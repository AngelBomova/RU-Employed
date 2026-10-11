import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
import { demoPlan } from "../lib/demo.js";

let server,
  base,
  cookie = "";
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
async function post(path, values) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values || {})) body.set(key, value);
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    body,
    headers: { cookie },
  });
  const incoming = response.headers.getSetCookie();
  if (incoming.length) cookie = incoming.map((s) => s.split(";")[0]).join("; ");
  return { status: response.status, data: await response.json() };
}

test("demo honors focus and question counts for every length", () => {
  for (const focus of ["behavioral", "technical", "mixed"]) {
    for (const [length, count] of Object.entries({
      short: 4,
      standard: 6,
      long: 9,
    })) {
      assert.equal(demoPlan({ focus, length }).questions.length, count);
    }
  }
  assert.match(
    demoPlan({ focus: "technical" }).questions[1].question,
    /PostgreSQL/,
  );
  assert.match(
    demoPlan({ focus: "behavioral" }).questions[1].question,
    /disagreement/,
  );
});

test("demo completes an interview, rejects empty answers, and supports isolated retries", async () => {
  const created = await post("/api/sessions", {
    demo: "true",
    length: "short",
    focus: "mixed",
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.demo, true);
  assert.equal(created.data.question_id, "q1");
  const path = `/api/sessions/${created.data.id}`;
  assert.equal((await post(`${path}/feedback`)).status, 400);
  assert.equal((await post(`${path}/answer`, { text: "   " })).status, 400);
  assert.equal(
    (await post(`${path}/retry`, { answerIndex: 0, text: "Not yet" })).status,
    409,
  );
  for (let i = 0; i < 4; i++) {
    const answer = await post(`${path}/answer`, {
      text: "During my project, the goal was to help students. I designed and tested an API. We reduced latency by 40%.",
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.data.metrics.source, "typed");
    assert.equal(answer.data.metrics.words_per_minute, undefined);
    assert.equal(answer.data.metrics.think_time_sec, undefined);
    assert.equal(answer.data.ended, i === 3);
    if (i < 3) assert.equal(answer.data.question_id, `q${i + 2}`);
  }
  assert.equal(
    (await post(`${path}/answer`, { text: "One more" })).status,
    409,
  );
  const report = await post(`${path}/feedback`);
  assert.equal(report.status, 200);
  assert.equal(report.data.feedback.answers.length, 4);
  assert.equal(
    report.data.transcript.filter((t) => t.role === "candidate").length,
    4,
  );
  assert.match(report.data.feedback.overall.summary, /offline demo/);
  assert.match(report.data.feedback.delivery.pace, /typed/);
  const retry = await post(`${path}/retry`, {
    answerIndex: 0,
    text: "I helped.",
  });
  assert.equal(retry.status, 200);
  assert.ok(
    retry.data.answer.star.result.score <
      report.data.feedback.answers[0].star.result.score,
  );
  assert.equal(
    (await post(`${path}/retry`, { answerIndex: 99, text: "Invalid" })).status,
    400,
  );
  assert.equal(
    (await post(`${path}/retry`, { answerIndex: 0, text: "" })).status,
    400,
  );
  assert.deepEqual((await post(`${path}/feedback`)).data, report.data);
});

test("ending early produces feedback only for answered questions", async () => {
  const { data } = await post("/api/sessions", { demo: "true" });
  const path = `/api/sessions/${data.id}`;
  await post(`${path}/answer`, { text: "I built a project." });
  assert.equal((await post(`${path}/end`)).status, 200);
  const report = await post(`${path}/feedback`);
  assert.equal(report.data.feedback.answers.length, 1);
  assert.equal(
    (await post("/api/sessions/not-a-session/feedback")).status,
    404,
  );
});
