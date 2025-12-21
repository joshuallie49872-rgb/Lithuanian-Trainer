/* =========================================================
   Lithuanian Trainer — app.js (v5.3.1 “Auth + Map labels”)
   - Course Map with locked progression + topic/icon labels
   - Lesson engine (MCQ + type-in)
   - Speak button (Web Speech, fallback-safe)
   - Mikas emotion switching
   - Account button + Auth modal wiring (works with or without auth_ui.js)
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
   Storage keys
----------------------------- */
const LS = {
  progress: "lt_progress_v1",
  streak: "lt_streak_v1",
  lastLesson: "lt_last_lesson_v1",
  user: "lt_user_v1",
};

/* -----------------------------
   App state
----------------------------- */
let manifest = null;            // { lessons: [...] }
let lessonData = null;          // current lesson JSON
let lessonIndex = 0;            // index in manifest.lessons
let qIndex = 0;                 // question index
let streak = 0;
let progress = loadProgress();  // { completedLessonIds: [], best: {...} }

let currentScreen = "home";     // home|lesson|map|done
let currentQuestion = null;     // active question object
let isAnswered = false;

/* -----------------------------
   DOM refs (expected ids)
----------------------------- */
const DOM = {
  title: el("title"),
  prompt: el("prompt"),
  controls: {
    prevBtn: el("prevBtn"),
    speakBtn: el("speakBtn"),
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

  // Lesson UI
  answers: el("answers"),
  inputWrap: el("inputWrap"),
  input: el("answerInput"),
  checkBtn: el("checkBtn"),
  nextBtn: el("nextBtn"),
  feedback: el("feedback"),

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

  // Auth modal (from index.html diff)
  authModal: el("authModal"),
};

/* -----------------------------
   Mikas emotion images
   (match your filenames if different)
----------------------------- */
const MIKAS = {
  neutral: "assets/mikas-neutral.png",
  thinking: "assets/mikas-thinking.png",
  happy: "assets/mikas-happy.png",
  sad: "assets/mikas-sad.png",
  proud: "assets/mikas-proud.png",
  celebrate: "assets/mikas-celebrate.png",
};

function setMikas(emotion, bubbleText = "") {
  const src = MIKAS[emotion] || MIKAS.neutral;
  if (DOM.mikasImg) DOM.mikasImg.src = src;
  if (DOM.mikasBubble) {
    DOM.mikasBubble.textContent = bubbleText || "";
    DOM.mikasBubble.style.opacity = bubbleText ? "1" : "0";
  }
}

/* -----------------------------
   Progress
----------------------------- */
function loadProgress() {
  try {
    const raw = localStorage.getItem(LS.progress);
    if (!raw) return { completedLessonIds: [], best: {} };
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.completedLessonIds)) return { completedLessonIds: [], best: {} };
    if (!p.best) p.best = {};
    return p;
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
  // unlocked = completed count (sequential)
  // lesson i is unlocked if i === 0 or previous lesson completed
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
  // dot ON if user exists
  const u = getUser();
  if (DOM.controls.accountDot) {
    DOM.controls.accountDot.style.opacity = u ? "1" : "0";
  }
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
  // Normalize lesson entries: { id, title?, topic?, icon?, file? }
  m.lessons = m.lessons.map((x) => ({
    id: x.id,
    title: x.title || x.id,
    topic: x.topic || "",
    icon: x.icon || "",
    file: x.file || `lessons/${x.id}.json`,
  }));
  return m;
}

async function loadLessonByIndex(i) {
  lessonIndex = clamp(i, 0, manifest.lessons.length - 1);
  const meta = manifest.lessons[lessonIndex];

  const res = await fetch(`./${meta.file}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${meta.file}`);
  const data = await res.json();

  // Normalize questions
  if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error(`Lesson ${meta.id} has no questions[]`);
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
  // speakBtn visible only if question has lt text to speak
  if (DOM.controls.speakBtn) DOM.controls.speakBtn.style.display = "none";
}

