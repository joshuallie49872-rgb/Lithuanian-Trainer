import json
import pathlib

LESSONS_DIR = pathlib.Path("lessons")

def fix_file(path):
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # Only convert if old schema exists
    if "items" not in data:
        return False

    items = data.pop("items")
    questions = []

    for item in items:
        q = {
            "prompt": item.get("prompt", ""),
            "lt": item.get("lt", ""),
            "choices": item.get("choices", []),
        }

        # Convert answerIndex → answer string
        idx = item.get("answerIndex")
        if idx is not None and q["choices"]:
            try:
                q["answer"] = q["choices"][idx]
            except IndexError:
                q["answer"] = ""

        # Preserve TTS if present
        if "tts" in item:
            if isinstance(item["tts"], dict):
                q["tts"] = item["tts"].get("text", "")
            else:
                q["tts"] = item["tts"]

        questions.append(q)

    data["questions"] = questions

    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return True


def main():
    changed = 0
    for file in LESSONS_DIR.glob("*.json"):
        if fix_file(file):
            changed += 1

    print(f"✔ Converted {changed} lesson files")

if __name__ == "__main__":
    main()
