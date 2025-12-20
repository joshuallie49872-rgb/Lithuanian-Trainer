// Lithuanian Trainer — App v5.3.2 (Firebase Login + Firestore Progress Sync + Home + Map + Lesson)
// - Google + Email/Password login
// - progress ALWAYS saved locally
// - if logged in, progress also saved to Firestore: collection "progress" doc = uid
// - shows login UI on Home screen
// - shuffle fix (correct not always A)
// - SW register call kept

const STORAGE_KEY = "lt_session_v6";
const PROGRESS_KEY = "lt_progress_v2";
const MANIFEST_URL = "lessons/manifest.json";
const LT_AUDIO_MANIFEST_URL = "audio/lt/manifest.json";

let manifest = { lessons: [] };

let progress = {
  v: 2,
  completedLessons: [],
};

let session = {
  v: 6,
  lessonId: null,
  screen: "home", // "home" | "map" | "lesson"
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

// ---------- Firebase / Auth ----------
let currentUser = null;

function firebaseReady() {
  return (
    typeof window !== "undefined" &&
    window.firebase &&
    window.fbAuth &&
    window.fbDB &&
    typeof window.fbAuth.onAuthStateChanged === "function"
  );
}

function isAuthed() { return !!currentUser; }

function signInWithGoogle() {
  if (!firebaseReady()) return alert("Firebase not loaded on this page.");
  const provider = new firebase.auth.GoogleAuthProvider();
  fbAuth.signInWithPopup(provider).catch(err => alert(err.message));
}

function signUpWithEmail(email, password) {
  if (!firebaseReady()) return alert("Firebase not loaded on this page.");
  return fbAuth.createUserWithEmailAndPassword(email, password)
    .catch(err => alert(err.message));
}

function signInWithEmail(email, password) {
  if (!firebaseReady()) return alert("Firebase not loaded on this page.");
  return fbAuth.signInWithEmailAndPassword(email, password)
    .catch(err => alert(err.message));
}

function signOut() {
  if (!firebaseReady()) return;
  fbAuth.signOut().catch(err => alert(err.message));
}

// Firestore progress per user
async function loadProgressFromCloud() {
  if (!firebaseReady() || !currentUser) return;

  const ref = fbDB.collection("progress").doc(currentUser.uid);
  const snap = await ref.get();

  if (snap.exists) {
    const data = snap.data();
    if (data && typeof data === "object") {
      progress = {
        v: 2,
        completedLessons: Array.isArray(data.completedLessons) ? data.completedLessons : [],
      };
      saveProgress(); // also writes local
    }
  } else {
    // create doc if missing
    await ref.set(progress);
  }
}

async function saveProgressCloud() {
  if (!firebaseReady() || !currentUser) return;
  await fbDB.collection("progress").doc(currentUser.uid).set(progress);
}

function wireAuthListenerOnce() {
  if (!firebaseReady()) return;

  if (wireAuthListenerOnce._wired) return;
  wireAuthListenerOnce._wired = true;

  fbAuth.onAuthStateChanged(async (user) => {
    currentUser = user || null;

    // local first
    loadProgress();

    // then cloud overlays local
    if (currentUser) {
      try { await loadProgressFromCloud(); } catch (e) { console.warn(e); }
    }

    render();
  });
}

// ---------- Mikas Coach (PNG moods) ----------
const MIKAS = {
  neutral: "mikas/neutral.png",
  thinking: "mikas/thinking.png",
  happy: "mikas/happy.png",
  sad: "mikas/sad.png",
  proud: "mikas/proud.png",
  celebrate: "mikas/celebrate.png",
};

function preloadMikasImages() {
  Object.values(MIKAS).forEach((src) => {
    const i = new Image();
    i.src = src;
  });
}

function setMikasMood(mood) {
  if (!MIKAS[mood]) mood = "neutral";
  const img = el("mikasImg");
  if (img && img.getAttribute("src") !== MIKAS[mood]) {
    img.setAttribute("src", MIKAS[mood]);
  }
}

function mikasShow(state = "neutral", bubbleText = "", autoHideMs = 0) {
  setMikasMood(state);
  const dock = el("mikasDock");
  if (dock) dock.classList.remove("mikasHidden");
}

preloadMikasImages();
setMikasMood("neutral");

// Thinking mood when typing in lesson inputs
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t) return;
  const isLessonInput =
    t.id === "answer" ||
    t.id === "answerInput" ||
    t.id === "translateInput" ||
    t.classList?.contains("answerInput") ||
    t.classList?.contains("translateInput");
  if (isLessonInput) setMikasMood("thinking");
});

// ---------- Storage ----------
function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function loadSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  const loaded = safeParse(raw, null);
  if (!loaded || typeof loaded !== "object") return;

  session = {
    ...session,
    ...loaded,
    v: 6,
  };

  if (!["home","map","lesson"].includes(session.screen)) session.screen = "home";
}

function saveProgress() {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  if (currentUser) saveProgressCloud().catch(console.warn);
}

