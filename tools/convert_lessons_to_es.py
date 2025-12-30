import json, re
from pathlib import Path

# INPUT / OUTPUT
SRC_DIR = Path("lessons")        # existing Lithuanian lessons
OUT_DIR = Path("lessons_es")     # new Spanish lessons
OUT_DIR.mkdir(exist_ok=True)

# TRANSLATION MAP (START SMALL)
MAP = {
    "labas": "hola",
    "ačiū": "gracias",
    "prašau": "por favor",
    "viso gero": "adiós",
    "taip": "sí",
    "ne": "no",
}

def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def translate_text(s):
    key = norm(s)
    return MAP.get(key, s)

def translate_list(lst):
    return [translate_text(x) for x in (lst or [])]

def convert_question(q):
    q = dict(q)

    # convert Lithuanian target to Spanish
    if "lt" in q and q["lt"]:
        q["es"] = translate_text(q["lt"])

    if "choices" in q:
        q["choices"] = translate_list(q["choices"])

    if "correct" in q:
        q["correct"] = translate_list(q["correct"])

    # force Spanish TTS
    speak = q.get("es") or (q.get("correct") or [""])[0]
    if speak:
        q["tts"] = {"lang": "es-MX", "text": speak}

    return q

def main():
    files = list(SRC_DIR.glob("*.json"))
    if not files:
        print("❌ No lesson files found")
        return

    for src in files:
        with open(src, "r", encoding="utf-8") as f:
            data = json.load(f)

        if "questions" in data:
            data["questions"] = [convert_question(q) for q in data["questions"]]
        elif "items" in data:
            data["items"] = [convert_question(q) for q in data["items"]]
        else:
            print("Skipping unknown format:", src.name)
            continue

        out = OUT_DIR / src.name
        with open(out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print("✅ Created:", out)

if __name__ == "__main__":
    main()