function renderQuestion() {
  isAnswered = false;
  currentQuestion = lessonData.questions[qIndex];
  if (!currentQuestion) return;

  // Title/prompt
  const meta = manifest.lessons[lessonIndex];
  if (DOM.title) DOM.title.textContent = `${meta.icon ? meta.icon + " " : ""}${meta.title}`;
  if (DOM.prompt) DOM.prompt.textContent = currentQuestion.prompt || "";

  // Reset feedback/buttons
  if (DOM.feedback) DOM.feedback.textContent = "";
  show(DOM.nextBtn, false);

  // Choose UI mode: multiple choice vs input
  const hasChoices = Array.isArray(currentQuestion.choices) && currentQuestion.choices.length > 0;
  const expectsText = !!currentQuestion.answer && !hasChoices;

  // speak button if lt present
  const speakText = currentQuestion.lt || currentQuestion.tts || currentQuestion.speak || "";
  if (DOM.controls.speakBtn) {
    if (speakText) {
      DOM.controls.speakBtn.style.display = "";
      DOM.controls.speakBtn.onclick = () => speakLithuanian(speakText);
    } else {
      DOM.controls.speakBtn.style.display = "none";
    }
  }

  // Mikas state
  setMikas("neutral");

  // Render answers
  if (DOM.answers) DOM.answers.innerHTML = "";
  show(DOM.inputWrap, false);

  if (hasChoices) {
    renderChoices(currentQuestion);
  } else if (expectsText) {
    renderTextInput(currentQuestion);
  } else {
    // fallback: treat as text input with empty
    renderTextInput(currentQuestion);
  }

  setControlsForQuestion(qIndex > 0);
}

function renderChoices(q) {
  show(DOM.inputWrap, false);

  const choices = q.choices.slice();
  // optional shuffle: q.shuffle === true
  if (q.shuffle) choices.sort(() => Math.random() - 0.5);

  for (const choice of choices) {
    const b = document.createElement("button");
    b.className = "choice";
    b.textContent = choice;
    b.onclick = () => {
      if (isAnswered) return;
      checkAnswer(choice);
    };
    DOM.answers.appendChild(b);
  }
}

function renderTextInput(q) {
  show(DOM.inputWrap, true);
  if (DOM.input) {
    DOM.input.value = "";
    DOM.input.placeholder = q.placeholder || "Type your answer…";
    DOM.input.oninput = () => {
      if (!isAnswered) setMikas("thinking");
    };
    DOM.input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!isAnswered) {
          const val = (DOM.input.value || "").trim();
          checkAnswer(val);
        }
      }
    };
  }
  if (DOM.checkBtn) {
    DOM.checkBtn.onclick = () => {
      if (isAnswered) return;
      const val = (DOM.input?.value || "").trim();
      checkAnswer(val);
    };
  }
}

function normalizeAnswer(s) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”"]/g, '"')
    .replace(/[’]/g, "'");
}

function checkAnswer(userValue) {
  isAnswered = true;

  const q = currentQuestion;
  const correct =
    Array.isArray(q.correct)
      ? q.correct
      : (q.answer != null ? [q.answer] : (q.correctAnswer != null ? [q.correctAnswer] : []));

  const userN = normalizeAnswer(userValue);
  const correctList = correct.map(normalizeAnswer);

  const ok = correctList.includes(userN);

  if (ok) {
    streak += 1;
    saveStreak();

    // Proud milestones
    if (streak === 5 || streak === 10 || streak === 15) {
      setMikas("proud", `🔥 Streak ${streak}!`);
    } else {
      setMikas("happy", streak >= 2 ? `Nice! 🔥${streak}` : "Nice!");
    }

    setFeedback("✅ Correct!", "ok");
    markChoiceButtons(userValue, true);
  } else {
    streak = 0;
    saveStreak();
    setMikas("sad", "Oops…");

    const showCorrect = correct[0] != null ? String(correct[0]) : "";
    setFeedback(`❌ Not quite.${showCorrect ? " Answer: " + showCorrect : ""}`, "bad");
    markChoiceButtons(userValue, false);
  }

  show(DOM.nextBtn, true);
  if (DOM.nextBtn) DOM.nextBtn.onclick = () => nextQuestion();
}

