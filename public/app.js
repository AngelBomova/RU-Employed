const $ = (selector) => document.querySelector(selector);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const clamp = (n, max = 100) => Math.max(0, Math.min(max, Number(n) || 0));
const list = (items) =>
  items?.length
    ? `<ul>${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : '<p class="muted small">No additional notes.</p>';
const colorFor = (n) =>
  n >= 75 ? "var(--good)" : n >= 50 ? "var(--warn)" : "var(--bad)";
const HISTORY_KEY = "ru-employed.reports.v1";
const state = {
  config: null,
  sessionId: null,
  plan: null,
  demo: false,
  busy: false,
  speaking: false,
  recording: false,
  ended: false,
  stream: null,
  recorder: null,
  timer: null,
  lastReply: "",
  answers: 0,
  currentQuestion: "q1",
  questionEndedAt: null,
  pendingAnswer: null,
  report: null,
  retryIndex: null,
  retryRecording: null,
  retryBusy: false,
  speechGeneration: 0,
};

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.add("hidden"), 4500);
}
function show(view) {
  document
    .querySelectorAll(".view")
    .forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
  document.querySelectorAll(".nav-item").forEach((el) => {
    const active =
      el.dataset.view === view ||
      (el.dataset.view === "setup" &&
        ["interview", "loading", "report"].includes(view));
    el.classList.toggle("active", active);
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("#page-label").textContent = {
    setup: "Interview studio",
    interview: "Live practice",
    loading: "Preparing your session",
    report: "Your feedback",
    history: "Practice history",
    guide: "Coaching playbook",
  }[view];
  if (view === "history") renderHistory();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`;
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}
function releaseMic() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}
async function getMic() {
  if (state.stream?.getAudioTracks().some((t) => t.readyState === "live"))
    return state.stream;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      "Recording is unavailable in this browser. You can type your answer instead.",
    );
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  return state.stream;
}

async function init() {
  $("#setup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    startInterview(false);
  });
  $("#demo-btn").addEventListener("click", () => startInterview(true));
  document.querySelectorAll(".drop").forEach((drop) => {
    const input = drop.querySelector("input");
    const label = drop.querySelector(".drop-text");
    const original = label.innerHTML;
    const update = () => {
      const file = input.files[0];
      if (
        file &&
        (file.size > 15 * 1024 * 1024 || !/\.(pdf|txt|md)$/i.test(file.name))
      ) {
        input.value = "";
        toast("Choose a PDF, TXT, or Markdown file under 15 MB.");
      }
      const valid = input.files[0];
      drop.classList.toggle("filled", !!valid);
      if (valid) label.textContent = valid.name;
      else label.innerHTML = original;
    };
    input.addEventListener("change", update);
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      if (!e.dataTransfer.files.length) return;
      const transfer = new DataTransfer();
      transfer.items.add(e.dataTransfer.files[0]);
      input.files = transfer.files;
      update();
    });
  });
  updateHistoryCount();
  try {
    state.config = await (await api("/api/config")).json();
    $("#voiceId").innerHTML = state.config.voices
      .map(
        (v) =>
          `<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.style)}</option>`,
      )
      .join("");
    const notes = [];
    if (!state.config.ai)
      notes.push(
        "Live AI interviews need a connected provider. You can explore the entire experience with <b>Try a demo</b>.",
      );
    if (!state.config.elevenlabs)
      notes.push(
        "Browser voice is available; answers use the keyboard until ElevenLabs is connected.",
      );
    if (notes.length) {
      $("#keys-warning").innerHTML = notes.join(" ");
      $("#keys-warning").classList.remove("hidden");
    }
  } catch {
    $("#keys-warning").textContent =
      "The interview server is unavailable. Start the project server to begin a session.";
    $("#keys-warning").classList.remove("hidden");
  }
}

