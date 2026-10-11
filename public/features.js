import { avatarSvg } from "./avatar.js";
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
    `<div class="settings-row"><label class="field-label" for="interviewStyle">Interview space<select name="interviewStyle" id="interviewStyle"><option value="voice">Voice studio</option><option value="video">Face-to-face</option></select></label><label class="field-label" for="gender">AI interviewer<select name="gender" id="gender"><option value="female">Female interviewer</option><option value="male">Male interviewer</option></select></label></div><label class="camera-consent"><input type="checkbox" id="enable-camera" name="enableCamera" value="true"/> Enable my webcam for face-to-face practice</label><p class="hint">Your camera stays on this device. No video is uploaded or analyzed.</p>`,
  );
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
    <section id="view-account" class="view"><div class="page-intro"><div><span class="eyebrow">YOUR STORY. YOUR SPACE.</span><h1 id="account-title">Welcome to your next chapter<span>.</span></h1><p id="account-intro">Sign in to keep your interviews and progress together.</p></div></div><div id="account-notice" class="banner hidden"></div><div id="auth-panel" class="card auth-card"><div class="auth-tabs"><button type="button" class="btn primary" data-auth-mode="login">Sign in</button><button type="button" class="btn" data-auth-mode="signup">Create an account</button></div><form id="auth-form"><label class="field-label hidden" id="auth-name-label">Your name<input id="auth-name" autocomplete="name" maxlength="80"/></label><label class="field-label">Email address<input id="auth-email" type="email" autocomplete="email" required/></label><label class="field-label" id="auth-password-label">Password<input id="auth-password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required/></label><button class="btn primary big" id="auth-submit">Sign in ${icon("arrow")}</button></form><button class="text-button" id="forgot-password">Forgot password?</button><p class="error" id="auth-error" role="alert"></p><p class="hint" id="auth-status" role="status"></p></div><div id="profile-panel" class="hidden account-grid"><form id="account-details" class="card"><h2>Your account</h2><label class="field-label">Your name<input id="profile-name" autocomplete="name" maxlength="80"/></label><label class="field-label">Email address<input id="profile-email" type="email" autocomplete="email" required/></label><label class="field-label">New password <span class="optional">OPTIONAL</span><input id="profile-password" type="password" autocomplete="new-password" minlength="10" maxlength="128" placeholder="Leave blank to keep your current password"/></label><button class="btn primary">Save account details</button><button class="btn" id="signout" type="button">Sign out</button><p id="profile-status" class="hint" role="status"></p></form><form id="saved-materials" class="card"><h2>Your saved experience</h2><p class="hint">These details are private to your account. Uploads are stored as extracted text, not original files.</p><label class="field-label">Resume<textarea id="saved-resume" rows="5" placeholder="Your experience and achievements…"></textarea></label><label class="field-label">LinkedIn experience<textarea id="saved-linkedin" rows="3"></textarea></label><label class="field-label">Portfolio projects<textarea id="saved-portfolio" rows="3"></textarea></label><div class="coding-actions"><button class="btn primary">Save experience</button><button class="btn" id="use-saved-materials" type="button">Use in next interview</button></div><p id="materials-status" class="hint" role="status"></p></form></div></section>
  `,
  );
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
    $("#auth-password-label").classList.toggle("hidden", next === "forgot");
    $("#auth-password").required = next !== "forgot";
    $("#auth-password").autocomplete =
      next === "signup" ? "new-password" : "current-password";
    $("#auth-submit").innerHTML =
      `${next === "forgot" ? "Send reset link" : next === "signup" ? "Create account" : "Sign in"} ${icon("arrow")}`;
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
      for (const key of ["resume", "linkedin", "portfolio"])
        $("#saved-" + key).value = profile.materials[key] || "";
    } else
      for (const key of ["resume", "linkedin", "portfolio"])
        $("#saved-" + key).value = "";
    $("#account-nav").textContent = state.user
      ? state.user.name || "My account"
      : "Sign in";
    $(".user-avatar").textContent = (state.user?.name ||
      state.user?.email ||
      "Y")[0].toUpperCase();
    $("#view-history > .hint").textContent = state.user
      ? "Private reports saved to your account. Demo indicators are excluded from progress."
      : "Reports and transcripts save on this device. Sign in to save across devices.";
    updateHistoryCount();
    account();
  }
  function account() {
    const enabled = !!state.config?.accounts;
    $("#account-notice").classList.toggle("hidden", enabled);
    $("#account-notice").textContent =
      "Cloud accounts are not connected in this workspace yet. You can still practice as a guest and keep reports on this device.";
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
        await api(`/api/auth/${authMode}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: $("#auth-name").value,
            email: $("#auth-email").value,
            password: $("#auth-password").value,
          }),
        })
      ).json();
      $("#auth-password").value = "";
      $("#auth-status").textContent = result.message || "Signed in.";
      await refreshAccount();
      if (state.user) {
        show("progress");
        toast("Welcome to your private workspace.");
      }
    } catch (error) {
      $("#auth-error").textContent = error.message;
    } finally {
      $("#auth-submit").disabled = !state.config?.accounts;
    }
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
      state.user = null;
      state.cloudReports = [];
      state.report = null;
      await refreshAccount();
      show("setup");
      toast("Signed out. Your cloud reports remain private.");
    } catch (error) {
      toast(error.message);
    }
  });
  $("#saved-materials").addEventListener("submit", async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      await api("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resume: $("#saved-resume").value,
          linkedin: $("#saved-linkedin").value,
          portfolio: $("#saved-portfolio").value,
        }),
      });
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
  }
  function stopCamera() {
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
  $("#mute-btn").addEventListener("click", async () => {
    if (state.recording)
      return toast("Stop and send your answer before muting.");
    try {
      const stream = await getMic();
      const enabled = !stream.getAudioTracks()[0].enabled;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = enabled;
      });
      $("#mute-btn").textContent = enabled
        ? "Mute microphone"
        : "Unmute microphone";
      $("#mic-btn").disabled =
        !enabled || state.busy || state.speaking || state.ended;
    } catch (error) {
      toast(error.message);
    }
  });
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
        updateCodingControls();
      }
    }
  }
  function updateCodingControls() {
    $("#run-code").disabled =
      codingBusy || !state.config?.coding?.runner || !coding;
    $("#finish-coding").disabled = $("#leave-coding").disabled =
      codingBusy || codingRecorder?.state === "recording";
    $("#send-code-explanation").disabled =
      codingBusy || codingSpeaking || codingRecorder?.state === "recording";
    $("#coding-mic").disabled =
      codingBusy || codingSpeaking || !state.config?.elevenlabs;
    $("#code-language").disabled = codingBusy;
  }
  function codePayload() {
    return {
      code: editor?.getValue() || "",
      language: $("#code-language").value,
    };
  }
  async function startCoding(isDemo) {
    if (codingBusy || coding) return;
    audio.unlock();
    if (!isDemo && state.config?.accounts && !state.user) {
      show("account");
      return toast("Sign in to save and start a private coding interview.");
    }
    codingBusy = true;
    $("#generate-coding").disabled = $("#demo-coding").disabled = true;
    $("#coding-setup-error").textContent = "Preparing your problem and editor…";
    try {
      await ensureEditor();
      coding = await (
        await api("/api/coding/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            demo: isDemo,
            company: $("#coding-company").value,
            role: $("#coding-role").value,
            difficulty: $("#coding-difficulty").value,
            voiceId: $("#voiceId").value,
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
      $("#coding-avatar").innerHTML = avatarSvg($("#gender").value);
      $("#coding-interviewer-name").textContent = coding.plan.interviewer.name;
      $("#runner-note").classList.toggle(
        "hidden",
        !!state.config?.coding?.runner,
      );
      $("#coding-mic").classList.toggle("hidden", !state.config?.elevenlabs);
      $("#code-results").innerHTML = "";
      $("#coding-transcript").innerHTML = "";
      $("#code-explanation").value = "";
      editor.setValue(coding.problem.starter[$("#code-language").value]);
      editor.layout();
      codingBusy = false;
      updateCodingControls();
      $("#coding-setup-error").textContent = "";
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
      $("#code-explanation").value = "";
      $("#coding-transcript").insertAdjacentHTML(
        "beforeend",
        `<p><b>You:</b> ${esc(result.transcript)}</p><p><b>Interviewer:</b> ${esc(result.reply)}</p>`,
      );
      $("#coding-status").textContent = "Your next follow-up is ready.";
      codingBusy = false;
      await codingSpeak(result.reply);
      if (result.ended) await finishCoding();
    } catch (error) {
      $("#coding-status").textContent = error.message;
    } finally {
      codingBusy = false;
      updateCodingControls();
    }
  }
  $("#code-explanation-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#code-explanation").value.trim();
    if (!text) return toast("Explain your approach or ask a question.");
    const body = new FormData();
    for (const [key, value] of Object.entries({ ...codePayload(), text }))
      body.set(key, value);
    explain(body);
  });
  $("#coding-mic").addEventListener("click", async () => {
    if (codingRecorder?.state === "recording") {
      codingRecorder.stop();
      return;
    }
    try {
      const stream = await getMic(),
        chunks = [],
        mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((x) =>
          MediaRecorder.isTypeSupported(x),
        );
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : {},
      );
      codingRecorder = recorder;
      recorder.onerror = () => {
        releaseMic();
        codingRecorder = null;
        toast("Recording failed. Please type your explanation or try again.");
        updateCodingControls();
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const body = new FormData(),
          type = recorder.mimeType || "audio/webm";
        body.set(
          "audio",
          new Blob(chunks, { type }),
          `explanation.${type.includes("mp4") ? "m4a" : "webm"}`,
        );
        for (const [key, value] of Object.entries(codePayload()))
          body.set(key, value);
        releaseMic();
        $("#coding-mic").innerHTML = `${icon("mic")} Record explanation`;
        explain(body);
      };
      recorder.start(250);
      $("#coding-mic").textContent = "Stop & send";
      $("#coding-status").textContent = "Recording your explanation…";
      updateCodingControls();
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
    if (!coding || codingBusy || codingRecorder?.state === "recording") return;
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
      releaseMic();
      saveReport(report);
      renderReport(report);
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
            `<div class="stat"><b>${report.demo ? "—" : Math.round(score)}</b><span>${label}</span></div>`,
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
      $("#avatar-video").innerHTML = avatarSvg($("#gender").value);
      $("#mute-btn").textContent = "Mute microphone";
      $("#mute-btn").classList.toggle("hidden", !state.config?.elevenlabs);
    },
    mouth(value) {
      document
        .querySelectorAll(".avatar-mouth")
        .forEach((mouth) =>
          mouth.setAttribute(
            "ry",
            String(3 + Math.min(1, Math.max(0, value)) * 9),
          ),
        );
    },
    speaking(on) {
      if (!on) this.mouth(0);
      document
        .querySelectorAll(".interviewer-avatar")
        .forEach((el) => el.classList.toggle("is-speaking", on));
    },
    stopCamera,
    isActive: () => !!coding || codingBusy,
    account,
    progress,
    enhanceReport,
  };
}
