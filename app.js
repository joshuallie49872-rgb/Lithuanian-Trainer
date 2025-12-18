// Lithuanian Trainer — App v5.2 (Azure MP3 Audio + Crash-proof Map + Unlock + Scoring)
// CHANGE: Mikas is ALWAYS visible (no flashing / no auto-hide) + Emotion PNG triggers

const STORAGE_KEY = "lt_session_v5";
const PROGRESS_KEY = "lt_progress_v1";
const MANIFEST_URL = "lessons/manifest.json";

// Azure pre-generated audio manifest
const LT_AUDIO_MANIFEST_URL = "audio/lt/manifest.json";

let manifest = { lessons: [] };

let progress = {
  completedLessons: []
};

let session = {
  lessonId: null,
  screen: "map", // "map" | "lesson"
  pos: 0,
  order: [],
  firstTry: {},
  correct: 0,
  wrong: 0,
  streak: 0,
  bestStreak: 0,
  locked: false,
  mode: "lesson" // "lesson" | "review"
};

const el = (id) => document.getElementById(id);

// ---------- Mikas Coach (PNG moods) ----------
const MIKAS = {
  neutral: "mikas/neutral.png",
  thinking: "mikas/thinking.png",
  happy: "mikas/happy.png",
  sad: "mikas/sad.png",
  proud: "mikas/proud.png",
  celebrate: "mikas/celebrate.png",
};

let mikasMood = "neutral";

function preloadMikasImages() {
  Object.values(MIKAS).forEach((src) => {
    const i = new Image();
    i.src = src;
  });
}

function setMikasMood(mood) {
  if (!MIKAS[mood]) mood = "neutral";
  mikasMood = mood;

  const img = el("mikasImg");
  if (img && img.getAttribute("src") !== MIKAS[mood]) {
    img.setAttribute("src", MIKAS[mood]);
  }
}

// NOTE: We keep the function signature, but we IGNORE autoHideMs now.
// Mikas will remain visible unless you explicitly hide via CSS/DOM yourself.
function mikasShow(state = "neutral", bubbleText = "", autoHideMs = 0) {
  const dock = el("mikasDock");
  const bubble = el("mikasBubble");
  if (!dock) return;

  // Always visible
  dock.style.display = "block";
  dock.setAttribute("aria-hidden", "false");

  setMikasMood(state);

  if (bubble) {
    if (bubbleText) {
      bubble.textContent = bubbleText;
      bubble.classList.add("show");
    } else {
      bubble.textContent = "";
      bubble.classList.remove("show");
    }
  }
}

// You can still hide manually if you ever want to,
// but we won't call this automatically anywhere.
function mikasHide() {
  const dock = el("mikasDock");
  if (!dock) return;
  dock.style.display = "none";
  dock.setAttribute("aria-hidden", "true");
}

// Preload & set default mood once
preloadMikasImages();
mikasShow("neutral", "", 0);

// Thinking = any typing in the translate input (your input id is "answer")
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === "answer") {
    setMikasMood("thinking");
  }
});

