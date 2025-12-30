import os, json, time, argparse, pathlib
from typing import Any, Dict, List, Tuple
from openai import OpenAI

client = OpenAI()

def read_json(p: pathlib.Path) -> Dict[str, Any]:
    return json.loads(p.read_text(encoding="utf-8"))

def write_json(p: pathlib.Path, obj: Dict[str, Any]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def normalize_to_questions(data: Dict[str, Any]) -> Dict[str, Any]:
    # supports both {questions:[...]} and older {items:[...]}
    if isinstance(data.get("questions"), list) and data["questions"]:
        return data
    if isinstance(data.get("items"), list) and data["items"]:
        questions = []
        for it in data["items"]:
            t = it.get("type", "")
            if t == "choose":
                choices = list(it.get("choices") or [])
                idx = it.get("answerIndex", -1)
                ans = ""
                if isinstance(idx, int) and 0 <= idx < len(choices):
                    ans = choices[idx]
                else:
                    ans = it.get("answer") or it.get("correctAnswer") or ""
                questions.append({
                    "type": "choose",
                    "prompt": it.get("prompt") or "Pick the correct meaning",
                    "lt": it.get("lt") or "",
                    "choices": choices,
                    "correct": [ans] if ans else [],
                    "tts": it.get("tts") or ({"lang": "lt-LT", "text": it.get("lt")} if it.get("lt") else "")
                })
            elif t == "translate":
                correct_list = list(it.get("answers") or [])
                if not correct_list and it.get("answer"):
                    correct_list = [it.get("answer")]
                questions.append({
                    "type": "translate",
                    "prompt": it.get("prompt") or "Translate to Lithuanian",
                    "en": it.get("en") or "",
                    "correct": [c for c in correct_list if c],
                    "placeholder": it.get("placeholder") or "Type Lithuanian…",
                    "tts": it.get("tts") or ({"lang": "lt-LT", "text": correct_list[0]} if correct_list else "")
                })
            else:
                questions.append(it)
        data = dict(data)
        data["questions"] = questions
    return data

def chunk(lst: List[str], n: int) -> List[List[str]]:
    return [lst[i:i+n] for i in range(0, len(lst), n)]

def translate_batch_es_mx(texts: List[str]) -> List[str]:
    # Keep output strictly aligned with input count/order.
    # Mexican Spanish, natural, not formal.
    sys = (
        "You are a native Mexican Spanish translator for a language-learning app.\n"
        "Translate ONLY the given Lithuanian text into natural Mexican Spanish.\n"
        "Keep it short and Duolingo-like.\n"
        "Return a JSON array of strings, same length/order as input.\n"
        "Do not add explanations."
    )
    inp = json.dumps(texts, ensure_ascii=False)

    for attempt in range(6):
        try:
            resp = client.responses.create(
                model="gpt-5.2",
                input=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": inp},
                ],
            )
            out = resp.output_text.strip()
            arr = json.loads(out)
            if isinstance(arr, list) and len(arr) == len(texts) and all(isinstance(x, str) for x in arr):
                return arr
            raise ValueError("Bad model output (not JSON array aligned).")
        except Exception as e:
            wait = 1.5 * (attempt + 1)
            print(f"[retry {attempt+1}] translate batch failed: {e} | waiting {wait:.1f}s")
            time.sleep(wait)
    # if it still fails:
    raise RuntimeError("Translation failed after retries.")

def looks_lithuanian(s: str) -> bool:
    if not s: return False
    # rough heuristic: Lithuanian diacritics or common endings
    diacritics = set("ąčęėįšųūž")
    if any(c in diacritics for c in s.lower()):
        return True
    lower = s.lower().strip()
    return lower.endswith(("as","is","us","ai","ei","os","es","ą","ę","ė","į","ų","ū"))

