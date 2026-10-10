import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { demoPlan, DEMO_MATERIALS, demoFeedback } from "../lib/demo.js";
import { analyzeDelivery } from "../lib/delivery.js";

// Exercise actual SDK parsing and HTTP integration without paid API calls.
const originalFetch = globalThis.fetch;
process.env.AI_PROVIDER = "openai";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
process.env.ELEVENLABS_TTS_MODEL = "test-tts-model";
process.env.ELEVENLABS_STT_MODEL = "test-stt-model";
const plan = demoPlan({ length: "short" });
let failTurn = false,
  emptySpeech = false,
  lastTurnMessages,
  speechModels = [],
  sttModels = [],
  planningPrompt,
  notifyTranscribing;
const text = "I built CampusConnect.";
const words = [
  { type: "word", text: "I", start: 0, end: 0.2 },
  { type: "word", text: "built", start: 0.3, end: 0.7 },
  { type: "word", text: "CampusConnect", start: 2.5, end: 3 },
];
const feedback = demoFeedback({
  plan,
  turns: [
    { role: "interviewer", text: plan.questions[0].question },
    { role: "candidate", text, metrics: analyzeDelivery(text, words) },
  ],
});

globalThis.fetch = async (input, options) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.openai.com/")) {
    const request = JSON.parse(options.body);
    const name = request.response_format.json_schema.name;
    let content;
    if (name === "interview_plan") {
      planningPrompt = request.messages.at(-1).content;
      content = plan;
    }
    if (name === "interviewer_turn") {
      lastTurnMessages = request.messages;
      if (failTurn) {
        failTurn = false;
        return Response.json(
          {
            error: {
              message: "Simulated provider failure",
              type: "invalid_request_error",
            },
          },
          { status: 400 },
        );
      }
      const opening = request.messages.length === 2;
      content = {
        say: opening ? plan.questions[0].question : plan.questions[1].question,
        question_id: opening ? "q1" : "q2",
        end_interview: false,
      };
    }
    if (name === "feedback_report") content = feedback;
    assert.ok(content, `Unexpected structured request: ${name}`);
    return Response.json({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify(content),
            refusal: null,
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) {
    speechModels.push(JSON.parse(options.body).model_id);
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "audio/mpeg" },
    });
  }
  if (url === "https://api.elevenlabs.io/v1/speech-to-text") {
    sttModels.push(options.body.get("model_id"));
    notifyTranscribing?.();
    await new Promise((resolve) => setTimeout(resolve, 70));
    return Response.json({
      text: emptySpeech ? "" : text,
      words: emptySpeech ? [] : words,
    });
  }
  return originalFetch(input, options);
};

const { app } = await import("../server.js");
let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = originalFetch;
});
async function post(path, values, audio = false) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values || {})) body.set(key, value);
  if (audio)
    body.set(
      "audio",
      new Blob(["test-recording"], { type: "audio/webm" }),
      "answer.webm",
    );
  const response = await originalFetch(`${base}${path}`, {
    method: "POST",
    body,
  });
  return { status: response.status, data: await response.json() };
}

test("live OpenAI planning, ElevenLabs audio, failed-turn recovery, feedback, and voice retries", async () => {
  const created = await post("/api/sessions", {
    resumeText: DEMO_MATERIALS.resume,
    jobText: DEMO_MATERIALS.job,
    portfolioText: "Portfolio: my accessible community application.",
    length: "short",
    focus: "technical",
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.demo, false);
  assert.match(
    planningPrompt,
    /<candidate_portfolio>\nPortfolio: my accessible/,
  );
  const path = `/api/sessions/${created.data.id}`;

  const speech = await originalFetch(`${base}${path}/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: created.data.reply }),
  });
  assert.equal(speech.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(
    Array.from(new Uint8Array(await speech.arrayBuffer())),
    [1, 2, 3],
  );
  assert.deepEqual(speechModels, ["test-tts-model"]);

  failTurn = true;
  assert.equal(
    (await post(`${path}/answer`, { text: "This attempt failed." })).status,
    400,
  );
  emptySpeech = true;
  assert.equal((await post(`${path}/answer`, {}, true)).status, 400);
  emptySpeech = false;
  const transcribing = new Promise((resolve) => {
    notifyTranscribing = resolve;
  });
  const answerPromise = post(`${path}/answer`, {}, true);
  await transcribing;
  notifyTranscribing = null;
  assert.equal(
    (await post(`${path}/answer`, { text: "Concurrent duplicate." })).status,
    409,
  );
  const answer = await answerPromise;
  assert.equal(answer.status, 200);
  assert.equal(answer.data.metrics.source, "voice");
  assert.equal(answer.data.metrics.long_pauses, 1);
  assert.equal(answer.data.metrics.words_per_minute, 60);
  assert.equal(
    lastTurnMessages.length,
    4,
    "Failed turns should not remain in SDK history",
  );
  assert.ok(
    !lastTurnMessages.some((m) => m.content.includes("This attempt failed.")),
  );

  const report = await post(`${path}/feedback`);
  assert.equal(report.status, 200);
  assert.equal(report.data.demo, false);
  assert.equal(
    report.data.transcript.filter((t) => t.role === "candidate").length,
    1,
  );
  const retry = await post(`${path}/retry`, { answerIndex: 0 }, true);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.metrics.source, "voice");
  assert.equal(retry.data.transcript, text);
  assert.ok(sttModels.every((model) => model === "test-stt-model"));
  assert.deepEqual((await post(`${path}/feedback`)).data, report.data);
});
