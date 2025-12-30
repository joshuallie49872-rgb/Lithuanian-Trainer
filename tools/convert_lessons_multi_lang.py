import json, re
from pathlib import Path

SRC_DIR = Path("lessons")

LANGS = {
    # Latvian
    "lv": {
        "out_dir": Path("lessons_lv"),
        "tts_lang": "lv-LV",
        "map": {
            "labas": "sveiki",
            "ačiū": "paldies",
            "prašau": "lūdzu",
            "viso gero": "uz redzēšanos",
            "taip": "jā",
            "ne": "nē",
        },
    },
    # Estonian
    "et": {
        "out_dir": Path("lessons_et"),
        "tts_lang": "et-EE",
        "map": {
            "labas": "tere",
            "ačiū": "aitäh",
            "prašau": "palun",
            "viso gero": "nägemist",
            "taip": "jah",
            "ne": "ei",
        },
    },
    # Russian
    "ru": {
        "out_dir": Path("lessons_ru"),
        "tts_lang": "ru-RU",
        "map": {
            "labas": "привет",
            "ačiū": "спасибо",
            "prašau": "пожалуйста",
            "viso gero": "до свидания",
            "taip": "да",
            "ne": "нет",
        },
    },
    # Polish
    "pl": {
        "out_dir": Path("lessons_pl"),
        "tts_lang": "pl-PL",
        "map": {
            "labas": "cześć",
            "ačiū": "dziękuję",
            "prašau": "proszę",
            "viso gero": "do widzenia",
            "taip": "tak",
            "ne": "nie",
        },
    },
}

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def translate_text(s: str, mapping: dict) -> str:
    key = norm(s)
    return mapping.get(key, s)

def translate_list(lst, mapping):
    return [translate_text(x, mapping) for x in (lst or [])]

def convert_question(q: dict, lang_code: str, cfg: dict) -> dict:
    q = dict(q)
    mapping = cfg["map"]

    # source "lt" -> target language field (lv/et/ru/pl)
    if "lt" in q and q["lt"]:
        q[lang_code] = translate_text(q["lt"], mapping)

    if "choices" in q:
        q["choices"] = translate_list(q["choices"], mapping)

    if "correct" in q:
        q["correct"] = translate_list(q["correct"], mapping)

    # force TTS to target language (best effort)
    speak = q.get(lang_code) or (q.get("correct") or [""])[0]
    if speak:
        q["tts"] = {"lang": cfg["tts_lang"], "text": speak}

    return q

def convert_lesson(data: dict, lang_code: str, cfg: dict) -> dict:
    data = dict(data)

    if "questions" in data and isinstance(data["questions"], list):
        data["questions"] = [convert_question(x, lang_code, cfg) for x in data["questions"]]
        return data

    if "items" in data and isinstance(data["items"], list):
        data["items"] = [convert_question(x, lang_code, cfg) for x in data["items"]]
        return data

    return None

def main():
    files = list(SRC_DIR.glob("*.json"))
    if not files:
        print("❌ No lesson JSON files found in /lessons")
        return

    for lang_code, cfg in LANGS.items():
        out_dir = cfg["out_dir"]
        out_dir.mkdir(exist_ok=True)
        print(f"\n=== Building {lang_code} -> {out_dir}/ ===")

        for src in files:
            with open(src, "r", encoding="utf-8") as f:
                data = json.load(f)

            converted = convert_lesson(data, lang_code, cfg)
            if not converted:
                print(f"Skipping (unknown format): {src.name}")
                continue

            out_path = out_dir / src.name
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(converted, f, ensure_ascii=False, indent=2)

            print("✅ Created:", out_path)

if __name__ == "__main__":
    main()
