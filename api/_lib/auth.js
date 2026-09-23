const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 7;

// The signing key is derived from the database secret, so no separate secret has to be configured per app.
const secret = (app) =>
  crypto.createHmac("sha256", process.env.MONGODB_URI || "dev-only").update(`session-signing:${app}`).digest("hex");

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function getUser(req, app) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret(app));
    return { id: p.sub, email: p.email, name: p.name, role: p.role || "user" };
  } catch {
    return null;
  }
}

function setSession(res, app, user) {
  const token = jwt.sign(
    { sub: String(user.id), email: user.email, name: user.name, role: user.role || "user" },
    secret(app),
    { expiresIn: MAX_AGE },
  );
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE}`];
  if (process.env.VERCEL_ENV) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const hash = (password) => bcrypt.hash(password, 10);
const verify = (password, passwordHash) => bcrypt.compare(password, passwordHash);

module.exports = { getUser, setSession, clearSession, hash, verify };
