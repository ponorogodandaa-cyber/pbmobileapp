// blaze-pedia/server.js
'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const TEMPLATE_PATH = path.join(DATA_DIR, 'template.user.js');

const PORT = Number(process.env.PORT || 3000);
let PUBLIC_URL = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
let AUTH_SECRET = String(process.env.AUTH_SECRET || 'blaze-dev-auth-change-me');
let PAYMENT_SECRET = String(process.env.PAYMENT_SECRET || 'blaze-dev-payment-change-me');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TEMPLATE_PATH)) {
  throw new Error('data/template.user.js missing. Letakkan template userscript di sana.');
}

const hmac = value => crypto.createHmac('sha256', AUTH_SECRET).update(String(value)).digest('hex');
const paymentHmac = value => crypto.createHmac('sha256', PAYMENT_SECRET).update(value).digest('hex');
const uid = prefix => prefix + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();
const nowIso = () => new Date().toISOString();
const addDays = (from, days) => new Date(Date.parse(from) + Number(days) * 86400000).toISOString();

const genKey = () => {
  const block = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `BLAZE-${block()}-${block()}-${block()}-${block()}`;
};

const canaryFor = key => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 10).toUpperCase();

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const defaultDb = () => ({
  products: [{
    id: 'pb-simple',
    name: 'BLAZE PB Kit',
    desc: 'ESP + auto aim ringan untuk PB Mobile browser. Pasang lewat Tampermonkey.',
    active: true,
    prices: { 7: 35000, 30: 99000, 90: 249000 }
  }],
  orders: [],
  licenses: [],
  updates: [{
    id: uid('UPD'),
    version: '1.1.0',
    body: 'Status pindah ke DOM overlay. ESP tidak ikut mati saat bidik error.',
    createdAt: nowIso()
  }],
  settings: {
    storeName: 'BLAZE PEDIA',
    supportUrl: 'https://t.me/blazepedia',
    qris: '',
    publicUrl: PUBLIC_URL,
    paymentSecretNote: 'Isi di .env / environment variable PAYMENT_SECRET untuk webhook otomatis.',
    pinHash: hmac(process.env.ADMIN_PIN || 'blaze123')
  }
});

let db;
try {
  db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!db.products || !db.orders || !db.licenses || !db.settings) throw new Error('format db tidak valid');
} catch (_) {
  db = defaultDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const saveDb = () => {
  const temp = DB_PATH + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_PATH);
};

const publicBase = () => db.settings.publicUrl || PUBLIC_URL || '';

const makeToken = payload => {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 12 * 3600000 }))
    .toString('base64url');
  return body + '.' + hmac(body);
};

const readToken = token => {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !safeEqual(parts[1], hmac(parts[0]))) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!data.exp || data.exp <= Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
};

const makeDownloadToken = key => {
  const body = Buffer.from(JSON.stringify({
    k: String(key),
    n: uid('DL'),
    exp: Date.now() + 15 * 60000
  })).toString('base64url');
  return body + '.' + hmac(body);
};

const readDownloadToken = token => {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !safeEqual(parts[1], hmac(parts[0]))) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!data.k || !data.exp || data.exp <= Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
};

const renderTemplate = key => {
  const license = db.licenses.find(item => item.key === key);
  const source = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return source
    .split('__BLAZE_LICENSE__').join(key)
    .split('__BLAZE_API__').join(publicBase())
    .split('__BLAZE_CANARY__').join(license ? license.canary : canaryFor(key));
};

const licenseView = license => {
  const product = db.products.find(item => item.id === license.productId);
  return {
    key: license.key,
    orderId: license.orderId,
    productId: license.productId,
    productName: product ? product.name : license.productId,
    buyer: license.buyer || '',
    contact: license.contact || '',
    days: license.days,
    issuedAt: license.issuedAt,
    expiresAt: license.expiresAt,
    status: license.status,
    device: license.device || null,
    canary: license.canary
  };
};

const expired = license => Date.parse(license.expiresAt) <= Date.now();
const licenseActive = license => license && license.status === 'active' && !expired(license);

const activateOrder = order => {
  order.paid = true;
  order.status = 'paid';
  order.paidAt = order.paidAt || nowIso();

  let license = db.licenses.find(item => item.orderId === order.id);
  if (!license) {
    const key = genKey();
    license = {
      key,
      orderId: order.id,
      productId: order.productId,
      days: order.days,
      buyer: order.buyer,
      contact: order.contact,
      issuedAt: nowIso(),
      expiresAt: addDays(nowIso(), order.days),
      status: 'active',
      device: null,
      canary: canaryFor(key)
    };
    db.licenses.push(license);
  }
  return license;
};

