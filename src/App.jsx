import { useMemo, useState } from "react";
import {
  AppShell, AuthProvider, AuthScreen, Badge, Donut, Empty, ErrorNote, Field, Loading, Modal, Stat, ToastProvider,
  ago, api, compact, dateFmt, money, useApi, useAsync, useAuth, useHashRoute,
} from "./kit.jsx";

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) {
    return (
      <AuthScreen
        title="StockFlow"
        tagline="Know what you have, where it is, and when to reorder."
        points={["Stock levels across every warehouse", "Transfers, adjustments and a full movement ledger", "Purchase orders with partial receiving", "Automatic reorder suggestions"]}
      />
    );
  }
  return <Router />;
}

const NAV = [
  { to: "/", label: "Dashboard" }, { to: "/inventory", label: "Inventory" }, { to: "/warehouses", label: "Warehouses" },
  { to: "/orders", label: "Purchase orders" }, { to: "/movements", label: "Movements" }, { to: "/suppliers", label: "Suppliers" },
];

function Router() {
  const { path, go } = useHashRoute("/");
  return (
    <AppShell brand="StockFlow" mark="S" nav={NAV} path={path} go={go}>
      {path === "/" && <Dashboard go={go} />}
      {path === "/inventory" && <Inventory />}
      {path === "/warehouses" && <Warehouses />}
      {path === "/orders" && <Orders />}
      {path === "/movements" && <Movements />}
      {path === "/suppliers" && <Suppliers />}
    </AppShell>
  );
}

const statusBadge = (s) => <Badge kind={s === "out" ? "danger" : s === "low" ? "warn" : "ok"}>{s === "ok" ? "In stock" : s === "low" ? "Low" : "Out"}</Badge>;
const numberInput = (props) => <input className="input" type="number" min="0" step="1" {...props} />;

