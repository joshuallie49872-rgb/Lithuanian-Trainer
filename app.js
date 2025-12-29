/* =========================================================
   Lithuanian Trainer — app.js (v5.3.7)
   - Course Map with locked progression + topic/icon labels
   - Lesson engine (MCQ + type-in)
   - Speak button (Native MP3 first, fallback Web Speech)
   - Mikas emotion switching
   - Account button + Auth modal wiring (works with or without auth_ui.js)

   FIXES / UPGRADES (2025-12-28 -> v5.3.7):
   ✅ Dictation: NEVER reveal the answer text in UI (no more "labas" or "••••••")
      - Dictation card shows only: "🎧 Hear it — then type what you hear"
   ✅ Remove duplicate prompts:
      - renderQuestion() no longer writes into #prompt
      - Only setHeaderMode() controls #prompt (brand header line)
   ✅ MCQ: tapping a choice plays audio immediately (native MP3 if available),
      then submits the answer.
   ✅ Speak speed support:
      - speakLithuanian(text, rate) supports slow playback
      - Safe no-op if slow button doesn't exist yet
   ✅ Progress bar hooks:
      - Optional DOM ids: #lessonProgressText, #lessonProgressFill
      - Safe if not present (no errors)
   ✅ Better lesson-load errors for diagnosing missing lesson files (e.g. lesson 4)

   Notes:
   - Supports BOTH lesson formats:
     A) { questions: [...] }  (new)
     B) { items: [...] }      (older lessons/*.json)
   ========================================================= */

"use strict";