const loadingSteps = [
  [
    "Getting to know your story…",
    "Finding the projects, experience, and achievements that make you, you.",
  ],
  [
    "Looking at your next opportunity…",
    "Connecting your strengths to what this role needs.",
  ],
  [
    "Making your interview personal…",
    "Preparing questions grounded in your experience.",
  ],
  [
    "Your interviewer is joining…",
    "Take a breath, grab some water, and settle in.",
  ],
];
async function startInterview(demo) {
  if (state.busy) return;
  $("#setup-error").textContent = "";
  if (!state.config)
    return ($("#setup-error").textContent =
      "The server is unavailable. Start it and refresh this page.");
  const fd = new FormData($("#setup-form"));
  if (demo) {
    // The demo uses a fictional sample profile; personal inputs are not sent.
    for (const key of [
      "resumeFile",
      "resumeText",
      "linkedinFile",
      "linkedinText",
      "portfolioUrl",
      "portfolioText",
      "jobUrl",
      "jobText",
      "notes",
    ])
      fd.delete(key);
    fd.append("demo", "true");
    fd.set("length", "short");
  } else {
    if (!fd.get("resumeFile")?.size && !fd.get("resumeText")?.trim())
      return ($("#setup-error").textContent =
        "Add your resume as a file or pasted text first.");
    if (!fd.get("jobUrl")?.trim() && !fd.get("jobText")?.trim())
      return ($("#setup-error").textContent =
        "Add a job link or paste the job description first.");
    if (!state.config.ai)
      return ($("#setup-error").textContent =
        "Add an OpenAI API key to .env and restart the server for a live interview. Try a demo to explore now.");
    for (const key of ["resumeFile", "linkedinFile"])
      if (!fd.get(key)?.size) fd.delete(key);
  }
  state.busy = true;
  state.demo = demo;
  state.ended = false;
  state.answers = 0;
  state.pendingAnswer = null;
  state.report = null;
  $("#start-btn").disabled = $("#demo-btn").disabled = true;
  audio.unlock();
  if (state.config.elevenlabs) {
    try {
      await getMic();
    } catch {
      toast(
        "Microphone access is unavailable. You can still type your answers.",
      );
    }
  }
  show("loading");
  let index = 0;
  const tick = () => {
    const [title, sub] = loadingSteps[Math.min(index++, 3)];
    $("#loading-title").textContent = title;
    $("#loading-sub").textContent = sub;
  };
  tick();
  const loader = setInterval(tick, 4500);
  try {
    const data = await (
      await api("/api/sessions", { method: "POST", body: fd })
    ).json();
    clearInterval(loader);
    state.sessionId = data.id;
    state.plan = data.plan;
    state.currentQuestion = data.question_id;
    state.demo = data.demo;
    state.busy = false;
    enterCall();
    await interviewerSays(data.reply);
  } catch (error) {
    releaseMic();
    show("setup");
    $("#setup-error").textContent = error.message;
  } finally {
    clearInterval(loader);
    state.busy = false;
    $("#start-btn").disabled = $("#demo-btn").disabled = false;
  }
}

// Audio uses a separate analyser for the mic so recorded sound never echoes.
const audio = (() => {
  const element = new Audio();
  let ctx,
    playbackAnalyser,
    micAnalyser,
    micSource,
    frame,
    finishPlayback,
    finishBrowser;
  const canvas = $("#viz"),
    pen = canvas.getContext("2d");
  function setup() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    playbackAnalyser = ctx.createAnalyser();
    playbackAnalyser.fftSize = 256;
    ctx.createMediaElementSource(element).connect(playbackAnalyser);
    playbackAnalyser.connect(ctx.destination);
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 256;
  }
  function draw(analyser, color) {
    cancelAnimationFrame(frame);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(bins);
      pen.clearRect(0, 0, 240, 240);
      for (let i = 0; i < 64; i++) {
        const value = bins[Math.floor((i / 64) * bins.length * 0.7)] / 255,
          angle = (i / 64) * Math.PI * 2;
        pen.strokeStyle = color;
        pen.globalAlpha = 0.3 + value * 0.7;
        pen.lineWidth = 3;
        pen.lineCap = "round";
        pen.beginPath();
        pen.moveTo(120 + Math.cos(angle) * 73, 120 + Math.sin(angle) * 73);
        pen.lineTo(
          120 + Math.cos(angle) * (79 + value * 37),
          120 + Math.sin(angle) * (79 + value * 37),
        );
        pen.stroke();
      }
      frame = requestAnimationFrame(loop);
    };
    loop();
  }
  return {
    unlock() {
      try {
        setup();
        ctx.resume().catch(() => {});
      } catch {}
    },
    async play(blob) {
      setup();
      await ctx.resume();
      const url = URL.createObjectURL(blob);
      element.src = url;
      draw(playbackAnalyser, "#8cac66");
      try {
        await new Promise((resolve, reject) => {
          finishPlayback = resolve;
          element.onended = resolve;
          element.onerror = () => reject(new Error("Audio playback failed."));
          element.play().catch(reject);
        });
      } finally {
        finishPlayback = null;
        URL.revokeObjectURL(url);
        this.stop();
      }
    },
    speak(text) {
      if (!("speechSynthesis" in window)) return Promise.resolve();
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.02;
        utterance.onend = utterance.onerror = resolve;
        finishBrowser = resolve;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }).finally(() => {
        finishBrowser = null;
      });
    },
    showMic(stream) {
      try {
        setup();
        micSource?.disconnect();
        micSource = ctx.createMediaStreamSource(stream);
        micSource.connect(micAnalyser);
        draw(micAnalyser, "#78915b");
      } catch {}
    },
    stop() {
      cancelAnimationFrame(frame);
      pen.clearRect(0, 0, 240, 240);
      micSource?.disconnect();
      micSource = null;
    },
    interrupt() {
      element.pause();
      finishPlayback?.();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      finishBrowser?.();
      this.stop();
    },
  };
})();

