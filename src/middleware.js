const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

const signToken = (user) =>
  jwt.sign({ id: user.id, username: user.username, role: user.role, branch_id: user.branch_id ?? null }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Token talab qilinadi' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token yaroqsiz yoki muddati tugagan' });
  }
}

/**
 * Rolni tokendan emas, bazadan tekshiradi: o'chirilgan/bloklangan ishchi yoki filial
 * eski tokeni bilan kira olmaydi. req.user yangilangan ma'lumot bilan almashtiriladi.
 */
const requireRole = (...roles) => (req, res, next) => {
  const u = db.prepare(
    `SELECT u.id, u.username, u.role, u.branch_id, u.active, b.active AS branch_active
     FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?`
  ).get(req.user?.id);
  if (!u || !u.active) return res.status(401).json({ error: 'Hisob topilmadi yoki bloklangan' });
  if (!roles.includes(u.role)) return res.status(403).json({ error: 'Bu amal uchun ruxsat yo\'q' });
  if (['branch_admin', 'worker'].includes(u.role) && !u.branch_active)
    return res.status(403).json({ error: 'Filial faol emas' });
  req.user = { id: u.id, username: u.username, role: u.role, branch_id: u.branch_id };
  next();
};

const superAdmin = requireRole('superadmin');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { signToken, auth, requireRole, superAdmin, wrap };
