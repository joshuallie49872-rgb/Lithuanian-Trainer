// auth_ui.js — Lithuanian Trainer auth modal (Google + Email)
// Works with Firebase compat already attached to window.fbAuth

(function () {
  const $ = (id) => document.getElementById(id);

  function safeText(el, t) {
    if (!el) return;
    el.textContent = t ?? "";
  }

  function setMsg(text, isError = false) {
    const el = $("authMsg");
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.classList.toggle("error", !!isError);
    safeText(el, text || "");
  }

  function openModal() {
    const modal = $("authModal");
    if (!modal) return;
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setMsg("");
    // Focus first meaningful input/button
    const btn = $("googleBtn") || $("emailInput");
    if (btn) btn.focus();
  }

  function closeModal() {
    const modal = $("authModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    setMsg("");
  }

  function setSignedInUI(user) {
    const signedIn = !!user;

    // Pills
    safeText($("pillMode"), signedIn ? "Mode: Signed in" : "Mode: Guest");
    safeText($("pillSync"), signedIn ? "Cloud Sync: ON" : "Cloud Sync: OFF");
    safeText($("pillLocal"), "Local Save: ON");

    // Account dot color
    const dot = $("accountDot");
    if (dot) dot.classList.toggle("on", signedIn);

    // Panels
    const guestPanel = $("guestPanel");
    const signedPanel = $("signedInPanel");
    if (guestPanel) guestPanel.style.display = signedIn ? "none" : "block";
    if (signedPanel) signedPanel.style.display = signedIn ? "block" : "none";

    // Profile
    if (signedIn) {
      safeText($("userName"), user.displayName || "Signed in");
      safeText($("userEmail"), user.email || "");
      const img = $("userPhoto");
      if (img) {
        img.style.display = user.photoURL ? "block" : "none";
        if (user.photoURL) img.src = user.photoURL;
      }
    }
  }

  async function signInGoogle() {
    try {
      setMsg("");
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await window.fbAuth.signInWithPopup(provider);
      setMsg("Signed in ✅");
    } catch (e) {
      setMsg(e?.message || "Google sign-in failed", true);
    }
  }

  async function signUpEmail(email, pass) {
    try {
      setMsg("");
      await window.fbAuth.createUserWithEmailAndPassword(email, pass);
      setMsg("Account created ✅");
    } catch (e) {
      setMsg(e?.message || "Sign up failed", true);
    }
  }

  async function signInEmail(email, pass) {
    try {
      setMsg("");
      await window.fbAuth.signInWithEmailAndPassword(email, pass);
      setMsg("Signed in ✅");
    } catch (e) {
      setMsg(e?.message || "Sign in failed", true);
    }
  }

  async function signOut() {
    try {
      setMsg("");
      await window.fbAuth.signOut();
      setMsg("Signed out.");
    } catch (e) {
      setMsg(e?.message || "Sign out failed", true);
    }
  }

  function wire() {
    // If firebase isn’t present, don’t crash the app
    if (!window.fbAuth || !window.firebase) {
      console.warn("Firebase auth not available (fbAuth missing).");
      return;
    }

    // Open/close
    const accountBtn = $("accountBtn");
    if (accountBtn) accountBtn.addEventListener("click", openModal);

    const closeBtn = $("authCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    const modal = $("authModal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.getAttribute && t.getAttribute("data-close") === "1") closeModal();
      });

      // Esc to close
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display === "block") closeModal();
      });
    }

    // Buttons
    const googleBtn = $("googleBtn");
    if (googleBtn) googleBtn.addEventListener("click", signInGoogle);

    const signupBtn = $("signupBtn");
    if (signupBtn) {
      signupBtn.addEventListener("click", () => {
        const email = $("emailInput")?.value?.trim();
        const pass = $("passInput")?.value || "";
        if (!email || pass.length < 6) return setMsg("Enter email + password (6+ chars).", true);
        signUpEmail(email, pass);
      });
    }

    const signinBtn = $("signinBtn");
    if (signinBtn) {
      signinBtn.addEventListener("click", () => {
        const email = $("emailInput")?.value?.trim();
        const pass = $("passInput")?.value || "";
        if (!email || !pass) return setMsg("Enter email + password.", true);
        signInEmail(email, pass);
      });
    }

    const signOutBtn = $("signOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    const closeAfterSignOutBtn = $("closeAfterSignOutBtn");
    if (closeAfterSignOutBtn) closeAfterSignOutBtn.addEventListener("click", closeModal);

    // Auth state
    window.fbAuth.onAuthStateChanged((user) => {
      window.currentUser = user || null;
      setSignedInUI(user || null);
    });

    // Initial UI
    setSignedInUI(window.fbAuth.currentUser || null);
  }

  // Run after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
