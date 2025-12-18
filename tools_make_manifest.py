import json, os, re

LESSONS_DIR = "lessons"
out_path = os.path.join(LESSONS_DIR, "manifest.json")

files = [
    f for f in os.listdir(LESSONS_DIR)
    if f.endswith(".json") and f != "manifest.json"
]

def lesson_num(lesson_id: str) -> int:
    m = re.match(r"^(\d{3})-", lesson_id)
    return int(m.group(1)) if m else 999999

entries = []
for f in files:
    path = os.path.join(LESSONS_DIR, f)
    with open(path, "r", encoding="utf-8") as fp:
        data = json.load(fp)
    lid = data.get("id") or f.replace(".json", "")
    title = data.get("title") or lid
    entries.append({"id": lid, "title": title})

entries.sort(key=lambda x: lesson_num(x["id"]))

manifest = {"version": 1, "lessons": entries}

with open(out_path, "w", encoding="utf-8") as fp:
    json.dump(manifest, fp, ensure_ascii=False, indent=2)

print(f"Wrote {out_path} with {len(entries)} lessons.")
