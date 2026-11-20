const express = require('express');
const bcrypt = require('bcryptjs');
const { db, transaction, ORDER_STATUSES } = require('./db');
const { signToken, auth, requireRole, superAdmin, wrap } = require('./middleware');
const { upload, resolveImage, removeLocal, publicUrl } = require('./upload');
const { bad, notFound, httpError, toNum, isNum, str, getOrder, listOrders } = require('./helpers');

const router = express.Router();
const SIZES = [22, 28, 33];

// ---------- AUTH ----------
router.post('/auth/register', wrap((req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || username.trim().length < 3) return bad(res, 'username kamida 3 belgi');
  if (typeof password !== 'string' || password.length < 6) return bad(res, 'password kamida 6 belgi');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim()))
    return res.status(409).json({ error: 'Bu username band' });
  const r = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username.trim(), bcrypt.hashSync(password, 10));
  const user = { id: Number(r.lastInsertRowid), username: username.trim(), role: 'user', branch_id: null };
  res.status(201).json({ user, token: signToken(user) });
}));

// Hamma rollar (user, superadmin, branch_admin, worker) shu yerdan kiradi
router.post('/auth/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare(
    `SELECT u.*, b.active AS branch_active FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.username = ?`
  ).get(username || '');
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'Username yoki parol noto\'g\'ri' });
  if (!u.active) return res.status(403).json({ error: 'Hisob bloklangan' });
  if (u.branch_id && !u.branch_active) return res.status(403).json({ error: 'Filial faol emas' });
  const user = { id: u.id, username: u.username, role: u.role, branch_id: u.branch_id };
  res.json({ user, token: signToken(user) });
}));

router.get('/auth/me', auth, wrap((req, res) => {
  const u = db.prepare(
    `SELECT u.id, u.username, u.role, u.full_name, u.phone, u.created_at, u.branch_id, b.name AS branch_name
     FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?`).get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
  const { branch_id, branch_name, ...rest } = u;
  res.json({ ...rest, branch: branch_id ? { id: branch_id, name: branch_name } : null });
}));

// ---------- CATEGORIES (umumiy, faqat superadmin boshqaradi) ----------
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
  if (!r.changes) return notFound(res, 'Kategoriya topilmadi');
  res.json({ id: Number(req.params.id), name });
}));

router.delete('/categories/:id', auth, superAdmin, wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM products WHERE category_id = ?').get(req.params.id))
    return res.status(409).json({ error: 'Kategoriyada mahsulotlar bor, avval ularni o\'chiring' });
  const r = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (!r.changes) return notFound(res, 'Kategoriya topilmadi');
  res.status(204).end();
}));

// ---------- PRODUCTS (filial ovqatlari) ----------
const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.image, p.description, p.category_id, c.name AS category,
         p.branch_id, b.name AS branch_name, p.price_22, p.price_28, p.price_33
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN branches b ON b.id = p.branch_id`;

const shape = (req) => (p) => ({
  id: p.id,
  name: p.name,
  image: publicUrl(req, p.image),
  description: p.description,
  category: { id: p.category_id, name: p.category },
  branch: p.branch_id ? { id: p.branch_id, name: p.branch_name } : null,
  sizes: [
    { size: 22, price: p.price_22 },
    { size: 28, price: p.price_28 },
    { size: 33, price: p.price_33 },
  ],
});

function readPrices(b) {
  let prices = b.prices;
  if (typeof prices === 'string') {
    try { prices = JSON.parse(prices); } catch { return { error: 'prices JSON noto\'g\'ri' }; }
  }
  prices = prices && typeof prices === 'object' ? { ...prices } : {};
  // form-data uchun tekis maydonlar ham qabul qilinadi: price_22, price_28, price_33
  for (const s of SIZES) if (prices[s] === undefined && b[`price_${s}`] !== undefined) prices[s] = b[`price_${s}`];
  return { prices };
}

function readProductBody(req, partial = false) {
  const b = req.body || {};
  const { prices, error: pErr } = readPrices(b);
  if (pErr) return { error: pErr };
  const out = {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'name majburiy' };
    out.name = b.name.trim();
  }
  const img = resolveImage(req, 'image');
  if (img.error) return { error: img.error };
  if (img.value !== undefined) out.image = img.value;
  else if (!partial) out.image = '';
  if (!partial || b.description !== undefined) out.description = str(b.description);
  if (!partial || b.category_id !== undefined) {
    const categoryId = toNum(b.category_id);
    if (!Number.isInteger(categoryId) || !db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId))
      return { error: 'category_id noto\'g\'ri' };
    out.category_id = categoryId;
  }
  // Filial: filial admini faqat o'z filialiga qo'shadi; superadmin branch_id ni ko'rsatadi
  if (req.user.role === 'branch_admin') {
    if (!partial) out.branch_id = req.user.branch_id;
  } else if (!partial || b.branch_id !== undefined) {
    const branchId = toNum(b.branch_id);
    if (!Number.isInteger(branchId) || !db.prepare('SELECT id FROM branches WHERE id = ?').get(branchId))
      return { error: 'branch_id noto\'g\'ri' };
    out.branch_id = branchId;
  }
  for (const s of SIZES) {
    if (!partial || prices[s] !== undefined) {
      const price = toNum(prices[s]);
      if (!isNum(price)) return { error: `prices.${s} musbat son bo'lishi kerak` };
      out[`price_${s}`] = price;
    }
  }
  return { data: out };
}

