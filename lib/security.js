import { randomUUID } from "node:crypto";

export const failure = (status, message) =>
  Object.assign(new Error(message), { status });
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim().split(/=(.*)/s))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, v]) => {
        try {
          return [k, decodeURIComponent(v)];
        } catch {
          return [k, ""];
        }
      }),
  );
}
export function setCookie(res, name, value, maxAge) {
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}
export function securityMiddleware(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()",
  );
  res.setHeader("X-Frame-Options", "DENY");
  // GLTFLoader decodes embedded model textures through local blob URLs.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (process.env.NODE_ENV === "production")
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
    const expected =
      process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`;
    if (req.headers.origin !== new URL(expected).origin)
      return next(
        failure(403, "This request must come from your interview workspace."),
      );
  }
  next();
}
const buckets = new Map();
export function rateLimit(max, windowMs = 60_000) {
  const scope = randomUUID();
  return (req, res, next) => {
    const now = Date.now(),
      key = `${scope}:${req.ip}`,
      entry = buckets.get(key);
    const bucket =
      !entry || entry.until < now ? { count: 0, until: now + windowMs } : entry;
    bucket.count++;
    buckets.set(key, bucket);
    if (buckets.size > 10_000)
      for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
    if (bucket.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((bucket.until - now) / 1000)),
      );
      return next(
        failure(429, "Too many requests. Please wait a moment and try again."),
      );
    }
    next();
  };
}