const app = express();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({
  limit: '4mb',
  verify: (req, _res, buffer) => { req.rawBody = buffer; }
}));
app.use('/api', rateLimit({
  windowMs: 60000,
  max: 180,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Terlalu banyak request. Tunggu sebentar.' }
}));

const requireAdmin = (req, res, next) => {
  const raw = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const data = readToken(raw);
  if (!data || data.admin !== true) return res.status(401).json({ error: 'Owner belum login' });
  req.admin = data;
  next();
};

app.get('/api/health', (_req, res) => res.json({ ok: true, store: db.settings.storeName }));

app.get('/api/settings', (_req, res) => {
  res.json({
    storeName: db.settings.storeName,
    supportUrl: db.settings.supportUrl,
    qris: db.settings.qris || '',
    publicUrl: db.settings.publicUrl || ''
  });
});

app.get('/api/updates', (_req, res) => res.json(db.updates));

app.get('/api/products', (_req, res) => {
  res.json(db.products.filter(product => product.active));
});

app.post('/api/orders', (req, res) => {
  const { productId, days, buyer, contact } = req.body || {};
  const product = db.products.find(item => item.id === productId && item.active);
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  if (![7, 30, 90].includes(Number(days))) return res.status(400).json({ error: 'Durasi tidak valid' });
  if (!String(buyer || '').trim() || !String(contact || '').trim()) {
    return res.status(400).json({ error: 'Nama dan kontak wajib' });
  }

  let invoice;
  do {
    invoice = `BP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${1000 + Math.floor(Math.random() * 9000)}`;
  } while (db.orders.some(order => order.invoice === invoice));

  const order = {
    id: uid('ORD'),
    invoice,
    productId: product.id,
    productName: product.name,
    days: Number(days),
    price: Number(product.prices[days] || 0),
    buyer: String(buyer).trim().slice(0, 80),
    contact: String(contact).trim().slice(0, 120),
    paid: false,
    status: 'pending',
    createdAt: nowIso(),
    paidAt: null,
    source: 'web'
  };
  db.orders.unshift(order);
  saveDb();

  res.status(201).json({
    invoice: order.invoice,
    price: order.price,
    status: order.status,
    qris: db.settings.qris || '',
    support: db.settings.supportUrl || ''
  });
});

app.get('/api/orders/:invoice', (req, res) => {
  const order = db.orders.find(item => item.invoice === req.params.invoice);
  if (!order) return res.status(404).json({ error: 'Invoice tidak ditemukan' });
  const license = db.licenses.find(item => item.orderId === order.id);
  res.json({
    invoice: order.invoice,
    status: order.status,
    paid: order.paid,
    paidAt: order.paidAt,
    buyer: order.buyer,
    productName: order.productName,
    days: order.days,
    licenseKey: license ? license.key : null,
    expiresAt: license ? license.expiresAt : null
  });
});

app.post('/api/payments/qris/webhook', (req, res) => {
  const signature = req.get('x-blaze-signature') || (req.body && req.body.signature);
  const expected = paymentHmac(req.rawBody || Buffer.from(''));
  if (!safeEqual(signature, expected)) return res.status(401).json({ error: 'Signature tidak valid' });

  const invoice = String((req.body && req.body.invoice) || '');
  const paymentStatus = String((req.body && req.body.status) || 'paid').toLowerCase();
  const order = db.orders.find(item => item.invoice === invoice);
  if (!order) return res.status(404).json({ error: 'Invoice tidak ditemukan' });
  if (paymentStatus !== 'paid') return res.json({ ok: true, ignored: true });

  const license = activateOrder(order);
  saveDb();
  res.json({ ok: true, license: license.key, expiresAt: license.expiresAt });
});

app.get('/api/license/status', (req, res) => {
  const key = String(req.query.key || '').trim().toUpperCase();
  const license = db.licenses.find(item => item.key === key);
  if (!license) return res.json({ active: false, reason: 'NOT_FOUND' });
  if (license.status !== 'active') return res.json({ active: false, reason: license.status.toUpperCase() });
  if (expired(license)) return res.json({ active: false, reason: 'EXPIRED', expiresAt: license.expiresAt });

  const product = db.products.find(item => item.id === license.productId);
  res.json({
    active: true,
    reason: 'ACTIVE',
    key: license.key,
    productName: product ? product.name : license.productId,
    buyer: license.buyer || '',
    expiresAt: license.expiresAt,
    downloadUrl: '/api/download/' + makeDownloadToken(license.key)
  });
});

