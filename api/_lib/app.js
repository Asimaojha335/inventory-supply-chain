const { createApp, bad, notFound, oid, clean, str, num, oneOf, created } = require("./http");
const { addAuthRoutes } = require("./authRoutes");

const app = createApp({
  app: "inventory-supply-chain",
  dbName: "inventory_supply_chain",
  setup: async (db) => {
    await db.collection("levels").createIndex({ ownerId: 1, productId: 1, warehouseId: 1 }, { unique: true });
    await db.collection("products").createIndex({ ownerId: 1, sku: 1 }, { unique: true });
    await db.collection("movements").createIndex({ ownerId: 1, at: -1 });
  },
});
addAuthRoutes(app);

const owned = (user, extra = {}) => ({ ownerId: user.id, ...extra });
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------- lookups ---------- */
async function getOwned(db, collection, id, user, label) {
  const doc = await db.collection(collection).findOne({ _id: oid(id), ownerId: user.id });
  if (!doc) throw notFound(`${label} not found.`);
  return doc;
}

async function stockOf(db, user, productId, warehouseId) {
  const row = await db.collection("levels").findOne({ ownerId: user.id, productId, warehouseId });
  return row ? row.qty : 0;
}

async function totals(db, user) {
  const rows = await db.collection("levels").aggregate([{ $match: { ownerId: user.id, qty: { $gt: 0 } } }, { $group: { _id: "$productId", qty: { $sum: "$qty" } } }]).toArray();
  return new Map(rows.map((r) => [r._id, r.qty]));
}

async function log(db, user, entry) {
  await db.collection("movements").insertOne({ ownerId: user.id, userName: user.name, at: new Date(), ...entry });
}

/* ---------- atomic stock primitives (never lets a level go below zero) ---------- */
async function addStock(db, user, productId, warehouseId, qty) {
  await db.collection("levels").updateOne(
    { ownerId: user.id, productId, warehouseId },
    { $inc: { qty }, $setOnInsert: { ownerId: user.id, productId, warehouseId } },
    { upsert: true },
  );
}

async function removeStock(db, user, productId, warehouseId, qty) {
  const res = await db.collection("levels").updateOne({ ownerId: user.id, productId, warehouseId, qty: { $gte: qty } }, { $inc: { qty: -qty } });
  if (!res.modifiedCount) {
    const have = await stockOf(db, user, productId, warehouseId);
    throw bad(`Not enough stock: only ${have} available in that warehouse.`);
  }
}

const qtyOf = (v) => num(v, { min: 1, max: 1000000, int: true, label: "Quantity" });

/* ---------- warehouses ---------- */
app.get("/warehouses", { auth: true }, async ({ db, user }) => {
  const [list, levels] = await Promise.all([
    db.collection("warehouses").find({ ownerId: user.id }).sort({ name: 1 }).toArray(),
    db.collection("levels").aggregate([{ $match: { ownerId: user.id, qty: { $gt: 0 } } }, { $group: { _id: "$warehouseId", units: { $sum: "$qty" }, skus: { $sum: 1 } } }]).toArray(),
  ]);
  const by = new Map(levels.map((l) => [l._id, l]));
  return list.map((w) => ({ ...clean(w), units: (by.get(String(w._id)) || {}).units || 0, skus: (by.get(String(w._id)) || {}).skus || 0 }));
});

function warehouseFields(body) {
  return {
    name: str(body.name, { min: 2, max: 60, label: "Name" }),
    code: str(body.code, { min: 2, max: 8, label: "Code" }).toUpperCase(),
    city: str(body.city, { max: 60 }),
    capacity: body.capacity === "" || body.capacity == null ? null : num(body.capacity, { min: 1, max: 100000000, int: true, label: "Capacity" }),
  };
}

app.post("/warehouses", { auth: true }, async ({ db, user, body }) => {
  const doc = { ...owned(user), ...warehouseFields(body), createdAt: new Date() };
  if (await db.collection("warehouses").findOne({ ownerId: user.id, code: doc.code })) throw bad("That warehouse code is already used.");
  const { insertedId } = await db.collection("warehouses").insertOne(doc);
  return created(clean({ _id: insertedId, ...doc }));
});

