import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # repo root
TARGET = "lt"

COURSE_JSON = ROOT / "courses" / TARGET / "course.json"
LESSONS_DIR = ROOT / "courses" / TARGET / "lessons"
OVERLAYS_DIR = ROOT / "courses" / TARGET / "overlays"

# Which native overlays to convert (only if the overlay file exists)
NATIVE_LANGS = ["en", "es", "ru"]

# Convert EVERYTHING after 001-basics (already converted)
BATCH_SIZE = 9999
SKIP_FIRST = 1

def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def hard_fail(msg: str):
    raise SystemExit("\nHARD FAIL: " + msg + "\nFix the file(s) above and re-run.\n")

def is_keyed_choices(choices):
    return (
        isinstance(choices, list)
        and len(choices) > 0
        and isinstance(choices[0], dict)
        and "key" in choices[0]
        and "label" in choices[0]
    )

def core_choice_keys(core_choices):
    if is_keyed_choices(core_choices):
        return [str(c.get("key", "")) for c in core_choices]
    if isinstance(core_choices, list):
        return [str(x) for x in core_choices]
    return []

def to_keyed_choices_from_strings(choice_strings):
    # Keys are the exact original strings so correctness won't change.
    return [{"key": s, "label": s} for s in choice_strings]

def normalize_questions_container(data: dict):
    """
    Ensure we have data["questions"] as the canonical list.
    If data has items[], we promote it to questions[].
    """
    questions = data.get("questions")
    if questions is None and isinstance(data.get("items"), list):
        data["questions"] = data["items"]
        data.pop("items", None)
        questions = data["questions"]
    if not isinstance(questions, list):
        return None
    return questions

def validate_correct_against_keys(lesson_path: Path, q_index: int, keys: list, correct):
    if correct is None:
        hard_fail(f"{lesson_path} q{q_index}: missing correct[] for choose question")
    if not isinstance(correct, list):
        hard_fail(f"{lesson_path} q{q_index}: correct must be an array")
    for ans in correct:
        if ans not in keys:
            hard_fail(f"{lesson_path} q{q_index}: correct '{ans}' not in choice keys {keys}")

def convert_core_lesson(lesson_path: Path):
    data = load_json(lesson_path)
    questions = normalize_questions_container(data)
    if questions is None:
        hard_fail(f"{lesson_path}: no questions[] (or items[]) list")

    changed = False
    core_keys_by_qindex = {}

    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        if q.get("type") != "choose":
            continue

        choices = q.get("choices")

        # Already keyed: validate correct[] against keys
        if is_keyed_choices(choices):
            keys = [str(c.get("key")) for c in choices]
            core_keys_by_qindex[i] = keys
            validate_correct_against_keys(lesson_path, i, keys, q.get("correct"))
            continue

        # String list: convert to keyed
        if isinstance(choices, list) and all(isinstance(x, str) for x in choices):
            keyed = to_keyed_choices_from_strings(choices)
            q["choices"] = keyed
            keys = [c["key"] for c in keyed]
            core_keys_by_qindex[i] = keys
            validate_correct_against_keys(lesson_path, i, keys, q.get("correct"))
            changed = True
        else:
            hard_fail(f"{lesson_path} q{i}: unknown choices format (expected list of strings or list of {{key,label}})")

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
        hard_fail(f"{overlay_path}: overlay missing questions[] list")

    # HARD STOP: overlay must align by index with core question list length
    # (we can only validate this if core has the lesson file length; done in main)
    changed = False

    for i, oq in enumerate(oqs):
        if not isinstance(oq, dict):
            continue

        if "choices" in oq and i in core_keys_by_qindex:
            ochoices = oq.get("choices")
            core_keys = core_keys_by_qindex.get(i, [])

            # If overlay already keyed: ensure keys match exactly
            if is_keyed_choices(ochoices):
                overlay_keys = [str(c.get("key")) for c in ochoices]
                if overlay_keys != core_keys:
                    hard_fail(f"{overlay_path} q{i}: overlay keys != core keys\noverlay={overlay_keys}\ncore={core_keys}")
                continue

            # If overlay is string labels: convert using core keys by index
            if isinstance(ochoices, list) and all(isinstance(x, str) for x in ochoices):
                if len(ochoices) != len(core_keys):
                    hard_fail(f"{overlay_path} q{i}: overlay choice count {len(ochoices)} != core choice count {len(core_keys)}")
                oq["choices"] = [{"key": k, "label": lbl} for k, lbl in zip(core_keys, ochoices)]
                changed = True
            else:
                hard_fail(f"{overlay_path} q{i}: unknown overlay choices format")

    if changed:
        save_json(overlay_path, overlay)

    return changed

def main():
    if not COURSE_JSON.exists():
        hard_fail(f"Missing {COURSE_JSON}")

    course = load_json(COURSE_JSON)
    lessons = course.get("lessons", [])
    ids = [l.get("id") for l in lessons if isinstance(l, dict) and l.get("id")]

    batch = ids[SKIP_FIRST:SKIP_FIRST + BATCH_SIZE]
    print(f"Converting {len(batch)} lessons to keyed choices (hard-stop validation ON)...")

    core_changed_count = 0
    overlay_changed_count = 0

    for lesson_id in batch:
        lesson_path = LESSONS_DIR / f"{lesson_id}.json"
        if not lesson_path.exists():
            hard_fail(f"Missing core lesson file: {lesson_path}")

        # Convert core; get key map
        core_changed, core_keys_by_qindex = convert_core_lesson(lesson_path)
        if core_changed:
            core_changed_count += 1

        # HARD STOP: overlay question count must match core question count
        core_data = load_json(lesson_path)
        core_qs = normalize_questions_container(core_data)
        core_len = len(core_qs)

        for lang in NATIVE_LANGS:
            overlay_path = OVERLAYS_DIR / lang / f"{lesson_id}.json"
            if overlay_path.exists():
                overlay_data = load_json(overlay_path)
                oqs = overlay_data.get("questions")
                if not isinstance(oqs, list):
                    hard_fail(f"{overlay_path}: overlay missing questions[]")
                if len(oqs) != core_len:
                    hard_fail(f"{overlay_path}: overlay questions len {len(oqs)} != core {core_len}")

            oc = convert_overlay_for_lesson(lesson_id, lang, core_keys_by_qindex)
            if oc:
                overlay_changed_count += 1

    print("\nDONE.")
    print(f"Core lessons changed: {core_changed_count}")
    print(f"Overlay files changed: {overlay_changed_count}")
    print("No hard fails => conversion is safe to commit/push.")

if __name__ == "__main__":
    main()