// Validatsiya xatosida yuklangan faylni o'chirib, xato qaytaradi
const rejectUpload = (req, res, msg, status = 400) => {
  if (req.file) removeLocal(`/uploads/${req.file.filename}`);
  return res.status(status).json({ error: msg });
};

// Filial admini faqat o'z filiali mahsulotiga tegishi mumkin
const canEditProduct = (user, product) => user.role === 'superadmin' || product.branch_id === user.branch_id;

const productEditors = [auth, requireRole('superadmin', 'branch_admin')];

router.get('/products', wrap((req, res) => {
  const where = ['(b.active = 1 OR p.branch_id IS NULL)'];
  const args = [];
  if (req.query.category_id) { where.push('p.category_id = ?'); args.push(req.query.category_id); }
  if (req.query.branch_id) { where.push('p.branch_id = ?'); args.push(req.query.branch_id); }
  if (req.query.search) { where.push('p.name LIKE ?'); args.push(`%${req.query.search}%`); }
  const sql = `${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.id DESC`;
  res.json(db.prepare(sql).all(...args).map(shape(req)));
}));

router.get('/products/:id', wrap((req, res) => {
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!p) return notFound(res, 'Mahsulot topilmadi');
  res.json(shape(req)(p));
}));

// Rasm: JSON'da "image" (link) yoki multipart/form-data'da "image" (fayl) / "image_url" (link)
router.post('/products', ...productEditors, upload.single('image'), wrap((req, res) => {
  const { data, error } = readProductBody(req);
  if (error) return rejectUpload(req, res, error);
  const r = db.prepare(
    `INSERT INTO products (name, image, description, category_id, branch_id, price_22, price_28, price_33)
     VALUES (:name, :image, :description, :category_id, :branch_id, :price_22, :price_28, :price_33)`
  ).run(data);
  res.status(201).json(shape(req)(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(r.lastInsertRowid)));
}));

