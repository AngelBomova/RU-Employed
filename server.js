import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pdfToText, clean, fetchJobPosting } from "./lib/ingest.js";
import {
  planInterview,
  interviewerTurn,
  generateFeedback,
  LENGTHS,
  aiProvider,
} from "./lib/ai.js";
import {
  streamSpeech,
  transcribe,
  VOICES,
  hasElevenLabs,
} from "./lib/elevenlabs.js";
import { analyzeDelivery } from "./lib/delivery.js";
import { securityMiddleware, rateLimit, failure } from "./lib/security.js";
import {
  authenticate,
  authRouter,
  hasDatabase,
  requireUser,
} from "./lib/auth.js";
import {
  guestIdentity,
  createSession,
  loadSession,
  saveSession,
  saveReport,
  listReports,
  deleteReport,
  profile,
} from "./lib/store.js";
import { buildReport } from "./lib/progress.js";
import { codingRouter, hasRunner } from "./lib/coding.js";
import {
  DEMO_MATERIALS,
  demoPlan,
  demoTurn,
  demoFeedback,
} from "./lib/demo.js";

// Load secrets from .env (project root) or env/.env — both are gitignored.
for (const file of [".env", "env/.env"]) {
  try {
    process.loadEnvFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), file),
    );
  } catch {}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.disable("x-powered-by");
if (process.env.TRUST_PROXY)
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
app.use(securityMiddleware);
app.use(express.json({ limit: "2mb" }));
app.use(
  "/vendor/monaco",
  express.static(path.join(__dirname, "node_modules/monaco-editor/min")),
);
app.use(
  "/vendor/chart",
  express.static(path.join(__dirname, "node_modules/chart.js/dist")),
);
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) =>
  res.json({ status: "ok", uptime: Math.round(process.uptime()) }),
);
app.use("/api", (req, res, next) => {
  const start = Date.now();
  if (process.env.NODE_ENV === "production")
    res.on("finish", () =>
      console.log(
        JSON.stringify({
          event: "request",
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        }),
      ),
    );
  next();
});
app.use("/api", rateLimit(180), guestIdentity, authenticate);
app.use("/api/auth", authRouter);
app.use("/api/coding", codingRouter);

// Authenticated sessions persist in Supabase; guests use an isolated memory store.
const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
    await saveSession(req);
  } catch (error) {
    try {
      await saveSession(req);
    } catch {
      console.error(
        JSON.stringify({
          event: "session_save_failed",
          requestId: req.requestId,
        }),
      );
    }
    next(error);
  }
};
app.use("/api/sessions/:id", (req, _res, next) =>
  loadSession(req, req.method !== "GET" && !req.path.endsWith("/speech")).then(
    () => next(),
    next,
  ),
);

function getSession(req) {
  const s = req.interviewSession;
  if (!s) {
    const err = new Error(
      "Interview session not found or expired. Start a new one.",
    );
    err.status = 404;
    throw err;
  }
  return s;
}

app.get("/api/config", (_req, res) => {
  res.json({
    voices: VOICES,
    lengths: LENGTHS,
    elevenlabs: hasElevenLabs(),
    ai: aiProvider(),
    accounts: hasDatabase(),
    coding: { ai: Boolean(process.env.OPENAI_API_KEY), runner: hasRunner() },
  });
});

