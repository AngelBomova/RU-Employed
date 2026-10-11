import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_ANON_KEY = "test-anon";
process.env.NODE_ENV = "test";
const originalFetch = globalThis.fetch;
const users = new Map([
  [
    "a",
    {
      id: randomUUID(),
      email: "a@example.com",
      user_metadata: { name: "Alex" },
    },
  ],
  [
    "b",
    {
      id: randomUUID(),
      email: "b@example.com",
      user_metadata: { name: "Bea" },
    },
  ],
]);
const reports = new Map(),
  sessions = new Map(),
  profiles = new Map();
let recovered,
  updated,
  refreshCount = 0,
  leaseSaves = 0,
  providerOffline = false;
const signedIn = (key) => ({
  access_token: key,
  refresh_token: `refresh-${key}`,
  user: users.get(key),
});
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.host !== "supabase.test") return originalFetch(input, options);
  assert.equal(options.headers.apikey, "test-anon");
  const method = options.method || "GET",
    body = options.body && JSON.parse(options.body);
  const token = options.headers.Authorization.slice(7),
    user = users.get(token);
  if (url.pathname === "/auth/v1/token") {
    if (url.searchParams.get("grant_type") === "refresh_token") {
      refreshCount++;
      return Response.json(
        signedIn(body.refresh_token.replace("refresh-", "")),
      );
    }
    return Response.json(signedIn(body.email[0]));
  }
  if (url.pathname === "/auth/v1/signup")
    return Response.json({ user: users.get("a") });
  if (url.pathname === "/auth/v1/user") {
    if (providerOffline)
      return Response.json({ msg: "Temporarily unavailable" }, { status: 503 });
    if (!user) return Response.json({ msg: "Expired token" }, { status: 401 });
    if (method === "PUT") {
      updated = body;
      if (body.data)
        user.user_metadata = { ...user.user_metadata, ...body.data };
    }
    return Response.json(user);
  }
  if (url.pathname === "/auth/v1/recover") {
    recovered = body.email;
    return Response.json({});
  }
  if (url.pathname === "/auth/v1/verify") {
    assert.equal(body.type, "recovery");
    return Response.json(signedIn("a"));
  }
  if (url.pathname === "/auth/v1/logout")
    return providerOffline
      ? Response.json({ msg: "Temporarily unavailable" }, { status: 503 })
      : new Response(null, { status: 204 });
  assert.ok(
    user,
    "Database requests must use a signed-in user token, not the anon or a privileged key",
  );
  const id = url.searchParams.get("id")?.replace("eq.", "");
  if (url.pathname === "/rest/v1/interview_reports") {
    if (method === "POST") {
      assert.equal(body.user_id, user.id);
      reports.set(body.id, body);
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      if (reports.get(id)?.user_id === user.id) reports.delete(id);
      return new Response(null, { status: 204 });
    }
    return Response.json(
      [...reports.values()]
        .filter((r) => r.user_id === user.id)
        .map((r) => ({ report: r.report })),
    );
  }
  if (url.pathname === "/rest/v1/candidate_profiles") {
    if (method === "POST") {
      assert.equal(body.user_id, user.id);
      profiles.set(user.id, body.materials);
      return new Response(null, { status: 201 });
    }
    return Response.json(
      profiles.has(user.id) ? [{ materials: profiles.get(user.id) }] : [],
    );
  }
  if (url.pathname === "/rest/v1/interview_sessions") {
    if (method === "POST") {
      assert.equal(body.user_id, user.id);
      sessions.set(body.id, body);
      return new Response(null, { status: 201 });
    }
    const row = sessions.get(id);
    return Response.json(row?.user_id === user.id ? [row] : []);
  }
  if (url.pathname === "/rest/v1/rpc/claim_interview") {
    const row = sessions.get(body.target_id);
    if (!row || row.user_id !== user.id || row.lease_key)
      return Response.json([]);
    row.lease_key = body.claim_key;
    return Response.json([row]);
  }
  if (url.pathname === "/rest/v1/rpc/save_interview") {
    const row = sessions.get(body.target_id);
    assert.equal(row.user_id, user.id);
    assert.equal(row.lease_key, body.claim_key);
    assert.equal(body.new_payload.busy, false);
    leaseSaves++;
    row.payload = body.new_payload;
    row.lease_key = null;
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected provider route ${url.pathname}`);
};
const { app } = await import("../server.js");
let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  globalThis.fetch = originalFetch;
});
function browser() {
  const jar = new Map();
  return {
    jar,
    async call(path, { method = "GET", body, headers = {}, redirect } = {}) {
      const response = await originalFetch(base + path, {
        method,
        headers: {
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(body && !(body instanceof FormData)
            ? { "content-type": "application/json" }
            : {}),
          ...headers,
        },
        ...(body
          ? { body: body instanceof FormData ? body : JSON.stringify(body) }
          : {}),
        ...(redirect ? { redirect } : {}),
      });
      for (const line of response.headers.getSetCookie()) {
        const [k, v] = line.split(";")[0].split("=");
        if (/Max-Age=0(?:;|$)/.test(line)) jar.delete(k);
        else jar.set(k, v);
      }
      return {
        status: response.status,
        headers: response.headers,
        data: await response.json().catch(() => null),
      };
    },
  };
}

test("accounts persist with HttpOnly cookies; recovery verifies a one-time token; private reports and sessions use user JWTs", async () => {
  const a = browser(),
    b = browser(),
    guest = browser();
  assert.equal((await guest.call("/api/reports")).status, 401);
  assert.equal(
    (
      await a.call("/api/auth/signup", {
        method: "POST",
        body: { email: "a@example.com", password: "short" },
      })
    ).status,
    400,
  );
  assert.match(
    (
      await a.call("/api/auth/signup", {
        method: "POST",
        body: { email: "a@example.com", password: "long-password" },
      })
    ).data.message,
    /Check your email/,
  );
  const login = await a.call("/api/auth/login", {
    method: "POST",
    body: { email: "a@example.com", password: "long-password" },
  });
  assert.equal(login.status, 200);
  assert.ok(
    login.headers
      .getSetCookie()
      .some(
        (line) =>
          /ru_access=/.test(line) && /HttpOnly; SameSite=Lax/.test(line),
      ),
  );
  assert.equal((await a.call("/api/auth/me")).data.user.id, users.get("a").id);
  a.jar.set("ru_access", "expired");
  assert.equal((await a.call("/api/auth/me")).data.user.id, users.get("a").id);
  assert.equal(refreshCount, 1);
  await b.call("/api/auth/login", {
    method: "POST",
    body: { email: "b@example.com", password: "long-password" },
  });
  await a.call("/api/profile", {
    method: "PUT",
    body: { resume: "My private project", portfolio: "My work" },
  });
  assert.equal((await b.call("/api/profile")).data.materials.resume, undefined);
  const form = new FormData();
  form.set("demo", "true");
  form.set("gender", "male");
  const created = await a.call("/api/sessions", { method: "POST", body: form });
  assert.equal(created.status, 200);
  assert.equal(created.data.gender, "male");
  const path = `/api/sessions/${created.data.id}`;
  const answer = new FormData();
  answer.set("text", "I built a project and improved performance by 40%.");
  sessions.get(created.data.id).lease_key = randomUUID();
  assert.equal(
    (await a.call(path + "/answer", { method: "POST", body: answer })).status,
    409,
    "An outstanding cloud lease must reject another mutation",
  );
  sessions.get(created.data.id).lease_key = null;
  assert.equal(
    (await b.call(path + "/answer", { method: "POST", body: answer })).status,
    404,
  );
  assert.equal(
    (await guest.call(path + "/feedback", { method: "POST" })).status,
    404,
  );
  assert.equal(
    (await a.call(path + "/answer", { method: "POST", body: answer })).status,
    200,
  );
  const saved = await a.call(path + "/feedback", { method: "POST" });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.cloudSaved, true);
  assert.equal((await a.call("/api/reports")).data.reports.length, 1);
  assert.equal((await b.call("/api/reports")).data.reports.length, 0);
  await b.call(`/api/reports/${created.data.id}`, { method: "DELETE" });
  assert.equal((await a.call("/api/reports")).data.reports.length, 1);
  assert.equal(
    (await a.call("/api/profile")).data.materials.resume,
    "My private project",
    "a demo must not overwrite saved experience",
  );
  assert.ok(leaseSaves >= 2);
  await guest.call("/api/auth/forgot", {
    method: "POST",
    body: { email: "a@example.com" },
  });
  assert.equal(recovered, "a@example.com");
  const recovery = await guest.call(
    "/api/auth/confirm?token_hash=one-time-recovery-hash&type=recovery",
    { redirect: "manual" },
  );
  assert.equal(recovery.status, 302);
  assert.equal(recovery.headers.get("location"), "/?account=recovery");
  assert.equal(
    (
      await guest.call("/api/auth/account", {
        method: "PATCH",
        body: { password: "new-long-password", name: "Alex R" },
      })
    ).status,
    200,
  );
  assert.equal(updated.password, "new-long-password");
  assert.equal(
    (
      await a.call("/api/auth/account", {
        method: "PATCH",
        headers: { origin: "https://untrusted.test" },
        body: { name: "Bad change" },
      })
    ).status,
    403,
  );
  providerOffline = true;
  assert.equal(
    (await a.call("/api/auth/logout", { method: "POST" })).status,
    200,
    "Local logout must work during a provider outage",
  );
  assert.equal((await a.call("/api/auth/me")).data.user, null);
  assert.equal((await a.call("/api/reports")).status, 401);
});
