import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { failure } from "./security.js";
const scrypt = promisify(derive);
let database;
export function localDatabase() {
  if (database) return database;
  const filename =
    process.env.LOCAL_DATABASE_PATH || path.resolve(".data/ru-employed.sqlite");
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(filename);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS logins (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, materials TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, report TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS report_owner ON reports(user_id,created_at);
    CREATE TABLE IF NOT EXISTS interviews (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, lease_key TEXT, lease_until INTEGER);
  `);
  database.prepare("DELETE FROM logins WHERE expires_at < ?").run(Date.now());
  database
    .prepare("DELETE FROM interviews WHERE expires_at < ?")
    .run(Date.now());
  if (filename !== ":memory:") {
    try {
      chmodSync(filename, 0o600);
    } catch {}
  }
  return database;
}
const digest = (s) => createHash("sha256").update(s).digest("hex");
const recovery = () =>
  randomBytes(20)
    .toString("hex")
    .match(/.{1,8}/g)
    .join("-")
    .toUpperCase();
const recoveryDigest = (s) =>
  digest(
    String(s || "")
      .replace(/[-\s]/g, "")
      .toUpperCase(),
  );
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${Buffer.from(key).toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  const [salt, hash] = encoded.split(":");
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(key));
}
const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  user_metadata: { name: row.name },
});
function loginSession(user) {
  const token = randomBytes(32).toString("hex");
  localDatabase()
    .prepare("INSERT INTO logins VALUES (?,?,?)")
    .run(digest(token), user.id, Date.now() + 28 * 86400000);
  return { token, user: publicUser(user) };
}
export async function localSignup(email, name, password) {
  const db = localDatabase(),
    normalized = email.trim().toLowerCase();
  if (db.prepare("SELECT id FROM users WHERE email=?").get(normalized))
    throw failure(
      409,
      "An account already uses that email. Sign in or reset its password.",
    );
  const code = recovery(),
    row = {
      id: randomUUID(),
      email: normalized,
      name: String(name || "")
        .trim()
        .slice(0, 80),
    };
  const hash = await hashPassword(password);
  try {
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(
      row.id,
      row.email,
      row.name,
      hash,
      recoveryDigest(code),
    );
  } catch (error) {
    if (String(error.message).includes("UNIQUE"))
      throw failure(409, "An account already uses that email.");
    throw error;
  }
  return { ...loginSession(row), recoveryCode: code };
}
export async function localLogin(email, password) {
  const row = localDatabase()
    .prepare("SELECT * FROM users WHERE email=?")
    .get(email.trim().toLowerCase());
  // Run the same expensive derivation for an unknown account.
  const placeholder = "0".repeat(32) + ":" + "0".repeat(128);
  const valid = await verifyPassword(
    password,
    row?.password_hash || placeholder,
  );
  if (!row || !valid) throw failure(401, "Email or password is incorrect.");
  return loginSession(row);
}
export function localAuthenticate(token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  const row = localDatabase()
    .prepare(
      "SELECT u.* FROM users u JOIN logins l ON l.user_id=u.id WHERE l.token_hash=? AND l.expires_at>?",
    )
    .get(digest(token), Date.now());
  return row ? { kind: "local", token, user: publicUser(row) } : null;
}
export function localLogout(token) {
  if (token)
    localDatabase()
      .prepare("DELETE FROM logins WHERE token_hash=?")
      .run(digest(token));
}
export async function localReset(email, code, password) {
  const db = localDatabase(),
    row = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(email.trim().toLowerCase());
  const received = recoveryDigest(code),
    expected = row?.recovery_hash || "0".repeat(64);
  if (
    !timingSafeEqual(
      Buffer.from(received, "hex"),
      Buffer.from(expected, "hex"),
    ) ||
    !row
  )
    throw failure(401, "That email and recovery code do not match.");
  const hash = await hashPassword(password),
    newCode = recovery();
  db.exec("BEGIN IMMEDIATE");
  try {
    const updated = db
      .prepare(
        "UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?",
      )
      .run(hash, recoveryDigest(newCode), row.id, received);
    if (!updated.changes)
      throw failure(401, "This recovery code has already been used.");
    db.prepare("DELETE FROM logins WHERE user_id=?").run(row.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...loginSession(row), recoveryCode: newCode };
}
export async function localUpdate(auth, body) {
  const db = localDatabase(),
    row = db.prepare("SELECT * FROM users WHERE id=?").get(auth.user.id);
  const email = body.email?.trim().toLowerCase() || row.email,
    name = body.data?.name ?? row.name;
  const hash = body.password
    ? await hashPassword(body.password)
    : row.password_hash;
  const duplicate = db
    .prepare("SELECT id FROM users WHERE email=? AND id<>?")
    .get(email, row.id);
  if (duplicate)
    throw failure(409, "That email is already used by another account.");
  db.prepare("UPDATE users SET email=?,name=?,password_hash=? WHERE id=?").run(
    email,
    name,
    hash,
    row.id,
  );
  if (body.password)
    db.prepare("DELETE FROM logins WHERE user_id=? AND token_hash<>?").run(
      row.id,
      digest(auth.token),
    );
}
export function localProfile(userId, materials) {
  const db = localDatabase();
  if (materials !== undefined) {
    db.prepare(
      "INSERT INTO profiles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET materials=excluded.materials",
    ).run(userId, JSON.stringify(materials));
    return materials;
  }
  return JSON.parse(
    db.prepare("SELECT materials FROM profiles WHERE user_id=?").get(userId)
      ?.materials || "{}",
  );
}
export function localSaveReport(userId, report) {
  localDatabase()
    .prepare(
      "INSERT INTO reports VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET report=excluded.report WHERE reports.user_id=excluded.user_id",
    )
    .run(report.id, userId, report.createdAt, JSON.stringify(report));
}
export function localReports(userId) {
  return localDatabase()
    .prepare(
      "SELECT report FROM reports WHERE user_id=? ORDER BY created_at DESC LIMIT 1000",
    )
    .all(userId)
    .map((r) => JSON.parse(r.report));
}
export function localDeleteReport(userId, id) {
  localDatabase()
    .prepare("DELETE FROM reports WHERE id=? AND user_id=?")
    .run(id, userId);
}
export function localCreateInterview(userId, session) {
  localDatabase()
    .prepare(
      "INSERT INTO interviews (id,user_id,payload,expires_at) VALUES (?,?,?,?)",
    )
    .run(
      session.id,
      userId,
      JSON.stringify(session),
      session.startedAt + 3 * 3600000,
    );
}
export function localLoadInterview(userId, id, lease) {
  const db = localDatabase();
  if (lease) {
    const claimed = db
      .prepare(
        "UPDATE interviews SET lease_key=?,lease_until=? WHERE id=? AND user_id=? AND expires_at>? AND (lease_until IS NULL OR lease_until<?)",
      )
      .run(lease, Date.now() + 180000, id, userId, Date.now(), Date.now());
    if (!claimed.changes) {
      const existing = db
        .prepare(
          "SELECT id FROM interviews WHERE id=? AND user_id=? AND expires_at>?",
        )
        .get(id, userId, Date.now());
      if (existing)
        throw failure(409, "Your interview is processing another request.");
      throw failure(404, "Interview not found or expired.");
    }
  }
  const row = db
    .prepare(
      "SELECT payload FROM interviews WHERE id=? AND user_id=? AND expires_at>?",
    )
    .get(id, userId, Date.now());
  if (!row) throw failure(404, "Interview not found or expired.");
  return JSON.parse(row.payload);
}
export function localSaveInterview(userId, session, lease) {
  const saved = localDatabase()
    .prepare(
      "UPDATE interviews SET payload=?,lease_key=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_key=? AND lease_until>?",
    )
    .run(
      JSON.stringify({ ...session, busy: false }),
      session.id,
      userId,
      lease,
      Date.now(),
    );
  if (!saved.changes)
    throw failure(409, "The interview request expired. Please try again.");
}