def patch_prompt_for_spanish(p: str) -> str:
    if not p: return p
    # keep English UI prompts but correct language name
    return (p.replace("Lithuanian", "Spanish")
             .replace("Lithuanian…", "Spanish…")
             .replace("to Lithuanian", "to Spanish"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="manifest.json")
    ap.add_argument("--src_lessons_dir", default="lessons")
    ap.add_argument("--out_manifest", default="manifest_es.json")
    ap.add_argument("--dst_lessons_dir", default="lessons_es")
    ap.add_argument("--batch_size", type=int, default=30)
    args = ap.parse_args()

    root = pathlib.Path(".").resolve()
    manifest_path = root / args.manifest
    src_dir = root / args.src_lessons_dir
    dst_dir = root / args.dst_lessons_dir

    m = read_json(manifest_path)
    if "lessons" not in m or not isinstance(m["lessons"], list):
        raise SystemExit("manifest.json missing lessons[]")

    # Write a Spanish manifest pointing to lessons_es/
    m_es = {"lessons": []}
    for lesson in m["lessons"]:
        lid = lesson.get("id")
        title = lesson.get("title") or lid
        topic = lesson.get("topic") or ""
        icon = lesson.get("icon") or "🇲🇽"
        # keep IDs same, just point file to lessons_es
        m_es["lessons"].append({
            "id": lid,
            "title": title,     # you can later translate titles too if you want
            "topic": topic,
            "icon": icon,
            "file": f"{args.dst_lessons_dir}/{lid}.json"
        })

    write_json(root / args.out_manifest, m_es)
    print(f"Wrote {args.out_manifest}")

    # Translate each lesson file
    for lesson in m_es["lessons"]:
        lid = lesson["id"]
        # original file resolution: either manifest file field OR default lessons/<id>.json
        orig_file = None
        for orig in m["lessons"]:
            if orig.get("id") == lid:
                orig_file = orig.get("file") or f"{args.src_lessons_dir}/{lid}.json"
                break
        src_path = root / orig_file
        dst_path = dst_dir / f"{lid}.json"

        data = normalize_to_questions(read_json(src_path))
        qs = data.get("questions") or []
        if not isinstance(qs, list) or not qs:
            print(f"SKIP {lid}: no questions")
            continue

        # Collect Lithuanian strings to translate (lt, correct answers that look Lithuanian, tts.text if Lithuanian)
        to_translate: List[Tuple[List[Any], str]] = []

        for qi, q in enumerate(qs):
            # prompt patch (no API needed)
            if isinstance(q.get("prompt"), str):
                q["prompt"] = patch_prompt_for_spanish(q["prompt"])
            if isinstance(q.get("placeholder"), str):
                q["placeholder"] = q["placeholder"].replace("Lithuanian", "Spanish")

            # lt field -> Spanish (we keep key name "lt" so app works with zero schema changes)
            lt = q.get("lt")
            if isinstance(lt, str) and lt.strip() and looks_lithuanian(lt):
                to_translate.append(([qi, "lt"], lt.strip()))

            # correct list -> if looks Lithuanian, translate to Spanish
            corr = q.get("correct")
            if isinstance(corr, list):
                for ci, c in enumerate(corr):
                    if isinstance(c, str) and c.strip() and looks_lithuanian(c):
                        to_translate.append(([qi, "correct", ci], c.strip()))

            # tts object text
            tts = q.get("tts")
            if isinstance(tts, dict) and isinstance(tts.get("text"), str):
                t = tts["text"].strip()
                if t and looks_lithuanian(t):
                    to_translate.append(([qi, "tts_text"], t))

        # Run translations in batches
        if to_translate:
            texts = [t[1] for t in to_translate]
            results: List[str] = []
            for part in chunk(texts, args.batch_size):
                out = translate_batch_es_mx(part)
                results.extend(out)
                time.sleep(0.2)

            # apply back
            for (path, _src), es in zip(to_translate, results):
                qi = path[0]
                key = path[1]
                if key == "lt":
                    qs[qi]["lt"] = es
                elif key == "correct":
                    ci = path[2]
                    qs[qi]["correct"][ci] = es
                elif key == "tts_text":
                    # convert tts to Spanish voice tag
                    if isinstance(qs[qi].get("tts"), dict):
                        qs[qi]["tts"]["text"] = es
                        qs[qi]["tts"]["lang"] = "es-MX"

        # also update any tts.lang that was lt-LT -> es-MX if it exists
        for q in qs:
            tts = q.get("tts")
            if isinstance(tts, dict) and isinstance(tts.get("lang"), str):
                if tts["lang"].lower().startswith("lt"):
                    tts["lang"] = "es-MX"

        data["questions"] = qs
        write_json(dst_path, data)
        print(f"Wrote {dst_path.as_posix()}")

    print("DONE. Next: wire app.js to load manifest_es.json when Spanish is selected.")

if __name__ == "__main__":
    main()
