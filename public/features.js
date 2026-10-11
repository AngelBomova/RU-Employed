import { createAvatar3D } from "./avatar-3d.js";
import { createContinuousMic } from "./continuous-mic.js";
import { createCameraCoach } from "./camera-coach.js";
import { analyzeProgress, metricsFor, CATEGORY_LABELS } from "./analytics.js";

export function createFeatures(ctx) {
  const {
    $,
    esc,
    icon,
    state,
    api,
    toast,
    show,
    audio,
    getMic,
    releaseMic,
    readHistory,
    saveReport,
    renderReport,
    updateHistoryCount,
  } = ctx;
  let camera = null,
    chart = null,
    chartReady,
    editor = null,
    editorReady,
    coding = null,
    codingBusy = false,
    codingSpeaking = false,
    codingRecorder = null,
    codingSpeechGeneration = 0;
  const drafts = {};
  const listHtml = (items) =>
    "<ul>" +
    items.map((item) => "<li>" + esc(item) + "</li>").join("") +
    "</ul>";
  let videoAvatar,
    codeAvatar,
    codeVoicing = false,
    codeFinishAfterAnswer = false,
    codePending = null;
  const coach = createCameraCoach((text) => {
    $("#camera-coach-status").textContent = text;
  });
  const codeMic = createContinuousMic({
    canListen: () => !!coding && !codingBusy && !codingSpeaking && !codePending,
    onState: ({ muted, speaking }) => {
      codeVoicing = speaking;
      $("#coding-mic").textContent = muted
        ? "Unmute microphone"
        : "Mute microphone";
      $("#coding-mic").setAttribute("aria-pressed", String(muted));
      if (speaking)
        $("#coding-status").textContent =
          "Listening to your explanation… pause to send.";
    },
    onAnswer: async (blob) => {
      const body = new FormData();
      body.set(
        "audio",
        blob,
        "explanation." + (blob.type.includes("mp4") ? "m4a" : "webm"),
      );
      for (const [k, v] of Object.entries(codePayload())) body.set(k, v);
      await explain(body);
    },
    onError: (error) => toast(error.message),
  });
  $(".side-nav").insertAdjacentHTML(
    "beforeend",
    `<button class="nav-item" data-view="coding" aria-label="Coding room">${icon("code")} Coding room</button><button class="nav-item" data-view="progress" aria-label="Your progress">${icon("chart")} Your progress</button>`,
  );
  $(".topbar-right").insertAdjacentHTML(
    "afterbegin",
    '<button class="btn account-button" data-view="account" id="account-nav">Sign in</button>',
  );
  $("#setup-form .settings-row").insertAdjacentHTML(
    "afterend",
    `<div class="settings-row"><label class="field-label" for="interviewStyle">Interview space<select name="interviewStyle" id="interviewStyle"><option value="voice">Voice studio</option><option value="video">Face-to-face</option></select></label><label class="field-label" for="gender">AI interviewer<select name="gender" id="gender"><option value="female">Female interviewer</option><option value="male">Male interviewer</option></select></label></div><label class="camera-consent"><input type="checkbox" id="enable-camera" name="enableCamera" value="true"/> Enable my webcam for face-to-face practice</label><p class="hint">Your camera stays on this device. No video is uploaded. Optional coaching analyzes landmarks locally.</p><label class="camera-consent"><input type="checkbox" id="analyze-camera" name="analyzeCamera" value="true"/> Review camera-facing direction, framing, and facial movement</label><p class="hint" id="camera-coach-status">Webcam coaching is optional. Facial movement does not measure emotion or confidence.</p>`,
  );
  $("#setup-form .settings-row").insertAdjacentHTML(
    "afterend",
    '<label class="field-label" id="technical-format-label">Technical interview format<select id="technical-format" name="technicalFormat"><option value="coding">Live coding · editor and spoken explanation</option><option value="conversation">Spoken technical questions</option><option value="system-design">System design discussion</option></select></label>',
  );
  const updateFormat = () =>
    $("#technical-format-label").classList.toggle(
      "hidden",
      new FormData($("#setup-form")).get("focus") !== "technical",
    );
  document
    .querySelectorAll('[name="focus"]')
    .forEach((input) => input.addEventListener("change", updateFormat));
  updateFormat();
  const stage = $("#view-interview .stage");
  const participants = document.createElement("div");
  participants.className = "video-participants hidden";
  participants.innerHTML = `<div class="video-person"><div id="avatar-video"></div><div class="participant-label">Your AI interviewer <span>SIMULATED</span></div></div><div class="video-person user-video"><video id="user-video" autoplay muted playsinline></video><div id="camera-placeholder"><span class="camera-initial">Y</span><b>Your camera is off</b><small>You can still take part in the interview.</small></div><div class="participant-label">You <span>LOCAL PREVIEW</span></div></div>`;
  stage.prepend(participants);
  $("#view-interview .call-foot").insertAdjacentHTML(
    "afterbegin",
    '<button class="btn ghost hidden" id="camera-btn" type="button">Enable camera</button><button class="btn ghost" id="mute-btn" type="button">Mute microphone</button>',
  );
  $("main > .foot").insertAdjacentHTML(
    "beforebegin",
    `
    <section id="view-coding" class="view"><div class="page-intro"><div><span class="eyebrow">THINK IT THROUGH. BUILD IT OUT.</span><h1>Your thinking, in action<span>.</span></h1><p>A real editor. A thoughtful interviewer. Room to work it out.</p></div></div>
      <form id="coding-setup" class="card coding-setup"><div class="settings-row"><label class="field-label">Company style<select id="coding-company"><option>Google</option><option>Meta</option><option>Amazon</option><option>Microsoft</option><option>Apple</option><option>Other</option></select></label><label class="field-label">Position<input id="coding-role" value="Software Engineer Intern" maxlength="100" required/></label><label class="field-label">Difficulty<select id="coding-difficulty"><option value="easy">Easy · fundamentals</option><option value="medium" selected>Medium · problem-solving</option><option value="hard">Hard · advanced reasoning</option></select></label></div><p class="hint">Representative practice adapted to a company style. These questions are not verified as actual company questions.</p><div class="coding-actions"><button class="btn primary" id="generate-coding" type="submit">Generate an interview ${icon("arrow")}</button><button class="btn" id="demo-coding" type="button">Try a coding demo</button></div><p class="error" id="coding-setup-error" role="alert"></p></form>
      <div id="coding-workspace" class="hidden"><div class="coding-toolbar"><span class="signal" id="coding-source">REPRESENTATIVE PRACTICE</span><span id="coding-validation" class="hint"></span><button class="btn" id="leave-coding">Leave without report</button><button class="btn danger" id="finish-coding">Finish & review ${icon("arrow")}</button></div><div class="coding-layout"><div class="coding-left"><article class="card problem-card"><span class="eyebrow" id="coding-target"></span><h2 id="problem-title"></h2><p id="problem-description"></p><h4>Constraints</h4><ul id="problem-constraints"></ul><details><summary>Examples & test cases</summary><div id="problem-examples"></div></details></article><article class="card coding-interviewer"><div class="coding-persona"><div id="coding-avatar"></div><div><b id="coding-interviewer-name"></b><span>AI technical interviewer</span></div></div><p id="coding-caption"></p><form id="code-explanation-form"><label class="field-label" for="code-explanation">Explain your thinking or ask a question</label><textarea id="code-explanation" rows="3" placeholder="I’m starting with…"></textarea><div class="coding-actions"><button class="btn" type="button" id="coding-mic">${icon("mic")} Record explanation</button><button class="btn primary" id="send-code-explanation">Discuss my code ${icon("arrow")}</button><button class="btn" type="button" id="coding-skip">Skip audio</button></div></form><p class="hint" id="coding-status" role="status"></p><details><summary>Conversation</summary><div id="coding-transcript"></div></details></article></div><div class="card editor-card"><div class="editor-toolbar"><label for="code-language" class="sr-only">Programming language</label><select id="code-language"><option value="python">Python 3</option><option value="javascript">JavaScript</option><option value="java">Java</option><option value="cpp">C++</option></select><span>Monaco Editor</span><button class="btn primary" id="run-code">▷ Run tests</button></div><div id="code-editor" aria-label="Live coding editor"></div><p class="hint" id="editor-status" role="status"></p><div class="test-heading"><h3>Test results</h3><span id="test-summary" class="hint">Your current code has not been run.</span></div><div id="code-results"><p class="muted small">Run your solution to check it against the examples.</p></div><p id="runner-note" class="banner hidden">Code execution isn't connected yet. You can write and discuss your solution; running it needs a configured Judge0 sandbox.</p></div></div></div>
    </section>
    <section id="view-progress" class="view"><div class="page-intro"><div><span class="eyebrow">ONE CONVERSATION AT A TIME</span><h1>See how far you've come<span>.</span></h1><p>Small improvements add up. Here's your progress in practice.</p></div><button class="btn primary" data-view="setup">Practice again ${icon("arrow")}</button></div><div class="analytics-filters"><label class="field-label">Time period<select id="progress-range"><option value="7">Past week</option><option value="30">Past month</option><option value="90">Past three months</option><option value="0" selected>All time</option></select></label><label class="field-label">Practice type<select id="progress-focus"><option value="all">All types</option><option value="behavioral">Behavioral</option><option value="technical">Technical</option><option value="mixed">Mixed interviews</option><option value="coding">Live coding</option></select></label><label class="field-label">Chart metric<select id="progress-metric">${Object.entries(
      CATEGORY_LABELS,
    )
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join(
        "",
      )}</select></label></div><div id="progress-stats" class="stats"></div><div class="card chart-card"><div class="card-heading"><div><h2>Your practice, over time</h2><p>Hover for details. Select a point to open that interview.</p></div><span class="small-badge">LIVE INTERVIEWS</span></div><div class="chart-container"><canvas id="progress-chart" role="img" aria-label="Interview performance over time"></canvas><p id="chart-empty" class="hidden">Finish a live interview to start your progress chart.</p></div><p class="hint">Demos are excluded. Gaps mean a category was not assessed. Confidence is inferred from available evidence, never a direct vocal measurement.</p></div><div id="progress-comparison" class="card comparison-card"></div><div id="progress-history"></div></section>
    <section id="view-account" class="view"><div class="page-intro"><div><span class="eyebrow">YOUR STORY. YOUR SPACE.</span><h1 id="account-title">Welcome to your next chapter<span>.</span></h1><p id="account-intro">Sign in to keep your interviews and progress together.</p></div></div><div id="account-notice" class="banner hidden"></div><div id="recovery-panel" class="card hidden"><h2>Save your recovery code</h2><p>This is your way to reset your password offline. Keep it somewhere safe. It is shown only now.</p><pre id="recovery-code" tabindex="0"></pre><button class="btn" id="copy-recovery">Copy code</button><button class="btn primary" id="saved-recovery">I saved it</button></div><div id="auth-panel" class="card auth-card"><div class="auth-tabs"><button type="button" class="btn primary" data-auth-mode="login">Sign in</button><button type="button" class="btn" data-auth-mode="signup">Create an account</button></div><form id="auth-form"><label class="field-label hidden" id="auth-name-label">Your name<input id="auth-name" autocomplete="name" maxlength="80"/></label><label class="field-label">Email address<input id="auth-email" type="email" autocomplete="email" required/></label><label class="field-label" id="auth-password-label">Password<input id="auth-password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required/></label><label class="field-label hidden" id="auth-recovery-label">Recovery code<input id="auth-recovery" autocomplete="off" maxlength="100" placeholder="Your saved signup code"/></label><button class="btn primary big" id="auth-submit">Sign in ${icon("arrow")}</button></form><button class="text-button" id="forgot-password">Forgot password?</button><p class="error" id="auth-error" role="alert"></p><p class="hint" id="auth-status" role="status"></p></div><div id="profile-panel" class="hidden account-grid"><form id="account-details" class="card"><h2>Your account</h2><label class="field-label">Your name<input id="profile-name" autocomplete="name" maxlength="80"/></label><label class="field-label">Email address<input id="profile-email" type="email" autocomplete="email" required/></label><label class="field-label">New password <span class="optional">OPTIONAL</span><input id="profile-password" type="password" autocomplete="new-password" minlength="10" maxlength="128" placeholder="Leave blank to keep your current password"/></label><button class="btn primary">Save account details</button><button class="btn" id="signout" type="button">Sign out</button><p id="profile-status" class="hint" role="status"></p></form><form id="saved-materials" class="card"><h2>Your saved experience</h2><p class="hint">These details are private to your account. Uploads are stored as extracted text, not original files.</p><label class="field-label">Resume<textarea id="saved-resume" rows="5" placeholder="Your experience and achievements…"></textarea></label><label class="field-label">LinkedIn experience<textarea id="saved-linkedin" rows="3"></textarea></label><label class="field-label">Portfolio projects<textarea id="saved-portfolio" rows="3"></textarea></label><div class="coding-actions"><button class="btn primary">Save experience</button><button class="btn" id="use-saved-materials" type="button">Use in next interview</button></div><p id="materials-status" class="hint" role="status"></p></form></div></section>
  `,
  );
  let savedProfile = {},
    resumeSaving = null;
  const resumeDrop = $("#resumeFile").closest(".drop");
  resumeDrop.insertAdjacentHTML(
    "afterend",
    `<div id="saved-resume-card" class="saved-resume-card hidden"><div class="saved-resume-copy"><b id="saved-resume-name"></b><span>Saved to your account · Ready for your next interview</span></div><div class="saved-resume-actions"><button class="btn" type="button" id="replace-resume">Replace</button><button class="text-button" type="button" id="remove-resume">Remove</button></div></div><p id="resume-save-status" class="hint hidden" role="status"></p>`,
  );
  $("#saved-resume")
    .closest("label")
    .insertAdjacentHTML(
      "afterend",
      '<button class="text-button" type="button" id="account-remove-resume">Remove saved resume</button>',
    );

  function renderResume() {
    const saved = Boolean(state.user && savedProfile.resume);
    $("#saved-resume-card").classList.toggle("hidden", !saved);
    resumeDrop.classList.toggle("hidden", saved);
    $("#saved-resume-name").textContent =
      savedProfile.resumeFilename || "Your saved resume";
    for (const id of [
      "replace-resume",
      "remove-resume",
      "account-remove-resume",
    ])
      $("#" + id).disabled = Boolean(resumeSaving) || !saved;
    $("#resumeFile").disabled = Boolean(resumeSaving);
  }
  function applyProfile(materials, fillSetup = true) {
    savedProfile = materials || {};
    for (const key of ["resume", "linkedin", "portfolio"])
      $("#saved-" + key).value = savedProfile[key] || "";
    if (fillSetup) $("#resumeText").value = savedProfile.resume || "";
    renderResume();
  }
  function resumeStatus(message) {
    $("#resume-save-status").textContent = message;
    $("#resume-save-status").classList.toggle("hidden", !message);
  }
  async function saveResumeChange(request, success) {
    if (resumeSaving) return resumeSaving;
    const userId = state.user?.id;
    resumeSaving = (async () => {
      try {
        const result = await (await request()).json();
        if (state.user?.id !== userId) return false;
        applyProfile(result.materials);
        $("#resumeFile").value = "";
        $("#resumeFile").dispatchEvent(new Event("change"));
        resumeStatus(success);
        $("#materials-status").textContent = success;
        return true;
      } catch (error) {
        $("#resumeFile").value = "";
        $("#resumeFile").dispatchEvent(new Event("change"));
        resumeStatus(error.message);
        toast(error.message);
        return false;
      } finally {
        resumeSaving = null;
        renderResume();
      }
    })();
    renderResume();
    return resumeSaving;
  }
  $("#resumeFile").addEventListener("change", () => {
    const file = $("#resumeFile").files[0];
    if (!state.user || !file || resumeSaving) return;
    if (file.size > 15 * 1024 * 1024 || !/\.(pdf|txt|md)$/i.test(file.name))
      return;
    const body = new FormData();
    body.set("resumeFile", file);
    resumeStatus("Saving your resume…");
    saveResumeChange(
      () => api("/api/profile/resume", { method: "PUT", body }),
      "Resume saved. It will be ready whenever you sign in.",
    );
  });
  $("#replace-resume").addEventListener("click", () =>
    $("#resumeFile").click(),
  );
  const removeResume = () => {
    if (!state.user || resumeSaving) return;
    resumeStatus("Removing your saved resume…");
    saveResumeChange(
      () => api("/api/profile/resume", { method: "DELETE" }),
      "Saved resume removed. Upload a new one whenever you’re ready.",
    );
  };
  $("#remove-resume").addEventListener("click", removeResume);
  $("#account-remove-resume").addEventListener("click", removeResume);
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () =>
        reject(
          new Error(
            "A workspace component failed to load. Refresh and try again.",
          ),
        );
      document.head.append(script);
    });
  let authMode = "login";
  function mode(next) {
    authMode = next;
    $("#auth-name-label").classList.toggle("hidden", next !== "signup");
    const offlineReset =
      next === "forgot" && state.config?.authMode === "local";
    $("#auth-recovery-label").classList.toggle("hidden", !offlineReset);
    $("#auth-recovery").required = offlineReset;
    $("#auth-password-label").classList.toggle(
      "hidden",
      next === "forgot" && !offlineReset,
    );
    $("#auth-password").required = next !== "forgot" || offlineReset;
    $("#auth-password").autocomplete =
      next === "signup" || offlineReset ? "new-password" : "current-password";
    $("#auth-submit").innerHTML =
      `${next === "forgot" ? (offlineReset ? "Reset password" : "Send reset link") : next === "signup" ? "Create account" : "Sign in"} ${icon("arrow")}`;
    document
      .querySelectorAll("[data-auth-mode]")
      .forEach((b) =>
        b.classList.toggle("primary", b.dataset.authMode === next),
      );
    $("#auth-error").textContent = $("#auth-status").textContent = "";
  }
  async function refreshAccount() {
    const previous = state.user?.id;
    const result = await (await api("/api/auth/me")).json();
    state.user = result.user;
    if (previous !== state.user?.id) state.cloudReports = [];
    if (state.user) {
      const result = await (await api("/api/reports")).json();
      state.cloudReports = result.reports;
      const profile = await (await api("/api/profile")).json();
      applyProfile(profile.materials);
      if (savedProfile.resume) {
        $("#resumeFile").value = "";
        $("#resumeFile").dispatchEvent(new Event("change"));
      }
    } else applyProfile({}, Boolean(previous));
    resumeStatus("");
    $("#account-nav").textContent = state.user
      ? state.user.name || "My account"
      : "Sign in";
    $(".user-avatar").textContent = (state.user?.name ||
      state.user?.email ||
      "Y")[0].toUpperCase();
    $("#view-history > .hint").textContent = state.user
      ? "Private reports saved to your account. Demo indicators are excluded from progress."
      : state.config?.authMode === "local"
        ? "Guest reports save in this browser. Sign in to keep private reports on this computer."
        : "Reports and transcripts save on this device. Sign in to save across devices.";
    updateHistoryCount();
    account();
  }
  function account() {
    const enabled = !!state.config?.accounts;
    $("#account-notice").classList.toggle(
      "hidden",
      enabled && state.config?.authMode !== "local",
    );
    $("#account-notice").textContent =
      state.config?.authMode === "local"
        ? "Local accounts save privately in SQLite on this computer. Password resets use your recovery code; no email service is needed."
        : "Accounts are unavailable. You can still explore a demo.";
    $("#auth-panel").classList.toggle("hidden", !!state.user);
    $("#profile-panel").classList.toggle("hidden", !state.user);
    $("#auth-submit").disabled = !enabled;
    if (state.user) {
      $("#account-title").textContent =
        `Welcome back${state.user.name ? ", " + state.user.name : ""}.`;
      $("#account-intro").textContent =
        "Your experience, conversations, and progress — in one private place.";
      $("#profile-name").value = state.user.name;
      $("#profile-email").value = state.user.email;
    } else {
      $("#account-title").innerHTML =
        "Welcome to your next chapter<span>.</span>";
      $("#account-intro").textContent =
        "Sign in to keep your interviews and progress together.";
    }
  }
  document
    .querySelectorAll("[data-auth-mode]")
    .forEach((b) =>
      b.addEventListener("click", () => mode(b.dataset.authMode)),
    );
  $("#forgot-password").addEventListener("click", () => mode("forgot"));
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#auth-error").textContent = "";
    $("#auth-submit").disabled = true;
    try {
      const result = await (
        await api(
          `/api/auth/${authMode === "forgot" && state.config?.authMode === "local" ? "reset" : authMode}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              recoveryCode: $("#auth-recovery").value,
              name: $("#auth-name").value,
              email: $("#auth-email").value,
              password: $("#auth-password").value,
            }),
          },
        )
      ).json();
      $("#auth-password").value = "";
      $("#auth-status").textContent = result.message || "Signed in.";
      await refreshAccount();
      $("#auth-recovery").value = "";
      if (result.recoveryCode) {
        $("#recovery-code").textContent = result.recoveryCode;
        $("#recovery-panel").classList.remove("hidden");
        show("account");
      } else if (state.user) {
        show("progress");
        toast("Welcome to your private workspace.");
      }
    } catch (error) {
      $("#auth-error").textContent = error.message;
    } finally {
      $("#auth-submit").disabled = !state.config?.accounts;
    }
  });
  $("#copy-recovery").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#recovery-code").textContent);
      toast("Recovery code copied.");
    } catch {
      toast("Select the recovery code and copy it manually.");
    }
  });
  $("#saved-recovery").addEventListener("click", () => {
    $("#recovery-code").textContent = "";
    $("#recovery-panel").classList.add("hidden");
    show("progress");
  });
  $("#account-details").addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    try {
      const body = { name: $("#profile-name").value };
      if ($("#profile-email").value !== state.user.email)
        body.email = $("#profile-email").value;
      if ($("#profile-password").value)
        body.password = $("#profile-password").value;
      const result = await (
        await api("/api/auth/account", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
      $("#profile-password").value = "";
      await refreshAccount();
      $("#profile-status").textContent = result.message;
    } catch (error) {
      $("#profile-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $("#signout").addEventListener("click", async () => {
    if (resumeSaving)
      return toast("Wait for your resume change to finish before signing out.");
    if (coding || state.busy || state.recording)
      return toast("Finish your current practice before signing out.");
    try {
      await api("/api/auth/logout", { method: "POST" });
      const prefix = "ru-employed.code." + state.user.id + ".";
      try {
        for (const key of Object.keys(localStorage))
          if (key.startsWith(prefix)) localStorage.removeItem(key);
      } catch {}
      for (const id of [
        "resumeText",
        "linkedinText",
        "portfolioText",
        "portfolioUrl",
        "jobText",
        "jobUrl",
        "notes",
        "resumeFile",
        "linkedinFile",
        "profile-name",
        "profile-email",
        "profile-password",
        "auth-email",
        "auth-name",
        "auth-password",
        "auth-recovery",
        "type-input",
        "code-explanation",
      ]) {
        const input = $("#" + id);
        if (input) input.value = "";
      }
      $("#report").innerHTML = $("#transcript").innerHTML = "";
      state.plan = null;
      state.sessionId = null;
      editor?.setValue("");
      $("#recovery-code").textContent = "";
      $("#recovery-panel").classList.add("hidden");
      state.user = null;
      state.cloudReports = [];
      state.report = null;
      await refreshAccount();
      show("setup");
      toast("Signed out. Your account reports remain private.");
    } catch (error) {
      toast(error.message);
    }
  });
  $("#saved-materials").addEventListener("submit", async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      if (resumeSaving && !(await resumeSaving)) return;
      const result = await (
        await api("/api/profile", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            resume: $("#saved-resume").value,
            linkedin: $("#saved-linkedin").value,
            portfolio: $("#saved-portfolio").value,
          }),
        })
      ).json();
      applyProfile(result.materials);
      $("#materials-status").textContent =
        "Your experience is saved privately.";
    } catch (error) {
      $("#materials-status").textContent = error.message;
    } finally {
      e.submitter.disabled = false;
    }
  });
  $("#use-saved-materials").addEventListener("click", () => {
    for (const [key, input] of [
      ["resume", "resumeText"],
      ["linkedin", "linkedinText"],
      ["portfolio", "portfolioText"],
    ]) {
      $("#" + input).value = $("#saved-" + key).value;
      $("#" + input).closest("details").open = true;
    }
    $("#resumeFile").value = $("#linkedinFile").value = "";
    $("#resumeFile").dispatchEvent(new Event("change"));
    $("#linkedinFile").dispatchEvent(new Event("change"));
    show("setup");
    toast("Your saved experience is ready for the next interview.");
  });
  function voices() {
    const gender = $("#gender").value,
      selected = $("#voiceId").value;
    $("#voiceId").innerHTML = (state.config?.voices || [])
      .filter((v) => v.gender === gender)
      .map(
        (v) =>
          `<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.style)}</option>`,
      )
      .join("");
    if ([...$("#voiceId").options].some((o) => o.value === selected))
      $("#voiceId").value = selected;
  }
  $("#gender").addEventListener("change", voices);
  async function enableCamera() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Camera access is unavailable. Your interview still works without it.",
      );
    camera = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    $("#user-video").srcObject = camera;
    $("#camera-placeholder").classList.add("hidden");
    $("#camera-btn").textContent = "Turn camera off";
    if ($("#analyze-camera").checked)
      await coach.start(
        $("#user-video"),
        () =>
          !state.speaking &&
          !state.busy &&
          !state.ended &&
          $("#view-interview").classList.contains("active"),
      );
  }
  function stopCamera() {
    coach.stop();
    camera?.getTracks().forEach((t) => t.stop());
    camera = null;
    $("#user-video").srcObject = null;
    $("#camera-placeholder").classList.remove("hidden");
    $("#camera-btn").textContent = "Enable camera";
  }
  $("#camera-btn").addEventListener("click", async () => {
    if (camera) stopCamera();
    else {
      $("#camera-btn").disabled = true;
      try {
        await enableCamera();
      } catch (error) {
        toast(error.message);
      } finally {
        $("#camera-btn").disabled = false;
      }
    }
  });
  $("#mute-btn").addEventListener("click", () => ctx.toggleMute());
  async function ensureEditor() {
    if (editor) return editor;
    editorReady ??= loadScript("/vendor/monaco/vs/loader.js").then(
      () =>
        new Promise((resolve, reject) => {
          window.require.config({
            paths: { vs: new URL("/vendor/monaco/vs", location.href).href },
          });
          window.require(
            ["vs/editor/editor.main"],
            () => {
              editor = window.monaco.editor.create($("#code-editor"), {
                value: "",
                language: "python",
                theme: "vs",
                automaticLayout: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                tabSize: 4,
                padding: { top: 16 },
                ariaLabel: "Coding interview solution",
              });
              editor.onDidChangeModelContent(() => {
                if (!coding) return;
                drafts[$("#code-language").value] = editor.getValue();
                $("#test-summary").textContent =
                  "Your current code has not been run.";
                try {
                  localStorage.setItem(
                    `ru-employed.code.${state.user?.id || "guest"}.${coding.id}`,
                    JSON.stringify(drafts),
                  );
                  $("#editor-status").textContent =
                    "Draft saved on this device.";
                } catch {
                  $("#editor-status").textContent =
                    "Draft could not be saved. Keep a copy of your code.";
                }
              });
              resolve(editor);
            },
            reject,
          );
        }),
    );
    try {
      return await editorReady;
    } catch (error) {
      editorReady = null;
      throw error;
    }
  }
  async function codingSpeak(text) {
    const generation = ++codingSpeechGeneration;
    $("#coding-caption").textContent = text;
    codingSpeaking = true;
    codeMic.pause();
    codeAvatar?.speaking(true);
    updateCodingControls();
    try {
      if (state.config?.elevenlabs) {
        try {
          const response = await api(`/api/sessions/${coding.id}/speech`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const blob = await response.blob();
          if (generation === codingSpeechGeneration) await audio.play(blob);
          return;
        } catch {
          if (generation === codingSpeechGeneration)
            toast("Using browser voice for this question.");
        }
      }
      if (generation === codingSpeechGeneration) await audio.speak(text);
    } finally {
      if (generation === codingSpeechGeneration) {
        codingSpeaking = false;
        codeAvatar?.speaking(false);
        updateCodingControls();
      }
    }
  }
  function updateCodingControls() {
    $("#run-code").disabled =
      codingBusy ||
      (!state.config?.coding?.runner &&
        $("#code-language").value !== "javascript") ||
      !coding;
    $("#finish-coding").disabled = $("#leave-coding").disabled =
      codingBusy || codingRecorder?.state === "recording";
    $("#send-code-explanation").disabled =
      codingBusy || codingSpeaking || codingRecorder?.state === "recording";
    $("#coding-mic").disabled = !state.config?.elevenlabs || !coding;
    $("#code-language").disabled = codingBusy;
  }
  function codePayload() {
    return {
      code: editor?.getValue() || "",
      language: $("#code-language").value,
    };
  }
  async function startCoding(isDemo, materials = null) {
    if (codingBusy || coding) return;
    audio.unlock();
    if (!isDemo && state.config?.accounts && !state.user) {
      show("account");
      return toast("Sign in to save and start a private coding interview.");
    }
    codingBusy = true;
    codePending = null;
    codeFinishAfterAnswer = false;
    $("#generate-coding").disabled = $("#demo-coding").disabled = true;
    $("#coding-setup-error").textContent = "Preparing your problem and editor…";
    try {
      await ensureEditor();
      const requestBody =
        materials instanceof FormData ? materials : { materials };
      const options = {
        demo: isDemo,
        company: $("#coding-company").value,
        role: $("#coding-role").value,
        difficulty: $("#coding-difficulty").value,
        voiceId: $("#voiceId").value,
      };
      if (requestBody instanceof FormData)
        for (const [key, value] of Object.entries(options))
          requestBody.set(key, String(value));
      else Object.assign(requestBody, options);
      coding = await (
        await api("/api/coding/sessions", {
          method: "POST",
          ...(requestBody instanceof FormData
            ? { body: requestBody }
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(requestBody),
              }),
        })
      ).json();
      Object.keys(drafts).forEach((key) => delete drafts[key]);
      $("#coding-setup").classList.add("hidden");
      $("#coding-workspace").classList.remove("hidden");
      $("#coding-source").textContent = coding.demo
        ? "GUIDED CODING DEMO"
        : "REPRESENTATIVE PRACTICE";
      $("#coding-target").textContent =
        `${coding.plan.company} · ${coding.plan.role}`;
      $("#problem-title").textContent = coding.problem.title;
      $("#problem-description").textContent = coding.problem.description;
      $("#problem-constraints").innerHTML = coding.problem.constraints
        .map((x) => `<li>${esc(x)}</li>`)
        .join("");
      $("#problem-examples").innerHTML = coding.problem.tests
        .map(
          (t, i) =>
            `<div class="code-example"><b>Example ${i + 1}</b><pre>Input: ${esc(t.stdin)}\nOutput: ${esc(t.expected_output)}</pre><p>${esc(t.explanation)}</p></div>`,
        )
        .join("");
      $("#coding-validation").textContent = coding.referenceVerified
        ? "Reference solution validated by the sandbox."
        : "Reference solution has not been executed.";
      codeAvatar?.dispose();
      codeAvatar = createAvatar3D($("#coding-avatar"), $("#gender").value);
      $("#coding-interviewer-name").textContent = coding.plan.interviewer.name;
      $("#runner-note").textContent =
        "JavaScript runs locally in an isolated sandbox. Python, Java and C++ need a connected Judge0 service.";
      $("#runner-note").classList.toggle(
        "hidden",
        !!state.config?.coding?.runner,
      );
      if (!state.config?.coding?.runner)
        $("#code-language").value = "javascript";
      $("#coding-mic").classList.toggle("hidden", !state.config?.elevenlabs);
      $("#code-results").innerHTML = "";
      $("#coding-transcript").innerHTML = "";
      $("#code-explanation").value = "";
      editor.setValue(coding.problem.starter[$("#code-language").value]);
      editor.layout();
      codingBusy = false;
      updateCodingControls();
      $("#coding-setup-error").textContent = "";
      if (state.config?.elevenlabs) {
        try {
          await codeMic.start(await getMic());
        } catch (error) {
          toast(error.message);
        }
      }
      await codingSpeak(coding.reply);
    } catch (error) {
      $("#coding-setup-error").textContent = error.message;
    } finally {
      codingBusy = false;
      $("#generate-coding").disabled = $("#demo-coding").disabled = false;
      updateCodingControls();
    }
  }
  $("#coding-setup").addEventListener("submit", (e) => {
    e.preventDefault();
    startCoding(false);
  });
  $("#demo-coding").addEventListener("click", () => startCoding(true));
  $("#code-language").addEventListener("change", () => {
    if (!coding || !editor) return;
    const language = $("#code-language").value;
    window.monaco.editor.setModelLanguage(editor.getModel(), language);
    updateCodingControls();
    editor.setValue(drafts[language] ?? coding.problem.starter[language]);
  });
  $("#run-code").addEventListener("click", async () => {
    if (!coding || codingBusy) return;
    codingBusy = true;
    updateCodingControls();
    $("#test-summary").textContent = "Running in the isolated sandbox…";
    try {
      const result = await (
        await api(`/api/coding/sessions/${coding.id}/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(codePayload()),
        })
      ).json();
      $("#test-summary").textContent =
        `${result.results.filter((r) => r.passed).length}/${result.results.length} tests passed`;
      $("#code-results").innerHTML = result.results
        .map(
          (r, i) =>
            `<details class="test-result ${r.passed ? "passed" : "failed"}" open><summary>Test ${i + 1} · ${esc(r.status)}${r.passed ? " · Passed" : ""}</summary><pre>Expected: ${esc(r.expected)}\nOutput: ${esc(r.stdout || "(no output)")}</pre>${r.stderr || r.compile_output ? `<pre class="error">${esc(r.compile_output || r.stderr)}</pre>` : ""}<span class="hint">${esc(r.time ?? "—")} sec · ${esc(r.memory ?? "—")} KB</span></details>`,
        )
        .join("");
    } catch (error) {
      $("#test-summary").textContent = error.message;
    } finally {
      codingBusy = false;
      updateCodingControls();
    }
  });
  async function explain(body) {
    if (!coding || codingBusy || codingSpeaking) return;
    codeMic.pause();
    codePending = body;
    codingBusy = true;
    updateCodingControls();
    $("#coding-status").textContent =
      "Your interviewer is reviewing your code and explanation…";
    try {
      const result = await (
        await api(`/api/coding/sessions/${coding.id}/answer`, {
          method: "POST",
          body,
        })
      ).json();
      codePending = null;
      $("#code-explanation").value = "";
      $("#coding-transcript").insertAdjacentHTML(
        "beforeend",
        `<p><b>You:</b> ${esc(result.transcript)}</p><p><b>Interviewer:</b> ${esc(result.reply)}</p>`,
      );
      $("#coding-status").textContent = "Your next follow-up is ready.";
      codingBusy = false;
      if (codeFinishAfterAnswer) {
        codeFinishAfterAnswer = false;
        await finishCoding();
        return;
      }
      await codingSpeak(result.reply);
      if (result.ended) await finishCoding();
    } catch (error) {
      $("#coding-status").textContent =
        error.message +
        " Your recording is preserved. Click Discuss my code to retry.";
    } finally {
      codingBusy = false;
      updateCodingControls();
    }
  }
  $("#code-explanation-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#code-explanation").value.trim();
    if (!text && codePending) return explain(codePending);
    if (!text) return toast("Explain your approach or ask a question.");
    const body = new FormData();
    for (const [key, value] of Object.entries({ ...codePayload(), text }))
      body.set(key, value);
    explain(body);
  });
  $("#coding-mic").addEventListener("click", async () => {
    try {
      if (!state.stream) await codeMic.start(await getMic());
      else codeMic.toggleMute();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#coding-skip").addEventListener("click", () => {
    codingSpeechGeneration++;
    audio.interrupt();
    codingSpeaking = false;
    updateCodingControls();
  });
  async function finishCoding() {
    if (!coding || codingBusy) return;
    if (codeVoicing) {
      codeFinishAfterAnswer = true;
      codeMic.flush();
      return;
    }
    if (codePending)
      return toast(
        "Retry your saved explanation with Discuss my code before finishing.",
      );
    if (!coding.demo && !$("#coding-transcript").textContent.trim())
      return toast(
        "Talk through your solution or type an explanation before finishing.",
      );
    codeMic.pause();
    codingBusy = true;
    codingSpeechGeneration++;
    codingSpeaking = false;
    audio.interrupt();
    updateCodingControls();
    $("#coding-status").textContent = "Reviewing your solution and reasoning…";
    try {
      const report = await (
        await api(`/api/coding/sessions/${coding.id}/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(codePayload()),
        })
      ).json();
      codeMic.stop();
      codeAvatar?.dispose();
      codeAvatar = null;
      releaseMic();
      saveReport(report);
      renderReport(report);
      codePending = null;
      coding = null;
      $("#coding-workspace").classList.add("hidden");
      $("#coding-setup").classList.remove("hidden");
      show("report");
    } catch (error) {
      $("#coding-status").textContent = error.message;
    } finally {
      codingBusy = false;
      updateCodingControls();
    }
  }
  $("#finish-coding").addEventListener("click", finishCoding);
  $("#leave-coding").addEventListener("click", async () => {
    if (!coding || codingBusy || codingRecorder?.state === "recording") return;
    codingBusy = true;
    codingSpeechGeneration++;
    codingSpeaking = false;
    audio.interrupt();
    codeMic.stop();
    releaseMic();
    updateCodingControls();
    try {
      await api("/api/sessions/" + coding.id + "/end", { method: "POST" });
      coding = null;
      $("#coding-workspace").classList.add("hidden");
      $("#coding-setup").classList.remove("hidden");
      show("setup");
      toast("Coding session ended without a report.");
    } catch (error) {
      $("#coding-status").textContent = error.message;
    } finally {
      codingBusy = false;
      updateCodingControls();
    }
  });
  function enhanceReport(report) {
    const v = report.camera;
    if (v) {
      const pct = (x) => (x === null ? "—" : Math.round(x * 100) + "%");
      const tips = [];
      if (v.faceVisible < 0.8)
        tips.push("Keep your face visible and add light in front of you.");
      if (v.cameraFacing !== null && v.cameraFacing < 0.65)
        tips.push(
          "Try placing your notes close to the camera and glancing toward the lens while speaking. Looking away to think is normal.",
        );
      if (v.framing !== null && v.framing < 0.75)
        tips.push(
          "Center your head and shoulders with a little space above your head.",
        );
      if (v.facialMovement !== null && v.facialMovement < 0.008)
        tips.push(
          "Practice a relaxed greeting and let facial movement follow your explanation naturally. You do not need to perform a particular expression.",
        );
      $("#r-delivery").insertAdjacentHTML(
        "afterend",
        '<section class="block card" id="r-camera"><span class="eyebrow">ON-CAMERA PRACTICE</span><h3>Eye line & facial movement</h3><p class="hint">Private landmark estimates from ' +
          v.seconds +
          " seconds of your turns. Camera-facing direction approximates an eye line; it is not actual eye contact. Facial movement does not measure emotion or confidence.</p>" +
          (!v.sufficient
            ? "<p>Not enough camera samples for reliable coaching. Try a longer response with good lighting.</p>"
            : '<div class="stats"><div class="stat"><b>' +
              pct(v.faceVisible) +
              '</b><span>face visible</span></div><div class="stat"><b>' +
              pct(v.cameraFacing) +
              '</b><span>approximately camera-facing</span></div><div class="stat"><b>' +
              pct(v.framing) +
              "</b><span>comfortable framing</span></div></div><p>Facial movement: " +
              (v.facialMovement === null
                ? "not measured"
                : v.facialMovement < 0.008
                  ? "little change observed"
                  : v.facialMovement > 0.08
                    ? "frequent movement observed"
                    : "some movement observed") +
              ".</p>" +
              listHtml(
                tips.length
                  ? tips
                  : [
                      "Keep practicing a comfortable camera position and a natural speaking style.",
                    ],
              )) +
          "</section>",
      );
    }
    if (!report.feedback.coding) return;
    const f = report.feedback.coding;
    $("#r-delivery .stat b").textContent = "—";
    $("#r-delivery .stat span").textContent = "confidence not assessed";
    if (report.demo) {
      $("#report .banner").textContent =
        "CODING DEMO · No AI evaluation is performed. Sandbox results, when available, describe only the code you ran.";
      $("#report .ring b").textContent = "—";
    }
    $("#r-answers").innerHTML =
      `<h3>Your code, your reasoning.</h3><div class="card"><div class="stats">${[
        ["Correctness", f.correctness],
        ["Efficiency", f.efficiency],
        ["Problem-solving", f.problem_solving],
        ["Communication", f.communication],
        ["Complexity explanation", f.complexity],
      ]
        .map(
          ([label, score]) =>
            `<div class="stat"><b>${report.demo || score === null ? "—" : Math.round(score)}</b><span>${label}</span></div>`,
        )
        .join(
          "",
        )}</div><p class="hint">${f.testedCurrentCode ? `${f.results.filter((r) => r.passed).length}/${f.results.length} test cases passed for the submitted code.` : "Submitted code was not executed. Correctness feedback is a static assessment."}</p><h4>Time complexity</h4><p>${esc(f.time_complexity)}</p><h4>Space complexity</h4><p>${esc(f.space_complexity)}</p><h4>What worked</h4><ul>${f.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><h4>What to refine</h4><ul>${f.improvements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><details><summary>Your submitted ${esc(f.language)} solution</summary><pre class="submitted-code">${esc(f.code)}</pre></details></div>`;
  }
  async function progress() {
    const data = analyzeProgress(readHistory(), {
      days: Number($("#progress-range").value),
      focus: $("#progress-focus").value,
    });
    $("#progress-stats").innerHTML = [
      ["Interviews completed", data.total],
      ["Average score", data.average ?? "—"],
      ["Highest score", data.highest ?? "—"],
      ["Practice hours", data.hours.toFixed(1)],
    ]
      .map(
        ([label, n]) =>
          `<div class="stat"><b>${n}</b><span>${label}</span></div>`,
      )
      .join("");
    const key = $("#progress-metric").value,
      points = data.filtered.map((r) => ({
        report: r,
        value: Number.isFinite(metricsFor(r)[key]) ? metricsFor(r)[key] : null,
      }));
    const hasPoints = points.some((p) => p.value !== null);
    $("#chart-empty").classList.toggle("hidden", hasPoints);
    $("#progress-chart").classList.toggle("hidden", !hasPoints);
    if (hasPoints) {
      chartReady ??= window.Chart
        ? Promise.resolve()
        : window.define?.amd
          ? new Promise((resolve, reject) => {
              window.require.config({
                paths: { "ru-chart": "/vendor/chart/chart.umd" },
              });
              window.require(
                ["ru-chart"],
                (Chart) => {
                  window.Chart = Chart;
                  resolve();
                },
                reject,
              );
            })
          : loadScript("/vendor/chart/chart.umd.js");
      try {
        await chartReady;
        chart?.destroy();
        const colors = ["#1f5748", "#9bb967", "#bd9462", "#6d87aa"];
        const versions = [
          ...new Set(points.map((p) => p.report.rubricVersion || "legacy")),
        ];
        chart = new window.Chart($("#progress-chart"), {
          type: "line",
          data: {
            labels: points.map((p) =>
              new Date(p.report.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              }),
            ),
            datasets: versions.map((version, i) => ({
              label: `${CATEGORY_LABELS[key]} · ${version}`,
              data: points.map((p) =>
                (p.report.rubricVersion || "legacy") === version
                  ? p.value
                  : null,
              ),
              borderColor: colors[i % 4],
              backgroundColor: "#dceac633",
              fill: true,
              tension: 0.25,
              pointRadius: 5,
              pointHoverRadius: 8,
              spanGaps: false,
            })),
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: "index" },
            onClick: (_event, elements) => {
              if (elements.length) {
                renderReport(points[elements[0].index].report);
                show("report");
              }
            },
            plugins: {
              legend: {
                labels: { usePointStyle: true, font: { family: "DM Sans" } },
              },
            },
            scales: {
              y: {
                beginAtZero: true,
                ...(!["pace", "fillers_per_100"].includes(key)
                  ? { max: 100 }
                  : {}),
                grid: { color: "#eef1e8" },
              },
              x: { grid: { display: false } },
            },
          },
        });
      } catch (error) {
        toast(error.message);
      }
    } else {
      chart?.destroy();
      chart = null;
    }
    const delta =
      data.previous &&
      Number.isFinite(metricsFor(data.latest)[key]) &&
      Number.isFinite(metricsFor(data.previous)[key])
        ? Math.round(
            (metricsFor(data.latest)[key] - metricsFor(data.previous)[key]) *
              10,
          ) / 10
        : null;
    $("#progress-comparison").innerHTML =
      `<span class="eyebrow">YOUR LATEST VS. YOUR PREVIOUS TAKE</span><h2>${delta === null ? "A comparison starts with two comparable interviews." : `${delta > 0 ? "+" : ""}${delta} ${["pace", "fillers_per_100"].includes(key) ? "change in " : "points in "}${CATEGORY_LABELS[key].toLowerCase()}`}</h2><p class="hint">Comparisons match the latest interview's type, focus, and scoring rubric. Lower filler frequency can be an improvement; higher speaking pace is not automatically better.</p>${
        data.changes.length
          ? `<h4>Strongest changes over your comparable attempts</h4><div class="improvement-chips">${data.changes
              .slice(0, 3)
              .map(
                (c) =>
                  `<span>${CATEGORY_LABELS[c.key]} <b>${c.delta > 0 ? "+" : ""}${c.delta}</b></span>`,
              )
              .join("")}</div>`
          : ""
      }`;
    $("#progress-history").innerHTML =
      `<h3 class="progress-history-title">The conversations behind your progress</h3>${
        data.filtered
          .slice()
          .reverse()
          .map(
            (r) =>
              `<button class="card progress-row" data-report="${esc(r.id)}"><span><b>${esc(r.plan.role)}</b><small>${esc(r.plan.company)} · ${new Date(r.createdAt).toLocaleDateString()}</small></span><b>${Math.round(r.feedback.overall.score)} <small>/ 100</small></b>${icon("arrow")}</button>`,
          )
          .join("") ||
        '<p class="muted small">No live interviews match these filters yet.</p>'
      }`;
  }
  ["progress-range", "progress-focus", "progress-metric"].forEach((id) =>
    $("#" + id).addEventListener("change", progress),
  );
  return {
    resumeReady: async () => (resumeSaving ? await resumeSaving : true),
    async init(config) {
      voices();
      account();
      $("#generate-coding").disabled = !config.coding?.ai;
      $("#runner-note").classList.toggle("hidden", !!config.coding?.runner);
      try {
        await refreshAccount();
        const action = new URLSearchParams(location.search).get("account");
        if (action === "recovery") {
          show("account");
          $("#profile-password").focus();
          toast("Choose a new password to finish resetting your account.");
        } else if (action === "confirmed") {
          toast("Your email has been confirmed.");
        }
        if (action) history.replaceState({}, "", "/");
      } catch (error) {
        toast(error.message);
      }
    },
    async beforeInterview(fd) {
      stopCamera();
      coach.reset();
      if (
        fd.get("interviewStyle") === "video" &&
        fd.get("enableCamera") === "true"
      )
        try {
          await enableCamera();
        } catch (error) {
          toast(error.message);
        }
    },
    enterVideo() {
      const video = $("#interviewStyle").value === "video";
      $("#view-interview .call").classList.toggle("video-mode", video);
      participants.classList.toggle("hidden", !video);
      $("#camera-btn").classList.toggle("hidden", !video);
      videoAvatar?.dispose();
      if (video)
        videoAvatar = createAvatar3D($("#avatar-video"), $("#gender").value);
      $("#mute-btn").textContent = "Mute microphone";
      $("#mute-btn").classList.toggle("hidden", !state.config?.elevenlabs);
    },
    mouth(value) {
      videoAvatar?.mouth(value);
      codeAvatar?.mouth(value);
    },
    speaking(on) {
      videoAvatar?.speaking(on);
      codeAvatar?.speaking(on);
    },
    cameraSummary: () => coach.summary(),
    async startTechnical(fd, demo) {
      if (
        fd.get("focus") !== "technical" ||
        $("#technical-format").value !== "coding"
      )
        return false;
      show("coding");
      if (
        !demo &&
        !fd.get("resumeFile")?.size &&
        !fd.get("resumeText")?.trim()
      ) {
        show("setup");
        $("#setup-error").textContent =
          "Add your resume as a file or pasted text first.";
        return true;
      }
      if (!demo && !fd.get("jobUrl")?.trim() && !fd.get("jobText")?.trim()) {
        show("setup");
        $("#setup-error").textContent =
          "Add a job link or paste the job description first.";
        return true;
      }
      await startCoding(demo, demo ? null : fd);
      return true;
    },
    stopCamera,
    stop: () => {
      codeMic.stop();
      stopCamera();
      videoAvatar?.dispose();
      codeAvatar?.dispose();
    },
    isActive: () => !!coding || codingBusy,
    account,
    progress,
    enhanceReport,
  };
}
