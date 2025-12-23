import json, os, re

AUDIO_DIR = os.path.join("audio", "lt")
OUT_FILE = os.path.join(AUDIO_DIR, "manifest.json")

def main():
    if not os.path.isdir(AUDIO_DIR):
        raise SystemExit(f"Missing folder: {AUDIO_DIR}")

    mapping = {}
    count = 0

    for name in os.listdir(AUDIO_DIR):
        path = os.path.join(AUDIO_DIR, name)
        if not os.path.isfile(path):
            continue

        # allow no extension OR mp3
        base = name
        if base.lower().endswith(".mp3"):
            base_noext = base[:-4]
        else:
            base_noext = base

        # expect: <hash>_<slug>
        if "_" not in base_noext:
            continue

        _hash, slug = base_noext.split("_", 1)
        slug = slug.strip().lower()
        if not slug:
            continue

        # store relative path for browser
        rel = f"audio/lt/{name}"
        mapping[slug] = rel
        count += 1

    os.makedirs(AUDIO_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)

    print(f"Wrote {OUT_FILE} with {count} entries")

if __name__ == "__main__":
    main()