function enterCall() {
  $("#call-company").textContent = state.plan.company;
  $("#call-role").textContent = state.plan.role;
  $("#call-format").textContent = state.plan.format_summary;
  $("#interviewer-name").textContent = state.plan.interviewer.name;
  $("#interviewer-title").textContent =
    `${state.plan.interviewer.title} · ${state.plan.company}`;
  $("#interviewer-initial").textContent =
    state.plan.interviewer.name[0]?.toUpperCase() || "R";
  $("#session-mode").innerHTML =
    `<i></i> ${state.demo ? "GUIDED DEMO" : "LIVE PRACTICE"}`;
  $("#transcript").innerHTML = "";
  $("#transcript").classList.add("hidden");
  $("#type-input").value = "";
  $("#toggle-type").classList.toggle("hidden", !state.stream);
  $("#type-form").classList.toggle("hidden", !!state.stream);
  $("#call-timer").textContent = "00:00";
  const startedAt = Date.now();
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    $("#call-timer").textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1000);
  show("interview");
}
function setStatus(text, mode = "") {
  $("#status").textContent = text;
  $("#orb").className = `orb ${mode}`;
}
function updateControls() {
  const blocked = state.busy || state.speaking || state.ended;
  $("#mic-btn").disabled = blocked || !state.stream;
  $("#type-form button").disabled = blocked || state.recording;
  $("#type-input").disabled = state.busy || state.recording || state.ended;
  $("#end-btn").disabled = state.busy || state.recording;
  $("#replay-btn").disabled = state.busy || state.recording || state.ended;
  $("#toggle-type").disabled = state.recording || state.busy;
  $("#replay-btn").innerHTML =
    `${icon("refresh")} ${state.pendingAnswer ? "Retry answer" : state.speaking ? "Skip audio" : "Repeat question"}`;
  const question = /^q(\d+)$/.exec(state.currentQuestion || "");
  $("#question-progress").textContent = question
    ? `Question ${question[1]} of ${state.plan.question_count}`
    : state.ended
      ? "Complete"
      : "Follow-up";
}
function addBubble(role, text, meta) {
  const node = document.createElement("div");
  node.className = `bubble ${role}`;
  node.innerHTML = `${esc(text)}${meta ? `<small>${esc(meta)}</small>` : ""}`;
  $("#transcript").append(node);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
}
async function interviewerSays(text, repeat = false) {
  const generation = ++state.speechGeneration;
  state.lastReply = text;
  if (!repeat) addBubble("interviewer", text);
  $("#caption").textContent = text;
  state.speaking = true;
  setStatus(`${state.plan.interviewer.name} is speaking…`, "speaking");
  updateControls();
  try {
    let spoke = false;
    if (state.config.elevenlabs) {
      try {
        const response = await api(`/api/sessions/${state.sessionId}/speech`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const blob = await response.blob();
        if (generation !== state.speechGeneration) return;
        await audio.play(blob);
        spoke = true;
      } catch {
        toast("Interviewer audio switched to your browser voice.");
      }
    }
    if (generation !== state.speechGeneration) return;
    if (!spoke) await audio.speak(text);
  } finally {
    if (generation === state.speechGeneration) {
      state.speaking = false;
      state.questionEndedAt = Date.now();
      if (state.ended) finishCall();
      else {
        setStatus(
          state.stream
            ? "Your turn. Take your time."
            : "Your turn. Type your answer below.",
          "listening",
        );
        updateControls();
      }
    }
  }
}
function stopSpeech() {
  state.speechGeneration++;
  state.speaking = false;
  audio.interrupt();
}
function pickMime() {
  return (
    [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || ""
  );
}
function startRecording() {
  if (!state.stream || state.busy || state.speaking || state.ended) return;
  try {
    const chunks = [],
      mime = pickMime(),
      thinkTimeMs = Date.now() - (state.questionEndedAt || Date.now());
    const recorder = new MediaRecorder(
      state.stream,
      mime ? { mimeType: mime } : {},
    );
    state.recorder = recorder;
    state.recording = true;
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      audio.stop();
      state.recording = false;
      $("#mic-btn").classList.remove("recording");
      $("#mic-btn").setAttribute("aria-label", "Start answering");
      const type = recorder.mimeType || "audio/webm";
      const fd = new FormData();
      fd.append(
        "audio",
        new Blob(chunks, { type }),
        `answer.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`,
      );
      fd.append("thinkTimeMs", String(thinkTimeMs));
      submitAnswer(fd);
    };
    recorder.onerror = () => {
      state.recording = false;
      audio.stop();
      $("#mic-btn").classList.remove("recording");
      setStatus("Recording failed. Try again or type your answer.");
      updateControls();
    };
    recorder.start(250);
    audio.showMic(state.stream);
    $("#mic-btn").classList.add("recording");
    $("#mic-btn").setAttribute("aria-label", "Stop and send your answer");
    $("#mic-hint").textContent = "Recording… tap again to send your answer.";
    setStatus("Listening to your story…", "listening");
    updateControls();
  } catch (error) {
    state.recording = false;
    toast(error.message);
    updateControls();
  }
}
async function submitAnswer(fd) {
  if (state.busy || state.ended) return;
  state.busy = true;
  state.pendingAnswer = fd;
  updateControls();
  setStatus(
    fd.has("audio")
      ? "Listening back and transcribing…"
      : "Your interviewer is thinking…",
  );
  try {
    const data = await (
      await api(`/api/sessions/${state.sessionId}/answer`, {
        method: "POST",
        body: fd,
      })
    ).json();
    state.pendingAnswer = null;
    state.answers++;
    state.currentQuestion = data.question_id;
    state.ended = data.ended;
    addBubble(
      "candidate",
      data.transcript,
      data.metrics.words_per_minute
        ? `${data.metrics.words_per_minute} words/min · ${data.metrics.filler_total} potential fillers`
        : `${data.metrics.word_count} words · typed answer`,
    );
    if (fd.has("text")) $("#type-input").value = "";
    state.busy = false;
    $("#mic-hint").textContent =
      "Tap the mic to begin. Tap again when you’re done.";
    await interviewerSays(data.reply);
  } catch (error) {
    state.busy = false;
    setStatus(
      `${error.message} Use Retry answer to send the same response again.`,
    );
    updateControls();
  }
}
async function finishCall() {
  if (state.busy || state.recording) return;
  if (!state.answers) {
    stopSpeech();
    clearInterval(state.timer);
    releaseMic();
    state.sessionId = null;
    state.ended = false;
    show("setup");
    return;
  }
  stopSpeech();
  clearInterval(state.timer);
  releaseMic();
  state.busy = true;
  state.ended = true;
  show("loading");
  $("#loading-title").textContent = "Turning your conversation into a plan…";
  $("#loading-sub").textContent = state.demo
    ? "Building your demo report with simple structure checks."
    : "Reviewing your answers, delivery, and fit for the role. This may take a minute.";
  try {
    const data = await (
      await api(`/api/sessions/${state.sessionId}/feedback`, { method: "POST" })
    ).json();
    state.report = {
      ...data,
      id: state.sessionId,
      createdAt: new Date().toISOString(),
    };
    saveReport(state.report);
    renderReport(state.report);
    show("report");
  } catch (error) {
    show("interview");
    setStatus(`${error.message} Click Finish & get feedback to try again.`);
  } finally {
    state.busy = false;
    updateControls();
  }
}

function deliveryTotals(transcript) {
  const answers = transcript.filter((t) => t.role === "candidate" && t.metrics),
    voiced = answers.filter((t) => t.metrics.words_per_minute);
  return {
    wpm: voiced.length
      ? Math.round(
          voiced.reduce((n, t) => n + t.metrics.words_per_minute, 0) /
            voiced.length,
        )
      : null,
    fillers: answers.reduce((n, t) => n + t.metrics.filler_total, 0),
    pauses: voiced.length
      ? voiced.reduce((n, t) => n + t.metrics.long_pauses, 0)
      : null,
    voiced: voiced.length,
  };
}
function starHtml(answer) {
  return `<div class="star">${Object.entries(answer.star)
    .map(([key, value]) => {
      const n = clamp(value.score, 5);
      return `<div class="star-cell"><div class="lbl"><span>${esc(key[0].toUpperCase() + key.slice(1))}</span><span>${n}/5</span></div><div class="bar"><i style="width:${n * 20}%;background:${colorFor(n * 20)}"></i></div><p>${esc(value.note)}</p></div>`;
    })
    .join("")}</div>`;
}
function answerHtml(answer, index) {
  return `<article class="answer"><div class="answer-header"><h4><span class="muted">${String(index + 1).padStart(2, "0")} / </span>${esc(answer.question)}</h4><button class="btn" data-retry="${index}">${icon("refresh")} Try this again</button></div><p class="sum">${esc(answer.answer_summary)}</p>${!answer.uses_star ? '<p class="hint">Structure feedback for a non-STAR question.</p>' : ""}${starHtml(answer)}<div class="cols"><div class="col"><h5>What worked</h5>${list(answer.what_worked)}</div><div class="col expand"><h5>Add a little more</h5>${list(answer.elaborate_on)}</div><div class="col cut"><h5>Keep it concise</h5>${list(answer.cut)}</div></div><details><summary>A stronger way to tell it</summary><div class="rewrite">${esc(answer.stronger_version)}</div></details></article>`;
}
const signals = {
  strong_yes: "Strong practice performance",
  yes: "Well on your way",
  lean_yes: "A solid foundation",
  lean_no: "Room to grow",
  no: "Keep building your story",
};
function renderReport(data) {
  state.report = data;
  const f = data.feedback,
    plan = data.plan,
    d = deliveryTotals(data.transcript),
    score = clamp(f.overall.score);
  $("#report").innerHTML =
    `<div class="report"><div class="report-intro"><span class="eyebrow">THE NEXT TAKE STARTS HERE</span><h1>A conversation. A clearer path forward.</h1><p class="muted small">${esc(plan.role)} · ${esc(plan.company)} · ${data.demo ? "Guided demo report" : "Personal interview coaching"}</p></div>${data.demo ? '<div class="banner">DEMO REPORT · Structure scores use simple keyword checks. They are not AI evaluations or hiring predictions.</div>' : ""}<div class="card report-head"><div class="ring" style="--v:${score}"><div><b>${score}</b><span>${data.demo ? "demo indicator" : "overall / 100"}</span></div></div><div><span class="signal">${data.demo ? "Guided practice" : esc(signals[f.overall.hire_signal] || "Your coaching report")}</span><h2>${esc(f.overall.headline)}</h2><p class="muted">${esc(f.overall.summary)}</p></div></div><nav class="report-nav" aria-label="Feedback sections"><a href="#r-answers">Your answers</a><a href="#r-delivery">Voice & delivery</a><a href="#r-fit">Role fit</a><a href="#r-plan">Your next steps</a><a href="#r-transcript">Transcript</a></nav><section class="block" id="r-answers"><h3>Your stories, a little stronger.</h3><p class="muted">Specific feedback for each answer. Keep what lands. Refine what doesn't.</p>${f.answers.map(answerHtml).join("")}</section><section class="block card" id="r-delivery"><span class="eyebrow">HOW YOUR STORY COMES ACROSS</span><h3>Voice & delivery</h3><p class="hint">${d.voiced ? "Pace and pauses are measured from transcription timestamps. Confidence and tone are inferred, not direct acoustic measurements. Pitch and volume are not assessed." : "Your answers were typed. Vocal tone, pace, volume, and pauses were not measured. Confidence reflects wording only."}</p><div class="stats"><div class="stat"><b>${data.demo ? "—" : clamp(f.delivery.confidence_score)}</b><span>${data.demo ? "vocal confidence not assessed" : "confidence of delivery / wording"}</span></div><div class="stat"><b>${d.wpm ?? "—"}</b><span>average words / minute</span></div><div class="stat"><b>${d.fillers}</b><span>potential filler words</span></div><div class="stat"><b>${d.pauses ?? "—"}</b><span>pauses over 1.5 seconds</span></div></div><dl class="kv"><dt>Tone</dt><dd>${esc(f.delivery.tone)}</dd><dt>Pace</dt><dd>${esc(f.delivery.pace)}</dd><dt>Word choice</dt><dd>${esc(f.delivery.filler_words)}</dd><dt>Ownership</dt><dd>${esc(f.delivery.ownership)}</dd></dl><h4>Small shifts to practice</h4>${list(f.delivery.tips)}</section><section class="block card" id="r-fit"><h3>Your experience meets the opportunity.</h3><div class="two"><div><h4>Strengths to bring forward</h4>${list(f.experience_fit.strengths_for_role)}</div><div><h4>Gaps to work on</h4>${list(f.experience_fit.gaps_vs_job)}</div></div><h4>Stories you could use</h4>${list(f.experience_fit.underused_experiences)}<h4>Connecting to the mission</h4><p class="muted small">${esc(f.experience_fit.mission_alignment)}</p></section><section class="block" id="r-plan"><h3>A plan for your next yes.</h3><ol class="plan">${[
      ...f.improvement_plan,
    ]
      .sort((a, b) => a.priority - b.priority)
      .map(
        (p) =>
          `<li><span class="when">${esc(p.timeframe)}</span><h4>${esc(p.title)}</h4><p class="muted">${esc(p.why)}</p>${list(p.actions)}<div class="drill"><b>Try this:</b> ${esc(p.practice_drill)}</div></li>`,
      )
      .join(
        "",
      )}</ol></section><section class="block card"><h3>Keep the conversation going.</h3>${list(f.practice_questions.map((q) => `${q.question} — ${q.why}`))}</section><section class="block card" id="r-transcript"><h3>Your full conversation</h3><div class="transcript">${data.transcript.map((t) => `<div class="bubble ${t.role === "candidate" ? "candidate" : "interviewer"}">${esc(t.text)}<small>${t.role === "candidate" ? "You" : esc(plan.interviewer.name)}</small></div>`).join("")}</div></section><div class="report-actions"><button class="btn" id="print-report">Save as PDF</button><button class="btn" data-view="history">Practice history</button><button class="btn primary" data-view="setup">Practice again ${icon("arrow")}</button></div></div>`;
}

function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (r) =>
              r?.id &&
              r.feedback?.overall &&
              r.plan &&
              Array.isArray(r.transcript),
          )
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
function saveReport(report) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(
        [report, ...readHistory().filter((r) => r.id !== report.id)].slice(
          0,
          12,
        ),
      ),
    );
  } catch {
    toast(
      "This report could not be saved on your device. You can still save it as a PDF.",
    );
  }
  updateHistoryCount();
}
function updateHistoryCount() {
  $("#history-count").textContent = readHistory().length;
}
function renderHistory() {
  const reports = readHistory(),
    real = reports.filter((r) => !r.demo);
  const average = real.length
    ? Math.round(
        real.reduce((n, r) => n + clamp(r.feedback.overall.score), 0) /
          real.length,
      )
    : "—";
  $("#history-list").innerHTML = !reports.length
    ? `<div class="card history-empty">${icon("clock")}<h2>Your next chapter hasn't been recorded yet.</h2><p>Finish an interview and your feedback will be waiting here.</p><button class="btn primary" data-view="setup">Start your first practice ${icon("arrow")}</button></div>`
    : `<div class="stats history-stats"><div class="stat"><b>${real.length}</b><span>live interviews completed</span></div><div class="stat"><b>${average}</b><span>average live interview score</span></div><div class="stat"><b>${real.length ? Math.max(...real.map((r) => clamp(r.feedback.overall.score))) : "—"}</b><span>best live interview score</span></div><div class="stat"><b>${reports.filter((r) => r.demo).length}</b><span>guided demos · excluded from progress</span></div></div>${reports.map((r) => `<article class="card history-card"><div class="history-score">${clamp(r.feedback.overall.score)}</div><div class="history-copy"><h3>${esc(r.plan.role)}</h3><p>${esc(r.plan.company)} · ${esc(new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</p><div class="history-meta"><span class="signal">${r.demo ? "Demo indicator" : "Live interview"}</span><span class="hint">${r.feedback.answers.length} answers reviewed</span></div></div><button class="btn" data-report="${esc(r.id)}">View feedback ${icon("arrow")}</button><button class="btn delete-report" data-delete="${esc(r.id)}" aria-label="Delete report for ${esc(r.plan.company)}">${icon("close")}</button></article>`).join("")}`;
}

function openRetry(index) {
  if (state.retryBusy)
    return toast("Your previous practice response is still being reviewed.");
  const answer = state.report?.feedback.answers[index];
  if (!answer) return;
  state.retryIndex = index;
  state.retryRecording = null;
  $("#retry-question").textContent = answer.question;
  $("#retry-tip").textContent = answer.elaborate_on.join(" ");
  $("#retry-input").value = "";
  $("#retry-result").innerHTML = "";
  $("#retry-status").textContent =
    "Fresh feedback is available while the original session is active (up to 3 hours).";
  $("#retry-mic").classList.toggle("hidden", !state.config?.elevenlabs);
  $("#retry-mic").innerHTML = `${icon("mic")} Record answer`;
  $("#retry-submit").disabled = false;
  $("#retry-input").required = true;
  $("#retry-dialog").showModal();
}
async function recordRetry() {
  if (state.retryBusy) return;
  if (state.retryRecorder?.state === "recording") {
    state.retryRecorder.stop();
    return;
  }
  try {
    $("#retry-mic").disabled = true;
    await getMic();
    if (!$("#retry-dialog").open) {
      releaseMic();
      return;
    }
    const chunks = [],
      mime = pickMime(),
      recorder = new MediaRecorder(
        state.stream,
        mime ? { mimeType: mime } : {},
      );
    state.retryRecorder = recorder;
    state.retryRecording = null;
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      state.retryRecording = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      releaseMic();
      $("#retry-mic").innerHTML = `${icon("mic")} Record again`;
      $("#retry-input").required = false;
      $("#retry-submit").disabled = false;
      $("#retry-status").textContent =
        "Recording ready. Get fresh feedback to transcribe and review it.";
    };
    recorder.onerror = () => {
      releaseMic();
      $("#retry-submit").disabled = false;
      $("#retry-status").textContent =
        "Recording failed. Try again or type your response.";
    };
    recorder.start(250);
    $("#retry-mic").innerHTML = `${icon("mic")} Stop recording`;
    $("#retry-submit").disabled = true;
    $("#retry-status").textContent = "Recording your new response…";
  } catch {
    $("#retry-status").textContent =
      "Microphone access is unavailable. Type your response instead.";
  } finally {
    $("#retry-mic").disabled = false;
  }
}
async function submitRetry(e) {
  e.preventDefault();
  if (state.retryBusy || state.retryRecorder?.state === "recording") return;
  const fd = new FormData();
  fd.append("answerIndex", String(state.retryIndex));
  if (state.retryRecording) {
    const type = state.retryRecording.type;
    fd.append(
      "audio",
      state.retryRecording,
      `retry.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`,
    );
  } else {
    const text = $("#retry-input").value.trim();
    if (!text) return;
    fd.append("text", text);
  }
  state.retryBusy = true;
  $("#retry-submit").disabled = $("#retry-mic").disabled = true;
  $("#retry-status").textContent = "Reviewing your new answer…";
  try {
    const result = await (
      await api(
        `/api/sessions/${state.report.sessionId || state.report.id}/retry`,
        { method: "POST", body: fd },
      )
    ).json();
    if (!$("#retry-dialog").open) return;
    const original = state.report.feedback.answers[state.retryIndex],
      a = result.answer;
    const total = (answer) =>
      Object.values(answer.star).reduce((n, s) => n + clamp(s.score, 5), 0);
    $("#retry-status").textContent =
      `Structure score: ${total(original)}/20 → ${total(a)}/20${result.demo ? " · demo keyword indicator" : ""}. Your original report is preserved.`;
    $("#retry-result").innerHTML =
      `<h3>Your new take</h3><div class="rewrite">${esc(result.transcript)}</div>${starHtml(a)}<h3>What worked</h3>${list(a.what_worked)}<h3>What to refine next</h3>${list(a.elaborate_on)}<div class="rewrite">${esc(a.stronger_version)}</div>`;
  } catch (error) {
    $("#retry-status").textContent = error.message;
  } finally {
    state.retryBusy = false;
    $("#retry-submit").disabled = $("#retry-mic").disabled = false;
  }
}

document.addEventListener("click", (e) => {
  const view = e.target.closest("[data-view]");
  if (view) {
    if (
      state.busy ||
      state.recording ||
      ($("#view-interview").classList.contains("active") && !state.report)
    )
      return toast(
        "Finish your current interview before opening another page.",
      );
    show(view.dataset.view);
    return;
  }
  const report = e.target.closest("[data-report]");
  if (report) {
    const data = readHistory().find((r) => r.id === report.dataset.report);
    if (data) {
      renderReport(data);
      show("report");
    }
    return;
  }
  const remove = e.target.closest("[data-delete]");
  if (remove) {
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(
          readHistory().filter((r) => r.id !== remove.dataset.delete),
        ),
      );
      renderHistory();
      updateHistoryCount();
      toast("Report removed from this device.");
    } catch {
      toast("Your browser could not delete this saved report.");
    }
    return;
  }
  const retry = e.target.closest("[data-retry]");
  if (retry) openRetry(Number(retry.dataset.retry));
  if (e.target.closest("#print-report")) window.print();
});
$("#mic-btn").addEventListener("click", () => {
  if (state.recording) state.recorder.stop();
  else startRecording();
});
$("#type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#type-input").value.trim();
  if (!text || state.busy || state.speaking || state.recording || state.ended)
    return;
  const fd = new FormData();
  fd.append("text", text);
  fd.append(
    "thinkTimeMs",
    String(Date.now() - (state.questionEndedAt || Date.now())),
  );
  submitAnswer(fd);
});
$("#type-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#type-form").requestSubmit();
  }
});
document.addEventListener("keydown", (e) => {
  if (
    e.code !== "Space" ||
    !$("#view-interview").classList.contains("active") ||
    ["TEXTAREA", "INPUT", "SELECT", "BUTTON"].includes(
      document.activeElement.tagName,
    )
  )
    return;
  if ($("#mic-btn").disabled) return;
  e.preventDefault();
  if (state.recording) state.recorder.stop();
  else startRecording();
});
$("#toggle-type").addEventListener("click", () => {
  const visible = $("#type-form").classList.contains("hidden");
  $("#type-form").classList.toggle("hidden", !visible);
  $("#toggle-type").textContent = visible ? "Speak instead" : "Type instead";
  if (visible) $("#type-input").focus();
});
$("#toggle-transcript").addEventListener("click", () =>
  $("#transcript").classList.toggle("hidden"),
);
$("#replay-btn").addEventListener("click", () => {
  if (state.busy || state.recording) return;
  if (state.pendingAnswer) return submitAnswer(state.pendingAnswer);
  if (state.speaking) {
    stopSpeech();
    state.questionEndedAt = Date.now();
    setStatus("Your turn. Take your time.", "listening");
    updateControls();
    return;
  }
  if (state.lastReply && !state.ended) interviewerSays(state.lastReply, true);
});
$("#end-btn").addEventListener("click", finishCall);
$("#retry-form").addEventListener("submit", submitRetry);
$("#retry-mic").addEventListener("click", recordRetry);
$("#retry-input").addEventListener("input", () => {
  state.retryRecording = null;
  $("#retry-input").required = true;
});
$("#close-retry").addEventListener("click", () => $("#retry-dialog").close());
$("#retry-dialog").addEventListener("close", () => {
  if (state.retryRecorder?.state === "recording") state.retryRecorder.stop();
  releaseMic();
});
window.addEventListener("beforeunload", () => {
  audio.interrupt();
  releaseMic();
});
init();
