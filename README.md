# RU Employed?

**A voice-first AI mock interviewer built from your resume, your LinkedIn and the real job posting.** HackRU project.

Upload your resume, LinkedIn experience, optional portfolio, and a job description. An AI interviewer simulates a hiring manager for that role using the materials you supplied. It speaks with a realistic **ElevenLabs** voice and asks questions about your own projects and how they connect to the company's mission. You answer out loud. When the session ends you get a coaching report covering:

- **STAR breakdown for every answer.** Each Situation, Task, Action and Result is scored, with notes on what worked, what to **elaborate on** and what to **cut**, plus an outline of a stronger retelling.
- **Tone & confidence.** Uses measured speaking pace (words per minute), long pauses, filler words ("um", "like"…), hedging ("I think", "maybe"), think time before answering, and how often you said "I" vs "we".
- **Experience vs. the role.** Your strengths, the gaps against the job description, resume items you should have used, and how well you tied your experience to the mission.
- **A prioritized improvement plan** with concrete practice drills, plus the next questions to rehearse.

## How it works

### Interview studio

The interface uses a cream and forest-green workspace with a voice visualization, a guided setup, and dedicated interview, feedback, history, and coaching views. It works on desktop and mobile, supports keyboard navigation, respects reduced motion, and has a print layout for PDF reports.

- **Candidate setup:** upload a resume, add a LinkedIn export or pasted experience, and optionally supply a portfolio URL or project descriptions. Add a public job link or paste the description. Choose behavioral, technical, or mixed practice, 4/6/9 questions, a male/female interviewer, and voice or face-to-face practice. General technical sessions cover spoken reasoning and design; the separate Coding room supports programming exercises.
- **Live interview:** speak with the mic button, or type. See the current question, elapsed time, and transcript. Repeat a question or skip its audio without adding duplicate transcript entries.
- **Personal report:** overall score, per-answer STAR analysis, wording improvements, delivery signals, role alignment, and a concrete practice plan. Use **Try this again** to record or type a revised answer and get fresh feedback while the server session remains active.
- **Practice history:** guest reports save in this browser (last 12). Signed-in reports, transcripts, scores and extracted experience save privately in Supabase. View or delete reports. Live scores are summarized separately from demo indicators.
- **Try a demo:** a four-question simulation using a fictional Rutgers student, sample projects, and a fictional employer, Brightside. No API keys are needed. Browser speech reads the questions; answers are typed unless ElevenLabs is configured. Demo feedback uses clearly labeled keyword checks, not an AI evaluation.

### New practice spaces

- **Face-to-face:** a split-screen local webcam preview and male/female illustrated avatar. ElevenLabs playback drives mouth animation; camera and microphone controls remain available. Turning off the camera does not interrupt the interview. No video is uploaded or analyzed.
- **Coding room:** select a company style, position and difficulty. OpenAI generates representative problems, Monaco supports Python/Java/C++/JavaScript, and Judge0 executes code in a separate sandbox. Discuss your current code by voice or text and receive contextual follow-ups and correctness/efficiency/reasoning feedback. Changed code invalidates previous execution evidence. Demos and unconfigured services are labeled explicitly.
- **Your account:** Supabase email/password signup, confirmation, persistent login, logout, emailed recovery, account settings and private saved experience. Configure Supabase and its email templates before using these flows.
- **Your progress:** interactive Chart.js lines, week/month/90-day/all-time filters, category metrics, practice hours, comparable attempts and report links. Demos are excluded, unassessed categories remain gaps, and comparisons match interview type/focus and rubric version.

### Production setup

See [the deployment guide](docs/DEPLOYMENT.md) for Supabase SQL/email configuration, Judge0, Render/Docker, HTTPS, logging and the `ruemployed.io` registration/DNS steps. New variables are documented in [.env.example](.env.example). No domain or paid hosting has been purchased. Accounts and execution stay visibly unavailable until their services are configured.

### Feedback limits

Speaking pace and pauses come from ElevenLabs word timestamps. Filler counts and hedging come from the transcript. Tone and confidence are inferred from those signals and wording; pitch, volume, eye contact, and facial expressions are not measured. Typed responses receive wording and structure feedback only. Offline simulations do not perform AI correctness grading; live coding reports distinguish observed executions from static assessment.

### Validation

The new automated coverage checks private account/report/session ownership, persistent-cookie refresh, recovery requests, code-aware feedback, invalidated execution evidence, all four sandbox language IDs, compiler diagnostics, URL-fetch restrictions and progress filters/rubric comparisons. Browser checks cover the new video, account, Monaco and Chart.js flows at four responsive widths. Supabase/Judge0 tests use mock providers; actual email delivery, RLS and sandbox isolation must be verified after connecting your services.