app.patch("/warehouses/:id", { auth: true }, async ({ db, user, params, body }) => {
  const w = await getOwned(db, "warehouses", params.id, user, "Warehouse");
  const set = warehouseFields({ ...w, ...body });
  await db.collection("warehouses").updateOne({ _id: w._id }, { $set: set });
  return clean({ ...w, ...set });
});

app.delete("/warehouses/:id", { auth: true }, async ({ db, user, params }) => {
  const w = await getOwned(db, "warehouses", params.id, user, "Warehouse");
  if (await db.collection("levels").findOne({ ownerId: user.id, warehouseId: String(w._id), qty: { $gt: 0 } })) throw bad("Move or ship out the stock in this warehouse before deleting it.");
  await db.collection("levels").deleteMany({ ownerId: user.id, warehouseId: String(w._id) });
  await db.collection("warehouses").deleteOne({ _id: w._id });
  return { ok: true };
});

/* ---------- suppliers ---------- */
app.get("/suppliers", { auth: true }, async ({ db, user }) => (await db.collection("suppliers").find({ ownerId: user.id }).sort({ name: 1 }).toArray()).map(clean));

const supplierFields = (b) => ({ name: str(b.name, { min: 2, max: 80, label: "Name" }), email: str(b.email, { max: 120 }), leadDays: num(b.leadDays === undefined || b.leadDays === "" ? 7 : b.leadDays, { min: 0, max: 365, int: true, label: "Lead time" }) });

app.post("/suppliers", { auth: true }, async ({ db, user, body }) => {
  const doc = { ...owned(user), ...supplierFields(body), createdAt: new Date() };
  const { insertedId } = await db.collection("suppliers").insertOne(doc);
  return created(clean({ _id: insertedId, ...doc }));
});

app.patch("/suppliers/:id", { auth: true }, async ({ db, user, params, body }) => {
  const s = await getOwned(db, "suppliers", params.id, user, "Supplier");
  const set = supplierFields({ ...s, ...body });
  await db.collection("suppliers").updateOne({ _id: s._id }, { $set: set });
  return clean({ ...s, ...set });
});

app.delete("/suppliers/:id", { auth: true }, async ({ db, user, params }) => {
  const s = await getOwned(db, "suppliers", params.id, user, "Supplier");
  if (await db.collection("products").findOne({ ownerId: user.id, supplierId: String(s._id) })) throw bad("Some products still use this supplier.");
  await db.collection("suppliers").deleteOne({ _id: s._id });
  return { ok: true };
});

/* ---------- products ---------- */
function productFields(b) {
  return {
    sku: str(b.sku, { min: 2, max: 30, label: "SKU" }).toUpperCase(),
    name: str(b.name, { min: 2, max: 100, label: "Name" }),
    category: str(b.category, { max: 40 }) || "General",
    unit: str(b.unit, { max: 12 }) || "pcs",
    cost: num(b.cost, { min: 0, max: 100000000, label: "Cost" }),
    price: num(b.price, { min: 0, max: 100000000, label: "Price" }),
    reorderPoint: num(b.reorderPoint === undefined || b.reorderPoint === "" ? 10 : b.reorderPoint, { min: 0, max: 1000000, int: true, label: "Reorder point" }),
    supplierId: str(b.supplierId, { max: 30 }),
  };
}

const statusFor = (qty, reorder) => (qty <= 0 ? "out" : qty <= reorder ? "low" : "ok");

