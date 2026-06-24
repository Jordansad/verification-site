const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const db      = require('./database');

const app    = express();
const PORT   = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || 'vs_jwt_secret_2024_change_in_prod';

app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ── Middleware ── */
function authAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const d = jwt.verify(token, SECRET);
    if (d.role !== 'admin') return res.status(403).json({ error: 'Accès interdit' });
    req.admin = d; next();
  } catch { res.status(401).json({ error: 'Token invalide' }); }
}

/* ── Helpers ── */
function genDossier() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = 'VS-';
  for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

/* ════════════════════════════════════
   PUBLIC
════════════════════════════════════ */

app.get('/api/code-types', (req, res) => {
  res.json({ types: db.prepare('SELECT id,name,description FROM code_types WHERE active=1 ORDER BY name').all() });
});

app.post('/api/submit', (req, res) => {
  const { service_type, code_type_id, code, nom, prenom, email, montant, motif } = req.body;
  if (!code_type_id || !code?.trim()) return res.status(400).json({ error: 'Type de code et code requis' });
  if (!['verification','remboursement'].includes(service_type))
    return res.status(400).json({ error: 'Type de service invalide' });

  const ct = db.prepare('SELECT id FROM code_types WHERE id=? AND active=1').get(code_type_id);
  if (!ct) return res.status(400).json({ error: 'Type de code invalide' });

  let dossier, tries = 0;
  do { dossier = genDossier(); tries++; }
  while (db.prepare('SELECT id FROM submissions WHERE dossier_number=?').get(dossier) && tries < 20);

  const r = db.prepare(
    'INSERT INTO submissions (dossier_number,service_type,code_type_id,code,nom,prenom,email,montant,motif) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(dossier, service_type, code_type_id, code.trim().toUpperCase(),
        nom?.trim() || null, prenom?.trim() || null, email?.trim() || null,
        montant?.trim() || null, motif?.trim() || null);

  res.json({ success: true, dossier, id: r.lastInsertRowid });
});

app.get('/api/track/:dossier', (req, res) => {
  const s = db.prepare(`
    SELECT s.id, s.dossier_number, s.service_type, s.nom, s.prenom, s.status,
           s.admin_comment, s.created_at, s.updated_at, ct.name code_type_name
    FROM submissions s LEFT JOIN code_types ct ON s.code_type_id=ct.id
    WHERE s.dossier_number=?
  `).get(req.params.dossier.trim().toUpperCase());
  if (!s) return res.status(404).json({ error: 'Numéro de dossier introuvable' });
  res.json({ submission: s });
});

/* ════════════════════════════════════
   AUTH
════════════════════════════════════ */

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE email=?').get(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.name, role: 'admin' }, SECRET, { expiresIn: '8h' });
  res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
});

/* ════════════════════════════════════
   ADMIN — Stats
════════════════════════════════════ */

app.get('/api/admin/stats', authAdmin, (req, res) => {
  const g = (q, ...p) => db.prepare(q).get(...p);
  res.json({
    total:           g("SELECT COUNT(*) n FROM submissions").n,
    pending:         g("SELECT COUNT(*) n FROM submissions WHERE status='pending'").n,
    processing:      g("SELECT COUNT(*) n FROM submissions WHERE status='processing'").n,
    valid:           g("SELECT COUNT(*) n FROM submissions WHERE status='valid'").n,
    invalid:         g("SELECT COUNT(*) n FROM submissions WHERE status='invalid'").n,
    used:            g("SELECT COUNT(*) n FROM submissions WHERE status='used'").n,
    expired:         g("SELECT COUNT(*) n FROM submissions WHERE status='expired'").n,
    completed:       g("SELECT COUNT(*) n FROM submissions WHERE status='completed'").n,
    today:           g("SELECT COUNT(*) n FROM submissions WHERE DATE(created_at)=DATE('now')").n,
    verifications:   g("SELECT COUNT(*) n FROM submissions WHERE service_type='verification'").n,
    remboursements:  g("SELECT COUNT(*) n FROM submissions WHERE service_type='remboursement'").n,
    byType:          db.prepare("SELECT ct.name, COUNT(s.id) n FROM code_types ct LEFT JOIN submissions s ON s.code_type_id=ct.id WHERE ct.active=1 GROUP BY ct.id ORDER BY n DESC").all(),
    recent:          db.prepare("SELECT s.*,ct.name code_type_name FROM submissions s LEFT JOIN code_types ct ON s.code_type_id=ct.id ORDER BY s.created_at DESC LIMIT 8").all()
  });
});