function loadProgress() {
  const raw = localStorage.getItem(PROGRESS_KEY);
  if (!raw) return;

  const loaded = safeParse(raw, null);
  if (!loaded || typeof loaded !== "object") return;

  progress = {
    v: 2,
    completedLessons: Array.isArray(loaded.completedLessons) ? loaded.completedLessons : [],
  };
}

// ---------- Data ----------
async function loadManifestSafe() {
  try {
    const r = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("manifest missing");
    const data = await r.json();
    if (!data.lessons || !Array.isArray(data.lessons)) throw new Error("bad manifest format");
    manifest = data;
  } catch (e) {
    manifest = { lessons: [{ id: "001-basics", title: "Basics 1" }] };
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
let LT_AUDIO_READY = false;

async function loadLtAudioManifestSafe() {
  if (LT_AUDIO_READY) return;
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
    console.warn("LT audio not available yet:", e.message || e);
  }
}

function setSpeakLoading(isLoading) {
  const b = el("speakBtn");
  if (!b) return;
  b.disabled = !!isLoading;
  b.dataset.loading = isLoading ? "1" : "";
  b.textContent = isLoading ? "🔊 Loading…" : "🔊 Hear it";
}

function playLtMp3ByText(text) {
  const file = LT_AUDIO.get(text);
  if (!file) return { ok: false };
  const audio = new Audio(file);
  return { ok: true, audio };
}

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

function speakSmart(lang, text) {
  const l = (lang || "").toLowerCase();

  if (l.startsWith("lt")) {
    const res = playLtMp3ByText(text);
    if (res.ok && res.audio) {
      setSpeakLoading(true);

      const done = () => setSpeakLoading(false);

      res.audio.addEventListener("canplaythrough", async () => {
        try { await res.audio.play(); } catch (err) { console.warn("Audio play failed:", err); done(); }
      }, { once: true });

      res.audio.addEventListener("ended", done, { once: true });
      res.audio.addEventListener("error", done, { once: true });

      try { fetch(res.audio.src, { cache: "force-cache" }); } catch {}
      return;
    }
  }

  setSpeakLoading(true);
  try {
    speak(lang, text);
  } finally {
    setTimeout(() => setSpeakLoading(false), 600);
  }
}

// ---------- Helpers ----------
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
  const b = el("speakBtn");
  if (!b) return;
  b.style.display = hasTTS ? "inline-block" : "none";
  if (hasTTS) setSpeakLoading(false);
}

function disableQuestionInputs() {
  const content = el("content");
  if (!content) return;
  content.querySelectorAll("button").forEach((b) => (b.disabled = true));
  content.querySelectorAll("input").forEach((i) => (i.disabled = true));
}

