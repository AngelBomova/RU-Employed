import { randomUUID } from "node:crypto";
import { supabase, hasDatabase, requireUser } from "./auth.js";
import { cookies, setCookie, failure } from "./security.js";
const local = new Map();
const TTL = 3 * 60 * 60 * 1000;
setInterval(() => {
  for (const [id, s] of local)
    if (Date.now() - s.startedAt > TTL) local.delete(id);
}, 600_000).unref();
export function guestIdentity(req, res, next) {
  const existing = cookies(req).ru_guest;
  const valid = /^[a-f0-9-]{36}$/.test(existing || "");
  req.guestId = valid ? existing : randomUUID();
  if (!valid) setCookie(res, "ru_guest", req.guestId, 3 * 3600);
  next();
}
const owner = (req) => req.auth?.user.id || `guest:${req.guestId}`;
export async function createSession(req, session) {
  session.ownerId = owner(req);
  if (hasDatabase() && req.auth) {
    await supabase("/rest/v1/interview_sessions", {
      method: "POST",
      token: req.auth.token,
      body: {
        id: session.id,
        user_id: req.auth.user.id,
        payload: session,
        expires_at: new Date(session.startedAt + TTL).toISOString(),
      },
    });
  } else local.set(session.id, session);
}
export async function loadSession(req, mutate = false) {
  const id = req.params.id;
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw failure(
      404,
      "Interview session not found or expired. Start a new one.",
    );
  if (hasDatabase() && req.auth) {
    const lease = randomUUID();
    const rows = mutate
      ? await supabase("/rest/v1/rpc/claim_interview", {
          method: "POST",
          token: req.auth.token,
          body: { target_id: id, claim_key: lease },
        })
      : await supabase(
          `/rest/v1/interview_sessions?id=eq.${id}&select=payload,expires_at`,
          { token: req.auth.token },
        );
    if (!rows?.length) {
      if (mutate) {
        const found = await supabase(
          `/rest/v1/interview_sessions?id=eq.${id}&select=id`,
          { token: req.auth.token },
        );
        if (found?.length)
          throw failure(
            409,
            "This interview is processing another request. Please try again shortly.",
          );
      }
      throw failure(
        404,
        "Interview session not found or expired. Start a new one.",
      );
    }
    if (Date.parse(rows[0].expires_at) < Date.now())
      throw failure(404, "Interview session has expired. Start a new one.");
    req.sessionLease = mutate ? lease : null;
    req.interviewSession = rows[0].payload;
  } else {
    const session = local.get(id);
    if (
      !session ||
      session.ownerId !== owner(req) ||
      Date.now() - session.startedAt > TTL
    )
      throw failure(
        404,
        "Interview session not found or expired. Start a new one.",
      );
    req.interviewSession = session;
  }
  return req.interviewSession;
}
export async function saveSession(req) {
  if (!req.sessionLease) return;
  await supabase("/rest/v1/rpc/save_interview", {
    method: "POST",
    token: req.auth.token,
    body: {
      target_id: req.interviewSession.id,
      claim_key: req.sessionLease,
      new_payload: { ...req.interviewSession, busy: false },
    },
  });
  req.sessionLease = null;
}
export async function saveReport(req, session, report) {
  if (!hasDatabase() || !req.auth) return false;
  await supabase("/rest/v1/interview_reports?on_conflict=id", {
    method: "POST",
    token: req.auth.token,
    prefer: "resolution=merge-duplicates",
    body: {
      id: session.id,
      user_id: req.auth.user.id,
      created_at: report.createdAt,
      report,
      rubric_version: report.rubricVersion,
    },
  });
  if (!session.demo && session.kind !== "coding")
    await supabase("/rest/v1/candidate_profiles?on_conflict=user_id", {
      method: "POST",
      token: req.auth.token,
      prefer: "resolution=merge-duplicates",
      body: { user_id: req.auth.user.id, materials: session.materials },
    });
  return true;
}
export async function listReports(req) {
  const { token } = requireUser(req);
  return (
    await supabase(
      "/rest/v1/interview_reports?select=report&order=created_at.desc&limit=1000",
      { token },
    )
  ).map((r) => r.report);
}
export async function deleteReport(req, id) {
  const { token } = requireUser(req);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw failure(400, "Invalid report.");
  await supabase(`/rest/v1/interview_reports?id=eq.${id}`, {
    method: "DELETE",
    token,
  });
}
export async function profile(req, materials) {
  const { token, user } = requireUser(req);
  if (materials !== undefined) {
    await supabase("/rest/v1/candidate_profiles?on_conflict=user_id", {
      method: "POST",
      token,
      prefer: "resolution=merge-duplicates",
      body: { user_id: user.id, materials },
    });
    return materials;
  }
  return (
    (
      await supabase("/rest/v1/candidate_profiles?select=materials", { token })
    )[0]?.materials || {}
  );
}