router.put('/products/:id', ...productEditors, upload.single('image'), wrap((req, res) => {
  const old = db.prepare('SELECT image, branch_id FROM products WHERE id = ?').get(req.params.id);
  if (!old || !canEditProduct(req.user, old)) return rejectUpload(req, res, 'Mahsulot topilmadi', 404);
  const { data, error } = readProductBody(req, true);
  if (error) return rejectUpload(req, res, error);
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`)
      .run({ ...data, id: req.params.id });
  }
  if (data.image !== undefined && data.image !== old.image) removeLocal(old.image);
  res.json(shape(req)(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id)));
}));

router.delete('/products/:id', ...productEditors, wrap((req, res) => {
  const old = db.prepare('SELECT image, branch_id FROM products WHERE id = ?').get(req.params.id);
  if (!old || !canEditProduct(req.user, old)) return notFound(res, 'Mahsulot topilmadi');
  if (db.prepare('SELECT 1 FROM order_items WHERE product_id = ?').get(req.params.id))
    return res.status(409).json({ error: 'Bu mahsulot buyurtmalarda ishlatilgan, o\'chirib bo\'lmaydi' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  removeLocal(old.image);
  res.status(204).end();
}));

// ---------- ORDERS (mijoz) ----------
router.post('/orders', auth, wrap((req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) return bad(res, 'items bo\'sh bo\'lmasligi kerak');
  const orderId = transaction(() => {
    let total = 0;
    let branchId;
    const rows = [];
    for (const it of items) {
      if (!SIZES.includes(it?.size)) throw httpError(400, 'size 22, 28 yoki 33 bo\'lishi kerak');
      if (!Number.isInteger(it.quantity) || it.quantity < 1) throw httpError(400, 'quantity >= 1 butun son');
      const p = db.prepare(
        'SELECT p.*, b.active AS branch_active FROM products p LEFT JOIN branches b ON b.id = p.branch_id WHERE p.id = ?'
      ).get(it.product_id);
      if (!p) throw httpError(400, `product_id ${it.product_id} topilmadi`);
      if (!p.branch_id) throw httpError(400, `"${p.name}" hech qaysi filialga biriktirilmagan`);
      if (!p.branch_active) throw httpError(400, `"${p.name}" filiali hozir ishlamayapti`);
      if (branchId === undefined) branchId = p.branch_id;
      else if (branchId !== p.branch_id) throw httpError(400, 'Bitta buyurtmadagi mahsulotlar bitta filialdan bo\'lishi kerak');
      const price = p[`price_${it.size}`];
      total += price * it.quantity;
      rows.push([p.id, it.size, it.quantity, price]);
    }
    const o = db.prepare('INSERT INTO orders (user_id, branch_id, total, address, phone) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, branchId, total, str(req.body.address), str(req.body.phone));
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, size, quantity, price) VALUES (?, ?, ?, ?, ?)');
    rows.forEach((r) => ins.run(o.lastInsertRowid, ...r));
    return Number(o.lastInsertRowid);
  });
  res.status(201).json(getOrder(orderId));
}));

router.get('/orders/my', auth, wrap((req, res) => {
  res.json(listOrders({ user_id: req.user.id }, 500));
}));

router.get('/orders', auth, superAdmin, wrap((req, res) => {
  res.json(listOrders({ status: req.query.status, branch_id: req.query.branch_id, worker_id: req.query.worker_id }, req.query.limit));
}));

router.patch('/orders/:id/status', auth, superAdmin, wrap((req, res) => {
  const status = req.body?.status;
  if (!ORDER_STATUSES.includes(status)) return bad(res, 'status noto\'g\'ri');
  const r = db.prepare(
    `UPDATE orders SET status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, CURRENT_TIMESTAMP) ELSE delivered_at END
     WHERE id = ?`).run(status, status, req.params.id);
  if (!r.changes) return notFound(res, 'Buyurtma topilmadi');
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
    items: rows.map((r) => ({ ...r, image: publicUrl(req, r.image) })),
  });
}));

// ---------- LOGO ----------
const getLogo = () => db.prepare("SELECT value FROM settings WHERE key = 'logo'").get()?.value ?? null;

router.get('/logo', wrap((req, res) => {
  const logo = getLogo();
  res.json({ logo: logo ? publicUrl(req, logo) : null });
}));

// JSON'da "logo" (link) yoki multipart/form-data'da "logo" (fayl) / "logo_url" (link)
router.put('/logo', auth, superAdmin, upload.single('logo'), wrap((req, res) => {
  const { value, error } = resolveImage(req, 'logo');
  if (error) return rejectUpload(req, res, error);
  if (!value) return rejectUpload(req, res, 'logo (fayl yoki link) majburiy');
  const old = getLogo();
  db.prepare("INSERT INTO settings (key, value) VALUES ('logo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(value);
  if (old !== value) removeLocal(old);
  res.json({ logo: publicUrl(req, value) });
}));

router.delete('/logo', auth, superAdmin, wrap((req, res) => {
  removeLocal(getLogo());
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
      branches: one('SELECT COUNT(*) AS n FROM branches WHERE active = 1').n,
      workers: one("SELECT COUNT(*) AS n FROM users WHERE role = 'worker' AND active = 1").n,
      products: one('SELECT COUNT(*) AS n FROM products').n,
      categories: one('SELECT COUNT(*) AS n FROM categories').n,
      orders: one('SELECT COUNT(*) AS n FROM orders').n,
      revenue: one(`SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE ${live}`).n,
      averageOrder: one(`SELECT COALESCE(AVG(total),0) AS n FROM orders WHERE ${live}`).n,
    },
    ordersByStatus: all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status'),
    byBranch: all(
      `SELECT b.id, b.name, b.active,
              COUNT(o.id) AS orders,
              COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END),0) AS delivered,
              COALESCE(SUM(CASE WHEN o.status IN ('new','preparing','delivering') THEN 1 ELSE 0 END),0) AS inProgress,
              COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total ELSE 0 END),0) AS revenue,
              (SELECT COUNT(*) FROM users w WHERE w.branch_id = b.id AND w.role = 'worker' AND w.active = 1) AS workers
       FROM branches b LEFT JOIN orders o ON o.branch_id = b.id
       GROUP BY b.id ORDER BY revenue DESC`),
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

router.use(require('./branches'));
router.use('/branch', require('./branch'));
router.use('/worker', require('./worker'));

module.exports = router;