`npm test` covers delivery metrics, ingestion, interview length/focus, the complete demo session, empty answers, early endings, and isolated answer retries. It also exercises OpenAI SDK structured parsing, ElevenLabs streaming/transcription, model overrides, concurrent answer rejection, and recovery after provider failure with mocked HTTP responses. Browser checks exercised setup validation, the four-question demo, feedback, retries, persistent history, report deletion, and layouts at 390/768/1024/1440 pixels. Separate smoke checks verified live OpenAI planning, follow-ups, and feedback, plus ElevenLabs speech and Scribe transcription with word timestamps using fictional sample materials. Real provider calls require your API keys.

```
Resume PDF ──┐
LinkedIn PDF ┼─► text ─► AI designs a realistic interview plan for this exact role/company
Job URL ─────┘                                  │
                                                ▼
           ┌───────────── live call loop ──────────────┐
           │ AI (interviewer persona) → next line      │
           │ ElevenLabs TTS → interviewer speaks       │
           │ You answer → mic recording                │
           │ ElevenLabs Scribe STT → transcript +      │
           │   word timestamps → delivery metrics      │
           └───────────────────────────────────────────┘
                                                │
                                                ▼
         AI grades transcript + metrics → STAR / delivery / fit / plan report
```

| Piece                                        | Tech                                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interviewer voice                            | ElevenLabs text-to-speech (streaming, `eleven_flash_v2_5` for low latency)                                                                          |
| Hearing your answers                         | ElevenLabs Scribe speech-to-text with word-level timestamps                                                                                         |
| Interview design, live interviewer, feedback | Claude (`claude-opus-5-5`) **or** OpenAI (`gpt-4o`, change with `OPENAI_MODEL`), using structured outputs. The app uses whichever key is in `.env`. |
| Server                                       | Node.js + Express                                                                                                                                   |
| Frontend                                     | Vanilla HTML/CSS/JS with a Web Audio voice visualizer and MediaRecorder                                                                             |

## Run it

Requires Node 20+; Node 22 LTS is recommended. If `.env` already exists, keep it and add only the new variables.

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY (or ANTHROPIC_API_KEY) + ELEVENLABS_API_KEY
npm start              # → http://localhost:3000
```

Open it in Chrome, Edge or Safari, allow microphone access, and use headphones so the interviewer's voice doesn't bleed into your mic.

- **Answering:** tap the mic (or press <kbd>Space</kbd>), speak, then tap again when you're done. You can also type an answer at any point.
- **No ElevenLabs key?** The app still runs. The interviewer uses the browser's built-in voice and you type your answers.
- **LinkedIn:** on your profile, choose _More → Save to PDF_ and upload that file. You can also paste the sections in.
- **Job posting:** paste a link. If the page needs a login or JavaScript to load, paste the text instead.

## Project layout

```
server.js           Express API: sessions, answers, speech, feedback
lib/ingest.js       PDF + job-page text extraction
lib/ai.js           Interview planner, live interviewer, feedback grader (Claude or OpenAI)
lib/elevenlabs.js   TTS streaming + Scribe transcription
lib/delivery.js     Pace / pause / filler / hedge / ownership metrics
lib/auth.js         Supabase Auth and server-side persistent cookies
lib/store.js        Private cloud reports and active-session leases
lib/coding.js       OpenAI coding interviews and Judge0 integration
lib/progress.js     Versioned rubric and saved performance metrics
public/             Interview UI, avatar, Monaco and progress dashboard
supabase/           PostgreSQL migration with ownership policies
docs/DEPLOYMENT.md  Service setup, hosting and custom domain guide
test/               Unit tests (npm test)
```

## Notes

- Active sessions expire after 3 hours. Authenticated sessions persist in Supabase with request leases; guest/demo sessions use isolated process memory. Production requires Supabase and an HTTPS origin. See the deployment guide for shared rate limiting and scaling considerations.
- A transcript doesn't capture vocal pitch, so "tone" is inferred from pacing, pauses, fillers, hedging and word choice. The report says this.
- On Claude, requests use the server-side refusal fallback (`fallbacks: "default"`), so a false-positive safety decline doesn't end an interview partway through.
- **Keys stay private:** `.env` (and an `env/` folder, if you prefer to keep it there) are in `.gitignore`, so they never get committed.
