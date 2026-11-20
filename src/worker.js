// Ishchi (yetkazib beruvchi) paneli: filial buyurtmalarini oladi, yetkazadi va o'z statistikasini ko'radi.
// Oqim: new/preparing (bo'sh) --accept--> delivering --deliver--> delivered
//                                         delivering --release--> preparing (boshqa ishchi olishi uchun)
const express = require('express');
const { db } = require('./db');
const { auth, requireRole, wrap } = require('./middleware');
const { notFound, getOrder, listOrders } = require('./helpers');

const router = express.Router();
router.use(auth, requireRole('worker'));

/**
 * scope=available — filialdagi hali hech kim olmagan buyurtmalar (standart)
 * scope=mine      — menga biriktirilgan buyurtmalar (status bilan filtrlash mumkin)
 */
router.get('/orders', wrap((req, res) => {
  const { branch_id: branchId, id } = req.user;
  if (req.query.scope === 'mine')
    return res.json(listOrders({ worker_id: id, status: req.query.status }, req.query.limit));
  res.json(listOrders({ branch_id: branchId, worker_id: 'none', status: ['new', 'preparing'] }, req.query.limit));
}));

router.get('/orders/:id', wrap((req, res) => {
  const o = db.prepare('SELECT worker_id FROM orders WHERE id = ? AND branch_id = ?').get(req.params.id, req.user.branch_id);
  // Boshqa ishchining buyurtmasini ko'rsatmaymiz
  if (!o || (o.worker_id && o.worker_id !== req.user.id)) return notFound(res, 'Buyurtma topilmadi');
  res.json(getOrder(req.params.id));
}));

// Atomik o'zgartirish: shart bajarilmasa (masalan, boshqa ishchi allaqachon olgan) — 409
function transition(req, res, sql, args, conflictMsg) {
  const exists = db.prepare('SELECT id FROM orders WHERE id = ? AND branch_id = ?').get(req.params.id, req.user.branch_id);
  if (!exists) return notFound(res, 'Buyurtma topilmadi');
  const r = db.prepare(sql).run(...args);
  if (!r.changes) return res.status(409).json({ error: conflictMsg });
  res.json(getOrder(req.params.id));
}

// Buyurtmani olish (yetkazishga)
router.post('/orders/:id/accept', wrap((req, res) =>
  transition(req, res,
    `UPDATE orders SET worker_id = ?, status = 'delivering', accepted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND branch_id = ? AND worker_id IS NULL AND status IN ('new','preparing')`,
    [req.user.id, req.params.id, req.user.branch_id],
    'Buyurtmani olib bo\'lmaydi: boshqa ishchi olgan yoki holati mos emas')));

// Yetkazildi deb belgilash
router.post('/orders/:id/deliver', wrap((req, res) =>
  transition(req, res,
    `UPDATE orders SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
     WHERE id = ? AND worker_id = ? AND status = 'delivering'`,
    [req.params.id, req.user.id],
    'Faqat o\'zingiz yetkazayotgan ("delivering") buyurtmani yakunlash mumkin')));

// Buyurtmadan voz kechish — qayta navbatga qaytadi
router.post('/orders/:id/release', wrap((req, res) =>
  transition(req, res,
    `UPDATE orders SET status = 'preparing', worker_id = NULL, accepted_at = NULL
     WHERE id = ? AND worker_id = ? AND status = 'delivering'`,
    [req.params.id, req.user.id],
    'Faqat o\'zingiz yetkazayotgan buyurtmadan voz kechish mumkin')));

// Mening statistikam
router.get('/stats', wrap((req, res) => {
  const { id, branch_id: branchId } = req.user;
  const me = db.prepare(
    `SELECT COALESCE(SUM(status = 'delivered'),0) AS delivered,
            COALESCE(SUM(status = 'delivering'),0) AS delivering,
            COALESCE(SUM(status = 'delivered' AND delivered_at >= date('now')),0) AS deliveredToday,
            COALESCE(SUM(status = 'delivered' AND delivered_at >= date('now','-6 days')),0) AS deliveredLast7Days,
            COALESCE(SUM(CASE WHEN status = 'delivered' THEN total END),0) AS deliveredRevenue,
            AVG(CASE WHEN status = 'delivered' THEN (julianday(delivered_at) - julianday(accepted_at)) * 1440 END) AS avgDeliveryMinutes
     FROM orders WHERE worker_id = ?`).get(id);
  res.json({
    me,
    last7Days: db.prepare(
      `SELECT date(delivered_at) AS date, COUNT(*) AS delivered, COALESCE(SUM(total),0) AS revenue
       FROM orders WHERE worker_id = ? AND status = 'delivered' AND delivered_at >= date('now','-6 days')
       GROUP BY date(delivered_at) ORDER BY date`).all(id),
    branch: db.prepare(
      `SELECT COALESCE(SUM(created_at >= date('now')),0) AS ordersToday,
              COALESCE(SUM(status IN ('new','preparing') AND worker_id IS NULL),0) AS waiting,
              COALESCE(SUM(status = 'delivering'),0) AS delivering
       FROM orders WHERE branch_id = ?`).get(branchId),
  });
}));

module.exports = router;
