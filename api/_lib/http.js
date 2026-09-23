const { ObjectId } = require("mongodb");
const { getDb } = require("./db");
const { getUser } = require("./auth");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);
const unauthorized = (m = "Please sign in.") => new HttpError(401, m);
const forbidden = (m = "You do not have access to that.") => new HttpError(403, m);
const notFound = (m = "Not found.") => new HttpError(404, m);
const conflict = (m) => new HttpError(409, m);

function oid(value) {
  const text = String(value || "");
  if (!ObjectId.isValid(text) || String(new ObjectId(text)) !== text) throw bad("Invalid id.");
  return new ObjectId(text);
}

function clean(doc) {
  if (!doc) return doc;
  const { _id, passwordHash, ...rest } = doc;
  return { id: String(_id), ...rest };
}

function str(value, { min = 0, max = 200, label = "Value" } = {}) {
  const text = String(value == null ? "" : value).trim();
  if (text.length < min) throw bad(min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
  return text.slice(0, max);
}

function num(value, { min = -Infinity, max = Infinity, label = "Number", int = false } = {}) {
  const n = Number(value);
  if (value === "" || value == null || !Number.isFinite(n)) throw bad(`${label} must be a number.`);
  if (int && !Number.isInteger(n)) throw bad(`${label} must be a whole number.`);
  if (n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
  return n;
}

function oneOf(value, allowed, label = "Value") {
  if (!allowed.includes(value)) throw bad(`${label} must be one of: ${allowed.join(", ")}.`);
  return value;
}

const hits = new Map();
function rateLimit(req, key, limit, windowMs) {
  const ip = String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "unknown")
    .split(",")[0]
    .trim();
  const id = `${key}:${ip}`;
  const now = Date.now();
  const entry = (hits.get(id) || []).filter((t) => now - t < windowMs);
  if (entry.length >= limit) throw new HttpError(429, "Too many attempts. Please wait a moment and try again.");
  entry.push(now);
  hits.set(id, entry);
  if (hits.size > 5000) hits.clear();
}

const created = (body) => ({ __status: 201, body });

function createApp({ app, dbName, setup }) {
  const routes = [];
  const add = (method, path, opts, handler) => {
    if (typeof opts === "function") {
      handler = opts;
      opts = {};
    }
    const keys = [];
    const source = path.replace(/:([a-zA-Z]+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });
    routes.push({ method, re: new RegExp(`^${source}/?$`), keys, opts, handler });
  };

  let setupDone = null;
  const instance = {
    app,
    db: () => getDb(dbName),
    get: (p, o, h) => add("GET", p, o, h),
    post: (p, o, h) => add("POST", p, o, h),
    put: (p, o, h) => add("PUT", p, o, h),
    patch: (p, o, h) => add("PATCH", p, o, h),
    delete: (p, o, h) => add("DELETE", p, o, h),
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        // vercel.json rewrites /api/* to /api/index?__p=<path>; direct calls (tests, local server) use the URL path.
        const rewritten = url.searchParams.get("__p");
        url.searchParams.delete("__p");
        const path = rewritten !== null ? `/${rewritten.replace(/^\/+/, "")}` : url.pathname.replace(/^\/api/, "") || "/";
        const route = routes.find((r) => r.method === req.method && r.re.test(path));
        if (!route) {
          if (routes.some((r) => r.re.test(path))) throw new HttpError(405, "Method not allowed.");
          throw notFound("No such endpoint.");
        }
        const match = path.match(route.re);
        const params = {};
        route.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])));
        let body = req.body;
        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch {
            body = {};
          }
        }
        const db = await instance.db();
        if (setup && !setupDone) {
          setupDone = Promise.resolve(setup(db)).catch((e) => {
            setupDone = null;
            throw e;
          });
        }
        if (setup) await setupDone;
        const user = getUser(req, app);
        if (route.opts.auth && !user) throw unauthorized();
        const query = Object.fromEntries(url.searchParams.entries());
        const ctx = { req, res, db, params, query, body: body && typeof body === "object" ? body : {}, user };
        const data = await route.handler(ctx);
        if (!res.writableEnded) {
          res.setHeader("Cache-Control", "no-store");
          if (data && data.__status) res.status(data.__status).json(data.body);
          else res.status(200).json(data === undefined ? { ok: true } : data);
        }
      } catch (err) {
        if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
        if (err && err.code === 11000) return res.status(409).json({ error: "That already exists." });
        console.error(err);
        res.status(500).json({ error: "Something went wrong on the server." });
      }
    },
  };
  return instance;
}

module.exports = {
  createApp,
  HttpError,
  bad,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  oid,
  clean,
  str,
  num,
  oneOf,
  rateLimit,
  created,
};
