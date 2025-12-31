import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # repo root
TARGET = "lt"

COURSE_JSON = ROOT / "courses" / TARGET / "course.json"
LESSONS_DIR = ROOT / "courses" / TARGET / "lessons"
OVERLAYS_DIR = ROOT / "courses" / TARGET / "overlays"

NATIVE_LANGS = ["en", "es", "ru"]
BATCH_SIZE = 25
SKIP_FIRST = 1  # skip 001-basics (already converted)

def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def is_keyed_choices(choices):
    return isinstance(choices, list) and len(choices) > 0 and isinstance(choices[0], dict) and "key" in choices[0] and "label" in choices[0]

def to_keyed_choices_from_strings(choice_strings):
    # Keys are the exact original strings so correctness doesn't break.
    return [{"key": s, "label": s} for s in choice_strings]

def core_choice_keys(core_choices):
    if is_keyed_choices(core_choices):
        return [c.get("key", "") for c in core_choices]
    if isinstance(core_choices, list):
        return [str(x) for x in core_choices]
    return []

def convert_core_lesson(lesson_path: Path):
    data = load_json(lesson_path)

    # tolerate either questions[] or items[]; prefer questions[]
    questions = data.get("questions")
    if questions is None and isinstance(data.get("items"), list):
        questions = data["items"]
        data["questions"] = questions
        data.pop("items", None)

    if not isinstance(questions, list):
        print(f"SKIP (no questions list): {lesson_path.name}")
        return False, None

    changed = False
    core_keys_by_qindex = {}

    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        if q.get("type") != "choose":
            continue

        choices = q.get("choices")
        if is_keyed_choices(choices):
            core_keys_by_qindex[i] = core_choice_keys(choices)
            continue

        if isinstance(choices, list) and all(isinstance(x, str) for x in choices):
            keyed = to_keyed_choices_from_strings(choices)
            q["choices"] = keyed
            changed = True
            core_keys_by_qindex[i] = [c["key"] for c in keyed]
        else:
            # unknown format
            core_keys_by_qindex[i] = core_choice_keys(choices)

    if changed:
        save_json(lesson_path, data)

    return changed, core_keys_by_qindex

def convert_overlay_for_lesson(lesson_id: str, lang: str, core_keys_by_qindex: dict):
    overlay_path = OVERLAYS_DIR / lang / f"{lesson_id}.json"
    if not overlay_path.exists():
        return False

    overlay = load_json(overlay_path)
    oqs = overlay.get("questions")
    if not isinstance(oqs, list):
        print(f"OVERLAY SKIP (no questions[]): {overlay_path}")
        return False

    changed = False

    for i, oq in enumerate(oqs):
        if not isinstance(oq, dict):
            continue

        # Only convert choices if overlay has them and core has keys for that question index
        if "choices" in oq and i in core_keys_by_qindex:
            ochoices = oq.get("choices")

            # If overlay already keyed, leave it
            if is_keyed_choices(ochoices):
                # optional: validate keys
                ok = [c.get("key") for c in ochoices]
                ck = core_keys_by_qindex.get(i, [])
                if ck and ok and ck != ok:
                    print(f"WARNING keys mismatch {lesson_id} [{lang}] q{i}: core!=overlay")
                continue

            # If overlay has string labels, convert to keyed using core keys by index
            if isinstance(ochoices, list) and all(isinstance(x, str) for x in ochoices):
                ck = core_keys_by_qindex.get(i, [])
                if len(ck) != len(ochoices):
                    print(f"WARNING choice count mismatch {lesson_id} [{lang}] q{i}: core {len(ck)} vs overlay {len(ochoices)}")
                    # still do best-effort zip
                new_choices = []
                for key, label in zip(ck, ochoices):
                    new_choices.append({"key": key, "label": label})
                oq["choices"] = new_choices
                changed = True
            else:
                # unknown overlay format; leave it
                pass

    if changed:
        save_json(overlay_path, overlay)

    return changed

def main():
    if not COURSE_JSON.exists():
        raise SystemExit(f"Missing course.json at {COURSE_JSON}")

    course = load_json(COURSE_JSON)
    lessons = course.get("lessons", [])
    ids = [l.get("id") for l in lessons if isinstance(l, dict) and l.get("id")]

    batch = ids[SKIP_FIRST:SKIP_FIRST + BATCH_SIZE]
    print(f"Converting {len(batch)} lessons to keyed choices:")
    print(", ".join(batch))

    core_changed_count = 0
    overlay_changed_count = 0

    for lesson_id in batch:
        lesson_path = LESSONS_DIR / f"{lesson_id}.json"
        if not lesson_path.exists():
            print(f"SKIP missing core lesson: {lesson_path}")
            continue

        core_changed, core_keys_by_qindex = convert_core_lesson(lesson_path)
        if core_changed:
            core_changed_count += 1

        # If we couldn't compute any keys, still try overlays but likely no-op
        if core_keys_by_qindex is None:
            core_keys_by_qindex = {}

        for lang in NATIVE_LANGS:
            oc = convert_overlay_for_lesson(lesson_id, lang, core_keys_by_qindex)
            if oc:
                overlay_changed_count += 1

    print(f"\nDONE.")
    print(f"Core lessons changed: {core_changed_count}")
    print(f"Overlay files changed: {overlay_changed_count}")
    print("If you saw WARNINGS, open those specific overlay/core files and fix counts/order.")

if __name__ == "__main__":
    main()
