const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const db = new DatabaseSync(process.env.DB_PATH || 'pizza.db');

const ROLES = ['user', 'superadmin', 'branch_admin', 'worker'];
const ORDER_STATUSES = ['new', 'preparing', 'delivering', 'delivered', 'cancelled'];

const list = (arr) => arr.map((v) => `'${v}'`).join(',');

// Jadval sxemalari funksiya ko'rinishida: migratsiyada vaqtinchalik nom bilan yaratish uchun
const usersTable = (name = 'users') => `
CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN (${list(ROLES)})),
  branch_id INTEGER REFERENCES branches(id),
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const ordersTable = (name = 'orders') => `
CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  worker_id INTEGER REFERENCES users(id),
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (${list(ORDER_STATUSES)})),
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TEXT,
  delivered_at TEXT
)`;

db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
${usersTable()};
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category_id INTEGER NOT NULL REFERENCES categories(id),
  branch_id INTEGER REFERENCES branches(id),
  price_22 REAL NOT NULL,
  price_28 REAL NOT NULL,
  price_33 REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
${ordersTable()};
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size INTEGER NOT NULL CHECK (size IN (22,28,33)),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL
);
`);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Eski bazani yangi sxemaga o'tkazish (ma'lumotlar saqlanadi) ----------
const tableSql = (name) => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql || '';
const columns = (name) => db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);

function migrate() {
  const needUsers = !tableSql('users').includes('branch_admin');
  const needOrders = !tableSql('orders').includes('delivering');
  const needProducts = !columns('products').includes('branch_id');
  if (!needUsers && !needOrders && !needProducts) return;

  // SQLite CHECK cheklovini o'zgartirib bo'lmaydi — jadvalni qayta qurish kerak (rasmiy 12-qadamli usul)
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(() => {
      if (needUsers) {
        db.exec(usersTable('users_new'));
        db.exec(`INSERT INTO users_new (id, username, password_hash, role, created_at)
                 SELECT id, username, password_hash, role, created_at FROM users`);
        db.exec('DROP TABLE users');
        db.exec('ALTER TABLE users_new RENAME TO users');
      }
      if (needOrders) {
        db.exec(ordersTable('orders_new'));
        db.exec(`INSERT INTO orders_new (id, user_id, total, status, created_at)
                 SELECT id, user_id, total, status, created_at FROM orders`);
        db.exec('DROP TABLE orders');
        db.exec('ALTER TABLE orders_new RENAME TO orders');
      }
      if (needProducts) db.exec('ALTER TABLE products ADD COLUMN branch_id INTEGER REFERENCES branches(id)');
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Migratsiya: foreign key xatosi ${JSON.stringify(broken.slice(0, 3))}`);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  console.log('Baza yangi sxemaga o\'tkazildi (filiallar va ishchilar)');
}

migrate();
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id, role);
CREATE INDEX IF NOT EXISTS idx_products_branch ON products(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_worker ON orders(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
`);

// Birinchi ishga tushirishda super admin yaratiladi
const adminName = process.env.ADMIN_USERNAME || 'admin';
if (!db.prepare('SELECT id FROM users WHERE username = ?').get(adminName)) {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    adminName,
    bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
    'superadmin'
  );
}

module.exports = { db, transaction, ROLES, ORDER_STATUSES };