/* ════════════════════════════════════
   ADMIN — Submissions
════════════════════════════════════ */

app.get('/api/admin/submissions', authAdmin, (req, res) => {
  const { status, type_id, service_type, search, page = 1, limit = 25 } = req.query;
  let where = [], p = [];
  if (status)       { where.push('s.status=?'); p.push(status); }
  if (type_id)      { where.push('s.code_type_id=?'); p.push(type_id); }
  if (service_type) { where.push('s.service_type=?'); p.push(service_type); }
  if (search)       { where.push('(s.dossier_number LIKE ? OR s.code LIKE ? OR s.nom LIKE ? OR s.prenom LIKE ? OR s.email LIKE ?)'); p.push(...Array(5).fill(`%${search}%`)); }
  const ws = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM submissions s${ws}`).get(...p).n;
  p.push(+limit, (+page - 1) * +limit);
  const submissions = db.prepare(`
    SELECT s.*,ct.name code_type_name FROM submissions s
    LEFT JOIN code_types ct ON s.code_type_id=ct.id
    ${ws} ORDER BY s.created_at DESC LIMIT ? OFFSET ?
  `).all(...p);
  res.json({ submissions, total, page: +page, pages: Math.ceil(total / +limit) });
});

app.get('/api/admin/submissions/:id', authAdmin, (req, res) => {
  const s = db.prepare(`
    SELECT s.*,ct.name code_type_name FROM submissions s
    LEFT JOIN code_types ct ON s.code_type_id=ct.id WHERE s.id=?
  `).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Introuvable' });
  res.json({ submission: s });
});

app.put('/api/admin/submissions/:id', authAdmin, (req, res) => {
  const { status, admin_comment } = req.body;
  const valid = ['pending','processing','valid','invalid','used','expired','completed'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  db.prepare('UPDATE submissions SET status=?,admin_comment=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(status, admin_comment?.trim() || null, req.params.id);
  res.json({ success: true });
});

/* ════════════════════════════════════
   ADMIN — Code Types
════════════════════════════════════ */

app.get('/api/admin/code-types', authAdmin, (req, res) => {
  res.json({ types: db.prepare('SELECT * FROM code_types ORDER BY name').all() });
});

app.post('/api/admin/code-types', authAdmin, (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  try {
    const r = db.prepare('INSERT INTO code_types (name,description) VALUES (?,?)').run(name.trim(), description?.trim() || null);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Ce type existe déjà' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/code-types/:id', authAdmin, (req, res) => {
  const { name, description, active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  try {
    db.prepare('UPDATE code_types SET name=?,description=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name.trim(), description?.trim() || null, active ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Ce nom est déjà utilisé' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/code-types/:id', authAdmin, (req, res) => {
  const n = db.prepare('SELECT COUNT(*) n FROM submissions WHERE code_type_id=?').get(req.params.id).n;
  if (n > 0) return res.status(409).json({ error: `Impossible : ${n} soumission(s) liée(s)` });
  db.prepare('DELETE FROM code_types WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

/* ════════════════════════════════════
   START
════════════════════════════════════ */

app.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║   Vérification Site — Serveur démarré    ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log(`\n🌐 Site public : http://localhost:${PORT}`);
  console.log(`📊 Admin       : http://localhost:${PORT}/admin.html`);
  console.log('\n🔐 Admin: admin@verification.fr / Admin@2024\n');
});
