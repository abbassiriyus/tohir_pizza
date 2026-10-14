const express = require('express');
const bcrypt = require('bcryptjs');
const { db, transaction } = require('./db');
const { signToken, auth, superAdmin, wrap } = require('./middleware');

const router = express.Router();
const SIZES = [22, 28, 33];

const bad = (res, msg) => res.status(400).json({ error: msg });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// ---------- AUTH ----------
router.post('/auth/register', wrap((req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || username.trim().length < 3) return bad(res, 'username kamida 3 belgi');
  if (typeof password !== 'string' || password.length < 6) return bad(res, 'password kamida 6 belgi');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim()))
    return res.status(409).json({ error: 'Bu username band' });
  const r = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username.trim(), bcrypt.hashSync(password, 10));
  const user = { id: Number(r.lastInsertRowid), username: username.trim(), role: 'user' };
  res.status(201).json({ user, token: signToken(user) });
}));

router.post('/auth/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'Username yoki parol noto\'g\'ri' });
  const user = { id: u.id, username: u.username, role: u.role };
  res.json({ user, token: signToken(user) });
}));

router.get('/auth/me', auth, wrap((req, res) => {
  const u = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
  res.json(u);
}));

// ---------- CATEGORIES ----------
router.get('/categories', wrap((req, res) => {
  res.json(db.prepare('SELECT id, name FROM categories ORDER BY name').all());
}));

router.post('/categories', auth, superAdmin, wrap((req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return bad(res, 'name majburiy');
  if (db.prepare('SELECT id FROM categories WHERE name = ?').get(name))
    return res.status(409).json({ error: 'Bunday kategoriya bor' });
  const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
  res.status(201).json({ id: Number(r.lastInsertRowid), name });
}));

router.put('/categories/:id', auth, superAdmin, wrap((req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return bad(res, 'name majburiy');
  const r = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Kategoriya topilmadi' });
  res.json({ id: Number(req.params.id), name });
}));

router.delete('/categories/:id', auth, superAdmin, wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM products WHERE category_id = ?').get(req.params.id))
    return res.status(409).json({ error: 'Kategoriyada mahsulotlar bor, avval ularni o\'chiring' });
  const r = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Kategoriya topilmadi' });
  res.status(204).end();
}));

// ---------- PRODUCTS (card) ----------
const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.image, p.description, p.category_id, c.name AS category,
         p.price_22, p.price_28, p.price_33
  FROM products p JOIN categories c ON c.id = p.category_id`;

const shape = (p) => ({
  id: p.id,
  name: p.name,
  image: p.image,
  description: p.description,
  category: { id: p.category_id, name: p.category },
  sizes: [
    { size: 22, price: p.price_22 },
    { size: 28, price: p.price_28 },
    { size: 33, price: p.price_33 },
  ],
});

function readProductBody(body, partial = false) {
  const b = body || {};
  const prices = b.prices || {};
  const out = {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'name majburiy' };
    out.name = b.name.trim();
  }
  if (!partial || b.image !== undefined) out.image = String(b.image ?? '');
  if (!partial || b.description !== undefined) out.description = String(b.description ?? '');
  if (!partial || b.category_id !== undefined) {
    if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(b.category_id)) return { error: 'category_id noto\'g\'ri' };
    out.category_id = b.category_id;
  }
  for (const s of SIZES) {
    if (!partial || prices[s] !== undefined) {
      if (!isNum(prices[s])) return { error: `prices.${s} musbat son bo'lishi kerak` };
      out[`price_${s}`] = prices[s];
    }
  }
  return { data: out };
}

router.get('/products', wrap((req, res) => {
  const where = [];
  const args = [];
  if (req.query.category_id) { where.push('p.category_id = ?'); args.push(req.query.category_id); }
  if (req.query.search) { where.push('p.name LIKE ?'); args.push(`%${req.query.search}%`); }
  const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`;
  res.json(db.prepare(sql).all(...args).map(shape));
}));

router.get('/products/:id', wrap((req, res) => {
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  res.json(shape(p));
}));

router.post('/products', auth, superAdmin, wrap((req, res) => {
  const { data, error } = readProductBody(req.body);
  if (error) return bad(res, error);
  const r = db.prepare(
    `INSERT INTO products (name, image, description, category_id, price_22, price_28, price_33)
     VALUES (:name, :image, :description, :category_id, :price_22, :price_28, :price_33)`
  ).run(data);
  res.status(201).json(shape(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(r.lastInsertRowid)));
}));

router.put('/products/:id', auth, superAdmin, wrap((req, res) => {
  if (!db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Mahsulot topilmadi' });
  const { data, error } = readProductBody(req.body, true);
  if (error) return bad(res, error);
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`)
      .run({ ...data, id: req.params.id });
  }
  res.json(shape(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id)));
}));

router.delete('/products/:id', auth, superAdmin, wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM order_items WHERE product_id = ?').get(req.params.id))
    return res.status(409).json({ error: 'Bu mahsulot buyurtmalarda ishlatilgan, o\'chirib bo\'lmaydi' });
  const r = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  res.status(204).end();
}));