app.get("/products", { auth: true }, async ({ db, user }) => {
  const [list, levels] = await Promise.all([
    db.collection("products").find({ ownerId: user.id }).sort({ name: 1 }).toArray(),
    db.collection("levels").find({ ownerId: user.id, qty: { $gt: 0 } }).toArray(),
  ]);
  const by = new Map();
  levels.forEach((l) => by.set(l.productId, [...(by.get(l.productId) || []), { warehouseId: l.warehouseId, qty: l.qty }]));
  return list.map((p) => {
    const lv = by.get(String(p._id)) || [];
    const qty = lv.reduce((s, l) => s + l.qty, 0);
    return { ...clean(p), qty, levels: lv, status: statusFor(qty, p.reorderPoint), value: round2(qty * p.cost) };
  });
});

app.post("/products", { auth: true }, async ({ db, user, body }) => {
  const doc = { ...owned(user), ...productFields(body), createdAt: new Date() };
  if (await db.collection("products").findOne({ ownerId: user.id, sku: doc.sku })) throw bad("That SKU already exists.");
  const { insertedId } = await db.collection("products").insertOne(doc);
  return created(clean({ _id: insertedId, ...doc }));
});

app.patch("/products/:id", { auth: true }, async ({ db, user, params, body }) => {
  const p = await getOwned(db, "products", params.id, user, "Product");
  const set = productFields({ ...p, ...body });
  const clash = await db.collection("products").findOne({ ownerId: user.id, sku: set.sku, _id: { $ne: p._id } });
  if (clash) throw bad("That SKU already exists.");
  await db.collection("products").updateOne({ _id: p._id }, { $set: set });
  return clean({ ...p, ...set });
});

app.delete("/products/:id", { auth: true }, async ({ db, user, params }) => {
  const p = await getOwned(db, "products", params.id, user, "Product");
  if ((await totals(db, user)).get(String(p._id))) throw bad("This product still has stock. Ship it out or adjust it to zero first.");
  await db.collection("levels").deleteMany({ ownerId: user.id, productId: String(p._id) });
  await db.collection("products").deleteOne({ _id: p._id });
  return { ok: true };
});

/* ---------- stock operations ---------- */
async function pair(db, user, productId, warehouseId) {
  const [product, warehouse] = await Promise.all([getOwned(db, "products", productId, user, "Product"), getOwned(db, "warehouses", warehouseId, user, "Warehouse")]);
  return { product, warehouse };
}

async function receiveInto(db, user, product, warehouse, qty, unitCost, note, ref) {
  // weighted-average cost across everything on hand
  const onHand = (await totals(db, user)).get(String(product._id)) || 0;
  const cost = unitCost != null ? round2((onHand * product.cost + qty * unitCost) / (onHand + qty)) : product.cost;
  await addStock(db, user, String(product._id), String(warehouse._id), qty);
  if (cost !== product.cost) await db.collection("products").updateOne({ _id: product._id }, { $set: { cost } });
  await log(db, user, { type: "receive", productId: String(product._id), productName: product.name, sku: product.sku, toWarehouseId: String(warehouse._id), toName: warehouse.name, qty, note, ref });
}

app.post("/stock/receive", { auth: true }, async ({ db, user, body }) => {
  const { product, warehouse } = await pair(db, user, body.productId, body.warehouseId);
  const qty = qtyOf(body.qty);
  const unitCost = body.unitCost === undefined || body.unitCost === "" ? null : num(body.unitCost, { min: 0, label: "Unit cost" });
  await receiveInto(db, user, product, warehouse, qty, unitCost, str(body.note, { max: 200 }));
  return { ok: true, qty: await stockOf(db, user, String(product._id), String(warehouse._id)) };
});

app.post("/stock/ship", { auth: true }, async ({ db, user, body }) => {
  const { product, warehouse } = await pair(db, user, body.productId, body.warehouseId);
  const qty = qtyOf(body.qty);
  await removeStock(db, user, String(product._id), String(warehouse._id), qty);
  await log(db, user, { type: "ship", productId: String(product._id), productName: product.name, sku: product.sku, fromWarehouseId: String(warehouse._id), fromName: warehouse.name, qty, note: str(body.note, { max: 200 }) });
  return { ok: true, qty: await stockOf(db, user, String(product._id), String(warehouse._id)) };
});

