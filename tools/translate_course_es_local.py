import os, json, time
from pathlib import Path

import torch
from transformers import MarianMTModel, MarianTokenizer

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_IN = ROOT / "manifest.json"
OUT_DIR = ROOT / "lessons_es"
MANIFEST_OUT = ROOT / "manifest_es.json"

MODEL_NAME = "Helsinki-NLP/opus-mt-en-es"   # English -> Spanish

def load_model():
    tok = MarianTokenizer.from_pretrained(MODEL_NAME)
    model = MarianMTModel.from_pretrained(MODEL_NAME)
    model.eval()
    return tok, model

@torch.inference_mode()
def translate_batch(texts, tok, model, max_len=256):
    if not texts:
        return []
    batch = tok(texts, return_tensors="pt", padding=True, truncation=True, max_length=max_len)
    out = model.generate(**batch, max_length=max_len, num_beams=4)
    return [tok.decode(x, skip_special_tokens=True) for x in out]

def walk_strings(obj, out_list):
    """Collect references to all string fields we want to translate."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            # translate only these keys (safe)
            if k in ("en", "prompt", "title", "topic", "hint", "subtitle", "text"):
                if isinstance(v, str) and v.strip():
                    out_list.append((obj, k, v))
            else:
                walk_strings(v, out_list)
    elif isinstance(obj, list):
        for it in obj:
            walk_strings(it, out_list)

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(MANIFEST_IN.read_text(encoding="utf-8"))
    lessons = manifest.get("lessons", [])
    if not lessons:
        raise SystemExit("manifest.json has no lessons[]")

    # Write manifest_es.json (same lessons but point to lessons_es/)
    es_manifest = {"lessons": []}
    for L in lessons:
        es_manifest["lessons"].append({
            "id": L["id"],
            "title": L.get("title", L["id"]),   # will translate below
            "topic": L.get("topic", ""),
            "icon": L.get("icon", ""),
            "file": f"lessons_es/{L['id']}.json"
        })

    tok, model = load_model()

    # Translate manifest fields (title/topic)
    refs = []
    walk_strings(es_manifest, refs)
    texts = [v for (_, _, v) in refs]
    translated = translate_batch(texts, tok, model)
    for (obj, key, _), t in zip(refs, translated):
        obj[key] = t

    MANIFEST_OUT.write_text(json.dumps(es_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Wrote manifest_es.json")

    # Translate each lesson file
    for i, L in enumerate(lessons, start=1):
        in_path = ROOT / (L.get("file") or f"lessons/{L['id']}.json")
        if not in_path.exists():
            print(f"SKIP missing: {in_path}")
            continue

        data = json.loads(in_path.read_text(encoding="utf-8"))

        # Collect strings to translate (English UI text only)
        refs = []
        walk_strings(data, refs)

        # Batch translate in chunks (avoid huge batches)
        chunk = 24
        for start in range(0, len(refs), chunk):
            part = refs[start:start+chunk]
            src = [v for (_, _, v) in part]
            out = translate_batch(src, tok, model)
            for (obj, key, _), t in zip(part, out):
                obj[key] = t

        out_path = OUT_DIR / f"{L['id']}.json"
        out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[{i}/{len(lessons)}] Wrote {out_path}")

    print("DONE")

if __name__ == "__main__":
    main()