function markChoiceButtons(userValue, wasCorrect) {
  // Only applies to MCQ buttons
  if (!DOM.answers) return;
  const btns = Array.from(DOM.answers.querySelectorAll("button.choice"));
  if (btns.length === 0) return;

  const q = currentQuestion;
  const correct =
    Array.isArray(q.correct)
      ? q.correct
      : (q.answer != null ? [q.answer] : (q.correctAnswer != null ? [q.correctAnswer] : []));

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
  DOM.feedback.className = "feedback " + (kind === "ok" ? "feedback-ok" : kind === "bad" ? "feedback-bad" : "");
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
  // Lesson complete
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

  setMikas("celebrate", "Lesson complete!");
  setScreen("done");

  if (DOM.doneTitle) DOM.doneTitle.textContent = "✅ Complete!";
  if (DOM.doneBody) {
    const unlocked = unlockIndex();
    const nextMeta = manifest.lessons[clamp(lessonIndex + 1, 0, manifest.lessons.length - 1)];
    DOM.doneBody.textContent =
      lessonIndex < manifest.lessons.length - 1
        ? `Next unlocked: ${nextMeta.icon ? nextMeta.icon + " " : ""}${nextMeta.title}`
        : "You finished all lessons 🎉";
  }

  if (DOM.doneBtn) {
    DOM.doneBtn.onclick = () => {
      setScreen("map");
      renderMap();
    };
  }
}

/* -----------------------------
   Map rendering (with labels + icons)
----------------------------- */
function renderMap() {
  setControlsForQuestion(false);
  if (DOM.title) DOM.title.textContent = "Course Map";
  if (DOM.prompt) DOM.prompt.textContent = "Tap a node to play. 🔒 lessons unlock in order.";

  setScreen("map");

  const wrap = DOM.mapWrap;
  const nodesEl = DOM.mapNodes;
  const svg = DOM.mapSvg;
  if (!wrap || !nodesEl || !svg) return;

  nodesEl.innerHTML = "";
  svg.innerHTML = "";

  const W = Math.max(320, wrap.clientWidth);
  const topPad = 40;
  const stepY = 86;
  const nodeR = 35;

  const lessonCount = manifest.lessons.length;
  const H = topPad * 2 + (lessonCount - 1) * stepY + 120;

  svg.style.height = `${H}px`;
  nodesEl.style.height = `${H}px`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // FIX: SVG layer must NOT capture clicks
  svg.style.pointerEvents = "none";

  // Zig-zag X positions
  const xs = [
    Math.round(W * 0.30),
    Math.round(W * 0.70),
    Math.round(W * 0.35),
    Math.round(W * 0.65),
  ];

  const maxUnlocked = unlockIndex();

  // Draw connectors
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

    // style by unlock state
    const unlockedEdge = i < maxUnlocked;
    path.setAttribute("stroke", unlockedEdge ? "currentColor" : "rgba(0,0,0,0.12)");
    path.setAttribute("opacity", unlockedEdge ? "0.35" : "0.18");
    svg.appendChild(path);
  }

  // Nodes
  for (let i = 0; i < lessonCount; i++) {
    const meta = manifest.lessons[i];
    const x = xs[i % xs.length];
    const y = topPad + i * stepY;

    const unlocked = i === 0 || (i <= maxUnlocked);
    const completed = isLessonCompleted(meta.id);

    // Node button
    const btn = document.createElement("button");
    btn.className = "mapNode";
    btn.dataset.lessonIndex = String(i); // FIX: allow delegated click fallback
    btn.style.left = `${x - nodeR}px`;
    btn.style.top = `${y - nodeR}px`;
    btn.style.width = `${nodeR * 2}px`;
    btn.style.height = `${nodeR * 2}px`;

    // Contents (icon/number)
    const icon = meta.icon || (completed ? "✅" : unlocked ? "▶️" : "🔒");
    btn.innerHTML = `<div class="mapNodeInner">
        <div class="mapNodeIcon">${icon}</div>
        <div class="mapNodeNum">${i + 1}</div>
      </div>`;

    if (!unlocked) {
      btn.disabled = true;
      btn.classList.add("mapNode-locked");
    } else {
      btn.onclick = async () => {
        await startLesson(i);
      };
    }
    if (completed) btn.classList.add("mapNode-done");

    // Label under node (ALWAYS visible, locked is faded)
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
}

/* -----------------------------
   Start/continue logic
----------------------------- */
async function startLesson(i) {
  try {
    await loadLessonByIndex(i);
    setScreen("lesson");
    renderQuestion();
  } catch (err) {
    console.error(err);
    alert("Lesson data is missing or failed to load.");
  }
}

async function startFromContinue() {
  const lastId = localStorage.getItem(LS.lastLesson);
  if (!lastId) return startLesson(0);

  const idx = manifest.lessons.findIndex((l) => l.id === lastId);
  return startLesson(idx >= 0 ? idx : 0);
}