app.post("/stock/transfer", { auth: true }, async ({ db, user, body }) => {
  if (body.fromId === body.toId) throw bad("Pick two different warehouses.");
  const { product, warehouse: from } = await pair(db, user, body.productId, body.fromId);
  const to = await getOwned(db, "warehouses", body.toId, user, "Destination warehouse");
  const qty = qtyOf(body.qty);
  await removeStock(db, user, String(product._id), String(from._id), qty);
  try {
    await addStock(db, user, String(product._id), String(to._id), qty);
  } catch (e) {
    await addStock(db, user, String(product._id), String(from._id), qty);
    throw e;
  }
  await log(db, user, { type: "transfer", productId: String(product._id), productName: product.name, sku: product.sku, fromWarehouseId: String(from._id), fromName: from.name, toWarehouseId: String(to._id), toName: to.name, qty, note: str(body.note, { max: 200 }) });
  return { ok: true };
});

app.post("/stock/adjust", { auth: true }, async ({ db, user, body }) => {
  const { product, warehouse } = await pair(db, user, body.productId, body.warehouseId);
  const target = num(body.newQty, { min: 0, max: 1000000, int: true, label: "New quantity" });
  const before = await stockOf(db, user, String(product._id), String(warehouse._id));
  await db.collection("levels").updateOne(
    { ownerId: user.id, productId: String(product._id), warehouseId: String(warehouse._id) },
    { $set: { qty: target }, $setOnInsert: { ownerId: user.id, productId: String(product._id), warehouseId: String(warehouse._id) } },
    { upsert: true },
  );
  await log(db, user, { type: "adjust", productId: String(product._id), productName: product.name, sku: product.sku, toWarehouseId: String(warehouse._id), toName: warehouse.name, qty: target - before, note: str(body.note, { max: 200 }) || "Stock count" });
  return { ok: true, before, after: target };
});

app.get("/movements", { auth: true }, async ({ db, user, query }) => {
  const filter = { ownerId: user.id };
  if (query.productId) filter.productId = String(query.productId);
  if (query.type) filter.type = oneOf(query.type, ["receive", "ship", "transfer", "adjust"], "Type");
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 60));
  return (await db.collection("movements").find(filter).sort({ at: -1 }).limit(limit).toArray()).map(clean);
});

/* ---------- purchase orders ---------- */
const poNumber = async (db, user) => `PO-${String((await db.collection("purchaseOrders").countDocuments({ ownerId: user.id })) + 1001)}`;

function poLines(lines, products) {
  if (!Array.isArray(lines) || !lines.length) throw bad("Add at least one line.");
  return lines.slice(0, 50).map((l) => {
    const product = products.get(String(l.productId));
    if (!product) throw bad("A line refers to an unknown product.");
    return { productId: String(product._id), sku: product.sku, name: product.name, qty: qtyOf(l.qty), cost: l.cost === undefined || l.cost === "" ? product.cost : num(l.cost, { min: 0, label: "Cost" }), receivedQty: 0 };
  });
}

app.get("/purchase-orders", { auth: true }, async ({ db, user }) => {
  const [list, suppliers, whs] = await Promise.all([
    db.collection("purchaseOrders").find({ ownerId: user.id }).sort({ createdAt: -1 }).toArray(),
    db.collection("suppliers").find({ ownerId: user.id }).toArray(),
    db.collection("warehouses").find({ ownerId: user.id }).toArray(),
  ]);
  const sn = new Map(suppliers.map((s) => [String(s._id), s.name]));
  const wn = new Map(whs.map((w) => [String(w._id), w.name]));
  return list.map((po) => ({ ...clean(po), supplierName: sn.get(po.supplierId) || "Unknown", warehouseName: wn.get(po.warehouseId) || "Unknown", total: round2(po.lines.reduce((s, l) => s + l.qty * l.cost, 0)) }));
});

