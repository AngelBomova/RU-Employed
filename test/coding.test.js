import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.OPENAI_API_KEY = "test-openai-key";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.JUDGE0_API_URL = "https://judge.test";
const originalFetch = globalThis.fetch;
let submissionCount = 0,
  compileError = false,
  lastExplanation,
  lastEvaluation;
const outputs = new Map();
const problem = {
  title: "Reverse numbers",
  description: "Reverse a JSON array, printing compact JSON.",
  constraints: ["Up to ten integers."],
  tests: [
    { stdin: "[1,2]", expected_output: "[2,1]", explanation: "Reversed." },
    { stdin: "[]", expected_output: "[]", explanation: "Empty input." },
    { stdin: "[3]", expected_output: "[3]", explanation: "One element." },
  ],
  starter: {
    python: "# Python starter",
    javascript: "// JS starter",
    java: "class Main {}",
    cpp: "// C++ starter",
  },
  reference_python:
    'import json, sys\nprint(json.dumps(json.loads(sys.stdin.read())[::-1], separators=(",", ":")))',
  expected_complexity: "O(n)",
};
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.host === "judge.test") {
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.ok([71, 63, 62, 54].includes(body.language_id));
      assert.equal(body.enable_network, false);
      assert.equal(body.cpu_time_limit, 2);
      assert.equal(body.wall_time_limit, 5);
      assert.equal(body.memory_limit, 256000);
      assert.ok(Buffer.from(body.source_code, "base64").toString().length > 0);
      const token = `submission-${++submissionCount}`;
      outputs.set(token, body.expected_output);
      return Response.json({ token });
    }
    const token = url.pathname.split("/").at(-1);
    return Response.json(
      compileError
        ? {
            status: { id: 6, description: "Compilation Error" },
            compile_output: Buffer.from("Syntax error on line 2").toString(
              "base64",
            ),
          }
        : {
            status: { id: 3, description: "Accepted" },
            stdout: outputs.get(token),
            time: "0.01",
            memory: 2000,
          },
    );
  }
  if (url.host === "api.openai.com") {
    const body = JSON.parse(options.body),
      name = body.response_format.json_schema.name;
    let content;
    if (name === "coding_problem") content = problem;
    if (name === "coding_turn") {
      lastExplanation = JSON.parse(body.messages[1].content);
      content = {
        say: "How does your array slicing affect extra space?",
        end_interview: false,
      };
    }
    if (name === "coding_feedback") {
      lastEvaluation = JSON.parse(body.messages[1].content);
      content = {
        correctness: 80,
        efficiency: 75,
        problem_solving: 70,
        communication: 65,
        complexity: 60,
        summary: "Consider the additional array allocation.",
        strengths: ["Clear approach."],
        improvements: ["Explain space complexity."],
        time_complexity: "O(n)",
        space_complexity: "O(n)",
      };
    }
    assert.ok(content, `Unexpected OpenAI response schema ${name}`);
    return Response.json({
      id: "chatcmpl-coding-test",
      object: "chat.completion",
      created: 1,
      model: body.model,
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
  return originalFetch(input, options);
};
const { app } = await import("../server.js");
const { executeCode } = await import("../lib/coding.js");
let server,
  base,
  cookie = "";
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  globalThis.fetch = originalFetch;
});
async function post(path, body = {}) {
  const response = await originalFetch(base + path, {
    method: "POST",
    headers: {
      cookie,
      ...(body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
    },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  const incoming = response.headers.getSetCookie();
  if (incoming.length) cookie = incoming.map((s) => s.split(";")[0]).join("; ");
  return { status: response.status, data: await response.json() };
}
test("coding validates generated references, sends actual code into followups, distinguishes stale executions, and keeps reports immutable", async () => {
  const created = await post("/api/coding/sessions", {
    company: "Google",
    role: "Software Engineer",
    difficulty: "medium",
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.referenceVerified, true);
  assert.equal(submissionCount, 3);
  assert.equal(created.data.problem.reference_python, undefined);
  assert.match(created.data.source, /not verified/);
  const path = `/api/coding/sessions/${created.data.id}`,
    code = { language: "python", code: 'print("first version")' };
  const run = await post(path + "/run", code);
  assert.equal(run.status, 200);
  assert.ok(run.data.results.every((r) => r.passed));
  const explain = new FormData();
  explain.set("code", code.code);
  explain.set("language", code.language);
  explain.set("text", "I will use array slicing.");
  assert.equal((await post(path + "/answer", explain)).status, 200);
  assert.equal(lastExplanation.code, code.code);
  assert.equal(lastExplanation.tests.length, 3);
  const changed = { ...code, code: 'print("edited version")' };
  const feedback = await post(path + "/feedback", changed);
  assert.equal(feedback.status, 200);
  assert.equal(feedback.data.kind, "coding");
  assert.equal(lastEvaluation.code, changed.code);
  assert.equal(lastEvaluation.execution, "No results for the current code.");
  assert.equal(feedback.data.feedback.coding.testedCurrentCode, false);
  assert.equal(feedback.data.metrics.confidence, null);
  assert.equal((await post(path + "/feedback", code)).status, 409);
  assert.deepEqual(
    (await post(path + "/feedback", changed)).data,
    feedback.data,
  );
  assert.equal((await post(path + "/run", changed)).status, 409);
});
test("all four language IDs use sandbox limits and return compilation diagnostics; unavailable runners fail honestly", async () => {
  for (const language of ["python", "javascript", "java", "cpp"]) {
    const results = await executeCode("a trusted test fixture", language, [
      problem.tests[0],
    ]);
    assert.equal(results[0].passed, true);
  }
  compileError = true;
  const result = await executeCode("invalid", "java", [problem.tests[0]]);
  assert.equal(result[0].passed, false);
  assert.match(result[0].compile_output, /Syntax error/);
  compileError = false;
  await assert.rejects(
    executeCode("code", "shell", [problem.tests[0]]),
    (error) => error.status === 400,
  );
  process.env.JUDGE0_API_URL = "";
  await assert.rejects(
    executeCode("code", "python", [problem.tests[0]]),
    (error) => error.status === 503 && /never executed/.test(error.message),
  );
});
test("guest session identifiers are not sufficient to read or mutate another browser interview", async () => {
  const created = await post("/api/coding/sessions", { demo: true });
  const response = await originalFetch(
    base + `/api/coding/sessions/${created.data.id}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "my private code", language: "python" }),
    },
  );
  assert.equal(response.status, 404);
  const report = await post(
    `/api/coding/sessions/${created.data.id}/feedback`,
    { code: "my private code", language: "python" },
  );
  assert.equal(report.status, 200);
  assert.equal(report.data.demo, true);
  assert.match(report.data.feedback.overall.summary, /not performed/);
});
