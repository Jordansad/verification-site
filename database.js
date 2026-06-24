const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'verification.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS code_types (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    active      INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dossier_number TEXT UNIQUE NOT NULL,
    code_type_id   INTEGER NOT NULL REFERENCES code_types(id),
    code           TEXT NOT NULL,
    name           TEXT,
    email          TEXT,
    status         TEXT DEFAULT 'pending',
    admin_comment  TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/* ── Seed admin ── */
if (!db.prepare('SELECT id FROM admins WHERE email=?').get('admin@verification.fr')) {
  db.prepare('INSERT INTO admins (email,password_hash,name) VALUES (?,?,?)').run(
    'admin@verification.fr',
    bcrypt.hashSync('Admin@2024', 10),
    'Administrateur'
  );
  console.log('✅ Admin créé → admin@verification.fr / Admin@2024');
}

/* ── Seed code types ── */
const defaultTypes = [
  ['Carte cadeau',         'Cartes cadeaux de toutes enseignes'],
  ['Coupon promotionnel',  'Codes de réduction et coupons'],
  ['Voucher prépayé',      'Vouchers et bons prépayés'],
  ['Ticket électronique',  'Tickets dématérialisés et e-tickets'],
  ['Code de service',      'Codes d\'activation de services'],
  ['Autre',                'Tout autre type de code']
];
const insertType = db.prepare('INSERT OR IGNORE INTO code_types (name,description) VALUES (?,?)');
defaultTypes.forEach(([n, d]) => insertType.run(n, d));

module.exports = db;