app.post("/purchase-orders", { auth: true }, async ({ db, user, body }) => {
  const supplier = await getOwned(db, "suppliers", body.supplierId, user, "Supplier");
  const warehouse = await getOwned(db, "warehouses", body.warehouseId, user, "Warehouse");
  const products = new Map((await db.collection("products").find({ ownerId: user.id }).toArray()).map((p) => [String(p._id), p]));
  const doc = {
    ...owned(user), number: await poNumber(db, user), supplierId: String(supplier._id), warehouseId: String(warehouse._id),
    status: "draft", lines: poLines(body.lines, products), createdAt: new Date(), expectedAt: new Date(Date.now() + supplier.leadDays * 86400000),
  };
  const { insertedId } = await db.collection("purchaseOrders").insertOne(doc);
  return created(clean({ _id: insertedId, ...doc }));
});

async function loadPO(db, user, id) {
  return getOwned(db, "purchaseOrders", id, user, "Purchase order");
}

app.post("/purchase-orders/:id/order", { auth: true }, async ({ db, user, params }) => {
  const po = await loadPO(db, user, params.id);
  if (po.status !== "draft") throw bad("Only draft orders can be sent.");
  await db.collection("purchaseOrders").updateOne({ _id: po._id }, { $set: { status: "ordered", orderedAt: new Date() } });
  return { ok: true };
});

app.post("/purchase-orders/:id/cancel", { auth: true }, async ({ db, user, params }) => {
  const po = await loadPO(db, user, params.id);
  if (!["draft", "ordered"].includes(po.status)) throw bad("This order can no longer be cancelled.");
  if (po.lines.some((l) => l.receivedQty > 0)) throw bad("Part of this order was already received.");
  await db.collection("purchaseOrders").updateOne({ _id: po._id }, { $set: { status: "cancelled" } });
  return { ok: true };
});

// body.lines is optional: [{ productId, qty }] for a partial receipt; without it every outstanding line is received in full.
app.post("/purchase-orders/:id/receive", { auth: true }, async ({ db, user, params, body }) => {
  const po = await loadPO(db, user, params.id);
  if (!["ordered", "partial"].includes(po.status)) throw bad("Send the order before receiving it.");
  const warehouse = await getOwned(db, "warehouses", po.warehouseId, user, "Warehouse");
  const wanted = new Map((Array.isArray(body.lines) ? body.lines : po.lines.map((l) => ({ productId: l.productId, qty: l.qty - l.receivedQty }))).map((l) => [String(l.productId), Number(l.qty) || 0]));
  const lines = po.lines.map((l) => ({ ...l }));
  let received = 0;
  for (const line of lines) {
    const qty = Math.min(wanted.get(line.productId) || 0, line.qty - line.receivedQty);
    if (qty <= 0) continue;
    const product = await db.collection("products").findOne({ _id: oid(line.productId), ownerId: user.id });
    if (!product) continue;
    await receiveInto(db, user, product, warehouse, qty, line.cost, `Received on ${po.number}`, po.number);
    line.receivedQty += qty;
    received += qty;
  }
  if (!received) throw bad("Nothing to receive.");
  const done = lines.every((l) => l.receivedQty >= l.qty);
  await db.collection("purchaseOrders").updateOne({ _id: po._id }, { $set: { lines, status: done ? "received" : "partial", receivedAt: done ? new Date() : null } });
  return { ok: true, status: done ? "received" : "partial", received };
});

/* ---------- reorder suggestions ---------- */
async function suggestions(db, user) {
  const [products, tot, suppliers] = await Promise.all([db.collection("products").find({ ownerId: user.id }).toArray(), totals(db, user), db.collection("suppliers").find({ ownerId: user.id }).toArray()]);
  const sn = new Map(suppliers.map((s) => [String(s._id), s.name]));
  const openQty = new Map();
  for (const po of await db.collection("purchaseOrders").find({ ownerId: user.id, status: { $in: ["draft", "ordered", "partial"] } }).toArray()) {
    po.lines.forEach((l) => openQty.set(l.productId, (openQty.get(l.productId) || 0) + (l.qty - l.receivedQty)));
  }
  return products
    .map((p) => {
      const qty = tot.get(String(p._id)) || 0;
      const incoming = openQty.get(String(p._id)) || 0;
      const need = p.reorderPoint * 2 - (qty + incoming);
      return { product: p, qty, incoming, need };
    })
    .filter((x) => x.qty + x.incoming <= x.product.reorderPoint && x.need > 0)
    .map((x) => ({ productId: String(x.product._id), sku: x.product.sku, name: x.product.name, qty: x.qty, incoming: x.incoming, reorderPoint: x.product.reorderPoint, suggested: x.need, cost: x.product.cost, supplierId: x.product.supplierId, supplierName: sn.get(x.product.supplierId) || "No supplier" }));
}