/* -----------------------------
   Helpers
----------------------------- */
const el = (id) => document.getElementById(id);
const show = (node, yes = true) => {
  if (!node) return;
  node.style.display = yes ? "" : "none";
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -----------------------------
   SFX
----------------------------- */
const SFX = {
  correct: new Audio("audio/sfx/correct.wav"),
  wrong: new Audio("audio/sfx/wrong.mp3"),
  complete: new Audio("audio/sfx/level-complete.mp3"),
};

// Avoid delay on first play
Object.values(SFX).forEach((a) => {
  a.preload = "auto";
  a.volume = 0.6;
});

function playSfx(name) {
  const a = SFX[name];
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

/* -----------------------------
   Storage keys
----------------------------- */
const LS = {
  progress: "lt_progress_v1",
  streak: "lt_streak_v1",
  lastLesson: "lt_last_lesson_v1",
  user: "lt_user_v1",

  // learning mode selection (placeholder)
  learningMode: "lt_learning_mode_v1",

  // (future) mikas toggle etc.
};

/* -----------------------------
   Learning mode (placeholder)
----------------------------- */
let learningMode = localStorage.getItem(LS.learningMode) || "en_to_lt";
function saveLearningMode(mode) {
  learningMode = mode || "en_to_lt";
  localStorage.setItem(LS.learningMode, learningMode);
}

/* -----------------------------
   Native audio manifest (MP3)
----------------------------- */
const LT_AUDIO_MANIFEST_URL = "audio/lt/manifest.json";
let ltAudioMap = null; // { slug: "audio/lt/<file>" }
let audioPlayer = null; // HTMLAudioElement

// IMPORTANT: must match how audio/lt/manifest.json keys were generated:
// any non [a-z0-9] becomes "_"
function slugifyLt(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function loadLtAudioManifest() {
  try {
    const res = await fetch(LT_AUDIO_MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const m = await res.json();
    return m && typeof m === "object" ? m : null;
  } catch {
    return null;
  }
}

/* -----------------------------
   App state
----------------------------- */
let manifest = null; // { lessons: [...] }
let lessonData = null; // current lesson JSON
let lessonIndex = 0; // index in manifest.lessons
let qIndex = 0; // question index
let streak = 0;
let progress = loadProgress(); // { completedLessonIds: [], best: {...} }

let currentScreen = "home"; // home|lesson|map|done
let currentQuestion = null; // active question object
let isAnswered = false;

/* -----------------------------
   DOM refs (expected ids)
----------------------------- */
const DOM = {
  title: el("title"),
  prompt: el("prompt"),

  // brand header refs
  brandLogo: el("brandLogo"),
  brandText: el("brandText"),

  controls: {
    prevBtn: el("prevBtn"),
    speakBtn: el("speakBtn"),
    // OPTIONAL (we will add in index.html later)
    speakSlowBtn: el("speakSlowBtn"),

    mapBtn: el("mapBtn"),
    resetBtn: el("resetBtn"),
    accountBtn: el("accountBtn"),
    accountDot: el("accountDot"),
  },

  screens: {
    home: el("screenHome"),
    lesson: el("screenLesson"),
    map: el("screenMap"),
    done: el("screenDone"),
  },

  // Home
  startBtn: el("startBtn"),
  continueBtn: el("continueBtn"),
  learningModeSelect: el("learningModeSelect"),

  // Lesson UI
  lessonHeader: document.querySelector(".lessonHeader"),
  lessonPromptPretty: el("lessonPromptPretty"),
  answers: el("answers"),
  inputWrap: el("inputWrap"),
  input: el("answerInput"),
  checkBtn: el("checkBtn"),
  nextBtn: el("nextBtn"),
  feedback: el("feedback"),

  // OPTIONAL progress (we will add in index.html later)
  lessonProgressText: el("lessonProgressText"),
  lessonProgressFill: el("lessonProgressFill"),

  // Map
  mapWrap: el("mapWrap"),
  mapNodes: el("mapNodes"),
  mapSvg: el("mapSvg"),

  // Done
  doneTitle: el("doneTitle"),
  doneBody: el("doneBody"),
  doneBtn: el("doneBtn"),

  // Mikas
  mikasImg: el("mikasImg"),
  mikasBubble: el("mikasBubble"),

  // Auth modal
  authModal: el("authModal"),
};

/* -----------------------------
   Brand header helper
----------------------------- */
function setHeaderMode(mode, meta = null) {
  // mode: "home" | "lesson" | "map" | "done"
  // Keep brand logo always visible, but change the small prompt line

  if (DOM.brandLogo) {
    DOM.brandLogo.onerror = () => {
      if (DOM.brandLogo) DOM.brandLogo.style.display = "none";
      if (DOM.brandText) DOM.brandText.style.display = "block";
    };
  }

  // Hide ugly title always (we're using logo now)
  if (DOM.title) DOM.title.style.display = "none";

  if (!DOM.prompt) return;

  if (mode === "home") {
    DOM.prompt.textContent =
      "Play short lessons to learn Lithuanian — start fresh or continue your progress.";
    return;
  }

  if (mode === "map") {
    DOM.prompt.textContent =
      "Course Map — tap a node to play. 🔒 Lessons unlock in order.";
    return;
  }

  if (mode === "done") {
    DOM.prompt.textContent = "Nice work — keep going.";
    return;
  }

  // ✅ IMPORTANT: in lesson mode, DO NOT show the current question word here
  // (avoids duplicate prompt). Keep it high-level.
  if (mode === "lesson" && meta) {
    DOM.prompt.textContent =
      `${meta.icon ? meta.icon + " " : ""}${meta.title}${meta.topic ? " — " + meta.topic : ""}`;
    return;
  }

  DOM.prompt.textContent = "";
}

/* -----------------------------
   Mikas emotion images
----------------------------- */
const MIKAS = {
  neutral: "mikas/neutral.png",
  thinking: "mikas/thinking.png",
  happy: "mikas/happy.png",
  sad: "mikas/sad.png",
  proud: "mikas/proud.png",
  celebrate: "mikas/celebrate.png",
};

function setMikas(emotion, bubbleText = "") {
  const src = MIKAS[emotion] || MIKAS.neutral;
  if (DOM.mikasImg) DOM.mikasImg.src = src;
  if (DOM.mikasBubble) {
    DOM.mikasBubble.textContent = bubbleText || "";
    DOM.mikasBubble.style.opacity = bubbleText ? "1" : "0";
    DOM.mikasBubble.style.display = bubbleText ? "block" : "none";
  }
}

/* -----------------------------
   Progress (MIGRATION SAFE)
----------------------------- */
function loadProgress() {
  try {
    const raw = localStorage.getItem(LS.progress);
    if (!raw) return { completedLessonIds: [], best: {} };

    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return { completedLessonIds: [], best: {} };

    let ids =
      p.completedLessonIds ||
      p.completedLessonsIds ||
      p.completedLessons ||
      p.completedLessonsIds ||
      [];

    if (!Array.isArray(ids)) ids = [];

    ids = ids
      .map((x) => (typeof x === "string" ? x : x && x.id ? x.id : ""))
      .filter(Boolean);

    const best = p.best && typeof p.best === "object" ? p.best : {};

    return { completedLessonIds: ids, best };
  } catch {
    return { completedLessonIds: [], best: {} };
  }
}

function saveProgress() {
  localStorage.setItem(LS.progress, JSON.stringify(progress));
}

function isLessonCompleted(lessonId) {
  return progress.completedLessonIds.includes(lessonId);
}

function unlockIndex() {
  let maxUnlocked = 0;
  for (let i = 0; i < manifest.lessons.length; i++) {
    if (i === 0) {
      maxUnlocked = 0;
      continue;
    }
    const prevId = manifest.lessons[i - 1].id;
    if (isLessonCompleted(prevId)) maxUnlocked = i;
    else break;
  }
  return maxUnlocked;
}

/* -----------------------------
   User/account (lightweight)
----------------------------- */
function getUser() {
  try {
    const raw = localStorage.getItem(LS.user);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function setUser(u) {
  localStorage.setItem(LS.user, JSON.stringify(u));
  refreshAccountDot();
}
function refreshAccountDot() {
  const u = getUser();
  if (DOM.controls.accountDot) DOM.controls.accountDot.style.opacity = u ? "1" : "0";
}

/* -----------------------------
   Screens
----------------------------- */
function setScreen(name) {
  currentScreen = name;
  if (DOM.screens.home) show(DOM.screens.home, name === "home");
  if (DOM.screens.lesson) show(DOM.screens.lesson, name === "lesson");
  if (DOM.screens.map) show(DOM.screens.map, name === "map");
  if (DOM.screens.done) show(DOM.screens.done, name === "done");
}

/* -----------------------------
   Manifest + lesson loading
----------------------------- */
async function loadManifest() {
  const res = await fetch("./manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load manifest.json");
  const m = await res.json();
  if (!m || !Array.isArray(m.lessons) || m.lessons.length === 0) {
    throw new Error("manifest.json missing lessons[]");
  }

  m.lessons = m.lessons.map((x) => ({
    id: x.id,
    title: x.title || x.id,
    topic: x.topic || "",
    icon: x.icon || "",
    file: x.file || `lessons/${x.id}.json`,
  }));

  return m;
}

// Convert {items:[...]} -> {questions:[...]}
function normalizeLessonToQuestions(data) {
  if (!data || typeof data !== "object") return data;

  if (Array.isArray(data.questions) && data.questions.length > 0) return data;

  if (Array.isArray(data.items) && data.items.length > 0) {
    const questions = data.items.map((it) => {
      const type = it.type || "";

      if (type === "choose") {
        const choices = Array.isArray(it.choices) ? it.choices.slice() : [];
        const idx = Number.isFinite(it.answerIndex) ? it.answerIndex : -1;
        const answer =
          idx >= 0 && idx < choices.length
            ? choices[idx]
            : it.answer || it.correctAnswer || "";

        return {
          type: "choose",
          prompt: it.prompt || "Pick the correct meaning",
          lt: it.lt || "",
          choices,
          correct: [answer].filter(Boolean),
          tts: it.tts || (it.lt ? { lang: "lt-LT", text: it.lt } : ""),
        };
      }

      if (type === "translate") {
        const correctList = Array.isArray(it.answers)
          ? it.answers.slice()
          : it.answer
          ? [it.answer]
          : [];

        return {
          type: "translate",
          prompt: it.prompt || "Translate to Lithuanian",
          en: it.en || "",
          correct: correctList.filter(Boolean),
          placeholder: "Type Lithuanian…",
          tts: it.tts || (correctList[0] ? { lang: "lt-LT", text: correctList[0] } : ""),
        };
      }

      return {
        prompt: it.prompt || "Question",
        lt: it.lt || "",
        en: it.en || "",
        choices: Array.isArray(it.choices) ? it.choices.slice() : [],
        correct: Array.isArray(it.answers) ? it.answers.slice() : it.answer ? [it.answer] : [],
        tts: it.tts || "",
      };
    });

    return { ...data, questions };
  }

  return data;
}

async function loadLessonByIndex(i) {
  lessonIndex = clamp(i, 0, manifest.lessons.length - 1);
  const meta = manifest.lessons[lessonIndex];

  const url = `./${meta.file}`;
  let res = null;

  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new Error(`Failed to fetch lesson file: ${url}`);
  }

  if (!res.ok) {
    // ✅ Better error for debugging "Lesson 4 won't load" (usually 404 / case mismatch)
    throw new Error(
      `Lesson file not found or failed to load (${res.status}): ${url}\n` +
        `Common cause on GitHub Pages: filename case mismatch (Windows vs web).`
    );
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      `Lesson JSON is invalid: ${url}\n` +
        `Fix the JSON (missing comma/quote) and push again.`
    );
  }

  data = normalizeLessonToQuestions(data);

  if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error(`Lesson ${meta.id} has no questions[] (or items[])`);
  }

  lessonData = data;
  qIndex = 0;
  streak = loadStreak();

  localStorage.setItem(LS.lastLesson, meta.id);
  return data;
}

/* -----------------------------
   Streak
----------------------------- */
function loadStreak() {
  const raw = localStorage.getItem(LS.streak);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}
function saveStreak() {
  localStorage.setItem(LS.streak, String(streak));
}

/* -----------------------------
   Lesson rendering
----------------------------- */
function setControlsForQuestion(hasPrev) {
  show(DOM.controls.prevBtn, hasPrev);
  show(DOM.controls.resetBtn, true);
  show(DOM.controls.mapBtn, true);

  if (DOM.controls.speakBtn) DOM.controls.speakBtn.style.display = "none";
  if (DOM.controls.speakSlowBtn) DOM.controls.speakSlowBtn.style.display = "none";
}

function getSpeakText(q) {
  if (!q) return "";
  if (q.tts && typeof q.tts === "object" && q.tts.text) return String(q.tts.text);
  if (typeof q.tts === "string" && q.tts.trim()) return q.tts;
  if (typeof q.lt === "string" && q.lt.trim()) return q.lt;
  if (Array.isArray(q.correct) && q.correct[0]) return String(q.correct[0]);
  return "";
}

function shouldSpeakForMode(q) {
  if (!q) return false;

  // What language is being learned (target)
  const target =
    learningMode === "en_to_lt" ? "lt" :
    learningMode === "lt_to_en" ? "en" :
    null;

  if (!target) return false;

  // If TTS explicitly declares language
  if (q.tts && typeof q.tts === "object" && q.tts.lang) {
    return q.tts.lang.startsWith(target);
  }

  // Fallback inference
  if (target === "lt" && q.lt) return true;
  if (target === "en" && q.en) return true;

  return false;
}


function ensureLessonHeaderVisible() {
  const header = document.querySelector(".lessonHeader");
  if (header) header.style.display = "block";
}

function formatPrettyPrompt(q) {
  const p = q && q.prompt ? String(q.prompt) : "";
  const lt = q && q.lt ? String(q.lt) : "";
  const en = q && q.en ? String(q.en) : "";

  if (learningMode === "lt_to_en") {
    const main = lt || en || p || "";
    return p ? `${main} — ${p}` : main;
  }

  const main = lt || en || p || "";
  return p ? `${main} — ${p}` : main;
}

// Stronger normalization: accent-insensitive + consistent punctuation stripping
function normalizeAnswer(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9\s'"-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -----------------------------
   Dictation + close-match helpers
----------------------------- */
function getCorrectList(q) {
  let correct =
    Array.isArray(q.correct)
      ? q.correct
      : q.answer != null
      ? [q.answer]
      : q.correctAnswer != null
      ? [q.correctAnswer]
      : [];

  // If no correct answer but there IS TTS text, treat that as the correct answer.
  if (!correct || correct.length === 0) {
    if (q.tts && typeof q.tts === "object" && q.tts.text) correct = [q.tts.text];
    else if (typeof q.tts === "string" && q.tts.trim()) correct = [q.tts.trim()];
  }

  correct = (correct || []).map((x) => String(x || "").trim()).filter(Boolean);
  return correct;
}

function levenshtein(a, b) {
  a = a || "";
  b = b || "";
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarityScore(a, b) {
  a = normalizeAnswer(a);
  b = normalizeAnswer(b);
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - dist / maxLen; // 0..1
}

function isCloseEnough(userN, correctN) {
  if (!userN || !correctN) return false;
  if (userN === correctN) return true;

  const d = levenshtein(userN, correctN);
  const L = Math.max(userN.length, correctN.length);

  if (L <= 5) return d <= 1;
  return d <= 2;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* -----------------------------
   Progress UI (optional)
----------------------------- */
function updateLessonProgressUI() {
  if (!lessonData || !Array.isArray(lessonData.questions)) return;

  const total = lessonData.questions.length || 1;
  const cur = clamp(qIndex + 1, 1, total);
  const pct = Math.round((cur / total) * 100);

  if (DOM.lessonProgressText) {
    DOM.lessonProgressText.textContent = `Question ${cur} of ${total} (${pct}%)`;
  }
  if (DOM.lessonProgressText) {
    DOM.lessonProgressText.textContent = "";
  }
  if (DOM.lessonProgressFill) {
    DOM.lessonProgressFill.style.width = `${pct}%`;
  }
}

function renderQuestion() {
  isAnswered = false;
  currentQuestion = lessonData.questions[qIndex];
  if (!currentQuestion) return;

  setControlsForQuestion(qIndex > 0);

  const meta = manifest.lessons[lessonIndex];
  setHeaderMode("lesson", meta);

  updateLessonProgressUI();

  const type = currentQuestion.type || "";
  const p = (currentQuestion.prompt || "").trim();
  const lt = (currentQuestion.lt || "").trim();
  const en = (currentQuestion.en || "").trim();

  const correctListRaw = getCorrectList(currentQuestion);
  const speakText = getSpeakText(currentQuestion);

  const hasChoices = Array.isArray(currentQuestion.choices) && currentQuestion.choices.length > 0;

  // Dictation-style: no visible lt/en, has speakText, expects typing, has correct answer, no choices
  const isDictation = !lt && !en && !!speakText && correctListRaw.length > 0 && !hasChoices;

  // ✅ IMPORTANT: DO NOT set #prompt here (prevents duplicate prompt lines)
  // Header prompt is controlled only by setHeaderMode().

  // Speak button (normal)
  if (DOM.controls.speakBtn) {
    if (speakText && shouldSpeakForMode(currentQuestion)) {
      DOM.controls.speakBtn.style.display = "";
      DOM.controls.speakBtn.onclick = () => speakLithuanian(speakText, 0.95);
    } else {
      DOM.controls.speakBtn.style.display = "none";
      DOM.controls.speakBtn.onclick = null;
    }
  }

  // Speak button (slow) — safe if missing in index
  if (DOM.controls.speakSlowBtn) {
    if (speakText) {
      DOM.controls.speakSlowBtn.style.display = "";
      DOM.controls.speakSlowBtn.onclick = () => speakLithuanian(speakText, 0.45);
    } else {
      DOM.controls.speakSlowBtn.style.display = "none";
      DOM.controls.speakSlowBtn.onclick = null;
    }
  }

  ensureLessonHeaderVisible();

  // ✅ Dictation UI: show ONLY instruction. Never show the answer word.
  if (DOM.lessonHeader && DOM.lessonPromptPretty) {
    show(DOM.lessonHeader, true);

    if (isDictation || (type === "translate" && !en && !!speakText)) {
      DOM.lessonHeader.style.display = "";
      DOM.lessonPromptPretty.innerHTML =
        `<div class="listenTag">🎧 Hear it — then type what you hear</div>`;
    } else {
      // Non-dictation: show main/sub prompt in card
      const main = (currentQuestion.lt || currentQuestion.en || "").trim();
      const sub = (currentQuestion.prompt || "").trim();

      DOM.lessonHeader.style.display = "";
      DOM.lessonPromptPretty.innerHTML = `
        <div class="lpMain">${escapeHtml(main)}</div>
        <div class="lpSub">${escapeHtml(sub)}</div>
      `.trim();
    }
  }

  if (DOM.feedback) DOM.feedback.textContent = "";
  show(DOM.nextBtn, false);

  setMikas("neutral");

  if (DOM.answers) DOM.answers.className = "choices";
  if (DOM.answers) DOM.answers.innerHTML = "";
  show(DOM.inputWrap, false);

  if (hasChoices) renderChoices(currentQuestion);
  else renderTextInput(currentQuestion);
}

function renderChoices(q) {
  show(DOM.inputWrap, false);

  const choices = q.choices.slice();

  // Shuffle by default unless explicitly disabled
  const doShuffle = q.shuffle !== false;
  if (doShuffle) choices.sort(() => Math.random() - 0.5);

  for (const choice of choices) {
    const b = document.createElement("button");
    b.className = "choice btn btn-ghost";
    b.textContent = choice;

    b.onclick = async () => {
      if (isAnswered) return;

    // Speak ONLY if target language matches learning mode
    try {
      if (shouldSpeakForMode(q)) {
        const speakText =
          learningMode === "en_to_lt"
            ? (q.lt || "")
            : learningMode === "lt_to_en"
            ? (q.en || "")
            : "";

        if (speakText.trim()) {
          speakLithuanian(speakText, 0.95);
          await sleep(140);
        }
      }
    } catch {}

    if (isAnswered) return;
    checkAnswer(choice);
    };


    DOM.answers.appendChild(b);
  }
}

function renderTextInput(q) {
  show(DOM.inputWrap, true);

  if (DOM.input) {
    DOM.input.type = "text"; // ✅ never password dots
    DOM.input.value = "";
    DOM.input.placeholder = q.placeholder || "Type your answer…";
    DOM.input.oninput = () => {
      if (!isAnswered) setMikas("thinking");
    };
    DOM.input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!isAnswered) checkAnswer((DOM.input.value || "").trim());
      }
    };
  }

  if (DOM.checkBtn) {
    DOM.checkBtn.onclick = () => {
      if (isAnswered) return;
      checkAnswer((DOM.input?.value || "").trim());
    };
  }
}

function checkAnswer(userValue) {
  isAnswered = true;

  const q = currentQuestion;
  const correct = getCorrectList(q);

  const userN = normalizeAnswer(userValue);
  const correctNList = correct.map(normalizeAnswer);

  const ok = correctNList.includes(userN) || correctNList.some((c) => isCloseEnough(userN, c));

  let closeScore = 0;
  if (!ok && userN && correct && correct.length > 0) {
    closeScore = Math.max(...correct.map((c) => similarityScore(userValue, c)));
  }
  const isClose = !ok && closeScore >= 0.88;

  if (ok) {
    playSfx("correct");

    streak += 1;
    saveStreak();

    if (streak === 5 || streak === 10 || streak === 15) {
      setMikas("proud", `🔥 Streak ${streak}!`);
    } else {
      setMikas("happy", streak >= 2 ? `Nice! 🔥${streak}` : "Nice!");
    }

    setFeedback("✅ Correct!", "ok");
    markChoiceButtons(userValue, true);
  } else {
    if (isClose) {
      setMikas("thinking", "So close…");
      setFeedback(`🟡 Almost. Check spelling. (${Math.round(closeScore * 100)}%)`, "bad");
      // do NOT reset streak for close
    } else {
      playSfx("wrong");
      streak = 0;
      saveStreak();

      setMikas("sad", "Oops…");

      const showCorrect = correct[0] != null ? String(correct[0]) : "";
      setFeedback(`❌ Not quite.${showCorrect ? " Answer: " + showCorrect : ""}`, "bad");
    }

    markChoiceButtons(userValue, false);
  }

  show(DOM.nextBtn, true);
  if (DOM.nextBtn) DOM.nextBtn.onclick = () => nextQuestion();
}

function markChoiceButtons(userValue, wasCorrect) {
  if (!DOM.answers) return;
  const btns = Array.from(DOM.answers.querySelectorAll("button.choice"));
  if (btns.length === 0) return;

  const q = currentQuestion;
  const correct = getCorrectList(q);
  const correctN = correct.map(normalizeAnswer);

  for (const b of btns) {
    b.disabled = true;
    const t = normalizeAnswer(b.textContent);
    if (correctN.includes(t)) b.classList.add("choice-correct");
    if (!wasCorrect && normalizeAnswer(userValue) === t) b.classList.add("choice-wrong");
  }
}

function setFeedback(text, kind) {
  if (!DOM.feedback) return;
  DOM.feedback.textContent = text;
  DOM.feedback.className =
    "feedback " + (kind === "ok" ? "feedback-ok" : kind === "bad" ? "feedback-bad" : "");
}

/* -----------------------------
   Next / prev / reset
----------------------------- */
function prevQuestion() {
  if (qIndex <= 0) return;
  qIndex -= 1;
  renderQuestion();
}
function nextQuestion() {
  if (qIndex < lessonData.questions.length - 1) {
    qIndex += 1;
    renderQuestion();
    return;
  }
  onLessonComplete();
}
function resetLesson() {
  qIndex = 0;
  streak = 0;
  saveStreak();
  renderQuestion();
}

/* -----------------------------
   Lesson complete
----------------------------- */
function onLessonComplete() {
  const meta = manifest.lessons[lessonIndex];

  if (!isLessonCompleted(meta.id)) {
    progress.completedLessonIds.push(meta.id);
  }
  saveProgress();

  playSfx("complete");

  setMikas("celebrate", "Lesson complete!");
  setScreen("done");
  setHeaderMode("done");

  if (DOM.doneTitle) DOM.doneTitle.textContent = "✅ Complete!";
  if (DOM.doneBody) {
    const nextMeta = manifest.lessons[clamp(lessonIndex + 1, 0, manifest.lessons.length - 1)];
    DOM.doneBody.textContent =
      lessonIndex < manifest.lessons.length - 1
        ? `Next unlocked: ${nextMeta.icon ? nextMeta.icon + " " : ""}${nextMeta.title}`
        : "You finished all lessons 🎉";
  }

  if (DOM.doneBtn) {
    DOM.doneBtn.onclick = () => {
      setScreen("map");
      setHeaderMode("map");
      renderMap();
    };
  }
}

/* -----------------------------
   Map rendering
----------------------------- */
function renderMap() {
  setControlsForQuestion(false);
  setHeaderMode("map");

  setScreen("map");

  const wrap = DOM.mapWrap;
  const nodesEl = DOM.mapNodes;
  const svg = DOM.mapSvg;
  if (!wrap || !nodesEl || !svg) return;

  nodesEl.innerHTML = "";
  svg.innerHTML = "";

  svg.style.pointerEvents = "none";

  const W = Math.max(320, wrap.clientWidth);
  const topPad = 40;
  const stepY = 86;
  const nodeR = 35;

  const lessonCount = manifest.lessons.length;
  const H = topPad * 2 + (lessonCount - 1) * stepY + 120;

  svg.style.height = `${H}px`;
  nodesEl.style.height = `${H}px`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const xs = [Math.round(W * 0.3), Math.round(W * 0.7), Math.round(W * 0.35), Math.round(W * 0.65)];

  const maxUnlocked = unlockIndex();

  for (let i = 0; i < lessonCount - 1; i++) {
    const x1 = xs[i % xs.length];
    const y1 = topPad + i * stepY;
    const x2 = xs[(i + 1) % xs.length];
    const y2 = topPad + (i + 1) * stepY;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const midY = (y1 + y2) / 2;
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", "6");

    const unlockedEdge = i < maxUnlocked;
    path.setAttribute("stroke", unlockedEdge ? "currentColor" : "rgba(0,0,0,0.12)");
    path.setAttribute("opacity", unlockedEdge ? "0.35" : "0.18");
    svg.appendChild(path);
  }

  for (let i = 0; i < lessonCount; i++) {
    const meta = manifest.lessons[i];
    const x = xs[i % xs.length];
    const y = topPad + i * stepY;

    const unlocked = i === 0 || i <= maxUnlocked;
    const completed = isLessonCompleted(meta.id);

    const btn = document.createElement("button");
    btn.className = "mapNode";
    btn.dataset.idx = String(i);
    btn.style.left = `${x - nodeR}px`;
    btn.style.top = `${y - nodeR}px`;
    btn.style.width = `${nodeR * 2}px`;
    btn.style.height = `${nodeR * 2}px`;

    const icon = meta.icon || (completed ? "✅" : unlocked ? "▶️" : "🔒");
    btn.innerHTML = `<div class="mapNodeInner">
        <div class="mapNodeIcon">${icon}</div>
        <div class="mapNodeNum">${i + 1}</div>
      </div>`;

    if (!unlocked) {
      btn.disabled = true;
      btn.classList.add("mapNode-locked");
    }
    if (completed) btn.classList.add("mapNode-done");

    const label = document.createElement("div");
    label.className = "mapLabel";
    const topicText = meta.topic ? ` — ${meta.topic}` : "";
    label.textContent = `${meta.title}${topicText}`;
    label.style.left = `${x}px`;
    label.style.top = `${y + nodeR + 10}px`;
    label.style.transform = "translateX(-50%)";
    label.style.opacity = unlocked ? "0.92" : "0.35";

    nodesEl.appendChild(btn);
    nodesEl.appendChild(label);
  }

  nodesEl.onclick = async (e) => {
    const btn = e.target.closest?.("button.mapNode");
    if (!btn || btn.disabled) return;
    const idx = parseInt(btn.dataset.idx || "-1", 10);
    if (!Number.isFinite(idx) || idx < 0) return;
    await startLesson(idx);
  };
}

/* -----------------------------
   Start/continue logic
----------------------------- */
async function startLesson(i) {
  try {
    await loadLessonByIndex(i);
    setScreen("lesson");
    setHeaderMode("lesson", manifest.lessons[lessonIndex]);
    renderQuestion();
  } catch (err) {
    console.error(err);
    alert(String(err?.message || "Lesson data is missing or failed to load."));
  }
}

async function startFromContinue() {
  const lastId = localStorage.getItem(LS.lastLesson);
  if (!lastId) return startLesson(0);

  const idx = manifest.lessons.findIndex((l) => l.id === lastId);
  return startLesson(idx >= 0 ? idx : 0);
}

/* -----------------------------
   Speak (Native MP3 first, fallback Web Speech)
----------------------------- */
function speakLithuanian(text, rate = 0.95) {
  try {
    const raw = String(text || "").trim();
    if (!raw) return;

    // 1) Native MP3 (preferred)
    const key = slugifyLt(raw);
    const src = ltAudioMap && (ltAudioMap[key] || ltAudioMap[raw]);

    if (src) {
      if (!audioPlayer) audioPlayer = new Audio();
      audioPlayer.pause();
      audioPlayer.currentTime = 0;
      audioPlayer.src = src;

      // ✅ NEW: playback rate support (slow button)
      audioPlayer.playbackRate = clamp(Number(rate) || 1.0, 0.5, 1.25);

      audioPlayer.play().catch(() => {});
      return;
    }

    // 2) Fallback: Web Speech API (may not have LT voice)
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(raw);
    u.lang = "lt-LT";
    u.rate = clamp(Number(rate) || 0.95, 0.5, 1.25);

    const voices = window.speechSynthesis.getVoices?.() || [];
    const lt = voices.find((v) => (v.lang || "").toLowerCase().startsWith("lt"));
    if (lt) u.voice = lt;

    window.speechSynthesis.speak(u);
  } catch {
    // silent
  }
}

/* -----------------------------
   Auth modal wiring
----------------------------- */
function openAuth() {
  if (window.AuthUI && typeof window.AuthUI.open === "function") {
    window.AuthUI.open();
    return;
  }

  if (!DOM.authModal) return;

  DOM.authModal.style.display = "";
  DOM.authModal.setAttribute("aria-hidden", "false");

  const backdrop = DOM.authModal.querySelector(".modal-backdrop");
  const closeBtns = DOM.authModal.querySelectorAll("[data-close='1'], .modal-close");

  const close = () => {
    DOM.authModal.style.display = "none";
    DOM.authModal.setAttribute("aria-hidden", "true");
  };

  if (backdrop) backdrop.onclick = close;
  closeBtns.forEach((b) => (b.onclick = close));
}

/* -----------------------------
   Events / init
----------------------------- */
function wireEvents() {
  if (DOM.controls.prevBtn) DOM.controls.prevBtn.onclick = () => prevQuestion();
  if (DOM.controls.mapBtn)
    DOM.controls.mapBtn.onclick = () => {
      setScreen("map");
      setHeaderMode("map");
      renderMap();
    };
  if (DOM.controls.resetBtn) DOM.controls.resetBtn.onclick = () => resetLesson();

  if (DOM.controls.accountBtn) {
    if (!(window.AuthUI && typeof window.AuthUI.open === "function")) {
      DOM.controls.accountBtn.onclick = () => openAuth();
    }
  }

  if (DOM.startBtn) DOM.startBtn.onclick = () => startLesson(0);
  if (DOM.continueBtn) DOM.continueBtn.onclick = () => startFromContinue();

  if (DOM.learningModeSelect) {
    DOM.learningModeSelect.value = learningMode;
    DOM.learningModeSelect.onchange = () => {
      saveLearningMode(DOM.learningModeSelect.value || "en_to_lt");
    };
  }

  if (DOM.doneBtn)
    DOM.doneBtn.onclick = () => {
      setScreen("map");
      setHeaderMode("map");
      renderMap();
    };

  window.addEventListener("resize", () => {
    if (currentScreen === "map") renderMap();
  });
}

async function init() {
  try {
    manifest = await loadManifest();

    // Load native audio map (if present)
    ltAudioMap = await loadLtAudioManifest();

    refreshAccountDot();
    wireEvents();

    setScreen("home");
    setHeaderMode("home");

    if ("speechSynthesis" in window) {
      await sleep(50);
      window.speechSynthesis.getVoices?.();
    }

    if (!DOM.screens.home && DOM.screens.map) {
      setScreen("map");
      setHeaderMode("map");
      renderMap();
    }
  } catch (err) {
    console.error(err);
    if (DOM.title) DOM.title.textContent = "Error";
    if (DOM.prompt) DOM.prompt.textContent = String(err?.message || err);
  }
}

init();