// 1) Ingest resume / LinkedIn / job description, design the interview, and get the opening line.
app.post(
  "/api/sessions",
  upload.fields([
    { name: "resumeFile", maxCount: 1 },
    { name: "linkedinFile", maxCount: 1 },
  ]),
  wrap(async (req, res) => {
    const b = req.body;
    const demo = b.demo === "true";
    if (!demo && (hasDatabase() || process.env.NODE_ENV === "production"))
      requireUser(req);
    const voice =
      VOICES.find(
        (v) => v.id === b.voiceId && (!b.gender || v.gender === b.gender),
      ) ||
      VOICES.find((v) => v.gender === b.gender) ||
      VOICES[0];
    const fileText = async (field) => {
      const f = req.files?.[field]?.[0];
      if (!f) return "";
      if (
        f.mimetype === "application/pdf" ||
        f.originalname.toLowerCase().endsWith(".pdf")
      )
        return pdfToText(f.buffer);
      return clean(f.buffer.toString("utf8"));
    };

    const resume = demo
      ? DEMO_MATERIALS.resume
      : (await fileText("resumeFile")) || clean(b.resumeText);
    const linkedin = demo
      ? DEMO_MATERIALS.linkedin
      : (await fileText("linkedinFile")) || clean(b.linkedinText);
    let job = demo ? DEMO_MATERIALS.job : clean(b.jobText);
    if (!job && b.jobUrl) job = await fetchJobPosting(b.jobUrl.trim());
    let portfolio = demo ? DEMO_MATERIALS.portfolio : clean(b.portfolioText);
    if (!portfolio && b.portfolioUrl)
      portfolio = await fetchJobPosting(b.portfolioUrl.trim());

    if (!resume)
      return res
        .status(400)
        .json({ error: "Add your resume (PDF or pasted text)." });
    if (!job)
      return res
        .status(400)
        .json({ error: "Add the job description (link or pasted text)." });

    const materials = {
      resume,
      linkedin,
      portfolio,
      job,
      notes: clean(b.notes).slice(0, 2000),
    };
    const plan = demo
      ? demoPlan({ length: b.length, focus: b.focus })
      : await planInterview(materials, {
          length: b.length,
          focus: b.focus,
          interviewerName: voice.name,
          gender: voice.gender,
        });
    plan.interviewer.name = voice.name;

    const session = {
      id: randomUUID(),
      startedAt: Date.now(),
      voiceId: voice.id,
      gender: voice.gender,
      focus: ["behavioral", "technical"].includes(b.focus) ? b.focus : "mixed",
      materials,
      plan,
      messages: [], // append-only Claude conversation
      turns: [], // human-readable transcript + metrics
      ended: false,
      feedback: null,
      demo,
      busy: false,
    };
    const opening = demo
      ? demoTurn(session, null)
      : await interviewerTurn(session, null);
    session.currentQuestion = opening.question_id;
    session.turns.push({ role: "interviewer", text: opening.say });
    await createSession(req, session);

    res.json({
      id: session.id,
      demo,
      gender: voice.gender,
      question_id: opening.question_id,
      plan: {
        company: plan.company,
        role: plan.role,
        interviewer: plan.interviewer,
        format_summary: plan.format_summary,
        question_count: plan.questions.length,
      },
      reply: opening.say,
    });
  }),
);
app.get(
  "/api/reports",
  wrap(async (req, res) => res.json({ reports: await listReports(req) })),
);
app.delete(
  "/api/reports/:id",
  wrap(async (req, res) => {
    await deleteReport(req, req.params.id);
    res.json({ ok: true });
  }),
);
app.get(
  "/api/profile",
  wrap(async (req, res) => res.json({ materials: await profile(req) })),
);
app.put(
  "/api/profile",
  wrap(async (req, res) => {
    const materials = {};
    for (const key of ["resume", "linkedin", "portfolio", "job", "notes"])
      materials[key] = clean(req.body[key]);
    await profile(req, materials);
    res.json({ ok: true });
  }),
);

// 2) Candidate answers (voice or typed) → transcript + delivery metrics → interviewer's next line.
app.post(
  "/api/sessions/:id/answer",
  upload.single("audio"),
  wrap(async (req, res) => {
    const session = getSession(req);
    if (session.ended)
      return res
        .status(409)
        .json({ error: "This interview has already ended." });
    if (session.busy)
      return res
        .status(409)
        .json({ error: "Your last answer is still being processed." });
    session.busy = true;
    const messageCount = session.messages.length;
    try {
      let text = clean(req.body.text);
      let words = [];
      if (req.file) {
        const result = await transcribe(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
        );
        text = result.text;
        words = result.words;
      }
      if (!text)
        return res.status(400).json({
          error:
            "We couldn't hear an answer. Please record again or type your response.",
        });
      const metrics = analyzeDelivery(
        text,
        words,
        req.body.thinkTimeMs === undefined
          ? undefined
          : Number(req.body.thinkTimeMs),
      );

      const next = session.demo
        ? demoTurn(session, text)
        : await interviewerTurn(session, text);
      session.turns.push({ role: "candidate", text, metrics });
      session.turns.push({ role: "interviewer", text: next.say });
      session.currentQuestion = next.question_id;
      if (next.end_interview) session.ended = true;
      await saveSession(req);

      res.json({
        transcript: text,
        metrics,
        reply: next.say,
        ended: session.ended,
        question_id: next.question_id,
      });
    } catch (err) {
      session.messages.length = messageCount;
      throw err;
    } finally {
      session.busy = false;
    }
  }),
);