app.get("/reorder-suggestions", { auth: true }, async ({ db, user }) => suggestions(db, user));

app.post("/purchase-orders/from-suggestions", { auth: true }, async ({ db, user, body }) => {
  const warehouse = await getOwned(db, "warehouses", body.warehouseId, user, "Warehouse");
  const items = (await suggestions(db, user)).filter((s) => s.supplierId);
  if (!items.length) throw bad("Nothing needs reordering, or the low products have no supplier assigned.");
  const groups = new Map();
  items.forEach((s) => groups.set(s.supplierId, [...(groups.get(s.supplierId) || []), s]));
  const madeIds = [];
  for (const [supplierId, list] of groups) {
    const supplier = await db.collection("suppliers").findOne({ _id: oid(supplierId), ownerId: user.id });
    if (!supplier) continue;
    const doc = {
      ...owned(user), number: await poNumber(db, user), supplierId, warehouseId: String(warehouse._id), status: "draft", createdAt: new Date(),
      expectedAt: new Date(Date.now() + supplier.leadDays * 86400000),
      lines: list.map((s) => ({ productId: s.productId, sku: s.sku, name: s.name, qty: s.suggested, cost: s.cost, receivedQty: 0 })),
    };
    const { insertedId } = await db.collection("purchaseOrders").insertOne(doc);
    madeIds.push(String(insertedId));
  }
  return created({ created: madeIds.length, ids: madeIds });
});

/* ---------- dashboard ---------- */
app.get("/dashboard", { auth: true }, async ({ db, user }) => {
  const [products, warehouses, levels, movements, pos] = await Promise.all([
    db.collection("products").find({ ownerId: user.id }).toArray(),
    db.collection("warehouses").find({ ownerId: user.id }).toArray(),
    db.collection("levels").find({ ownerId: user.id, qty: { $gt: 0 } }).toArray(),
    db.collection("movements").find({ ownerId: user.id }).sort({ at: -1 }).limit(400).toArray(),
    db.collection("purchaseOrders").find({ ownerId: user.id }).toArray(),
  ]);
  const pmap = new Map(products.map((p) => [String(p._id), p]));
  const tot = new Map();
  const perWh = new Map(warehouses.map((w) => [String(w._id), { id: String(w._id), name: w.name, units: 0, value: 0 }]));
  let units = 0;
  let value = 0;
  for (const l of levels) {
    const p = pmap.get(l.productId);
    if (!p) continue;
    tot.set(l.productId, (tot.get(l.productId) || 0) + l.qty);
    units += l.qty;
    value += l.qty * p.cost;
    const w = perWh.get(l.warehouseId);
    if (w) { w.units += l.qty; w.value += l.qty * p.cost; }
  }
  const low = products.map((p) => ({ p, qty: tot.get(String(p._id)) || 0 })).filter((x) => x.qty <= x.p.reorderPoint);
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ key: d.toISOString().slice(0, 10), label: `${d.getDate()}/${d.getMonth() + 1}`, in: 0, out: 0 });
  }
  const idx = new Map(days.map((d) => [d.key, d]));
  for (const m of movements) {
    const d = idx.get(new Date(new Date(m.at).setHours(0, 0, 0, 0)).toISOString().slice(0, 10));
    if (!d) continue;
    if (m.type === "receive" || (m.type === "adjust" && m.qty > 0)) d.in += Math.abs(m.qty);
    if (m.type === "ship" || (m.type === "adjust" && m.qty < 0)) d.out += Math.abs(m.qty);
  }
  return {
    skus: products.length, warehouses: warehouses.length, units, value: round2(value),
    lowCount: low.length, outCount: low.filter((x) => x.qty <= 0).length,
    openOrders: pos.filter((p) => ["draft", "ordered", "partial"].includes(p.status)).length,
    lowItems: low.slice(0, 8).map((x) => ({ id: String(x.p._id), sku: x.p.sku, name: x.p.name, qty: x.qty, reorderPoint: x.p.reorderPoint })),
    byWarehouse: [...perWh.values()].map((w) => ({ ...w, value: round2(w.value) })),
    flow: days, recent: movements.slice(0, 8).map(clean),
  };
});

