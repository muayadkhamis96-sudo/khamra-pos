/* Khamra POS — central API. One file, zero npm dependencies.
   Node 24+ (uses the built-in node:sqlite). Runs in a container behind Caddy
   at https://khamra.38.54.116.48.sslip.io/api/* — Caddy serves the static app,
   this process owns the data. All money is stored as INTEGER baisa (OMR×1000)
   so sums are exact; the JSON boundary speaks OMR floats like the client.

   Auth: the till's PIN, but verified HERE, not in the browser — the client-side
   PIN gate is just a screen lock. Login issues an httpOnly session cookie.  */

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const PORT = +(process.env.PORT || 8792);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'khamra.db');
const DEFAULT_PIN = process.env.DEFAULT_PIN || '123456';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // one booth shift
const MAX_BODY = 20 * 1024 * 1024;            // import/menu carry base64 photos
const LOGIN_MAX = 8, LOGIN_WINDOW_MS = 10 * 60 * 1000;

// This process serves the static app too (SERVE_STATIC=1 in the container,
// DEV=1 locally) — one origin for app + API everywhere; in production Caddy
// terminates HTTPS in front and proxies the whole hostname here.
// Cookies drop the Secure flag only in DEV, because localhost is plain http.
const DEV = !!process.env.DEV;
const SERVE_STATIC = DEV || !!process.env.SERVE_STATIC;
const APP_ROOT = path.join(__dirname, '..');
const COOKIE_FLAGS = '; Path=/; HttpOnly; SameSite=Lax' + (DEV ? '' : '; Secure');

