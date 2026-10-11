import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const directory = mkdtempSync(path.join(os.tmpdir(), "ru-employed-test-"));
process.env.AUTH_MODE = "local";
process.env.LOCAL_DATABASE_PATH = path.join(directory, "accounts.sqlite");
const local = await import("../lib/local-db.js");
const { executeJavaScript } = await import("../lib/local-runner.js");
const { cameraSummary } = await import("../lib/camera.js");
after(() => {
  local.localDatabase().close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(process.env.LOCAL_DATABASE_PATH + suffix);
    } catch {}
  }
  rmdirSync(directory);
});
test("SQLite persists accounts, enforces ownership and leases, and recovery rotates codes and revokes old logins", async () => {
  const a = await local.localSignup(
    "Alex@Example.com",
    "Alex",
    "first-strong-password",
  );
  const b = await local.localSignup(
    "other@example.com",
    "Other",
    "other-strong-password",
  );
  assert.equal(local.localAuthenticate(a.token).user.email, "alex@example.com");
  await assert.rejects(
    local.localLogin("alex@example.com", "wrong-password"),
    (e) => e.status === 401,
  );
  const auth = local.localAuthenticate(a.token);
  local.localProfile(a.user.id, { resume: "private experience" });
  local.localProfile(b.user.id, { resume: "different experience" });
  const id = randomUUID(),
    session = { id, startedAt: Date.now(), turns: [] };
  local.localCreateInterview(a.user.id, session);
  assert.throws(
    () => local.localLoadInterview(b.user.id, id),
    (e) => e.status === 404,
  );
  const lease = randomUUID();
  local.localLoadInterview(a.user.id, id, lease);
  assert.throws(
    () => local.localLoadInterview(a.user.id, id, randomUUID()),
    (e) => e.status === 409,
  );
  local.localSaveInterview(
    a.user.id,
    { ...session, turns: [{ text: "answer" }] },
    lease,
  );
  assert.equal(local.localLoadInterview(a.user.id, id).turns[0].text, "answer");
  local.localSaveReport(a.user.id, {
    id,
    createdAt: new Date().toISOString(),
    private: true,
  });
  assert.equal(local.localReports(b.user.id).length, 0);
  local.localDeleteReport(b.user.id, id);
  assert.equal(local.localReports(a.user.id).length, 1);
  const restarted = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {localAuthenticate,localProfile} from ${JSON.stringify(new URL("../lib/local-db.js", import.meta.url).href)};const auth=localAuthenticate(${JSON.stringify(a.token)});console.log(JSON.stringify({name:auth.user.user_metadata.name,profile:localProfile(auth.user.id)}));`,
      ],
      {
        env: process.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ),
  );
  assert.equal(restarted.name, "Alex");
  assert.equal(restarted.profile.resume, "private experience");
  await assert.rejects(
    local.localReset(
      "alex@example.com",
      "wrong-code",
      "changed-strong-password",
    ),
    (e) => e.status === 401,
  );
  const reset = await local.localReset(
    "alex@example.com",
    a.recoveryCode,
    "changed-strong-password",
  );
  assert.notEqual(reset.recoveryCode, a.recoveryCode);
  assert.equal(local.localAuthenticate(a.token), null);
  await assert.rejects(
    local.localReset(
      "alex@example.com",
      a.recoveryCode,
      "another-strong-password",
    ),
    (e) => e.status === 401,
  );
  await assert.rejects(
    local.localLogin("alex@example.com", "first-strong-password"),
    (e) => e.status === 401,
  );
  assert.ok(
    (await local.localLogin("alex@example.com", "changed-strong-password"))
      .token,
  );
  local.localLogout(reset.token);
  assert.equal(local.localAuthenticate(reset.token), null);
  const row = local
    .localDatabase()
    .prepare("SELECT password_hash,recovery_hash FROM users WHERE id=?")
    .get(auth.user.id);
  assert.ok(!row.password_hash.includes("changed-strong-password"));
  assert.ok(!row.recovery_hash.includes(reset.recoveryCode));
});
test("local JavaScript sandbox runs actual code, reports errors and interrupts loops without host access", async () => {
  const tests = [{ stdin: "[2,7]", expected_output: "9" }];
  const pass = await executeJavaScript(
    'const fs=require("fs");const values=JSON.parse(fs.readFileSync(0,"utf8"));console.log(values.reduce((a,b)=>a+b,0));',
    tests,
  );
  assert.equal(pass[0].passed, true);
  const wrong = await executeJavaScript("console.log(0);", tests);
  assert.equal(wrong[0].passed, false);
  const blocked = await executeJavaScript("console.log(process.env);", tests);
  assert.match(blocked[0].stderr, /process/);
  const files = await executeJavaScript(
    'require("fs").readFileSync(".env");',
    tests,
  );
  assert.match(files[0].stderr, /stdin/);
  const network = await executeJavaScript(
    'fetch("https://example.com");',
    tests,
  );
  assert.match(network[0].stderr, /fetch/);
  const loop = await executeJavaScript("while(true){}", tests);
  assert.equal(loop[0].passed, false);
  assert.match(loop[0].stderr, /interrupt/);
});
test("camera aggregates reject invalid input and never manufacture confidence or emotion scores", () => {
  assert.equal(cameraSummary({ samples: 5, faceVisible: 2 }), null);
  const summary = cameraSummary({
    samples: 30,
    faceVisible: 0.9,
    cameraFacing: 0.8,
    framing: 0.7,
    facialMovement: 0.03,
    confidence: 0.99,
  });
  assert.equal(summary.sufficient, true);
  assert.equal(summary.confidence, undefined);
  assert.equal(summary.seconds, 12);
  assert.equal(cameraSummary({ samples: 2, faceVisible: 1 }).sufficient, false);
});