/* ---------- Dashboard ---------- */
function FlowChart({ data }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out]));
  const w = 100 / data.length;
  return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" style={{ width: "100%", height: 190 }} role="img" aria-label="Units received and shipped per day">
      {data.map((d, i) => {
        const hi = (d.in / max) * 34;
        const ho = (d.out / max) * 34;
        return (
          <g key={d.key}>
            <rect x={i * w + w * 0.12} y={38 - hi} width={w * 0.36} height={hi} rx="0.6" fill="var(--ok)"><title>{`${d.label}: ${d.in} in`}</title></rect>
            <rect x={i * w + w * 0.52} y={38 - ho} width={w * 0.36} height={ho} rx="0.6" fill="var(--accent)"><title>{`${d.label}: ${d.out} out`}</title></rect>
            {i % 2 === 0 && <text x={i * w + w / 2} y="43" fontSize="2.6" textAnchor="middle" fill="var(--muted)">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Dashboard({ go }) {
  const { data, loading, error, reload } = useApi("/dashboard");
  const { busy, run } = useAsync();
  const [reorder, setReorder] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const empty = data.skus === 0 && data.warehouses === 0;
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Dashboard</h1><p>Everything across all of your warehouses.</p></div>
        {data.lowCount > 0 && <button className="btn" onClick={() => setReorder(true)}>Create reorder POs</button>}</div>
      {empty && (
        <div className="card row between wrap">
          <div><b>Start with sample data</b><p className="muted small" style={{ margin: 0 }}>Adds 3 warehouses, 6 products, 2 suppliers and two weeks of movements so you can explore.</p></div>
          <button className="btn" disabled={busy} onClick={async () => { await run(() => api("/demo/seed", { method: "POST" }), "Sample data loaded"); reload(); }}>Load sample data</button>
        </div>
      )}
      <div className="grid cols-4">
        <Stat label="Products" value={data.skus} hint={`${data.warehouses} warehouses`} />
        <Stat label="Units on hand" value={compact(data.units)} />
        <Stat label="Inventory value" value={money(data.value)} />
        <Stat label="Needs attention" value={data.lowCount} hint={`${data.outCount} out of stock · ${data.openOrders} open POs`} />
      </div>
      <div className="grid cols-2">
        <div className="card"><h3>Units in and out (14 days)</h3>
          <FlowChart data={data.flow} />
          <div className="row small muted"><i className="dot" style={{ background: "var(--ok)" }} /> Received <i className="dot" style={{ background: "var(--accent)" }} /> Shipped</div></div>
        <div className="card"><h3>Value by warehouse</h3>
          {data.byWarehouse.length ? <Donut data={data.byWarehouse.map((w) => ({ label: w.name, value: w.value }))} center={compact(data.value)} /> : <p className="muted">No warehouses yet.</p>}</div>
      </div>
      <div className="grid cols-2">
        <div className="card stack-sm"><h3>Low stock</h3>
          {data.lowItems.length === 0 && <p className="muted">Everything is above its reorder point.</p>}
          {data.lowItems.map((i) => (
            <div key={i.id} className="row"><div className="grow"><b>{i.name}</b> <span className="muted small mono">{i.sku}</span></div><span className="small">{i.qty} / {i.reorderPoint}</span><Badge kind={i.qty <= 0 ? "danger" : "warn"}>{i.qty <= 0 ? "Out" : "Low"}</Badge></div>
          ))}
        </div>
        <div className="card stack-sm"><div className="row between"><h3 style={{ margin: 0 }}>Recent movements</h3><a href="#/movements" onClick={() => go("/movements")}>All</a></div>
          {data.recent.length === 0 && <p className="muted">No movements yet.</p>}
          {data.recent.map((m) => <MovementRow key={m.id} m={m} />)}
        </div>
      </div>
      {reorder && <ReorderModal onClose={() => setReorder(false)} onDone={() => { setReorder(false); go("/orders"); }} />}
    </div>
  );
}

function MovementRow({ m }) {
  const kind = { receive: "ok", ship: "accent", transfer: "", adjust: "warn" }[m.type];
  const where = m.type === "transfer" ? `${m.fromName} → ${m.toName}` : m.fromName || m.toName;
  return (
    <div className="row small"><Badge kind={kind}>{m.type}</Badge><span className="grow"><b>{m.productName}</b> · {where}</span>
      <b>{m.type === "ship" ? "-" : m.qty > 0 && m.type !== "transfer" ? "+" : ""}{Math.abs(m.qty)}</b><span className="muted">{ago(m.at)}</span></div>
  );
}

function ReorderModal({ onClose, onDone }) {
  const sug = useApi("/reorder-suggestions");
  const whs = useApi("/warehouses");
  const [warehouseId, setWarehouseId] = useState("");
  const { busy, run } = useAsync();
  const wid = warehouseId || (whs.data && whs.data[0] && whs.data[0].id) || "";
  const go = async () => {
    const res = await run(() => api("/purchase-orders/from-suggestions", { method: "POST", body: { warehouseId: wid } }));
    if (res) onDone();
  };
  return (
    <Modal title="Reorder suggestions" onClose={onClose} wide>
      {!sug.data ? <Loading /> : sug.data.length === 0 ? <Empty title="Nothing to reorder">Everything low is already covered by open purchase orders.</Empty> : (
        <div className="stack-sm">
          <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th>Supplier</th><th className="num">On hand</th><th className="num">Incoming</th><th className="num">Order</th></tr></thead>
            <tbody>{sug.data.map((s) => <tr key={s.productId}><td>{s.name}</td><td>{s.supplierName}</td><td className="num">{s.qty}</td><td className="num">{s.incoming}</td><td className="num"><b>{s.suggested}</b></td></tr>)}</tbody></table></div>
          <Field label="Deliver to"><select className="input" value={wid} onChange={(e) => setWarehouseId(e.target.value)}>{(whs.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <p className="muted small">One draft purchase order is created per supplier. Products without a supplier are skipped.</p>
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={busy || !wid} onClick={go}>Create draft orders</button></div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Inventory ---------- */
function Inventory() {
  const products = useApi("/products");
  const whs = useApi("/warehouses");
  const sups = useApi("/suppliers");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => (products.data || []).filter((p) => (status === "all" || p.status === status) && `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q.toLowerCase())), [products.data, q, status]);
  const wname = (id) => (whs.data || []).find((w) => w.id === id)?.name || "?";
  if (products.loading) return <Loading />;
  if (products.error) return <ErrorNote message={products.error} onRetry={products.reload} />;
  const refresh = () => { products.reload(true); whs.reload(true); };
  const current = open && products.data.find((p) => p.id === open);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Inventory</h1><p>{products.data.length} products across {(whs.data || []).length} warehouses</p></div><button className="btn" onClick={() => setAdding(true)}>+ Add product</button></div>
      <div className="row wrap">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search name, SKU or category" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="ok">In stock</option><option value="low">Low</option><option value="out">Out of stock</option></select>
      </div>
      {rows.length === 0 ? <Empty title="No products">{products.data.length ? "Nothing matches your filters." : "Add your first product, or load the sample data from the dashboard."}</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>SKU</th><th>Product</th><th>Category</th><th className="num">On hand</th><th className="num">Reorder at</th><th className="num">Value</th><th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setOpen(p.id)}>
              <td className="mono">{p.sku}</td><td><b>{p.name}</b></td><td>{p.category}</td><td className="num">{p.qty}</td><td className="num">{p.reorderPoint}</td><td className="num">{money(p.value)}</td><td>{statusBadge(p.status)}</td>
            </tr>))}</tbody></table></div>
      )}
      {adding && <ProductForm suppliers={sups.data || []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
      {current && <ProductModal product={current} warehouses={whs.data || []} suppliers={sups.data || []} wname={wname} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}

function ProductForm({ product, suppliers, onClose, onSaved }) {
  const [f, setF] = useState(product || { sku: "", name: "", category: "", unit: "pcs", cost: "", price: "", reorderPoint: 10, supplierId: "" });
  const { busy, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const res = await run(() => api(product ? `/products/${product.id}` : "/products", { method: product ? "PATCH" : "POST", body: f }), "Saved");
    if (res) onSaved();
  };
  return (
    <Modal title={product ? "Edit product" : "Add product"} onClose={onClose}>
      <form className="stack-sm" onSubmit={save}>
        <div className="grid cols-2"><Field label="SKU"><input className="input mono" value={f.sku} onChange={set("sku")} /></Field><Field label="Name"><input className="input" value={f.name} onChange={set("name")} /></Field></div>
        <div className="grid cols-2"><Field label="Category"><input className="input" value={f.category} onChange={set("category")} /></Field><Field label="Unit"><input className="input" value={f.unit} onChange={set("unit")} /></Field></div>
        <div className="grid cols-3"><Field label="Cost"><input className="input" type="number" min="0" step="0.01" value={f.cost} onChange={set("cost")} /></Field><Field label="Price"><input className="input" type="number" min="0" step="0.01" value={f.price} onChange={set("price")} /></Field><Field label="Reorder point">{numberInput({ value: f.reorderPoint, onChange: set("reorderPoint") })}</Field></div>
        <Field label="Supplier"><select className="input" value={f.supplierId} onChange={set("supplierId")}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function ProductModal({ product, warehouses, suppliers, wname, onClose, onChanged }) {
  const [tab, setTab] = useState("levels");
  const [f, setF] = useState({ warehouseId: "", toId: "", qty: "", note: "", unitCost: "" });
  const { busy, run } = useAsync();
  const [editing, setEditing] = useState(false);
  const wid = f.warehouseId || (warehouses[0] && warehouses[0].id) || "";
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (kind, e) => {
    e.preventDefault();
    const body = { productId: product.id, warehouseId: wid, qty: f.qty, note: f.note };
    let path = `/stock/${kind}`;
    if (kind === "transfer") { body.fromId = wid; body.toId = f.toId || (warehouses.find((w) => w.id !== wid) || {}).id; }
    if (kind === "receive" && f.unitCost !== "") body.unitCost = f.unitCost;
    if (kind === "adjust") { body.newQty = f.qty; delete body.qty; }
    const res = await run(() => api(path, { method: "POST", body }), "Stock updated");
    if (res) { setF({ ...f, qty: "", note: "", unitCost: "" }); onChanged(); }
  };
  const del = async () => { if (window.confirm(`Delete ${product.name}?`) && (await run(() => api(`/products/${product.id}`, { method: "DELETE" }), "Deleted"))) { onChanged(); onClose(); } };
  if (editing) return <ProductForm product={product} suppliers={suppliers} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />;
  return (
    <Modal title={`${product.name} · ${product.sku}`} onClose={onClose} wide>
      <div className="row wrap between" style={{ marginBottom: "0.75rem" }}>
        <div className="row wrap"><Badge>{product.category}</Badge>{statusBadge(product.status)}<span className="muted small">Cost {money(product.cost)} · Price {money(product.price)}</span></div>
        <div className="row"><button className="btn ghost sm" onClick={() => setEditing(true)}>Edit</button><button className="btn ghost sm" onClick={del}>Delete</button></div>
      </div>
      <div className="tabs">{["levels", "receive", "ship", "transfer", "adjust"].map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === "levels" ? (
        <div className="stack-sm">
          {product.levels.length === 0 && <p className="muted">No stock in any warehouse yet. Use Receive to add some.</p>}
          {product.levels.map((l) => (
            <div key={l.warehouseId} className="stack-sm"><div className="row between"><b>{wname(l.warehouseId)}</b><span>{l.qty} {product.unit}</span></div><div className="progress"><i style={{ width: `${Math.min(100, (l.qty / Math.max(1, product.qty)) * 100)}%` }} /></div></div>
          ))}
          <div className="row between"><b>Total</b><b>{product.qty} {product.unit} · {money(product.value)}</b></div>
        </div>
      ) : (
        <form className="stack-sm" onSubmit={(e) => submit(tab, e)}>
          <div className="grid cols-2">
            <Field label={tab === "transfer" ? "From warehouse" : "Warehouse"}><select className="input" value={wid} onChange={set("warehouseId")}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            {tab === "transfer" && <Field label="To warehouse"><select className="input" value={f.toId} onChange={set("toId")}>{warehouses.filter((w) => w.id !== wid).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
            <Field label={tab === "adjust" ? "Counted quantity" : "Quantity"}>{numberInput({ value: f.qty, onChange: set("qty"), min: tab === "adjust" ? 0 : 1 })}</Field>
            {tab === "receive" && <Field label="Unit cost (optional)"><input className="input" type="number" min="0" step="0.01" value={f.unitCost} onChange={set("unitCost")} /></Field>}
          </div>
          <Field label="Note"><input className="input" value={f.note} onChange={set("note")} placeholder={tab === "adjust" ? "Reason, e.g. cycle count" : "Optional"} /></Field>
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={busy || warehouses.length === 0}>{tab === "adjust" ? "Set quantity" : tab[0].toUpperCase() + tab.slice(1)}</button></div>
          {warehouses.length === 0 && <p className="muted small">Add a warehouse first.</p>}
        </form>
      )}
    </Modal>
  );
}

/* ---------- Warehouses ---------- */
function Warehouses() {
  const { data, loading, error, reload } = useApi("/warehouses");
  const [editing, setEditing] = useState(null);
  const { run } = useAsync();
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const del = async (w) => { if (window.confirm(`Delete ${w.name}?`)) { await run(() => api(`/warehouses/${w.id}`, { method: "DELETE" }), "Deleted"); reload(); } };
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Warehouses</h1><p>Where your stock lives.</p></div><button className="btn" onClick={() => setEditing({})}>+ Add warehouse</button></div>
      {data.length === 0 && <Empty title="No warehouses yet">Add one to start receiving stock.</Empty>}
      <div className="auto-grid">
        {data.map((w) => (
          <div key={w.id} className="card stack-sm">
            <div className="row between"><h3 style={{ margin: 0 }}>{w.name}</h3><Badge kind="accent">{w.code}</Badge></div>
            <p className="muted small" style={{ margin: 0 }}>{w.city || "No city set"}</p>
            <div className="row between small"><span>{w.units} units</span><span>{w.skus} products</span></div>
            {w.capacity ? <><div className="progress"><i style={{ width: `${Math.min(100, (w.units / w.capacity) * 100)}%` }} /></div><span className="muted small">{Math.round((w.units / w.capacity) * 100)}% of {compact(w.capacity)} capacity</span></> : null}
            <div className="row"><button className="btn ghost sm" onClick={() => setEditing(w)}>Edit</button><button className="btn ghost sm" onClick={() => del(w)}>Delete</button></div>
          </div>
        ))}
      </div>
      {editing && <WarehouseForm warehouse={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function WarehouseForm({ warehouse, onClose, onSaved }) {
  const [f, setF] = useState(warehouse || { name: "", code: "", city: "", capacity: "" });
  const { busy, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); if (await run(() => api(warehouse ? `/warehouses/${warehouse.id}` : "/warehouses", { method: warehouse ? "PATCH" : "POST", body: f }), "Saved")) onSaved(); };
  return (
    <Modal title={warehouse ? "Edit warehouse" : "Add warehouse"} onClose={onClose}>
      <form className="stack-sm" onSubmit={save}>
        <div className="grid cols-2"><Field label="Name"><input className="input" value={f.name} onChange={set("name")} /></Field><Field label="Short code"><input className="input mono" value={f.code} onChange={set("code")} maxLength={8} /></Field></div>
        <div className="grid cols-2"><Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field><Field label="Capacity (units)">{numberInput({ value: f.capacity ?? "", onChange: set("capacity") })}</Field></div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

/* ---------- Purchase orders ---------- */
const poKind = { draft: "", ordered: "accent", partial: "warn", received: "ok", cancelled: "danger" };

function Orders() {
  const { data, loading, error, reload } = useApi("/purchase-orders");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const { run } = useAsync();
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const act = async (po, action, msg) => { await run(() => api(`/purchase-orders/${po.id}/${action}`, { method: "POST", body: {} }), msg); reload(); };
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Purchase orders</h1><p>Order from suppliers and receive into a warehouse.</p></div><button className="btn" onClick={() => setCreating(true)}>+ New order</button></div>
      {data.length === 0 ? <Empty title="No purchase orders">Create one, or use Create reorder POs on the dashboard.</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Number</th><th>Supplier</th><th>Deliver to</th><th>Expected</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((po) => (
            <tr key={po.id}><td><a href="#/orders" onClick={(e) => { e.preventDefault(); setViewing(po); }}><b>{po.number}</b></a></td><td>{po.supplierName}</td><td>{po.warehouseName}</td><td>{dateFmt(po.expectedAt)}</td><td className="num">{money(po.total)}</td><td><Badge kind={poKind[po.status]}>{po.status}</Badge></td>
              <td><div className="row" style={{ justifyContent: "flex-end" }}>
                {po.status === "draft" && <button className="btn sm" onClick={() => act(po, "order", "Order sent")}>Send</button>}
                {(po.status === "ordered" || po.status === "partial") && <button className="btn ok sm" onClick={() => act(po, "receive", "Stock received")}>Receive all</button>}
                {(po.status === "draft" || po.status === "ordered") && <button className="btn ghost sm" onClick={() => act(po, "cancel", "Order cancelled")}>Cancel</button>}
              </div></td></tr>))}</tbody></table></div>
      )}
      {creating && <OrderForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {viewing && (
        <Modal title={viewing.number} onClose={() => setViewing(null)}>
          <div className="stack-sm"><div className="row wrap"><Badge kind={poKind[viewing.status]}>{viewing.status}</Badge><span className="muted small">{viewing.supplierName} → {viewing.warehouseName}</span></div>
            <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Received</th><th className="num">Cost</th></tr></thead>
              <tbody>{viewing.lines.map((l) => <tr key={l.productId}><td>{l.name}</td><td className="num">{l.qty}</td><td className="num">{l.receivedQty}</td><td className="num">{money(l.cost)}</td></tr>)}</tbody></table></div>
            <div className="row between"><b>Total</b><b>{money(viewing.total)}</b></div></div>
        </Modal>
      )}
    </div>
  );
}

function OrderForm({ onClose, onSaved }) {
  const sups = useApi("/suppliers");
  const whs = useApi("/warehouses");
  const prods = useApi("/products");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState([{ productId: "", qty: 10, cost: "" }]);
  const { busy, run } = useAsync();
  if (!sups.data || !whs.data || !prods.data) return <Modal title="New purchase order" onClose={onClose}><Loading /></Modal>;
  const sid = supplierId || (sups.data[0] && sups.data[0].id) || "";
  const wid = warehouseId || (whs.data[0] && whs.data[0].id) || "";
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = async (e) => {
    e.preventDefault();
    const clean = lines.filter((l) => l.productId).map((l) => ({ ...l, productId: l.productId }));
    if (await run(() => api("/purchase-orders", { method: "POST", body: { supplierId: sid, warehouseId: wid, lines: clean } }), "Order created")) onSaved();
  };
  if (!sups.data.length || !whs.data.length) return <Modal title="New purchase order" onClose={onClose}><Empty title="Set things up first">You need at least one supplier and one warehouse.</Empty></Modal>;
  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <form className="stack-sm" onSubmit={save}>
        <div className="grid cols-2">
          <Field label="Supplier"><select className="input" value={sid} onChange={(e) => setSupplierId(e.target.value)}>{sups.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Deliver to"><select className="input" value={wid} onChange={(e) => setWarehouseId(e.target.value)}>{whs.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr auto", alignItems: "end" }}>
            <Field label={i === 0 ? "Product" : ""}><select className="input" value={l.productId} onChange={(e) => setLine(i, "productId", e.target.value)}><option value="">Choose...</option>{prods.data.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></Field>
            <Field label={i === 0 ? "Quantity" : ""}>{numberInput({ value: l.qty, onChange: (e) => setLine(i, "qty", e.target.value), min: 1 })}</Field>
            <Field label={i === 0 ? "Unit cost" : ""}><input className="input" type="number" min="0" step="0.01" placeholder="Default" value={l.cost} onChange={(e) => setLine(i, "cost", e.target.value)} /></Field>
            <button type="button" className="icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label="Remove line">×</button>
          </div>
        ))}
        <div className="row between"><button type="button" className="btn ghost sm" onClick={() => setLines([...lines, { productId: "", qty: 10, cost: "" }])}>+ Add line</button><button className="btn" disabled={busy}>Create draft</button></div>
      </form>
    </Modal>
  );
}

/* ---------- Movements ---------- */
function Movements() {
  const [type, setType] = useState("");
  const { data, loading, error, reload } = useApi(`/movements?limit=100${type ? `&type=${type}` : ""}`);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Movements</h1><p>Every change to stock, newest first.</p></div>
        <select className="input" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option><option value="receive">Received</option><option value="ship">Shipped</option><option value="transfer">Transfers</option><option value="adjust">Adjustments</option></select></div>
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && data.length === 0 && <Empty title="No movements">Stock changes will appear here.</Empty>}
      {data && data.length > 0 && (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Type</th><th>Product</th><th>Location</th><th className="num">Qty</th><th>By</th><th>Note</th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.id}><td className="small">{new Date(m.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td><Badge kind={{ receive: "ok", ship: "accent", transfer: "", adjust: "warn" }[m.type]}>{m.type}</Badge></td>
              <td><b>{m.productName}</b> <span className="muted small mono">{m.sku}</span></td><td className="small">{m.type === "transfer" ? `${m.fromName} → ${m.toName}` : m.fromName || m.toName}</td><td className="num">{m.qty > 0 && m.type === "adjust" ? "+" : ""}{m.qty}</td><td className="small">{m.userName}</td><td className="small muted">{m.note}</td></tr>))}</tbody></table></div>
      )}
    </div>
  );
}

/* ---------- Suppliers ---------- */
function Suppliers() {
  const { data, loading, error, reload } = useApi("/suppliers");
  const [editing, setEditing] = useState(null);
  const { run } = useAsync();
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const del = async (s) => { if (window.confirm(`Delete ${s.name}?`)) { await run(() => api(`/suppliers/${s.id}`, { method: "DELETE" }), "Deleted"); reload(); } };
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Suppliers</h1><p>Who you buy from and how long they take.</p></div><button className="btn" onClick={() => setEditing({})}>+ Add supplier</button></div>
      {data.length === 0 ? <Empty title="No suppliers yet">Add one so products can be reordered.</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Email</th><th className="num">Lead time</th><th /></tr></thead>
          <tbody>{data.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.email || "-"}</td><td className="num">{s.leadDays} days</td><td><div className="row" style={{ justifyContent: "flex-end" }}><button className="btn ghost sm" onClick={() => setEditing(s)}>Edit</button><button className="btn ghost sm" onClick={() => del(s)}>Delete</button></div></td></tr>)}</tbody></table></div>
      )}
      {editing && <SupplierForm supplier={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function SupplierForm({ supplier, onClose, onSaved }) {
  const [f, setF] = useState(supplier || { name: "", email: "", leadDays: 7 });
  const { busy, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); if (await run(() => api(supplier ? `/suppliers/${supplier.id}` : "/suppliers", { method: supplier ? "PATCH" : "POST", body: f }), "Saved")) onSaved(); };
  return (
    <Modal title={supplier ? "Edit supplier" : "Add supplier"} onClose={onClose}>
      <form className="stack-sm" onSubmit={save}>
        <Field label="Name"><input className="input" value={f.name} onChange={set("name")} /></Field>
        <div className="grid cols-2"><Field label="Email"><input className="input" type="email" value={f.email} onChange={set("email")} /></Field><Field label="Lead time (days)">{numberInput({ value: f.leadDays, onChange: set("leadDays") })}</Field></div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
