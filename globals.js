/* OpenKalba globals shim (v2)
   Purpose: prevent scope-related ReferenceErrors by defining required helpers
   BEFORE app.js runs. This does NOT replace your real implementations if they
   exist; it only fills gaps when something isn't in global scope.
*/
(function () {
  if (typeof window === "undefined") return;

  function def(name, fn) {
    if (typeof window[name] !== "function") window[name] = fn;
  }

  // 1) shouldSpeakForMode (used by renderQuestion)
  def("shouldSpeakForMode", function (q, speakText = "") {
    const s = String(speakText || "").trim();
    return !!s;
  });

  // 2) getCorrectList (used by checkAnswer/markChoiceButtons)
  def("getCorrectList", function (q) {
    if (!q) return [];
    if (Array.isArray(q.correct)) return q.correct;
    if (q.answer != null) return [q.answer];
    if (q.correctAnswer != null) return [q.correctAnswer];
    // fallback to tts text if present
    if (q.tts && typeof q.tts === "object" && q.tts.text) return [String(q.tts.text)];
    if (typeof q.tts === "string" && q.tts.trim()) return [q.tts.trim()];
    return [];
  });

  // 3) ensureLessonHeaderVisible (used by renderQuestion)
  def("ensureLessonHeaderVisible", function () {
    try {
      var header = document.querySelector(".lessonHeader");
      if (header) header.style.display = "block";
    } catch (_) {}
  });

  // 4) show helper (used in some builds)
  def("show", function (node, yes) {
    try {
      if (!node) return;
      node.style.display = (yes === false) ? "none" : "";
    } catch (_) {}
  });

  // 5) el helper (used in some builds)
  def("el", function (id) {
    try { return document.getElementById(id); } catch (_) { return null; }
  });
})();
