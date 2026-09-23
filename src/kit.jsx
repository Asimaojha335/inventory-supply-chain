import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* ---------- API ---------- */
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Please try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

/* Loads data and exposes { data, error, loading, reload, setData }. Pass poll (ms) for near-real-time refresh. */
export function useApi(path, { poll, skip } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!skip);
  const alive = useRef(true);
  const reload = useCallback(
    async (silent = false) => {
      if (skip) return;
      if (!silent) setLoading(true);
      try {
        const result = await api(path);
        if (alive.current) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (alive.current) setError(e.message);
      } finally {
        if (alive.current && !silent) setLoading(false);
      }
    },
    [path, skip],
  );
  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);
  useEffect(() => {
    if (!poll || skip) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) reload(true);
    }, poll);
    return () => clearInterval(id);
  }, [poll, reload, skip]);
  return { data, error, loading, reload, setData };
}

/* ---------- Formatting ---------- */
export const money = (n, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(n) || 0);
export const compact = (n) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n) || 0);
export const dateFmt = (d, opts = { day: "numeric", month: "short", year: "numeric" }) => (d ? new Date(d).toLocaleDateString("en-IN", opts) : "-");
export const dateTimeFmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
export const ago = (d) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const initials = (name = "") => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

/* ---------- Theme ---------- */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("theme") || ""; } catch { return ""; }
  });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    try { theme ? localStorage.setItem("theme", theme) : localStorage.removeItem("theme"); } catch { /* storage unavailable */ }
  }, [theme]);
  const dark = theme ? theme === "dark" : typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

/* ---------- Hash router ---------- */
export function useHashRoute(defaultPath = "/") {
  const read = () => window.location.hash.replace(/^#/, "") || defaultPath;
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (to) => {
    window.location.hash = to;
  };
  return { path, go };
}

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list, { id, message, kind }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Basic components ---------- */
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: "0.9rem" }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <span className="err">{error}</span>}
    </label>
  );
}

export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;
export const Loading = () => <div className="center"><Spinner /></div>;
export const Empty = ({ title, children }) => (
  <div className="empty"><b>{title}</b>{children}</div>
);
export const ErrorNote = ({ message, onRetry }) => (
  <div className="empty" role="alert"><b>{message}</b>{onRetry && <button className="btn ghost sm" onClick={onRetry}>Try again</button>}</div>
);
export const Badge = ({ kind = "", children }) => <span className={`badge ${kind}`}>{children}</span>;
export const Avatar = ({ name }) => <span className="avatar" aria-hidden="true">{initials(name)}</span>;
export const Stat = ({ label, value, hint }) => (
  <div className="card stat"><span>{label}</span><b>{value}</b>{hint && <i>{hint}</i>}</div>
);

/* ---------- Charts (dependency-free SVG) ---------- */
export function Sparkline({ values, height = 48, width = 160, color = "var(--accent)" }) {
  if (!values || values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 4 - ((v - min) / span) * (height - 8)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function BarChart({ data, height = 180, valueFormat = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 8;
  const w = 100 / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" style={{ width: "100%", height }} role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const h = (d.value / max) * (height / 2 - 14);
        return (
          <g key={d.label}>
            <rect x={i * w + gap / 10} y={height / 2 - 10 - h} width={w - gap / 5} height={h} rx="1" fill={d.color || "var(--accent)"}>
              <title>{`${d.label}: ${valueFormat(d.value)}`}</title>
            </rect>
            <text x={i * w + w / 2} y={height / 2 - 2} fontSize="3.4" textAnchor="middle" fill="var(--muted)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16"];
export function Donut({ data, size = 170, thickness = 26, center }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row wrap" style={{ gap: "1.25rem" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution chart">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const len = (d.value / total) * c;
          const el = (
            <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color || PALETTE[i % PALETTE.length]} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          );
          offset += len;
          return el;
        })}
        {center && <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="var(--text)" fontWeight="800" fontSize="16">{center}</text>}
      </svg>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
        {data.map((d, i) => (
          <li key={d.label} className="row small">
            <i style={{ width: 10, height: 10, borderRadius: 3, background: d.color || PALETTE[i % PALETTE.length], display: "inline-block" }} />
            <span>{d.label}</span>
            <b>{Math.round((d.value / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- App shell + auth ---------- */
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    api("/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  const value = useMemo(
    () => ({
      user,
      login: async (email, password) => setUser((await api("/auth/login", { method: "POST", body: { email, password } })).user),
      signup: async (form) => setUser((await api("/auth/signup", { method: "POST", body: form })).user),
      logout: async () => {
        await api("/auth/logout", { method: "POST" });
        setUser(null);
      },
      setUser,
    }),
    [user],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function AuthScreen({ title, tagline, points = [], roles, defaultRole }) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: defaultRole || (roles && roles[0] && roles[0].value) || "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await login(form.email, form.password);
      else await signup(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setBusy(true);
    setError("");
    try {
      const stamp = Math.random().toString(36).slice(2, 8);
      await signup({ name: "Demo Visitor", email: `demo-${stamp}@example.com`, password: `Demo-${stamp}-99`, role: form.role });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-screen">
      <div className="auth-hero">
        <div className="brand"><span className="brand-mark">{title[0]}</span>{title}</div>
        <h1>{tagline}</h1>
        <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul>
        <p className="small">A portfolio project by Asima Ojha. Data is stored in a public demo database, so please do not enter real personal details.</p>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div>
            <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
            <p className="muted">{mode === "login" ? "Sign in to continue." : "It takes a few seconds."}</p>
          </div>
          {mode === "signup" && <Field label="Full name"><input className="input" value={form.name} onChange={set("name")} autoComplete="name" /></Field>}
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" /></Field>
          <Field label="Password"><input className="input" type="password" value={form.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} /></Field>
          {mode === "signup" && roles && (
            <Field label="I am a">
              <select className="input" value={form.role} onChange={set("role")}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
            </Field>
          )}
          {error && <div className="badge danger" role="alert" style={{ whiteSpace: "normal" }}>{error}</div>}
          <button className="btn" disabled={busy}>{busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}</button>
          <button type="button" className="btn ghost" onClick={demo} disabled={busy}>Try it with a demo account</button>
          <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
            {mode === "login" ? "New here? " : "Already registered? "}
            <a href="#/" onClick={(e) => { e.preventDefault(); setMode(mode === "login" ? "signup" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</a>
          </p>
        </form>
      </div>
    </div>
  );
}

/* Requires sign-in, then renders the app shell (top bar, nav, theme, sign-out). */
export function AppShell({ brand, mark, nav, path, go, children }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go("/"); }}><span className="brand-mark">{mark || brand[0]}</span>{brand}</a>
          <nav className="nav" aria-label="Main">
            {nav.map((n) => (
              <a key={n.to} href={`#${n.to}`} className={path === n.to || (n.to !== "/" && path.startsWith(`${n.to}/`)) ? "active" : ""}>{n.label}</a>
            ))}
          </nav>
          <button className="icon-btn" onClick={toggle} aria-label="Toggle dark mode">{dark ? "☀" : "☾"}</button>
          <div className="row" style={{ gap: "0.5rem" }}>
            <Avatar name={user.name} />
            <button className="btn ghost sm" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = useCallback(
    async (fn, success) => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast(success);
        return result;
      } catch (e) {
        toast(e.message, "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
