// Filiallarni boshqarish — superadmin. Ro'yxat esa hamma uchun ochiq (mijoz filial tanlaydi).
const express = require('express');
const { db, transaction } = require('./db');
const { auth, superAdmin, wrap } = require('./middleware');
const { bad, notFound, toBool, str, readNewUser, insertUser, updateStaff } = require('./helpers');

const router = express.Router();

const BRANCH_SELECT = `
  SELECT b.id, b.name, b.address, b.phone, b.active, b.created_at,
         (SELECT COUNT(*) FROM users w WHERE w.branch_id = b.id AND w.role = 'worker' AND w.active = 1) AS workers,
         (SELECT COUNT(*) FROM products p WHERE p.branch_id = b.id) AS products
  FROM branches b`;

const branchAdmins = (id) =>
  db.prepare(
    "SELECT id, username, full_name, phone, active FROM users WHERE branch_id = ? AND role = 'branch_admin' ORDER BY id"
  ).all(id);

const fullBranch = (id) => {
  const b = db.prepare(`${BRANCH_SELECT} WHERE b.id = ?`).get(id);
  return b && { ...b, active: !!b.active, admins: branchAdmins(id) };
};

// Ochiq: faol filiallar ro'yxati (mijozlar uchun)
router.get('/branches', wrap((req, res) => {
  res.json(db.prepare('SELECT id, name, address, phone FROM branches WHERE active = 1 ORDER BY name').all());
}));

// Superadmin: barcha filiallar (faol bo'lmaganlari ham), adminlari bilan
router.get('/branches/all', auth, superAdmin, wrap((req, res) => {
  const rows = db.prepare(`${BRANCH_SELECT} ORDER BY b.id`).all();
  res.json(rows.map((b) => ({ ...b, active: !!b.active, admins: branchAdmins(b.id) })));
}));

router.get('/branches/:id', auth, superAdmin, wrap((req, res) => {
  const b = fullBranch(req.params.id);
  if (!b) return notFound(res, 'Filial topilmadi');
  res.json(b);
}));

/**
 * Filial yaratish. Ixtiyoriy "admin": { username, password, full_name, phone } —
 * shu bilan birga filial admini hisobi ham yaratiladi.
 */
router.post('/branches', auth, superAdmin, wrap((req, res) => {
  const b = req.body || {};
  const name = str(b.name);
  if (!name) return bad(res, 'name majburiy');
  if (db.prepare('SELECT id FROM branches WHERE name = ?').get(name))
    return res.status(409).json({ error: 'Bunday nomli filial bor' });
  let admin;
  if (b.admin) {
    admin = readNewUser(b.admin);
    if (admin.error) return res.status(admin.status || 400).json({ error: `admin: ${admin.error}` });
  }
  const id = transaction(() => {
    const r = db.prepare('INSERT INTO branches (name, address, phone) VALUES (?, ?, ?)').run(name, str(b.address), str(b.phone));
    const branchId = Number(r.lastInsertRowid);
    if (admin) insertUser(admin.data, 'branch_admin', branchId);
    return branchId;
  });
  res.status(201).json(fullBranch(id));
}));

router.put('/branches/:id', auth, superAdmin, wrap((req, res) => {
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id)) return notFound(res, 'Filial topilmadi');
  const b = req.body || {};
  const set = {};
  if (b.name !== undefined) {
    set.name = str(b.name);
    if (!set.name) return bad(res, 'name bo\'sh bo\'lmasligi kerak');
    if (db.prepare('SELECT id FROM branches WHERE name = ? AND id != ?').get(set.name, req.params.id))
      return res.status(409).json({ error: 'Bunday nomli filial bor' });
  }
  if (b.address !== undefined) set.address = str(b.address);
  if (b.phone !== undefined) set.phone = str(b.phone);
  if (b.active !== undefined) {
    const active = toBool(b.active);
    if (active === undefined) return bad(res, 'active true/false bo\'lishi kerak');
    set.active = active ? 1 : 0;
  }
  const keys = Object.keys(set);
  if (keys.length)
    db.prepare(`UPDATE branches SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`).run({ ...set, id: req.params.id });
  res.json(fullBranch(req.params.id));
}));

// Bo'sh filialni o'chiradi. Buyurtma/mahsulot/xodimi bor filialni o'chirib bo'lmaydi — active=false qiling.
router.delete('/branches/:id', auth, superAdmin, wrap((req, res) => {
  const id = req.params.id;
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(id)) return notFound(res, 'Filial topilmadi');
  const used =
    db.prepare('SELECT 1 FROM orders WHERE branch_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM products WHERE branch_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM users WHERE branch_id = ? LIMIT 1').get(id);
  if (used)
    return res.status(409).json({ error: 'Filialda buyurtma, mahsulot yoki xodim bor. O\'chirish o\'rniga PUT bilan active=false qiling' });
  db.prepare('DELETE FROM branches WHERE id = ?').run(id);
  res.status(204).end();
}));

// Filialga qo'shimcha admin qo'shish
router.post('/branches/:id/admins', auth, superAdmin, wrap((req, res) => {
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id)) return notFound(res, 'Filial topilmadi');
  const u = readNewUser(req.body);
  if (u.error) return res.status(u.status || 400).json({ error: u.error });
  res.status(201).json(insertUser(u.data, 'branch_admin', Number(req.params.id)));
}));

// Filial adminini bloklash/ochish yoki parolini almashtirish
router.put('/branches/:id/admins/:userId', auth, superAdmin, wrap((req, res) => {
  const u = db.prepare("SELECT id FROM users WHERE id = ? AND branch_id = ? AND role = 'branch_admin'")
    .get(req.params.userId, req.params.id);
  if (!u) return notFound(res, 'Filial admini topilmadi');
  updateStaff(u.id, req.body);
  res.json(db.prepare('SELECT id, username, full_name, phone, active FROM users WHERE id = ?').get(u.id));
}));

module.exports = router;
