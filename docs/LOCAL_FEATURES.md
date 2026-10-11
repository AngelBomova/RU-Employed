# Local accounts and interview controls

Run with **Node 22.13 or newer**:

```powershell
npm install
npm start
```

Open **http://localhost:3000**. Keep your existing `.env`; the new local account features require no additional keys. If Node is not on PATH, this workspace also has a portable runtime:

```powershell
& .\.tools\node-v22.23.3-win-x64\node.exe server.js
```

## Accounts and offline recovery

With no Supabase configuration, accounts automatically use `.data/ru-employed.sqlite`. To choose local accounts explicitly, set `AUTH_MODE=local`. `LOCAL_DATABASE_PATH` optionally changes the database location. Accounts, saved experience, reports, and active interviews persist through restarts. Keep this database and its WAL files private; they are excluded from Git and Docker build contexts. Back up the data directory while the server is stopped.

Create an account and save the recovery code displayed once. **Forgot password?** accepts your email, recovery code, and a new password. A successful reset revokes existing logins, consumes the old recovery code, and displays a replacement code to save. No email or internet is needed for account signup, login, or reset. Passwords use salted scrypt hashes; recovery codes and session tokens are stored as hashes. Sessions use HttpOnly cookies. There is no administrator bypass for a lost password and lost code.

Supabase remains available when its URL and anon key are supplied and `AUTH_MODE` is not `local`. Existing Supabase accounts are separate from local accounts; they are not automatically migrated.

## Speaking

With ElevenLabs configured and microphone permission granted, the microphone stays open throughout an interview. Speak naturally and pause for about **1.8 seconds** to submit an answer. The mic button, **Mute microphone**, or Space toggles mute. Muting disables the audio track and submits any answer already spoken. Input is not transcribed while the interviewer is speaking, to avoid echo; use Skip audio to take your turn early. Turns are capped at 90 seconds. Headphones are recommended.

You can switch to typed responses. A failed answer is preserved: use **Retry answer**, or **Discuss my code** in the coding room. Finishing while speaking submits that final answer before requesting feedback. Without ElevenLabs, the interviewer uses browser speech and answers are typed. Local accounts do not make paid AI/voice services work without internet.

## Coding and system design

Select **Technical → Live coding** in the studio to open the Monaco workspace. Resume files and job descriptions carry into the coding session; the target employer and position are extracted from the job text. The standalone Coding room also allows company style, role and difficulty selection. Generated problems are representative practice, not verified company interview questions.

JavaScript runs without Judge0 in a QuickJS WebAssembly VM inside a disposable worker thread. Each test gets a clean VM, a 32 MB memory limit and a one-second execution limit. A total timeout terminates the worker. Candidate code has no Node, filesystem, network, or host-process access. `require('fs').readFileSync(0, 'utf8')` is a read-only stdin shim; `console.log` supplies stdout. Other Node modules and APIs are unavailable. Python, Java and C++ execution still requires Judge0.

Talk through your approach before or while coding; voice explanations submit automatically. Typed explanations support browsers without microphone access. A live coding report requires at least one explanation. Code-aware follow-ups receive the actual source and only test results for that revision. Editing code invalidates prior execution evidence. Select **Technical → System design discussion** for a spoken design exercise; interview notes can specify the service or topic to practice.

## 3D and camera coaching

The face-to-face and coding views render an animated human head and clothed torso with three.js. Jaw motion follows audio energy; this is approximate animation rather than phoneme lip sync. WebGL is required. See [asset attribution](../public/assets/ATTRIBUTION.md).

For webcam feedback, choose **Face-to-face**, enable the camera, and opt into the separate coaching checkbox. MediaPipe runs in a local worker using bundled model/WASM assets. No video or images are uploaded. Only bounded aggregate statistics accompany the saved report. Coaching covers face visibility, approximate camera-facing direction, framing and facial movement during your turns. It needs at least 25 samples, including 15 with a visible face. Lighting and camera position affect estimates.

Camera-facing direction approximates an eye line, not actual eye contact. Facial movement does not establish emotion or confidence. Confidence coaching remains based on available spoken/transcript evidence; pitch and volume are not assessed.

## Hosting local storage

For a production SQLite deployment, set `AUTH_MODE=local`, set `LOCAL_DATABASE_PATH` to a **persistent writable volume**, and set an HTTPS `PUBLIC_APP_URL`. Use one application instance; a local database is not shared automatically across hosts. Docker supplies a writable `/app/.data` directory, but mount a volume there to preserve accounts when replacing containers. Supabase remains the shared-storage option in the [deployment guide](DEPLOYMENT.md).
