/**
 * Pre-generate Lithuanian MP3 audio for all tts.text fields in lessons/*.json
 *
 * Expects:
 *  - .env with AZURE_SPEECH_KEY and AZURE_SPEECH_REGION
 *  - lessons/*.json files
 *
 * Outputs:
 *  - audio/lt/*.mp3
 *  - audio/lt/manifest.json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const speechsdk = require("microsoft-cognitiveservices-speech-sdk");

const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;

if (!KEY || !REGION) {
  console.error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION in .env");
  process.exit(1);
}

const LESSONS_DIR = path.resolve(process.cwd(), "lessons");
const OUT_DIR = path.resolve(process.cwd(), "audio", "lt");
fs.mkdirSync(OUT_DIR, { recursive: true });

function stableId(text) {
  return crypto.createHash("sha1").update(text.trim(), "utf8").digest("hex").slice(0, 16);
}

function sanitize(s) {
  return s.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

function collectTtsTexts(obj, out = []) {
  if (!obj) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectTtsTexts(item, out);
    return out;
  }
  if (typeof obj === "object") {
    if (obj.tts && typeof obj.tts.text === "string" && obj.tts.text.trim()) out.push(obj.tts.text.trim());
    if (typeof obj.ttsText === "string" && obj.ttsText.trim()) out.push(obj.ttsText.trim());
    for (const k of Object.keys(obj)) collectTtsTexts(obj[k], out);
  }
  return out;
}

function synthesizeMp3(text, outPath, voiceName = "lt-LT-LeonasNeural") {
  return new Promise((resolve, reject) => {
    const speechConfig = speechsdk.SpeechConfig.fromSubscription(KEY, REGION);

    speechConfig.speechSynthesisOutputFormat =
  speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;


    speechConfig.speechSynthesisVoiceName = voiceName;

    const audioConfig = speechsdk.AudioConfig.fromAudioFileOutput(outPath);
    const synthesizer = new speechsdk.SpeechSynthesizer(speechConfig, audioConfig);

    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === speechsdk.ResultReason.SynthesizingAudioCompleted) return resolve();
        return reject(new Error(`TTS failed: ${result.errorDetails || result.reason}`));
      },
      (err) => {
        synthesizer.close();
        reject(err);
      }
    );
  });
}

(async () => {
  if (!fs.existsSync(LESSONS_DIR)) {
    console.error(`Missing folder: ${LESSONS_DIR}\nCreate lessons/*.json first.`);
    process.exit(1);
  }

  const files = fs.readdirSync(LESSONS_DIR).filter((f) => f.toLowerCase().endsWith(".json"));
  if (!files.length) {
    console.error("No lessons/*.json found.");
    process.exit(1);
  }

  const manifest = {
    region: REGION,
    voice: "lt-LT-LeonasNeural",
    generatedAt: new Date().toISOString(),
    items: []
  };

  const seen = new Map();

  for (const file of files) {
    const full = path.join(LESSONS_DIR, file);
    const raw = fs.readFileSync(full, "utf8");
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error(`Invalid JSON: ${file}`);
      throw e;
    }

    const texts = collectTtsTexts(json, []);
    for (const t of texts) {
      if (!t.trim()) continue;
      if (!seen.has(t)) {
        const id = stableId(t);
        const nice = sanitize(t);
        const filename = `${id}_${nice}.mp3`;
        const rel = path.join("audio", "lt", filename);
        seen.set(t, { text: t, id, file: rel, sourceFile: file });
      }
    }
  }

  const all = Array.from(seen.values());
  console.log(`Found ${all.length} unique Lithuanian TTS lines.`);

  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    const outPath = path.join(process.cwd(), item.file);
    if (fs.existsSync(outPath)) {
      console.log(`[${i + 1}/${all.length}] exists, skip: ${path.basename(outPath)}`);
    } else {
      console.log(`[${i + 1}/${all.length}] generating: ${path.basename(outPath)}`);
      await synthesizeMp3(item.text, outPath);
    }
    manifest.items.push(item);
  }

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nDone.\nManifest: ${manifestPath}`);
})();