function setScreen(which) {
  session.screen = which;
  saveSession();

  el("homeScreen").style.display = which === "home" ? "block" : "none";
  el("mapScreen").style.display = which === "map" ? "block" : "none";
  el("lessonScreen").style.display = which === "lesson" ? "block" : "none";
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
      <button id="goHome">🏠 Home</button>
      <button id="goMap">🗺️ Back to Map</button>
      <button id="restartLesson">Restart lesson</button>
      <button id="reviewWrong">Retry wrong 🔁</button>
    </div>
  `;

  setControlsForQuestion(false);

  el("goHome").onclick = () => { setScreen("home"); render(); };
  el("goMap").onclick = () => { setScreen("map"); render(); };
  el("restartLesson").onclick = () => { resetSession(lesson.id, total); render(); };
  el("reviewWrong").onclick = () => {
    const ok = startReviewWrong(total);
    if (!ok) return alert("No wrong answers to review 🎉");
    render();
  };
}

// ---------- Home ----------
function renderHome() {
  setScreen("home");
  setControlsForQuestion(false);

  el("title").textContent = "Lithuanian Trainer";
  el("prompt").textContent = "Learn Lithuanian with quick, game-style lessons.";

  mikasShow("neutral", "", 0);

  const fbOk = firebaseReady();
  const who = currentUser ? (currentUser.email || "Google user") : "Guest";

  el("homeBody").innerHTML = `
    <div class="homeCard">
      <div class="homeHero">
        <div class="homeBrand">Lithuanian Quest</div>
        <div class="homeHeadline">Learn a new language — fast.</div>
        <div class="homeSub">Start instantly. Sign in to sync progress across devices.</div>
      </div>

      <div class="homeActions">
        <button id="startBtn" class="primaryBtn">Start Learning</button>
        <button id="goMapBtn">Course Map</button>
      </div>

      <div class="homeNote">
        <div><strong>Mode:</strong> ${who}</div>
        <div>Progress is always saved on this device.</div>
        <div>${currentUser ? "Cloud sync is ON." : "Cloud sync is OFF (guest)."} </div>
      </div>

      <div class="homeAuth">
        <div class="authTitle">Account (optional)</div>

        ${fbOk ? `
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
            <button id="googleBtn">Continue with Google</button>
            ${currentUser ? `<button id="logoutBtn">Sign out</button>` : ``}
          </div>

          ${currentUser ? `` : `
            <div style="margin-top:12px;">
              <div class="authSub">Or use email:</div>
              <input id="email" placeholder="Email" style="max-width:320px; display:block; margin-top:8px;" />
              <input id="pass" type="password" placeholder="Password" style="max-width:320px; display:block; margin-top:8px;" />
              <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
                <button id="emailSignUpBtn">Sign up</button>
                <button id="emailSignInBtn">Sign in</button>
              </div>
            </div>
          `}
        ` : `
          <div class="authSub" style="margin-top:10px;">
            Firebase not loaded. (Check the firebase script tags.)
          </div>
        `}
      </div>
    </div>
  `;

  // default lesson selection
  if (!session.lessonId && manifest.lessons.length) {
    session.lessonId = manifest.lessons[0].id;
    saveSession();
  }

  el("startBtn").onclick = async () => {
    const first = manifest.lessons[0]?.id || "001-basics";
    await startLesson(first);
  };

  el("goMapBtn").onclick = () => {
    setScreen("map");
    render();
  };

  if (fbOk) {
    el("googleBtn").onclick = signInWithGoogle;

    if (currentUser) {
      el("logoutBtn").onclick = signOut;
    } else {
      el("emailSignUpBtn").onclick = () => {
        const email = el("email").value.trim();
        const pass = el("pass").value;
        if (!email || !pass) return alert("Enter email + password");
        signUpWithEmail(email, pass);
      };
      el("emailSignInBtn").onclick = () => {
        const email = el("email").value.trim();
        const pass = el("pass").value;
        if (!email || !pass) return alert("Enter email + password");
        signInWithEmail(email, pass);
      };
    }
  }
}

// ---------- Map ----------
function renderMap() {
  setControlsForQuestion(false);
  el("title").textContent = "Course Map";
  el("prompt").textContent = "Tap a node to play. 🔒 lessons unlock in order.";

  setScreen("map");
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

// ---------- Shuffle helper ----------
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Render ----------
async function render() {
  loadSession();
  loadProgress();

  // Hook top buttons
  el("mapBtn").onclick = () => { setScreen("map"); render(); };
  el("resetBtn").onclick = async () => {
    try {
      const lesson = await loadLesson(session.lessonId || manifest.lessons[0]?.id || "001-basics");
      resetSession(lesson.id, lesson.items.length);
      render();
    } catch (e) {
      el("content").innerHTML = `<div class="q">⚠️ ${String(e.message || e)}</div>`;
    }
  };

  // Load manifest + audio once
  if (!manifest.lessons || manifest.lessons.length === 0) {
    await loadManifestSafe();
  }
  await loadLtAudioManifestSafe();

  // default lesson
  if (!session.lessonId) {
    session.lessonId = manifest.lessons[0]?.id || "001-basics";
    saveSession();
  }

  // screens
  if (session.screen === "home") { renderHome(); return; }
  if (session.screen === "map") { renderMap(); return; }

  // lesson render
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

    const check = () => {
      if (session.locked) return;

      const user = normalize(el("answer").value);
      const ok = item.answers.map(normalize).includes(user);

      recordFirstTry(ok, itemIndex);

      if (ok) {
        el("feedback").textContent = "✅ Correct";
        mikasShow("happy", "", 0);

        if (session.streak > 0 && session.streak % 5 === 0) {
          mikasShow("proud", "", 0);
        }

        session.locked = true;
        saveSession();
        disableQuestionInputs();
        setTimeout(() => next(totalQuestions), 300);
      } else {
        el("feedback").textContent = `❌ Try: ${item.answers[0]}`;
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

    const choiceObjs = item.choices.map((text, idx) => ({
      text,
      isCorrect: idx === item.answerIndex,
    }));
    shuffleInPlace(choiceObjs);

    choiceObjs.forEach((ch) => {
      const b = document.createElement("button");
      b.textContent = ch.text;

      b.onclick = () => {
        if (session.locked) return;

        const ok = ch.isCorrect;
        recordFirstTry(ok, itemIndex);

        if (ok) {
          el("feedback").textContent = "✅ Correct";
          mikasShow("happy", "", 0);

          if (session.streak > 0 && session.streak % 5 === 0) {
            mikasShow("proud", "", 0);
          }

          session.locked = true;
          saveSession();
          disableQuestionInputs();
          setTimeout(() => next(totalQuestions), 300);
        } else {
          el("feedback").textContent = "❌ Nope";
          mikasShow("sad", "", 0);
        }
      };

      c.appendChild(b);
    });
  }

  el("prevBtn").disabled = true;
}

// ---------- Service Worker register ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
    console.log("SW registered");
  } catch (e) {
    console.warn("SW register failed:", e);
  }
}

// boot
registerSW();

// If Firebase is ready: auth listener will call render().
// If not ready: render guest-only.
if (firebaseReady()) {
  wireAuthListenerOnce();
} else {
  render();
}
