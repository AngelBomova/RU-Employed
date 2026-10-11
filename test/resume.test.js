import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_MODE = "local";
process.env.LOCAL_DATABASE_PATH = ":memory:";
const { app } = await import("../server.js");
const { localSignup, localAuthenticate, localDatabase } =
  await import("../lib/local-db.js");
const { resolveResume } = await import("../lib/resume.js");
const { saveReport } = await import("../lib/store.js");
let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  localDatabase().close();
});

test("uploaded resumes save immediately, remain private, replace safely and stay removed after an older report finishes", async () => {
  const a = await localSignup(
    "resume-a@example.com",
    "Alex",
    "a-strong-password",
  );
  const b = await localSignup(
    "resume-b@example.com",
    "Bea",
    "b-strong-password",
  );
  async function call(path, { token = a.token, method = "GET", body } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { cookie: `ru_local=${token}` } : {}),
        ...(body && !(body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  const upload = (text, name = "Alex-resume.txt", token = a.token) => {
    const body = new FormData();
    body.set("resumeFile", new Blob([text]), name);
    return call("/api/profile/resume", { token, method: "PUT", body });
  };
  assert.equal(
    (await upload("Private resume", "resume.txt", null)).status,
    401,
  );
  await call("/api/profile", {
    method: "PUT",
    body: {
      linkedin: "My experience",
      portfolio: "My projects",
      notes: "Keep these",
    },
  });
  const first = await upload("Alex\nBuilt a search engine.");
  assert.equal(first.status, 200);
  assert.equal(first.data.materials.resumeFilename, "Alex-resume.txt");
  assert.equal(first.data.materials.portfolio, "My projects");
  assert.equal(
    (await call("/api/profile", { token: b.token })).data.materials.resume,
    undefined,
  );
  for (const [text, name] of [
    ["  ", "empty.txt"],
    ["Invalid PDF", "invalid.pdf"],
    ["Unsupported", "resume.exe"],
  ]) {
    assert.equal((await upload(text, name)).status, 400);
    assert.equal(
      (await call("/api/profile")).data.materials.resume,
      first.data.materials.resume,
    );
  }
  const replacement = await upload(
    "Alex\nLed a distributed systems project.",
    "Updated-resume.md",
  );
  assert.equal(replacement.status, 200);
  await call("/api/profile", {
    method: "PUT",
    body: { portfolio: "Updated projects" },
  });
  const current = (await call("/api/profile")).data.materials;
  assert.equal(current.resume, replacement.data.materials.resume);
  assert.equal(current.resumeFilename, "Updated-resume.md");
  assert.equal(current.linkedin, "My experience");
  const req = { auth: localAuthenticate(a.token) };
  assert.equal(await resolveResume(req), current.resume);
  await saveReport(
    req,
    {
      demo: false,
      materials: {
        resume: "Outdated resume",
        portfolio: "Prior interview project",
      },
    },
    { id: randomUUID(), createdAt: new Date().toISOString() },
  );
  assert.equal(
    (await call("/api/profile")).data.materials.resume,
    current.resume,
  );
  const removed = await call("/api/profile/resume", { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.materials.resume, "");
  assert.equal(removed.data.materials.resumeFilename, "");
  assert.equal(removed.data.materials.linkedin, "My experience");
  await saveReport(
    req,
    { demo: false, materials: { resume: current.resume } },
    { id: randomUUID(), createdAt: new Date().toISOString() },
  );
  assert.equal(await resolveResume(req), "");
  assert.equal((await call("/api/profile")).data.materials.resume, "");
  assert.equal(
    (await call("/api/profile/resume", { token: null, method: "DELETE" }))
      .status,
    401,
  );
});
