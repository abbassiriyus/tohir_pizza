// Filial admini paneli: o'z filialining ishchilari, buyurtmalari va statistikasi.
// Ovqatlar (mahsulotlar) umumiy /api/products orqali yaratiladi — filial admini uchun branch_id avtomatik qo'yiladi.
const express = require('express');
const { db } = require('./db');
const { auth, requireRole, wrap } = require('./middleware');
const { bad, notFound, readNewUser, insertUser, updateStaff, getOrder, listOrders } = require('./helpers');

const router = express.Router();
router.use(auth, requireRole('branch_admin'));

const MINUTES = "(julianday(delivered_at) - julianday(accepted_at)) * 1440";

router.get('/', wrap((req, res) => {
  const b = db.prepare('SELECT id, name, address, phone, created_at FROM branches WHERE id = ?').get(req.user.branch_id);
  res.json({
    ...b,
    workers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE branch_id = ? AND role = 'worker' AND active = 1").get(b.id).n,
    products: db.prepare('SELECT COUNT(*) AS n FROM products WHERE branch_id = ?').get(b.id).n,
  });
}));

// ---------- Ishchilar ----------
const WORKER_COLS = 'id, username, full_name, phone, active, created_at';
const findWorker = (req) =>
  db.prepare(`SELECT ${WORKER_COLS} FROM users WHERE id = ? AND branch_id = ? AND role = 'worker'`).get(req.params.id, req.user.branch_id);

router.get('/workers', wrap((req, res) => {
  const rows = db.prepare(
    `SELECT u.id, u.username, u.full_name, u.phone, u.active, u.created_at,
            SUM(CASE WHEN o.status = 'delivering' THEN 1 ELSE 0 END) AS delivering,
            SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) AS delivered
     FROM users u LEFT JOIN orders o ON o.worker_id = u.id
     WHERE u.branch_id = ? AND u.role = 'worker'
     GROUP BY u.id ORDER BY u.active DESC, u.full_name, u.username`).all(req.user.branch_id);
  res.json(rows.map((r) => ({ ...r, active: !!r.active, delivering: r.delivering || 0, delivered: r.delivered || 0 })));
}));

router.post('/workers', wrap((req, res) => {
  const u = readNewUser(req.body);
  if (u.error) return res.status(u.status || 400).json({ error: u.error });
  res.status(201).json(insertUser(u.data, 'worker', req.user.branch_id));
}));

// full_name, phone, password, active (bloklash/ochish)
router.put('/workers/:id', wrap((req, res) => {
  const w = findWorker(req);
  if (!w) return notFound(res, 'Ishchi topilmadi');
  res.json(updateStaff(w.id, req.body));
}));

// Buyurtmasi bo'lmagan ishchini butunlay o'chiradi; bo'lsa — active=false qilish kerak (statistika saqlanadi)
router.delete('/workers/:id', wrap((req, res) => {
  const w = findWorker(req);
  if (!w) return notFound(res, 'Ishchi topilmadi');
  if (db.prepare('SELECT 1 FROM orders WHERE worker_id = ? LIMIT 1').get(w.id))
    return res.status(409).json({ error: 'Ishchining buyurtmalari bor. O\'chirish o\'rniga PUT bilan active=false qiling' });
  db.prepare('DELETE FROM users WHERE id = ?').run(w.id);
  res.status(204).end();
}));

// ---------- Buyurtmalar ----------
const findOrder = (req) => db.prepare('SELECT * FROM orders WHERE id = ? AND branch_id = ?').get(req.params.id, req.user.branch_id);
const FINAL = ['delivered', 'cancelled'];

router.get('/orders', wrap((req, res) => {
  res.json(listOrders({ branch_id: req.user.branch_id, status: req.query.status, worker_id: req.query.worker_id }, req.query.limit));
}));

router.get('/orders/:id', wrap((req, res) => {
  if (!findOrder(req)) return notFound(res, 'Buyurtma topilmadi');
  res.json(getOrder(req.params.id));
}));

/**
 * Holatni o'zgartirish: new | preparing | delivered | cancelled.
 * "delivering" — faqat ishchi olganda yoki /assign orqali. new/preparing ga qaytarilsa ishchi bo'shatiladi.
 */