app.post('/api/license/verify', (req, res) => {
  const key = String((req.body && req.body.key) || '').trim().toUpperCase();
  const deviceId = String((req.body && req.body.deviceId) || '').trim();
  const canary = String((req.body && req.body.canary) || '').trim().toUpperCase();

  const license = db.licenses.find(item => item.key === key);
  if (!license) return res.status(404).json({ active: false, reason: 'NOT_FOUND' });
  if (license.status !== 'active') return res.status(403).json({ active: false, reason: license.status.toUpperCase() });
  if (expired(license)) return res.status(403).json({ active: false, reason: 'EXPIRED', expiresAt: license.expiresAt });
  if (!deviceId) return res.status(400).json({ active: false, reason: 'NO_DEVICE' });
  if (canary && canary !== license.canary) return res.status(403).json({ active: false, reason: 'CANARY_MISMATCH' });

  if (!license.device) {
    license.device = deviceId;
    saveDb();
  } else if (license.device !== deviceId) {
    return res.status(403).json({ active: false, reason: 'DEVICE_MISMATCH' });
  }

  const product = db.products.find(item => item.id === license.productId);
  res.json({
    active: true,
    reason: 'ACTIVE',
    expiresAt: license.expiresAt,
    productName: product ? product.name : license.productId
  });
});

app.get('/api/download/:token', (req, res) => {
  const data = readDownloadToken(req.params.token);
  if (!data) return res.status(403).json({ error: 'Link download tidak valid atau kedaluarsa' });
  const license = db.licenses.find(item => item.key === data.k);
  if (!licenseActive(license)) return res.status(403).json({ error: 'Lisensi tidak aktif' });

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="blaze-pb-kit.user.js"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(renderTemplate(license.key));
});

app.post('/api/admin/login', (req, res) => {
  const pin = String((req.body && req.body.pin) || '');
  if (!pin || !safeEqual(hmac(pin), db.settings.pinHash)) {
    return res.status(401).json({ error: 'PIN salah' });
  }
  res.json({ token: makeToken({ admin: true }), expiresIn: '12h' });
});

app.get('/api/admin/overview', requireAdmin, (_req, res) => {
  const paid = db.orders.filter(order => order.paid);
  const revenue = paid.reduce((sum, order) => sum + Number(order.price || 0), 0);
  res.json({
    storeName: db.settings.storeName,
    orders: db.orders.length,
    paidOrders: paid.length,
    pendingOrders: db.orders.length - paid.length,
    licenses: db.licenses.length,
    activeLicenses: db.licenses.filter(licenseActive).length,
    expiredLicenses: db.licenses.filter(expired).length,
    revenue,
    recentOrders: db.orders.slice(0, 6),
    recentLicenses: db.licenses.slice(0, 6).map(licenseView)
  });
});

app.get('/api/admin/orders', requireAdmin, (_req, res) => res.json(db.orders));

app.post('/api/admin/orders/:invoice/paid', requireAdmin, (req, res) => {
  const order = db.orders.find(item => item.invoice === req.params.invoice);
  if (!order) return res.status(404).json({ error: 'Invoice tidak ditemukan' });
  const license = activateOrder(order);
  saveDb();
  res.json({ ok: true, license: licenseView(license) });
});

app.get('/api/admin/licenses', requireAdmin, (_req, res) => res.json(db.licenses.map(licenseView)));

app.post('/api/admin/licenses', requireAdmin, (req, res) => {
  const { productId, days, buyer, contact } = req.body || {};
  const product = db.products.find(item => item.id === productId);
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  if (![7, 30, 90].includes(Number(days))) return res.status(400).json({ error: 'Durasi tidak valid' });

  const key = genKey();
  const license = {
    key,
    orderId: null,
    productId: product.id,
    days: Number(days),
    buyer: String(buyer || 'manual').slice(0, 80),
    contact: String(contact || '').slice(0, 120),
    issuedAt: nowIso(),
    expiresAt: addDays(nowIso(), Number(days)),
    status: 'active',
    device: null,
    canary: canaryFor(key)
  };
  db.licenses.unshift(license);
  saveDb();
  res.status(201).json(licenseView(license));
});

app.post('/api/admin/licenses/:key/revoke', requireAdmin, (req, res) => {
  const license = db.licenses.find(item => item.key === req.params.key);
  if (!license) return res.status(404).json({ error: 'Lisensi tidak ditemukan' });
  license.status = 'revoked';
  saveDb();
  res.json(licenseView(license));
});