/* -----------------------------
   Speak (Web Speech API)
----------------------------- */
function speakLithuanian(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = "lt-LT";
    u.rate = 0.95;

    // Try pick a Lithuanian voice if available
    const voices = window.speechSynthesis.getVoices?.() || [];
    const lt = voices.find((v) => (v.lang || "").toLowerCase().startsWith("lt"));
    if (lt) u.voice = lt;

    window.speechSynthesis.speak(u);
  } catch {
    // silent fail
  }
}

/* -----------------------------
   Auth modal wiring
   - If auth_ui.js exists and exposes window.AuthUI.open(), we call it.
   - Otherwise we show a simple “stub modal” so button still works.
----------------------------- */
function openAuth() {
  // If your separate module exists:
  if (window.AuthUI && typeof window.AuthUI.open === "function") {
    window.AuthUI.open();
    return;
  }

  // Fallback: open the modal markup we added to index.html
  if (!DOM.authModal) return;

  DOM.authModal.style.display = "";
  DOM.authModal.setAttribute("aria-hidden", "false");

  // close handlers
  const backdrop = DOM.authModal.querySelector(".modal-backdrop");
  const closeBtns = DOM.authModal.querySelectorAll("[data-close='1'], .modal-close");

  const close = () => {
    DOM.authModal.style.display = "none";
    DOM.authModal.setAttribute("aria-hidden", "true");
  };

  if (backdrop) backdrop.onclick = close;
  closeBtns.forEach((b) => (b.onclick = close));

  // If modal contains quick demo buttons
  // (optional, safe if they don't exist)
  const demoLogin = DOM.authModal.querySelector("[data-demo-login]");
  if (demoLogin) {
    demoLogin.onclick = () => {
      setUser({ name: "Demo", ts: Date.now() });
      close();
    };
  }
  const demoLogout = DOM.authModal.querySelector("[data-demo-logout]");
  if (demoLogout) {
    demoLogout.onclick = () => {
      localStorage.removeItem(LS.user);
      refreshAccountDot();
      close();
    };
  }
}

/* -----------------------------
   Events / init
----------------------------- */
function wireEvents() {
  // Controls
  if (DOM.controls.prevBtn) DOM.controls.prevBtn.onclick = () => prevQuestion();
  if (DOM.controls.mapBtn) DOM.controls.mapBtn.onclick = () => {
    setScreen("map");
    renderMap();
  };
  if (DOM.controls.resetBtn) DOM.controls.resetBtn.onclick = () => resetLesson();

  // Account
  if (DOM.controls.accountBtn) DOM.controls.accountBtn.onclick = () => openAuth();

  // Home buttons
  if (DOM.startBtn) DOM.startBtn.onclick = () => startLesson(0);
  if (DOM.continueBtn) DOM.continueBtn.onclick = () => startFromContinue();

  // Done
  if (DOM.doneBtn) DOM.doneBtn.onclick = () => {
    setScreen("map");
    renderMap();
  };

  // Delegated fallback for dynamically created map nodes
  document.body.addEventListener("click", (e) => {
    const node = e.target && e.target.closest ? e.target.closest("button.mapNode") : null;
    if (!node) return;
    if (node.disabled) return;
    const idx = node.dataset.lessonIndex ? parseInt(node.dataset.lessonIndex, 10) : NaN;
    if (Number.isFinite(idx)) startLesson(idx);
  }, true);

  // Resize map nicely
  window.addEventListener("resize", () => {
    if (currentScreen === "map") renderMap();
  });
}

async function init() {
  try {
    manifest = await loadManifest();
    refreshAccountDot();
    wireEvents();

    // Default screen: home
    setScreen("home");

    // If you prefer start on map:
    // setScreen("map"); renderMap();

    // Make sure voices are loaded
    if ("speechSynthesis" in window) {
      // Some browsers need a tick
      await sleep(50);
      window.speechSynthesis.getVoices?.();
    }

    // If home has no dedicated UI, fall back to map
    if (!DOM.screens.home && DOM.screens.map) {
      setScreen("map");
      renderMap();
    }

  } catch (err) {
    console.error(err);
    if (DOM.title) DOM.title.textContent = "Error";
    if (DOM.prompt) DOM.prompt.textContent = String(err?.message || err);
  }
}

init();
