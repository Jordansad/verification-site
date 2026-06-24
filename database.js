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
    service_type   TEXT DEFAULT 'verification',
    code_type_id   INTEGER NOT NULL REFERENCES code_types(id),
    code           TEXT NOT NULL,
    nom            TEXT,
    prenom         TEXT,
    email          TEXT,
    montant        TEXT,
    motif          TEXT,
    status         TEXT DEFAULT 'pending',
    admin_comment  TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/* ── Migrations pour bases existantes ── */
const cols = db.prepare("PRAGMA table_info(submissions)").all().map(c => c.name);
if (!cols.includes('service_type')) db.exec("ALTER TABLE submissions ADD COLUMN service_type TEXT DEFAULT 'verification'");
if (!cols.includes('nom'))          db.exec("ALTER TABLE submissions ADD COLUMN nom TEXT");
if (!cols.includes('prenom'))       db.exec("ALTER TABLE submissions ADD COLUMN prenom TEXT");
if (!cols.includes('montant'))      db.exec("ALTER TABLE submissions ADD COLUMN montant TEXT");
if (!cols.includes('motif'))        db.exec("ALTER TABLE submissions ADD COLUMN motif TEXT");

/* ── Seed admin ── */
if (!db.prepare('SELECT id FROM admins WHERE email=?').get('admin@verification.fr')) {
  db.prepare('INSERT INTO admins (email,password_hash,name) VALUES (?,?,?)').run(
    'admin@verification.fr',
    bcrypt.hashSync('Admin@2024', 10),
    'Administrateur'
  );
  console.log('✅ Admin créé → admin@verification.fr / Admin@2024');
}

/* ── Seed code types (4 types uniquement) ── */
const types = [
  ['Transcash', 'Carte prépayée Transcash — 12 chiffres'],
  ['Neosurf',   'Voucher Neosurf — 10 chiffres'],
  ['PCS',       'Carte PCS — 10 caractères alphanumériques'],
  ['STEAM',     'Code Steam — 15 caractères alphanumériques']
];
const insertType = db.prepare('INSERT OR IGNORE INTO code_types (name,description) VALUES (?,?)');
types.forEach(([n, d]) => insertType.run(n, d));

module.exports = db;
