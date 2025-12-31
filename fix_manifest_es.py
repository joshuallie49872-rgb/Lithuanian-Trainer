import json

with open("manifest_es.json", "r", encoding="utf-8") as f:
    manifest = json.load(f)

for lesson in manifest.get("lessons", []):
    lesson["file"] = f"lessons_es/{lesson['id']}.json"

with open("manifest_es.json", "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print("OK: manifest_es.json now points to lessons_es/")
