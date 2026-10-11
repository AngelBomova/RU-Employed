import express from "express";
import { cookies, setCookie, failure, rateLimit } from "./security.js";
import {
  localSignup,
  localLogin,
  localAuthenticate,
  localLogout,
  localReset,
  localUpdate,
} from "./local-db.js";
export const authMode = () =>
  process.env.AUTH_MODE === "local" ||
  !(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    ? "local"
    : "supabase";
export const hasDatabase = () => true;
const root = () => process.env.SUPABASE_URL.replace(/\/$/, "");
export async function supabase(
  path,
  { method = "GET", body, token, prefer } = {},
) {
  if (authMode() !== "supabase")
    throw failure(
      503,
      "Accounts are not connected yet. Configure Supabase to enable cloud saving and authentication.",
    );
  const res = await fetch(`${root()}${path}`, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token || process.env.SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    // Only user-facing Auth messages are allowed out; DB details stay private.
    throw failure(
      res.status === 401 || res.status === 403
        ? 401
        : res.status >= 500
          ? 503
          : 400,
      path.startsWith("/auth/")
        ? String(
            error.msg ||
              error.message ||
              error.error_description ||
              "Authentication failed. Please try again.",
          ).slice(0, 200)
        : "Cloud storage is unavailable. Check that the database migration has been applied.",
    );
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}
function writeSession(res, data) {
  setCookie(res, "ru_access", data.access_token, 28 * 86400);
  setCookie(res, "ru_refresh", data.refresh_token, 28 * 86400);
}
function clearSession(res) {
  setCookie(res, "ru_local", "", 0);
  setCookie(res, "ru_access", "", 0);
  setCookie(res, "ru_refresh", "", 0);
}
const refreshes = new Map();
export async function authenticate(req, res, next) {
  req.auth = null;
  if (authMode() === "local") {
    req.auth = localAuthenticate(cookies(req).ru_local);
    return next();
  }
  // Local sign-out must still work if the provider is temporarily unavailable.
  if (req.path === "/auth/logout") return next();
  if (!hasDatabase()) return next();
  const stored = cookies(req);
  if (!stored.ru_access && !stored.ru_refresh) return next();
  try {
    let token = stored.ru_access,
      user;
    try {
      user = token ? await supabase("/auth/v1/user", { token }) : null;
    } catch (error) {
      if (error.status !== 401) throw error;
    }
    if (!user && stored.ru_refresh) {
      let pending = refreshes.get(stored.ru_refresh);
      if (!pending) {
        pending = supabase("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          body: { refresh_token: stored.ru_refresh },
        });
        refreshes.set(stored.ru_refresh, pending);
        pending
          .finally(() => refreshes.delete(stored.ru_refresh))
          .catch(() => {});
      }
      const fresh = await pending;
      writeSession(res, fresh);
      token = fresh.access_token;
      user = fresh.user;
    }
    if (user?.id) req.auth = { token, user };
    else clearSession(res);
    next();
  } catch (error) {
    if (error.status === 401 || error.status === 400) {
      clearSession(res);
      next();
    } else next(error);
  }
}
export function requireUser(req) {
  if (!req.auth) throw failure(401, "Sign in to access your private account.");
  return req.auth;
}
export const authRouter = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const credentialLimit = rateLimit(20, 15 * 60_000);
authRouter.use((req, res, next) =>
  ["/signup", "/login", "/forgot", "/reset", "/confirm"].includes(req.path)
    ? credentialLimit(req, res, next)
    : next(),
);
authRouter.get("/me", (req, res) =>
  res.json({
    configured: hasDatabase(),
    mode: authMode(),
    user: req.auth?.user
      ? {
          id: req.auth.user.id,
          email: req.auth.user.email,
          name: req.auth.user.user_metadata?.name || "",
        }
      : null,
  }),
);
function credentials(body = {}, passwordRequired = true) {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email || "") ||
    body.email.length > 254
  )
    throw failure(400, "Enter a valid email address.");
  if (
    passwordRequired &&
    (typeof body.password !== "string" ||
      body.password.length < 10 ||
      body.password.length > 128)
  )
    throw failure(400, "Use a password between 10 and 128 characters.");
}
authRouter.post(
  "/signup",
  wrap(async (req, res) => {
    credentials(req.body);
    if (authMode() === "local") {
      const data = await localSignup(
        req.body.email,
        req.body.name,
        req.body.password,
      );
      setCookie(res, "ru_local", data.token, 28 * 86400);
      return res.json({
        signedIn: true,
        recoveryCode: data.recoveryCode,
        message: "Account created. Save your recovery code somewhere safe.",
      });
    }
    const site =
      process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`;
    const data = await supabase(
      `/auth/v1/signup?redirect_to=${encodeURIComponent(site)}`,
      {
        method: "POST",
        body: {
          email: req.body.email.trim(),
          password: req.body.password,
          data: {
            name: String(req.body.name || "")
              .trim()
              .slice(0, 80),
          },
        },
      },
    );
    if (data.access_token) writeSession(res, data);
    res.json({
      signedIn: !!data.access_token,
      message: data.access_token
        ? "Your account is ready."
        : "Check your email to confirm your account, then sign in.",
    });
  }),
);
authRouter.post(
  "/login",
  wrap(async (req, res) => {
    credentials(req.body);
    if (authMode() === "local") {
      const data = await localLogin(req.body.email, req.body.password);
      setCookie(res, "ru_local", data.token, 28 * 86400);
      return res.json({ ok: true });
    }
    const data = await supabase("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: req.body.email.trim(), password: req.body.password },
    });
    writeSession(res, data);
    res.json({ ok: true });
  }),
);
authRouter.post(
  "/logout",
  wrap(async (req, res) => {
    if (authMode() === "local") {
      localLogout(cookies(req).ru_local);
      clearSession(res);
      return res.json({ ok: true });
    }
    const token = req.auth?.token || cookies(req).ru_access;
    try {
      if (token && hasDatabase())
        await supabase("/auth/v1/logout?scope=local", {
          method: "POST",
          token,
        });
    } catch {
      /* Clear this browser's session even when remote revocation fails. */
    } finally {
      clearSession(res);
    }
    res.json({ ok: true });
  }),
);
authRouter.post(
  "/forgot",
  wrap(async (req, res) => {
    credentials(req.body, false);
    if (authMode() === "local")
      return res.json({
        message:
          "Reset your password with the recovery code you saved at signup.",
      });
    const site =
      process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`;
    await supabase(
      `/auth/v1/recover?redirect_to=${encodeURIComponent(site + "/?account=recovery")}`,
      { method: "POST", body: { email: req.body.email.trim() } },
    );
    res.json({
      message:
        "If an account exists for that email, a reset link has been requested. Check your inbox.",
    });
  }),
);
authRouter.post(
  "/reset",
  wrap(async (req, res) => {
    if (authMode() !== "local")
      throw failure(400, "Use the recovery link sent to your email.");
    credentials(req.body);
    if (
      typeof req.body.recoveryCode !== "string" ||
      req.body.recoveryCode.length > 100
    )
      throw failure(400, "Enter your saved recovery code.");
    const data = await localReset(
      req.body.email,
      req.body.recoveryCode,
      req.body.password,
    );
    setCookie(res, "ru_local", data.token, 28 * 86400);
    res.json({
      signedIn: true,
      recoveryCode: data.recoveryCode,
      message:
        "Password reset. Your old code and previous sign-ins have been revoked. Save this new recovery code.",
    });
  }),
);
// Supabase email template links use a one-time token_hash, verified server-side.
authRouter.get(
  "/confirm",
  wrap(async (req, res) => {
    const type = req.query.type;
    if (
      !["signup", "recovery", "email_change", "email"].includes(type) ||
      !/^[a-zA-Z0-9_-]{10,256}$/.test(req.query.token_hash || "")
    )
      throw failure(400, "This account link is invalid. Request a fresh link.");
    const data = await supabase("/auth/v1/verify", {
      method: "POST",
      body: { token_hash: req.query.token_hash, type },
    });
    writeSession(res, data);
    res.redirect(
      type === "recovery" ? "/?account=recovery" : "/?account=confirmed",
    );
  }),
);
authRouter.patch(
  "/account",
  wrap(async (req, res) => {
    const { token } = requireUser(req),
      body = {};
    if (req.body.password !== undefined) {
      if (
        typeof req.body.password !== "string" ||
        req.body.password.length < 10 ||
        req.body.password.length > 128
      )
        throw failure(400, "Use a password between 10 and 128 characters.");
      body.password = req.body.password;
    }
    if (req.body.name !== undefined)
      body.data = { name: String(req.body.name).trim().slice(0, 80) };
    if (req.body.email !== undefined) {
      credentials(req.body, false);
      body.email = req.body.email.trim();
    }
    if (authMode() === "local") {
      await localUpdate(req.auth, body);
      return res.json({ message: "Account updated." });
    }
    await supabase("/auth/v1/user", { method: "PUT", token, body });
    res.json({
      message: body.email
        ? "Account saved. Check your email to confirm the address change."
        : "Account updated.",
    });
  }),
);