app.post('/api/admin/licenses/:key/activate', requireAdmin, (req, res) => {
  const license = db.licenses.find(item => item.key === req.params.key);
  if (!license) return res.status(404).json({ error: 'Lisensi tidak ditemukan' });
  license.status = 'active';
  saveDb();
  res.json(licenseView(license));
});

app.post('/api/admin/licenses/:key/extend', requireAdmin, (req, res) => {
  const license = db.licenses.find(item => item.key === req.params.key);
  if (!license) return res.status(404).json({ error: 'Lisensi tidak ditemukan' });
  const days = Number((req.body && req.body.days) || 0);
  if (![7, 30, 90].includes(days)) return res.status(400).json({ error: 'Durasi tidak valid' });
  license.expiresAt = addDays(
    Date.parse(license.expiresAt) > Date.now() ? license.expiresAt : nowIso(),
    days
  );
  saveDb();
  res.json(licenseView(license));
});

app.get('/api/admin/products', requireAdmin, (_req, res) => res.json(db.products));

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const { id, name, desc, prices } = req.body || {};
  const slug = String(id || name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  if (!slug || !String(name || '').trim()) return res.status(400).json({ error: 'ID dan nama wajib' });
  if (db.products.some(product => product.id === slug)) return res.status(409).json({ error: 'ID sudah dipakai' });

  const product = {
    id: slug,
    name: String(name).trim().slice(0, 80),
    desc: String(desc || '').trim().slice(0, 240),
    active: true,
    prices: {
      7: Number(prices && prices[7]) || 0,
      30: Number(prices && prices[30]) || 0,
      90: Number(prices && prices[90]) || 0
    }
  };
  db.products.push(product);
  saveDb();
  res.status(201).json(product);
});

app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  const product = db.products.find(item => item.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  const patch = req.body || {};
  if (typeof patch.active === 'boolean') product.active = patch.active;
  if (patch.name) product.name = String(patch.name).trim().slice(0, 80);
  if (patch.desc) product.desc = String(patch.desc).trim().slice(0, 240);
  if (patch.prices) {
    for (const days of [7, 30, 90]) {
      if (patch.prices[days] !== undefined) product.prices[days] = Number(patch.prices[days]) || 0;
    }
  }
  saveDb();
  res.json(product);
});

app.get('/api/admin/source', requireAdmin, (_req, res) => {
  res.json({ source: fs.readFileSync(TEMPLATE_PATH, 'utf8') });
});

app.post('/api/admin/source', requireAdmin, (req, res) => {
  const source = String((req.body && req.body.source) || '');
  const required = ['__BLAZE_LICENSE__', '__BLAZE_API__', '__BLAZE_CANARY__', 'verifyLicense'];
  const missing = required.filter(token => source.indexOf(token) === -1);
  if (missing.length) return res.status(400).json({ error: 'Template tidak valid, kurang: ' + missing.join(', ') });

  fs.writeFileSync(TEMPLATE_PATH, source);
  res.json({ ok: true, size: source.length });
});

app.get('/api/admin/updates', requireAdmin, (_req, res) => res.json(db.updates));

app.post('/api/admin/updates', requireAdmin, (req, res) => {
  const version = String((req.body && req.body.version) || '').trim();
  const body = String((req.body && req.body.body) || '').trim();
  if (!version || !body) return res.status(400).json({ error: 'Versi dan catatan wajib' });
  const update = { id: uid('UPD'), version: version.slice(0, 30), body: body.slice(0, 500), createdAt: nowIso() };
  db.updates.unshift(update);
  saveDb();
  res.status(201).json(update);
});

app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const { pinHash, ...settings } = db.settings;
  res.json(settings);
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const patch = req.body || {};
  const allowed = ['storeName', 'supportUrl', 'qris', 'publicUrl', 'paymentSecretNote'];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      db.settings[key] = String(patch[key]).slice(0, key === 'qris' ? 200000 : 20000);
    }
  }
  if (patch.paymentSecret && String(patch.paymentSecret).trim()) {
    PAYMENT_SECRET = String(patch.paymentSecret).trim();
  }
  saveDb();
  const { pinHash, ...settings } = db.settings;
  res.json(settings);
});

app.post('/api/admin/pin', requireAdmin, (req, res) => {
  const next = String((req.body && req.body.pin) || '');
  if (next.length < 6) return res.status(400).json({ error: 'PIN minimal 6 karakter' });
  db.settings.pinHash = hmac(next);
  saveDb();
  res.json({ ok: true });
});

app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0 }));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`BLAZE PEDIA jalan di http://localhost:${PORT}`);
  console.log('PIN owner default: blaze123 — ganti di tab Setelan');
});
