const { ObjectId } = require("mongodb");
const { bad, conflict, str, rateLimit, HttpError, created } = require("./http");
const { setSession, clearSession, hash, verify } = require("./auth");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Adds /auth/signup, /auth/login, /auth/logout and /auth/me.
// `extra(body)` may return additional user fields (for example a role); `roles` limits which roles a signup may pick.
function addAuthRoutes(app, { extra = () => ({}), roles } = {}) {
  let indexed = false;
  const users = async (db) => {
    const col = db.collection("users");
    if (!indexed) {
      await col.createIndex({ email: 1 }, { unique: true });
      indexed = true;
    }
    return col;
  };
  const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role || "user" });

  app.post("/auth/signup", async ({ req, res, db, body }) => {
    rateLimit(req, "signup", 10, 10 * 60 * 1000);
    const name = str(body.name, { min: 2, max: 80, label: "Name" });
    const email = str(body.email, { min: 1, max: 200, label: "Email" }).toLowerCase();
    const password = String(body.password || "");
    if (!EMAIL.test(email)) throw bad("Enter a valid email address.");
    if (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      throw bad("Password must be at least 8 characters and include a letter and a number.");
    }
    const col = await users(db);
    if (await col.findOne({ email })) throw conflict("An account with that email already exists.");
    const fields = extra(body);
    if (roles && fields.role && !roles.includes(fields.role)) throw bad("Invalid role.");
    const doc = { name, email, passwordHash: await hash(password), createdAt: new Date(), ...fields };
    const { insertedId } = await col.insertOne(doc);
    const user = publicUser({ ...doc, _id: insertedId });
    setSession(res, app.app, user);
    return created({ user });
  });

  app.post("/auth/login", async ({ req, res, db, body }) => {
    rateLimit(req, "login", 20, 10 * 60 * 1000);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const found = await (await users(db)).findOne({ email });
    const ok = found && (await verify(password, found.passwordHash));
    if (!ok) throw new HttpError(401, "That email or password is incorrect.");
    const user = publicUser(found);
    setSession(res, app.app, user);
    return { user };
  });

  app.post("/auth/logout", async ({ res }) => {
    clearSession(res);
    return { ok: true };
  });

  app.get("/auth/me", async ({ db, user }) => {
    if (!user) throw new HttpError(401, "Not signed in.");
    const found = await (await users(db)).findOne({ _id: new ObjectId(user.id) });
    if (!found) throw new HttpError(401, "Not signed in.");
    return { user: publicUser(found) };
  });

  return { users, publicUser };
}

module.exports = { addAuthRoutes };