// 3) Interviewer voice via ElevenLabs.
app.post(
  "/api/sessions/:id/speech",
  wrap(async (req, res) => {
    const session = getSession(req);
    const text = String(req.body.text || "").slice(0, 2500);
    if (!text) return res.status(400).json({ error: "Nothing to say." });
    await streamSpeech(text, session.voiceId, res);
  }),
);

// 4) End early (candidate hangs up).
app.post(
  "/api/sessions/:id/end",
  wrap(async (req, res, next) => {
    try {
      const session = getSession(req);
      if (session.busy)
        return res
          .status(409)
          .json({ error: "Wait for your answer to finish before ending." });
      session.ended = true;
      await saveSession(req);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }),
);

// 5) Feedback report.
app.post(
  "/api/sessions/:id/feedback",
  wrap(async (req, res) => {
    const session = getSession(req);
    if (session.busy)
      return res.status(409).json({
        error: "Wait for your answer to finish before requesting feedback.",
      });
    if (!session.turns.some((t) => t.role === "candidate" && t.text)) {
      return res.status(400).json({
        error: "Answer at least one question before asking for feedback.",
      });
    }
    session.ended = true;
    session.busy = true;
    try {
      session.feedback ??= session.demo
        ? demoFeedback(session)
        : await generateFeedback(session);
      session.report ??= buildReport(session);
      const cloudSaved = await saveReport(req, session, session.report);
      await saveSession(req);
      res.json({ ...session.report, cloudSaved });
    } finally {
      session.busy = false;
    }
  }),
);

// Targeted practice leaves the original interview and report intact.
app.post(
  "/api/sessions/:id/retry",
  upload.single("audio"),
  wrap(async (req, res) => {
    const session = getSession(req);
    if (!session.feedback)
      return res.status(409).json({
        error: "Finish your interview before practicing an answer again.",
      });
    if (session.busy)
      return res
        .status(409)
        .json({ error: "Another response is still being processed." });
    const index = Number(req.body.answerIndex);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= session.feedback.answers.length
    )
      return res
        .status(400)
        .json({ error: "Choose a question from your report." });
    session.busy = true;
    try {
      let text = clean(req.body.text),
        words = [];
      if (req.file) {
        const result = await transcribe(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
        );
        text = result.text;
        words = result.words;
      }
      if (!text)
        return res
          .status(400)
          .json({ error: "Add a new answer to get feedback." });
      const metrics = analyzeDelivery(text, words);
      const practice = {
        ...session,
        turns: [
          {
            role: "interviewer",
            text: session.feedback.answers[index].question,
          },
          { role: "candidate", text, metrics },
        ],
      };
      const feedback = session.demo
        ? demoFeedback(practice)
        : await generateFeedback(practice);
      res.json({
        answer: feedback.answers[0],
        delivery: feedback.delivery,
        metrics,
        transcript: text,
        demo: session.demo,
      });
    } finally {
      session.busy = false;
    }
  }),
);

app.use((err, req, res, _next) => {
  const status = err.status && err.status < 600 ? err.status : 500;
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: "request_failed",
        requestId: req.requestId,
        status,
        kind: err.name,
      }),
    );
  if (!res.headersSent)
    res
      .status(status)
      .json({
        error:
          process.env.NODE_ENV === "production" && status >= 500
            ? "A service is temporarily unavailable. Please try again."
            : err.message || "Something went wrong.",
        requestId: req.requestId,
      });
  else res.end();
});

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (
    process.env.NODE_ENV === "production" &&
    (!hasDatabase() || !/^https:\/\//.test(process.env.PUBLIC_APP_URL || ""))
  )
    throw new Error(
      "Production requires Supabase configuration and an HTTPS PUBLIC_APP_URL. See docs/DEPLOYMENT.md.",
    );
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`RU Employed running → http://localhost:${port}`);
    const ai = aiProvider();
    if (ai) console.log(`AI brain: ${ai === "openai" ? "OpenAI" : "Claude"}`);
    else
      console.warn(
        "⚠  No ANTHROPIC_API_KEY or OPENAI_API_KEY in .env — the interviewer can't think.",
      );
    if (!hasElevenLabs())
      console.warn(
        "⚠  ELEVENLABS_API_KEY not set — falling back to the browser's built-in voice and typed answers.",
      );
  });
}
