const bcrypt = require('bcryptjs');
const { db } = require('./db');

const bad = (res, msg) => res.status(400).json({ error: msg });
const notFound = (res, msg) => res.status(404).json({ error: msg });
const httpError = (status, msg) => Object.assign(new Error(msg), { status });

// multipart/form-data'da hamma qiymat matn bo'lib keladi — sonlarni o'giramiz
const toNum = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const toBool = (v) => (v === true || v === 'true' || v === 1 || v === '1' ? true : v === false || v === 'false' || v === 0 || v === '0' ? false : undefined);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Yangi foydalanuvchi (filial admini yoki ishchi) uchun body'ni tekshiradi */
function readNewUser(b = {}) {
  const username = str(b.username);
  if (username.length < 3) return { error: 'username kamida 3 belgi' };
  if (typeof b.password !== 'string' || b.password.length < 6) return { error: 'password kamida 6 belgi' };
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return { error: 'Bu username band', status: 409 };
  return { data: { username, password_hash: bcrypt.hashSync(b.password, 10), full_name: str(b.full_name), phone: str(b.phone) } };
}

function insertUser(data, role, branchId) {
  const r = db.prepare(
    'INSERT INTO users (username, password_hash, role, branch_id, full_name, phone) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(data.username, data.password_hash, role, branchId, data.full_name, data.phone);
  return publicUser(Number(r.lastInsertRowid));
}

/** Xodim (filial admini yoki ishchi) ma'lumotlarini yangilash: full_name, phone, password, active */
function updateStaff(userId, body = {}) {
  const set = {};
  if (body.full_name !== undefined) set.full_name = str(body.full_name);
  if (body.phone !== undefined) set.phone = str(body.phone);
  if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < 6) throw httpError(400, 'password kamida 6 belgi');
    set.password_hash = bcrypt.hashSync(body.password, 10);
  }
  if (body.active !== undefined) {
    const active = toBool(body.active);
    if (active === undefined) throw httpError(400, 'active true/false bo\'lishi kerak');
    set.active = active ? 1 : 0;
  }
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`).run({ ...set, id: userId });
  return publicUser(userId);
}

const publicUser = (id) =>
  db.prepare('SELECT id, username, role, branch_id, full_name, phone, active, created_at FROM users WHERE id = ?').get(id);

function getOrder(id) {
  const o = db.prepare(
    `SELECT o.id, o.user_id, u.username, o.total, o.status, o.address, o.phone,
            o.branch_id, b.name AS branch_name, o.worker_id, w.full_name AS worker_name, w.username AS worker_username,
            o.created_at, o.accepted_at, o.delivered_at
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN branches b ON b.id = o.branch_id
     LEFT JOIN users w ON w.id = o.worker_id
     WHERE o.id = ?`).get(id);
  if (!o) return null;
  const { branch_id, branch_name, worker_id, worker_name, worker_username, ...rest } = o;
  rest.branch = branch_id ? { id: branch_id, name: branch_name } : null;
  rest.worker = worker_id ? { id: worker_id, username: worker_username, full_name: worker_name } : null;
  rest.items = db.prepare(
    `SELECT oi.product_id, p.name, oi.size, oi.quantity, oi.price
     FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`).all(id);
  return rest;
}

/** Buyurtmalar ro'yxati: filtrlari bilan (status, branch_id, worker_id, user_id), yangilari birinchi */
function listOrders(filters = {}, limit = 200) {
  const where = [];
  const args = [];
  for (const [col, val] of Object.entries(filters)) {
    if (val === undefined || val === '' || val === null) continue;
    if (col === 'worker_id' && val === 'none') { where.push('worker_id IS NULL'); continue; }
    if (Array.isArray(val)) { where.push(`${col} IN (${val.map(() => '?').join(',')})`); args.push(...val); continue; }
    where.push(`${col} = ?`);
    args.push(val);
  }
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || 200, 1), 1000);
  const sql = `SELECT id FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${n}`;
  return db.prepare(sql).all(...args).map((r) => getOrder(r.id));
}

module.exports = {
  bad, notFound, httpError, toNum, isNum, toBool, str,
  readNewUser, insertUser, updateStaff, publicUser, getOrder, listOrders,
};