/* ---------- demo data ---------- */
app.post("/demo/seed", { auth: true }, async ({ db, user }) => {
  if (await db.collection("warehouses").findOne({ ownerId: user.id })) throw bad("You already have data. Delete it first, or just start adding your own.");
  const now = new Date();
  const whDocs = [["Mumbai Hub", "MUM", "Mumbai", 50000], ["Delhi DC", "DEL", "Delhi", 30000], ["Bengaluru Store", "BLR", "Bengaluru", 20000]].map(([name, code, city, capacity]) => ({ ...owned(user), name, code, city, capacity, createdAt: now }));
  const supDocs = [["Apex Components", "sales@apex.example", 5], ["Nova Wholesale", "orders@nova.example", 9]].map(([name, email, leadDays]) => ({ ...owned(user), name, email, leadDays, createdAt: now }));
  const whs = (await db.collection("warehouses").insertMany(whDocs)).insertedIds;
  const sups = (await db.collection("suppliers").insertMany(supDocs)).insertedIds;
  const items = [
    ["LAP-001", "Laptop Stand", "Accessories", 640, 1199, 20, 0], ["USB-014", "USB-C Cable 1m", "Accessories", 90, 249, 60, 0], ["MON-027", "27in Monitor", "Displays", 9800, 13499, 8, 1],
    ["KEY-003", "Mechanical Keyboard", "Peripherals", 2100, 3499, 15, 1], ["MSE-009", "Wireless Mouse", "Peripherals", 480, 899, 25, 0], ["HDD-500", "External SSD 500GB", "Storage", 3600, 5299, 12, 1],
  ];
  const prodDocs = items.map(([sku, name, category, cost, price, reorderPoint, s]) => ({ ...owned(user), sku, name, category, unit: "pcs", cost, price, reorderPoint, supplierId: String(sups[s]), createdAt: now }));
  const prods = (await db.collection("products").insertMany(prodDocs)).insertedIds;
  const qtys = [[120, 40, 15], [300, 90, 40], [4, 2, 1], [8, 4, 2], [80, 22, 30], [0, 3, 2]];
  const rows = [];
  Object.values(prods).forEach((pid, i) => Object.values(whs).forEach((wid, j) => rows.push({ ownerId: user.id, productId: String(pid), warehouseId: String(wid), qty: qtys[i][j] })));
  await db.collection("levels").insertMany(rows);
  const pl = Object.values(prods);
  const wl = Object.values(whs);
  const moves = [];
  for (let d = 12; d >= 0; d -= 1) {
    const at = new Date(Date.now() - d * 86400000 - Math.random() * 3600000);
    const i = d % pl.length;
    moves.push({ ownerId: user.id, userName: user.name, at, type: d % 3 === 0 ? "receive" : "ship", productId: String(pl[i]), productName: items[i][1], sku: items[i][0], qty: 4 + ((d * 7) % 20), [d % 3 === 0 ? "toName" : "fromName"]: whDocs[d % 3].name, note: d % 3 === 0 ? "Supplier delivery" : "Customer order" });
  }
  await db.collection("movements").insertMany(moves);
  return created({ ok: true });
});

module.exports = app;