// ---------- ORDERS ----------
router.post('/orders', auth, wrap((req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) return bad(res, 'items bo\'sh bo\'lmasligi kerak');
  const order = transaction(() => {
    let total = 0;
    const rows = [];
    for (const it of items) {
      if (!SIZES.includes(it.size)) throw Object.assign(new Error('size 22, 28 yoki 33 bo\'lishi kerak'), { status: 400 });
      if (!Number.isInteger(it.quantity) || it.quantity < 1) throw Object.assign(new Error('quantity >= 1 butun son'), { status: 400 });
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!p) throw Object.assign(new Error(`product_id ${it.product_id} topilmadi`), { status: 400 });
      const price = p[`price_${it.size}`];
      total += price * it.quantity;
      rows.push([p.id, it.size, it.quantity, price]);
    }
    const o = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)').run(req.user.id, total);
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, size, quantity, price) VALUES (?, ?, ?, ?, ?)');
    rows.forEach((r) => ins.run(o.lastInsertRowid, ...r));
    return Number(o.lastInsertRowid);
  });
  res.status(201).json(getOrder(order));
}));

function getOrder(id) {
  const o = db.prepare(
    `SELECT o.id, o.user_id, u.username, o.total, o.status, o.created_at
     FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`).get(id);
  if (!o) return null;
  o.items = db.prepare(
    `SELECT oi.product_id, p.name, oi.size, oi.quantity, oi.price
     FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`).all(id);
  return o;
}

router.get('/orders/my', auth, wrap((req, res) => {
  const ids = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json(ids.map((r) => getOrder(r.id)));
}));

router.get('/orders', auth, superAdmin, wrap((req, res) => {
  const ids = db.prepare('SELECT id FROM orders ORDER BY id DESC').all();
  res.json(ids.map((r) => getOrder(r.id)));
}));

router.patch('/orders/:id/status', auth, superAdmin, wrap((req, res) => {
  const status = req.body?.status;
  if (!['new', 'preparing', 'delivered', 'cancelled'].includes(status)) return bad(res, 'status noto\'g\'ri');
  const r = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  res.json(getOrder(req.params.id));
}));

// ---------- PURCHASED ITEMS (sotib olingan tovarlar) ----------
router.get('/purchases', auth, wrap((req, res) => {
  const rows = db.prepare(
    `SELECT p.id AS product_id, p.name, p.image, oi.size,
            SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.price) AS spent, MAX(o.created_at) AS last_purchased_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = ? AND o.status != 'cancelled'
     GROUP BY p.id, oi.size ORDER BY last_purchased_at DESC`).all(req.user.id);
  res.json({
    totalSpent: rows.reduce((s, r) => s + r.spent, 0),
    items: rows,
  });
}));

// ---------- LOGO ----------
router.get('/logo', wrap((req, res) => {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'logo'").get();
  res.json({ logo: r ? r.value : null });
}));

router.put('/logo', auth, superAdmin, wrap((req, res) => {
  const logo = req.body?.logo;
  if (typeof logo !== 'string' || !logo.trim()) return bad(res, 'logo (URL) majburiy');
  db.prepare("INSERT INTO settings (key, value) VALUES ('logo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(logo.trim());
  res.json({ logo: logo.trim() });
}));

router.delete('/logo', auth, superAdmin, wrap((req, res) => {
  db.prepare("DELETE FROM settings WHERE key = 'logo'").run();
  res.status(204).end();
}));

// ---------- STATISTICS (super admin) ----------
router.get('/admin/stats', auth, superAdmin, wrap((req, res) => {
  const one = (sql) => db.prepare(sql).get();
  const all = (sql) => db.prepare(sql).all();
  const live = "status != 'cancelled'";
  res.json({
    totals: {
      users: one("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").n,
      products: one('SELECT COUNT(*) AS n FROM products').n,
      categories: one('SELECT COUNT(*) AS n FROM categories').n,
      orders: one('SELECT COUNT(*) AS n FROM orders').n,
      revenue: one(`SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE ${live}`).n,
      averageOrder: one(`SELECT COALESCE(AVG(total),0) AS n FROM orders WHERE ${live}`).n,
    },
    ordersByStatus: all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status'),
    topProducts: all(
      `SELECT p.id, p.name, SUM(oi.quantity) AS sold, SUM(oi.quantity * oi.price) AS revenue
       FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id
       WHERE o.${live} GROUP BY p.id ORDER BY sold DESC LIMIT 5`),
    salesBySize: all(
      `SELECT oi.size, SUM(oi.quantity) AS sold FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.${live} GROUP BY oi.size ORDER BY oi.size`),
    salesByCategory: all(
      `SELECT c.name AS category, SUM(oi.quantity) AS sold, SUM(oi.quantity * oi.price) AS revenue
       FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
       JOIN orders o ON o.id = oi.order_id WHERE o.${live} GROUP BY c.id ORDER BY revenue DESC`),
    last7Days: all(
      `SELECT date(created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
       FROM orders WHERE ${live} AND created_at >= date('now','-6 days')
       GROUP BY date(created_at) ORDER BY date`),
  });
}));

module.exports = router;