// --- Database ----------------------------------------------------------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS kv       (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS menu     (id TEXT PRIMARY KEY, ar TEXT NOT NULL DEFAULT '', en TEXT NOT NULL DEFAULT '',
                                       price INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'drinks',
                                       icon TEXT, photo TEXT, stock INTEGER, pos INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sales    (id TEXT PRIMARY KEY, no INTEGER UNIQUE NOT NULL, ts INTEGER NOT NULL,
                                       iso TEXT, day TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'cash',
                                       total INTEGER NOT NULL, count INTEGER NOT NULL, items TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL,
                                       category TEXT NOT NULL DEFAULT 'other', desc TEXT NOT NULL DEFAULT '',
                                       amount INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS expense_cats (name TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_sales_day ON sales(day);
  CREATE INDEX IF NOT EXISTS idx_expenses_day ON expenses(day);
`);

// --- Money: OMR float <-> baisa int ------------------------------------
function toB(x)   { var n = Number(x); return isFinite(n) ? Math.round(n * 1000) : 0; }
function fromB(n) { return (n | 0) / 1000; }

// --- PIN (scrypt, stored salt:hash in kv) ------------------------------
function kvGet(k)    { const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k); return r ? r.v : null; }
function kvSet(k, v) { db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v); }

function hashPin(pin, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function verifyPin(pin) {
  const stored = kvGet('pin');
  if (!stored) return false;
  const parts = stored.split(':');
  const candidate = hashPin(pin, parts[0]).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(parts[1], 'hex'), Buffer.from(candidate, 'hex'));
}
if (!kvGet('pin')) kvSet('pin', hashPin(DEFAULT_PIN));

// --- Sessions ----------------------------------------------------------
function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
  db.prepare('INSERT INTO sessions (id, created, expires) VALUES (?, ?, ?)').run(id, now, now + SESSION_TTL_MS);
  return id;
}
function sessionValid(id) {
  if (!id) return false;
  const r = db.prepare('SELECT expires FROM sessions WHERE id = ?').get(id);
  return !!r && r.expires > Date.now();
}
function cookieOf(req) {
  const m = /(?:^|;\s*)khamra_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

// --- Login rate limit (per IP; Caddy overwrites X-Forwarded-For) -------
const attempts = new Map();
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return xf ? String(xf).split(',')[0].trim() : (req.socket.remoteAddress || '?');
}
function rateLimited(ip) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || now > a.reset) { a = { n: 0, reset: now + LOGIN_WINDOW_MS }; attempts.set(ip, a); }
  a.n++;
  return a.n > LOGIN_MAX;
}

// --- Row <-> JSON ------------------------------------------------------
function menuRow(m)   { return { id: m.id, ar: m.ar, en: m.en, price: fromB(m.price), category: m.category,
                                 icon: m.icon || null, photo: m.photo || null,
                                 stock: (m.stock === null || m.stock === undefined) ? null : m.stock }; }
function saleRow(s)   { return { id: s.id, no: s.no, ts: s.ts, iso: s.iso, day: s.day, method: s.method,
                                 total: fromB(s.total), count: s.count, items: JSON.parse(s.items) }; }
function expenseRow(e){ return { id: e.id, ts: e.ts, day: e.day, category: e.category, desc: e.desc, amount: fromB(e.amount) }; }

// --- Validation --------------------------------------------------------
function isDay(s)  { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function dayOf(ts) { // container runs TZ=Asia/Muscat, so local date = booth date
  const d = new Date(ts), p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function validSaleBody(s) {
  return s && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 64 &&
    Array.isArray(s.items) && s.items.length > 0 && s.items.length <= 200 &&
    s.items.every(i => i && typeof i.id === 'string' && isFinite(Number(i.price)) && (i.qty | 0) > 0) &&
    isFinite(Number(s.total)) && (s.method === 'cash' || s.method === 'card');
}

// --- HTTP plumbing -----------------------------------------------------
function send(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
  res.end(body);
}
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
function tx(fn) { // run fn inside an exclusive-enough transaction
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}

// --- Handlers ----------------------------------------------------------
const routes = {

  'GET /api/health': (req, res) => send(res, 200, { ok: true, ts: Date.now() }),

  'POST /api/login': async (req, res) => {
    const ip = clientIp(req);
    if (rateLimited(ip)) return send(res, 429, { error: 'rateLimited' });
    const body = await readJSON(req);
    if (!verifyPin(String(body.pin || ''))) return send(res, 401, { error: 'wrongPin' });
    attempts.delete(ip);
    const sid = createSession();
    send(res, 200, { ok: true }, {
      'Set-Cookie': 'khamra_sid=' + sid + COOKIE_FLAGS + '; Max-Age=' + (SESSION_TTL_MS / 1000)
    });
  },

  'POST /api/logout': (req, res) => {
    const sid = cookieOf(req);
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    send(res, 200, { ok: true }, { 'Set-Cookie': 'khamra_sid=' + COOKIE_FLAGS + '; Max-Age=0' });
  },

  // Everything the till needs to boot and sell.
  'GET /api/bootstrap': (req, res) => {
    const menu = db.prepare('SELECT * FROM menu ORDER BY pos').all().map(menuRow);
    const settings = JSON.parse(kvGet('settings') || '{}');
    send(res, 200, { menu, settings, pinIsDefault: verifyPin(DEFAULT_PIN) });
  },

  // Full replace — the client's menu editor saves the whole array, order included.
  'PUT /api/menu': async (req, res) => {
    const body = await readJSON(req);
    if (!Array.isArray(body.menu)) return send(res, 400, { error: 'badMenu' });
    tx(() => {
      db.prepare('DELETE FROM menu').run();
      const ins = db.prepare('INSERT INTO menu (id, ar, en, price, category, icon, photo, stock, pos) VALUES (?,?,?,?,?,?,?,?,?)');
      body.menu.forEach((m, i) => {
        if (!m || typeof m.id !== 'string') return;
        ins.run(m.id, String(m.ar || ''), String(m.en || ''), toB(m.price), String(m.category || 'drinks'),
                m.icon || null, m.photo || null, (typeof m.stock === 'number') ? Math.max(0, m.stock | 0) : null, i);
      });
    });
    send(res, 200, { ok: true });
  },

  'PATCH /api/stock': async (req, res) => {
    const body = await readJSON(req);
    if (typeof body.id !== 'string') return send(res, 400, { error: 'badId' });
    const stock = (body.stock === null || body.stock === undefined) ? null : Math.max(0, body.stock | 0);
    db.prepare('UPDATE menu SET stock = ? WHERE id = ?').run(stock, body.id);
    send(res, 200, { ok: true, stock });
  },

  // Idempotent: the client's sale id is the key. Replaying a queued sale after
  // a dropped connection can never double-record or double-decrement stock.
  'POST /api/sales': async (req, res) => {
    const body = await readJSON(req);
    const s = body.sale;
    if (!validSaleBody(s)) return send(res, 400, { error: 'badSale' });
    const out = tx(() => {
      const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(s.id);
      if (existing) return { sale: saleRow(existing), duplicate: true };
      const no = db.prepare('SELECT COALESCE(MAX(no),0)+1 AS n FROM sales').get().n;
      const ts = isFinite(s.ts) ? +s.ts : Date.now();
      const day = isDay(s.day) ? s.day : dayOf(ts);
      const count = isFinite(s.count) ? s.count | 0 : s.items.reduce((a, i) => a + (i.qty | 0), 0);
      db.prepare('INSERT INTO sales (id, no, ts, iso, day, method, total, count, items) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(s.id, no, ts, s.iso || new Date(ts).toISOString(), day, s.method, toB(s.total), count, JSON.stringify(s.items));
      const dec = db.prepare("UPDATE menu SET stock = MAX(0, stock - ?) WHERE id = ? AND category = 'sweets' AND stock IS NOT NULL");
      s.items.forEach(i => dec.run(i.qty | 0, i.id));
      return { sale: saleRow(db.prepare('SELECT * FROM sales WHERE id = ?').get(s.id)), duplicate: false };
    });
    send(res, 200, out);
  },

  'GET /api/sales': (req, res, url) => {
    const day = url.searchParams.get('day');
    const rows = day
      ? db.prepare('SELECT * FROM sales WHERE day = ? ORDER BY ts').all(day)
      : db.prepare('SELECT * FROM sales ORDER BY ts').all();
    send(res, 200, { sales: rows.map(saleRow) });
  },

  'GET /api/expenses': (req, res) => {
    send(res, 200, {
      expenses: db.prepare('SELECT * FROM expenses ORDER BY ts').all().map(expenseRow),
      cats: db.prepare('SELECT name FROM expense_cats ORDER BY name').all().map(r => r.name)
    });
  },

  'POST /api/expenses': async (req, res) => {
    const body = await readJSON(req);
    const e = body.expense || {};
    const now = Date.now();
    const rec = {
      id: (typeof e.id === 'string' && e.id) ? e.id.slice(0, 64) : 'E' + now + '-' + Math.floor(Math.random() * 1000),
      ts: isFinite(e.ts) ? +e.ts : now,
      day: isDay(e.day) ? e.day : dayOf(now),
      category: String(e.category || 'other').slice(0, 64),
      desc: String(e.desc || '').slice(0, 500),
      amount: Math.max(0, toB(e.amount))
    };
    db.prepare('INSERT INTO expenses (id, ts, day, category, desc, amount) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(rec.id, rec.ts, rec.day, rec.category, rec.desc, rec.amount);
    send(res, 200, { expense: expenseRow(db.prepare('SELECT * FROM expenses WHERE id = ?').get(rec.id)) });
  },

  'POST /api/cats': async (req, res) => {
    const body = await readJSON(req);
    const name = String(body.name || '').trim().slice(0, 64);
    if (name) db.prepare('INSERT INTO expense_cats (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
    send(res, 200, { cats: db.prepare('SELECT name FROM expense_cats ORDER BY name').all().map(r => r.name) });
  },

  'GET /api/settings': (req, res) => send(res, 200, { settings: JSON.parse(kvGet('settings') || '{}') }),

  'PUT /api/settings': async (req, res) => {
    const body = await readJSON(req);
    if (!body.settings || typeof body.settings !== 'object') return send(res, 400, { error: 'badSettings' });
    kvSet('settings', JSON.stringify(body.settings));
    send(res, 200, { ok: true });
  },

  'POST /api/pin': async (req, res) => {
    const body = await readJSON(req);
    if (!verifyPin(String(body.current || ''))) return send(res, 401, { error: 'wrongPin' });
    if (!/^\d{6}$/.test(String(body.next || ''))) return send(res, 400, { error: 'badPin' });
    kvSet('pin', hashPin(String(body.next)));
    send(res, 200, { ok: true });
  },

  // Merge a device backup (the app's Backup JSON) into the central DB.
  // Same semantics as the client's importBackup: existing ids win, only
  // missing records are added. Historical sales do NOT touch stock.
  'POST /api/import': async (req, res) => {
    const data = await readJSON(req);
    const added = { menu: 0, sales: 0, expenses: 0, cats: 0 };
    let skipped = 0;
    tx(() => {
      if (Array.isArray(data.menu)) {
        const have = new Set(db.prepare('SELECT id FROM menu').all().map(r => r.id));
        let pos = db.prepare('SELECT COALESCE(MAX(pos),-1)+1 AS p FROM menu').get().p;
        const ins = db.prepare('INSERT INTO menu (id, ar, en, price, category, icon, photo, stock, pos) VALUES (?,?,?,?,?,?,?,?,?)');
        const fillPhoto = db.prepare("UPDATE menu SET photo = ? WHERE id = ? AND (photo IS NULL OR photo = '')");
        data.menu.forEach(m => {
          if (!m || typeof m.id !== 'string') { skipped++; return; }
          if (have.has(m.id)) {
            // Existing item wins — but the very first login seeds the default
            // menu (photo-less) before the device backup arrives, so backfill
            // a photo the server doesn't have yet rather than drop it.
            if (m.photo && fillPhoto.run(String(m.photo), m.id).changes > 0) added.menu++;
            return;
          }
          ins.run(m.id, String(m.ar || ''), String(m.en || ''), toB(m.price), String(m.category || 'drinks'),
                  m.icon || null, m.photo || null, (typeof m.stock === 'number') ? Math.max(0, m.stock | 0) : null, pos++);
          have.add(m.id); added.menu++;
        });
      }
      if (Array.isArray(data.sales)) {
        let nextNo = db.prepare('SELECT COALESCE(MAX(no),0)+1 AS n FROM sales').get().n;
        const noTaken = db.prepare('SELECT 1 AS x FROM sales WHERE no = ?');
        const ins = db.prepare('INSERT INTO sales (id, no, ts, iso, day, method, total, count, items) VALUES (?,?,?,?,?,?,?,?,?)');
        data.sales.forEach(s => {
          if (!validSaleBody(s) || !isFinite(s.ts)) { skipped++; return; }
          if (db.prepare('SELECT 1 AS x FROM sales WHERE id = ?').get(s.id)) return;
          let no = (isFinite(s.no) && (s.no | 0) > 0 && !noTaken.get(s.no | 0)) ? s.no | 0 : nextNo;
          const count = isFinite(s.count) ? s.count | 0 : s.items.reduce((a, i) => a + (i.qty | 0), 0);
          ins.run(s.id, no, +s.ts, s.iso || null, isDay(s.day) ? s.day : dayOf(+s.ts),
                  s.method === 'card' ? 'card' : 'cash', toB(s.total), count, JSON.stringify(s.items));
          if (no >= nextNo) nextNo = no + 1;
          added.sales++;
        });
      }
      if (Array.isArray(data.expenses)) {
        const ins = db.prepare('INSERT INTO expenses (id, ts, day, category, desc, amount) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING');
        data.expenses.forEach(e => {
          if (!e || typeof e.id !== 'string' || !isDay(e.day)) { skipped++; return; }
          const r = ins.run(e.id, isFinite(e.ts) ? +e.ts : Date.parse(e.day), e.day,
                            String(e.category || 'other'), String(e.desc || ''), Math.max(0, toB(e.amount)));
          if (r.changes > 0) added.expenses++;
        });
      }
      if (Array.isArray(data.expenseCats)) {
        const ins = db.prepare('INSERT INTO expense_cats (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
        data.expenseCats.forEach(c => {
          if (typeof c !== 'string' || !c.trim()) { skipped++; return; }
          if (ins.run(c.trim()).changes > 0) added.cats++;
        });
      }
    });
    send(res, 200, { added, skipped });
  }
};

// Routes with an id in the path.
function dynamicRoute(method, pathname, req, res) {
  let m;
  if ((m = /^\/api\/expenses\/([^/]+)$/.exec(pathname))) {
    const id = decodeURIComponent(m[1]);
    if (method === 'DELETE') {
      db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
      return send(res, 200, { ok: true });
    }
    if (method === 'PATCH') {
      return readJSON(req).then(body => {
        const cur = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
        if (!cur) return send(res, 404, { error: 'notFound' });
        const day = isDay(body.day) ? body.day : cur.day;
        db.prepare('UPDATE expenses SET day = ?, category = ?, desc = ?, amount = ? WHERE id = ?')
          .run(day,
               body.category !== undefined ? String(body.category).slice(0, 64) : cur.category,
               body.desc !== undefined ? String(body.desc).slice(0, 500) : cur.desc,
               body.amount !== undefined ? Math.max(0, toB(body.amount)) : cur.amount,
               id);
        send(res, 200, { expense: expenseRow(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)) });
      });
    }
  }
  if ((m = /^\/api\/cats\/([^/]+)$/.exec(pathname)) && method === 'DELETE') {
    db.prepare('DELETE FROM expense_cats WHERE name = ?').run(decodeURIComponent(m[1]));
    return send(res, 200, { cats: db.prepare('SELECT name FROM expense_cats ORDER BY name').all().map(r => r.name) });
  }
  if ((m = /^\/api\/sales\/([^/]+)$/.exec(pathname)) && method === 'DELETE') {
    db.prepare('DELETE FROM sales WHERE id = ?').run(decodeURIComponent(m[1]));
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/sales' && method === 'DELETE') {   // Settings → clear all sales
    db.prepare('DELETE FROM sales').run();
    return send(res, 200, { ok: true });
  }
  return null;
}

const PUBLIC = { 'GET /api/health': 1, 'POST /api/login': 1 };

// --- DEV static serving (production: Caddy does this) -------------------
const MIME = { html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8',
               css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png',
               jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon',
               pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', woff2: 'font/woff2' };
function serveStatic(res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') p = '/index.html';
  // never serve dotfiles or the server dir (the DB lives there in dev)
  if (p.includes('..') || p.includes('/.') || p.startsWith('/server')) return send(res, 404, { error: 'notFound' });
  const file = path.join(APP_ROOT, p);
  if (!file.startsWith(APP_ROOT)) return send(res, 404, { error: 'notFound' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'notFound' });
    const ext = path.extname(file).slice(1).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const key = req.method + ' ' + url.pathname;
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (SERVE_STATIC && req.method === 'GET') return serveStatic(res, url.pathname);
      return send(res, 404, { error: 'notFound' });
    }
    const needsAuth = !PUBLIC[key];
    if (needsAuth && !sessionValid(cookieOf(req))) return send(res, 401, { error: 'unauthorized' });
    const handler = routes[key];
    if (handler) return await handler(req, res, url);
    const dyn = dynamicRoute(req.method, url.pathname, req, res);
    if (dyn !== null) return await dyn;
    send(res, 404, { error: 'notFound' });
  } catch (e) {
    if (e.message === 'too_large') return send(res, 413, { error: 'tooLarge' });
    if (e.message === 'bad_json') return send(res, 400, { error: 'badJson' });
    console.error(new Date().toISOString(), req.method, url.pathname, e);
    send(res, 500, { error: 'server' });
  }
});

server.listen(PORT, () => console.log('khamra-api listening on :' + PORT + ' db=' + DB_PATH));