// ---------- Storage ----------
function saveSession() { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
function loadSession() { const s = localStorage.getItem(STORAGE_KEY); if (s) session = JSON.parse(s); }

function saveProgress() { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }
function loadProgress() { const p = localStorage.getItem(PROGRESS_KEY); if (p) progress = JSON.parse(p); }

// ---------- Data ----------
async function loadManifestSafe() {
  try {
    const r = await fetch(MANIFEST_URL);
    if (!r.ok) throw new Error("manifest missing");
    const data = await r.json();
    if (!data.lessons || !Array.isArray(data.lessons)) throw new Error("bad manifest format");
    manifest = data;
  } catch (e) {
    // Fallback so the app still works
    manifest = { lessons: [{ id: "001-basics", title: "Basics 1" }] };
    // show message on screen (non-blocking)
    if (el("prompt")) {
      el("prompt").textContent =
        "⚠️ Missing lessons/manifest.json. Run: python tools_make_manifest.py  (then refresh)";
    }
  }
}

async function loadLesson(id) {
  const r = await fetch(`lessons/${id}.json`);
  if (!r.ok) throw new Error("Lesson not found: " + id);
  return await r.json();
}

// ---------- Pre-generated Lithuanian audio ----------
let LT_AUDIO = new Map();      // text -> file
let LT_AUDIO_READY = false;    // loaded successfully (or attempted)

async function loadLtAudioManifestSafe() {
  if (LT_AUDIO_READY) return; // load once
  LT_AUDIO_READY = true;

  try {
    const r = await fetch(LT_AUDIO_MANIFEST_URL);
    if (!r.ok) throw new Error("lt audio manifest missing");
    const data = await r.json();
    if (!data.items || !Array.isArray(data.items)) throw new Error("bad lt audio manifest format");

    for (const item of data.items) {
      if (item && typeof item.text === "string" && typeof item.file === "string") {
        LT_AUDIO.set(item.text, item.file);
      }
    }
  } catch (e) {
    // Don't crash the app if audio isn't there yet
    console.warn("LT audio not available yet:", e.message || e);
  }
}

function playLtMp3ByText(text) {
  const file = LT_AUDIO.get(text);
  if (!file) return false;

  const audio = new Audio(file);
  audio.play().catch((err) => {
    console.warn("Audio play failed:", err);
  });
  return true;
}

// ---------- Helpers ----------
function speak(lang, text) {
  if (!("speechSynthesis" in window)) return;

  const voices = speechSynthesis.getVoices();

  let voice =
    voices.find(v => v.lang === "lt-LT") ||
    voices.find(v => v.lang.startsWith("lt")) ||
    voices.find(v => v.lang.startsWith("pl")) ||
    voices.find(v => v.lang.startsWith("ru")) ||
    voices.find(v => v.lang.startsWith("en")) ||
    voices[0];

  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = (lang || voice?.lang || "en-US");

  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// MP3 first for Lithuanian, then fallback TTS
function speakSmart(lang, text) {
  const l = (lang || "").toLowerCase();

  if (l.startsWith("lt")) {
    const ok = playLtMp3ByText(text);
    if (ok) return;
  }

  speak(lang, text);
}

function normalize(s) {
  return (s || "").toLowerCase().trim().replace(/[.!?,"']/g, "");
}

function calcAccuracy() {
  const attempted = session.correct + session.wrong;
  if (attempted === 0) return 0;
  return Math.round((session.correct / attempted) * 100);
}

function calcStars(accuracy) {
  if (accuracy >= 95) return 3;
  if (accuracy >= 85) return 2;
  if (accuracy >= 70) return 1;
  return 0;
}

function starsText(n) { return "⭐".repeat(n); }

function headerText(title, currentNumber, totalQuestions) {
  const acc = calcAccuracy();
  const stars = starsText(calcStars(acc));
  const fire = session.streak > 0 ? ` 🔥${session.streak}` : "";
  return `${title} (${currentNumber}/${totalQuestions}) ${stars}${fire}`;
}

function setControlsForQuestion(hasTTS) {
  el("speakBtn").style.display = hasTTS ? "inline-block" : "none";
}

function disableQuestionInputs() {
  const content = el("content");
  content.querySelectorAll("button").forEach((b) => (b.disabled = true));
  content.querySelectorAll("input").forEach((i) => (i.disabled = true));
}

function setScreen(which) {
  session.screen = which;
  saveSession();
  el("mapScreen").style.display = which === "map" ? "block" : "none";
  el("lessonScreen").style.display = which === "lesson" ? "block" : "none";

  // Mikas stays visible; reset mood cleanly on screen changes
  mikasShow("neutral", "", 0);
}

// ---------- Unlocking ----------
function lessonIndexById(id) {
  return manifest.lessons.findIndex((x) => x.id === id);
}

function isLessonUnlocked(lessonId) {
  const idx = lessonIndexById(lessonId);
  if (idx <= 0) return true;
  const prevId = manifest.lessons[idx - 1]?.id;
  return progress.completedLessons.includes(prevId);
}

function markLessonCompleted(lessonId) {
  if (!progress.completedLessons.includes(lessonId)) {
    progress.completedLessons.push(lessonId);
    saveProgress();
  }
}

// ---------- Lesson control ----------
function resetSession(lessonId, lessonLength) {
  session.lessonId = lessonId;
  session.pos = 0;
  session.order = Array.from({ length: lessonLength }, (_, i) => i);
  session.firstTry = {};
  session.correct = 0;
  session.wrong = 0;
  session.streak = 0;
  session.bestStreak = 0;
  session.locked = false;
  session.mode = "lesson";
  session.screen = "lesson";
  saveSession();
}

function startReviewWrong(lessonLength) {
  const wrongIndices = [];
  for (let i = 0; i < lessonLength; i++) {
    if (session.firstTry[i] === false) wrongIndices.push(i);
  }
  if (wrongIndices.length === 0) return false;

  session.mode = "review";
  session.order = wrongIndices;
  session.pos = 0;
  session.locked = false;
  saveSession();
  return true;
}

function recordFirstTry(isCorrect, itemIndex) {
  if (session.firstTry[itemIndex] !== undefined) return;
  session.firstTry[itemIndex] = isCorrect;

  if (isCorrect) {
    session.correct += 1;
    session.streak += 1;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
  } else {
    session.wrong += 1;
    session.streak = 0;
  }
  saveSession();
}

function getCurrentItemIndex() {
  return session.order[session.pos];
}

function next(totalQuestions) {
  session.locked = false;
  if (session.pos < session.order.length) session.pos += 1;
  saveSession();
  render();
}

// ---------- Summary ----------
function showSummary(lesson) {
  const total = lesson.items.length;
  const attempted = session.correct + session.wrong;
  const acc = calcAccuracy();
  const stars = starsText(calcStars(acc));
  const perfect = session.wrong === 0 && attempted > 0;

  if (session.mode === "lesson") markLessonCompleted(lesson.id);

  el("title").textContent =
    `${lesson.title} — Summary ${stars}` +
    (session.bestStreak ? ` 🔥Best ${session.bestStreak}` : "");

  el("prompt").textContent = "";

  // Celebrate on summary
  mikasShow(perfect ? "celebrate" : "proud", "", 0);

  el("content").innerHTML = `
    <div class="q">Lesson complete ✅</div>
    <div style="margin-top:10px; line-height:1.8;">
      <div><strong>Correct:</strong> ${session.correct}</div>
      <div><strong>Wrong:</strong> ${session.wrong}</div>
      <div><strong>Accuracy:</strong> ${acc}%</div>
      <div><strong>Best streak:</strong> ${session.bestStreak}</div>
      <div style="margin-top:10px;">${perfect ? "⭐ Perfect lesson!" : ""}</div>
    </div>
    <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;">
      <button id="goMap">🗺️ Back to Map</button>
      <button id="restartLesson">Restart lesson</button>
      <button id="reviewWrong">Retry wrong 🔁</button>
    </div>
  `;

  setControlsForQuestion(false);

  el("goMap").onclick = () => { setScreen("map"); render(); };
  el("restartLesson").onclick = () => { resetSession(lesson.id, total); render(); };
  el("reviewWrong").onclick = () => {
    const ok = startReviewWrong(total);
    if (!ok) return alert("No wrong answers to review 🎉");
    render();
  };
}

// ---------- Map ----------
function starsForLessonId(lessonId) {
  return progress.completedLessons.includes(lessonId) ? "⭐⭐" : "";
}

function renderMap() {
  setControlsForQuestion(false);
  el("title").textContent = "Course Map";
  el("prompt").textContent = "Tap a node to play. 🔒 lessons unlock in order.";

  setScreen("map");

  // Mikas always visible on map
  mikasShow("neutral", "", 0);

  const wrap = el("mapWrap");
  const nodesEl = el("mapNodes");
  const svg = el("mapSvg");

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

  const lanes = [
    Math.round(W * 0.25),
    Math.round(W * 0.55),
    Math.round(W * 0.35),
    Math.round(W * 0.70),
    Math.round(W * 0.45),
  ].map(x => Math.min(Math.max(x, 70), W - 70));

  const points = manifest.lessons.map((l, i) => {
    const x = lanes[i % lanes.length];
    const y = topPad + i * stepY;
    return { x, y, lesson: l };
  });

  const d = points
    .map((p, i) =>
      i === 0
        ? `M ${p.x} ${p.y}`
        : `Q ${(points[i - 1].x + p.x) / 2} ${(points[i - 1].y + p.y) / 2} ${p.x} ${p.y}`
    )
    .join(" ");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("class", "path-stroke");
  svg.appendChild(path);

  const currentIdx = manifest.lessons.findIndex(
    (l) => isLessonUnlocked(l.id) && !progress.completedLessons.includes(l.id)
  );

  manifest.lessons.forEach((l, i) => {
    const p = points[i];
    const node = document.createElement("div");
    node.className = "map-node";

    const complete = progress.completedLessons.includes(l.id);
    const unlocked = isLessonUnlocked(l.id);
    const isCurrent = i === currentIdx;

    node.classList.add(
      complete ? "node-complete" : unlocked ? "node-unlocked" : "node-locked"
    );
    if (isCurrent) node.classList.add("node-current");

    node.style.left = `${p.x - nodeR}px`;
    node.style.top = `${p.y - nodeR}px`;

    const num = String(i + 1);
    const icon = complete ? "✅" : unlocked ? "⭐" : "🔒";
    node.innerHTML = `
      <div>${icon}
        <div style="font-size:12px; opacity:.9; margin-top:2px;">${num}</div>
      </div>
    `;

    const mini = document.createElement("div");
    mini.className = "mini";
    mini.textContent = complete ? "⭐⭐" : "";
    node.appendChild(mini);

    node.onclick = () => {
      if (!unlocked) return;
      startLesson(l.id);
    };

    nodesEl.appendChild(node);
  });

  if (currentIdx >= 0) {
    const targetY = topPad + currentIdx * stepY;
    wrap.scrollTo({ top: Math.max(0, targetY - 180), behavior: "smooth" });
  } else {
    wrap.scrollTo({ top: 0, behavior: "auto" });
  }
}

async function startLesson(lessonId) {
  const lesson = await loadLesson(lessonId);
  resetSession(lesson.id, lesson.items.length);
  setScreen("lesson");
  render();
}

// ---------- Render ----------
async function render() {
  loadSession();
  loadProgress();

  // Always visible at start of render
  mikasShow("neutral", "", 0);

  el("mapBtn").onclick = () => { setScreen("map"); render(); };
  el("resetBtn").onclick = async () => {
    try {
      const lesson = await loadLesson(session.lessonId || "001-basics");
      resetSession(lesson.id, lesson.items.length);
      render();
    } catch (e) {
      el("content").innerHTML = `<div class="q">⚠️ ${String(e.message || e)}</div>`;
    }
  };

  if (!manifest.lessons || manifest.lessons.length === 0) {
    await loadManifestSafe();
  }

  await loadLtAudioManifestSafe();

  if (!session.lessonId) {
    session.lessonId = manifest.lessons[0]?.id || "001-basics";
    saveSession();
  }

  if (session.screen === "map") {
    renderMap();
    return;
  }

  const lesson = await loadLesson(session.lessonId);
  const totalQuestions = lesson.items.length;

  if (!Array.isArray(session.order) || session.order.length !== totalQuestions || session.pos < 0) {
    resetSession(lesson.id, totalQuestions);
  }

  if (session.pos > session.order.length) session.pos = session.order.length;

  if (session.pos >= session.order.length) {
    showSummary(lesson);
    return;
  }

  const itemIndex = getCurrentItemIndex();
  const item = lesson.items[itemIndex];

  el("title").textContent = headerText(lesson.title, session.pos + 1, totalQuestions);

  const acc = calcAccuracy();
  el("prompt").textContent =
    session.mode === "review"
      ? `Review mode 🔁 (Accuracy from original run: ${acc}%)`
      : `Accuracy: ${acc}% • Wrong: ${session.wrong}`;

  // Default mood while question is waiting
  mikasShow("neutral", "", 0);

  el("content").innerHTML = "";
  setControlsForQuestion(!!item.tts);

  el("speakBtn").onclick = () => speakSmart(item.tts.lang, item.tts.text);

  session.locked = false;
  saveSession();

  if (item.type === "translate") {
    el("content").innerHTML = `
      <div class="q">${item.en}</div>
      <input id="answer" placeholder="Type answer..." />
      <button id="check">Check</button>
      <div id="feedback"></div>
    `;

    // thinking as soon as input focuses (feels better than waiting for typing)
    el("answer").addEventListener("focus", () => setMikasMood("thinking"));

    const check = () => {
      if (session.locked) return;

      const user = normalize(el("answer").value);
      const ok = item.answers.map(normalize).includes(user);

      recordFirstTry(ok, itemIndex);

      if (ok) {
        el("feedback").textContent = "✅ Correct";

        // happy on correct
        mikasShow("happy", "", 0);

        // proud on streak milestones (5,10,15...)
        if (session.streak > 0 && session.streak % 5 === 0) {
          mikasShow("proud", "", 0);
        }

        session.locked = true;
        saveSession();
        disableQuestionInputs();
        setTimeout(() => next(totalQuestions), 300);
      } else {
        el("feedback").textContent = `❌ Try: ${item.answers[0]}`;

        // sad on wrong
        mikasShow("sad", "", 0);
      }
    };

    el("check").onclick = check;
    el("answer").addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
  }

  if (item.type === "choose") {
    el("content").innerHTML = `
      <div class="q">${item.lt}</div>
      <div id="choices"></div>
      <div id="feedback"></div>
    `;

    const c = el("choices");
    item.choices.forEach((choice, idx) => {
      const b = document.createElement("button");
      b.textContent = choice;

      b.onclick = () => {
        if (session.locked) return;

        const ok = idx === item.answerIndex;
        recordFirstTry(ok, itemIndex);

        if (ok) {
          el("feedback").textContent = "✅ Correct";

          // happy on correct
          mikasShow("happy", "", 0);

          // proud on streak milestones (5,10,15...)
          if (session.streak > 0 && session.streak % 5 === 0) {
            mikasShow("proud", "", 0);
          }

          session.locked = true;
          saveSession();
          disableQuestionInputs();
          setTimeout(() => next(totalQuestions), 300);
        } else {
          el("feedback").textContent = "❌ Nope";

          // sad on wrong
          mikasShow("sad", "", 0);
        }
      };

      c.appendChild(b);
    });
  }

  el("prevBtn").disabled = true;
}

// boot
render();