router.patch('/orders/:id/status', wrap((req, res) => {
  const status = req.body?.status;
  if (!['new', 'preparing', 'delivered', 'cancelled'].includes(status))
    return bad(res, 'status: new, preparing, delivered yoki cancelled (ishchiga berish uchun /assign)');
  const o = findOrder(req);
  if (!o) return notFound(res, 'Buyurtma topilmadi');
  if (FINAL.includes(o.status)) return res.status(409).json({ error: `Buyurtma allaqachon "${o.status}"` });
  if (status === 'delivered' && !o.worker_id) return bad(res, 'Avval buyurtmani ishchiga bering (/assign)');
  if (['new', 'preparing'].includes(status)) {
    db.prepare('UPDATE orders SET status = ?, worker_id = NULL, accepted_at = NULL WHERE id = ?').run(status, o.id);
  } else {
    db.prepare(
      `UPDATE orders SET status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END WHERE id = ?`
    ).run(status, status, o.id);
  }
  res.json(getOrder(o.id));
}));

// Buyurtmani ishchiga biriktirish (holat "delivering" bo'ladi)
router.patch('/orders/:id/assign', wrap((req, res) => {
  const o = findOrder(req);
  if (!o) return notFound(res, 'Buyurtma topilmadi');
  if (FINAL.includes(o.status)) return res.status(409).json({ error: `Buyurtma allaqachon "${o.status}"` });
  const w = db.prepare("SELECT id FROM users WHERE id = ? AND branch_id = ? AND role = 'worker' AND active = 1")
    .get(req.body?.worker_id, req.user.branch_id);
  if (!w) return bad(res, 'worker_id: shu filialning faol ishchisi bo\'lishi kerak');
  db.prepare("UPDATE orders SET worker_id = ?, status = 'delivering', accepted_at = CURRENT_TIMESTAMP WHERE id = ?").run(w.id, o.id);
  res.json(getOrder(o.id));
}));

// ---------- Statistika ----------
router.get('/stats', wrap((req, res) => {
  const id = req.user.branch_id;
  const one = (sql) => db.prepare(sql).get(id);
  const all = (sql) => db.prepare(sql).all(id);
  res.json({
    totals: one(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(status = 'delivered'),0) AS delivered,
              COALESCE(SUM(status = 'cancelled'),0) AS cancelled,
              COALESCE(SUM(status IN ('new','preparing') AND worker_id IS NULL),0) AS waiting,
              COALESCE(SUM(status = 'delivering'),0) AS delivering,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END),0) AS revenue,
              COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total END),0) AS averageOrder,
              AVG(CASE WHEN status = 'delivered' AND accepted_at IS NOT NULL THEN ${MINUTES} END) AS avgDeliveryMinutes
       FROM orders WHERE branch_id = ?`),
    today: one(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(status = 'delivered'),0) AS delivered,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END),0) AS revenue
       FROM orders WHERE branch_id = ? AND created_at >= date('now')`),
    ordersByStatus: all('SELECT status, COUNT(*) AS count FROM orders WHERE branch_id = ? GROUP BY status'),
    last7Days: all(
      `SELECT date(created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END),0) AS revenue
       FROM orders WHERE branch_id = ? AND created_at >= date('now','-6 days')
       GROUP BY date(created_at) ORDER BY date`),
    workers: all(
      `SELECT u.id, u.username, u.full_name, u.active,
              COALESCE(SUM(o.status = 'delivering'),0) AS delivering,
              COALESCE(SUM(o.status = 'delivered'),0) AS delivered,
              COALESCE(SUM(o.status = 'delivered' AND o.delivered_at >= date('now')),0) AS deliveredToday,
              COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total END),0) AS deliveredRevenue,
              AVG(CASE WHEN o.status = 'delivered' THEN (julianday(o.delivered_at) - julianday(o.accepted_at)) * 1440 END) AS avgDeliveryMinutes
       FROM users u LEFT JOIN orders o ON o.worker_id = u.id
       WHERE u.branch_id = ? AND u.role = 'worker'
       GROUP BY u.id ORDER BY delivered DESC`).map((w) => ({ ...w, active: !!w.active })),
    topProducts: all(
      `SELECT p.id, p.name, SUM(oi.quantity) AS sold, SUM(oi.quantity * oi.price) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
       WHERE o.branch_id = ? AND o.status != 'cancelled' GROUP BY p.id ORDER BY sold DESC LIMIT 5`),
  });
}));

module.exports = router;
