// Fleet service app - server bez vanjskih ovisnosti za lokalni rad (koristi node:http i
// node:sqlite). Ako je postavljena DATABASE_URL (npr. na Renderu), koristi Turso bazu -
// tada je jedina vanjska ovisnost @libsql/client (vidi server/db.js).
// Pokretanje: node server/index.js   (potreban Node.js 22.5+)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const db = require('./db');
const { computeServiceInfo } = require('./serviceCalc');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function withServiceInfo(vehicle) {
  return { ...vehicle, ...computeServiceInfo(vehicle) };
}

// SQL fragment koji uz sve stupce vozila vraća i "ima_nedostatak" - true ako vozilo ima
// barem jednu neriješenu napomenu (uočeni nedostatak).
const VEHICLE_SELECT = `v.*, EXISTS(
  SELECT 1 FROM notes n WHERE n.vehicle_id = v.id AND n.rijeseno = 0
) AS ima_nedostatak`;

function normalizeTip(tip) {
  return tip === 'quad' || tip === 'buggy' ? tip : null;
}

function normalizePodtip(podtip) {
  return podtip === 'dvosjed' || podtip === 'cetverosjed' ? podtip : null;
}

// Ulazni niz servisa je poredan od najnovijeg prema najstarijem (DESC).
// Ovdje svakom zapisu pridružujemo redni broj servisa (1. servis = najstariji).
function withServiceNumbers(recordsDesc) {
  const total = recordsDesc.length;
  return recordsDesc.map((r, idxFromNewest) => ({
    ...r,
    redni_broj: total - idxFromNewest,
  }));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function notFound(res, msg) {
  sendJson(res, 404, { error: msg || 'Nije pronađeno' });
}

function badRequest(res, msg) {
  sendJson(res, 400, { error: msg || 'Neispravan zahtjev' });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Tijelo zahtjeva je preveliko'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// --- Jednostavan router ---
const routes = []; // { method, pattern: RegExp, keys: string[], handler }

function addRoute(method, path, handler) {
  const keys = [];
  const pattern = new RegExp(
    '^' +
      path
        .split('/')
        .map((segment) => {
          if (segment.startsWith(':')) {
            keys.push(segment.slice(1));
            return '([^/]+)';
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '$'
  );
  routes.push({ method, pattern, keys, handler });
}

async function handleApi(req, res, pathname) {
  const match = routes.find((r) => r.method === req.method && r.pattern.test(pathname));
  if (!match) return notFound(res, 'Ruta nije pronađena');

  const values = match.pattern.exec(pathname).slice(1);
  const params = {};
  match.keys.forEach((k, i) => (params[k] = decodeURIComponent(values[i])));

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return badRequest(res, 'Neispravan JSON u tijelu zahtjeva');
    }
  }

  try {
    await match.handler(req, res, params, body);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'Interna greška servera', detail: String((e && e.message) || e) });
  }
}

// ---------- VEHICLES ----------

addRoute('GET', '/api/vehicles', async (req, res) => {
  const rows = await db.dbAll(`SELECT ${VEHICLE_SELECT} FROM vehicles v ORDER BY v.naziv COLLATE NOCASE`);
  sendJson(res, 200, rows.map(withServiceInfo));
});

addRoute('GET', '/api/vehicles/:id', async (req, res, params) => {
  const vehicle = await db.dbGet(`SELECT ${VEHICLE_SELECT} FROM vehicles v WHERE v.id = ?`, [params.id]);
  if (!vehicle) return notFound(res, 'Vozilo nije pronađeno');

  const serviceRecordsRaw = await db.dbAll(
    'SELECT * FROM service_records WHERE vehicle_id = ? ORDER BY datum DESC, id DESC',
    [params.id]
  );
  const service_records = withServiceNumbers(serviceRecordsRaw);
  const notes = await db.dbAll('SELECT * FROM notes WHERE vehicle_id = ? ORDER BY created_at DESC, id DESC', [
    params.id,
  ]);
  const kontrole = await db.dbAll('SELECT * FROM kontrole WHERE vehicle_id = ? ORDER BY datum DESC, id DESC', [
    params.id,
  ]);

  sendJson(res, 200, { ...withServiceInfo(vehicle), service_records, notes, kontrole });
});

addRoute('POST', '/api/vehicles', async (req, res, params, body) => {
  const {
    naziv,
    registracija,
    baza,
    status,
    tip,
    podtip,
    za_vodica,
    trenutna_kilometraza,
    interval_mjeseci,
    interval_km,
    prvi_servis_km,
    zadnji_servis_datum,
    zadnji_servis_km,
  } = body || {};

  if (!naziv || !String(naziv).trim()) {
    return badRequest(res, 'Naziv vozila je obavezan');
  }

  const normTip = normalizeTip(tip);

  const info = await db.dbRun(
    `INSERT INTO vehicles
      (naziv, registracija, baza, status, tip, podtip, za_vodica, trenutna_kilometraza, interval_mjeseci, interval_km, prvi_servis_km, zadnji_servis_datum, zadnji_servis_km)
    VALUES (@naziv, @registracija, @baza, @status, @tip, @podtip, @za_vodica, @trenutna_kilometraza, @interval_mjeseci, @interval_km, @prvi_servis_km, @zadnji_servis_datum, @zadnji_servis_km)`,
    {
      naziv: String(naziv).trim(),
      registracija: registracija || null,
      baza: baza || null,
      status: status === 'neispravno' ? 'neispravno' : 'ispravno',
      tip: normTip,
      podtip: normTip === 'buggy' ? normalizePodtip(podtip) : null,
      za_vodica: za_vodica ? 1 : 0,
      trenutna_kilometraza: Number(trenutna_kilometraza || 0),
      interval_mjeseci: Number(interval_mjeseci || 6),
      interval_km: Number(interval_km || 1500),
      prvi_servis_km: Number(prvi_servis_km != null ? prvi_servis_km : 500),
      zadnji_servis_datum: zadnji_servis_datum || null,
      zadnji_servis_km: zadnji_servis_km != null ? Number(zadnji_servis_km) : null,
    }
  );

  const vehicle = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [info.lastInsertRowid]);
  sendJson(res, 201, withServiceInfo(vehicle));
});

addRoute('PUT', '/api/vehicles/:id', async (req, res, params, body) => {
  const vehicle = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [params.id]);
  if (!vehicle) return notFound(res, 'Vozilo nije pronađeno');

  const fields = [
    'naziv',
    'registracija',
    'baza',
    'status',
    'tip',
    'podtip',
    'za_vodica',
    'trenutna_kilometraza',
    'interval_mjeseci',
    'interval_km',
    'prvi_servis_km',
    'zadnji_servis_datum',
    'zadnji_servis_km',
  ];

  const updates = {};
  for (const f of fields) {
    if (body && Object.prototype.hasOwnProperty.call(body, f)) {
      updates[f] = body[f];
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    updates.status = updates.status === 'neispravno' ? 'neispravno' : 'ispravno';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'tip')) {
    updates.tip = normalizeTip(updates.tip);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'podtip')) {
    updates.podtip = normalizePodtip(updates.podtip);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'za_vodica')) {
    updates.za_vodica = updates.za_vodica ? 1 : 0;
  }

  const merged = { ...vehicle, ...updates };
  // podtip (dvosjed/četverosjed) ima smisla samo za buggy - za sve ostalo ga čistimo.
  if (merged.tip !== 'buggy') merged.podtip = null;

  const bindParams = {
    naziv: merged.naziv,
    registracija: merged.registracija,
    baza: merged.baza,
    status: merged.status,
    tip: merged.tip,
    podtip: merged.podtip,
    za_vodica: merged.za_vodica ? 1 : 0,
    trenutna_kilometraza: merged.trenutna_kilometraza,
    interval_mjeseci: merged.interval_mjeseci,
    interval_km: merged.interval_km,
    prvi_servis_km: merged.prvi_servis_km,
    zadnji_servis_datum: merged.zadnji_servis_datum,
    zadnji_servis_km: merged.zadnji_servis_km,
    id: params.id,
  };

  await db.dbRun(
    `UPDATE vehicles SET
      naziv = @naziv,
      registracija = @registracija,
      baza = @baza,
      status = @status,
      tip = @tip,
      podtip = @podtip,
      za_vodica = @za_vodica,
      trenutna_kilometraza = @trenutna_kilometraza,
      interval_mjeseci = @interval_mjeseci,
      interval_km = @interval_km,
      prvi_servis_km = @prvi_servis_km,
      zadnji_servis_datum = @zadnji_servis_datum,
      zadnji_servis_km = @zadnji_servis_km,
      updated_at = datetime('now')
    WHERE id = @id`,
    bindParams
  );

  const updated = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [params.id]);
  sendJson(res, 200, withServiceInfo(updated));
});

addRoute('DELETE', '/api/vehicles/:id', async (req, res, params) => {
  const info = await db.dbRun('DELETE FROM vehicles WHERE id = ?', [params.id]);
  if (info.changes === 0) return notFound(res, 'Vozilo nije pronađeno');
  sendNoContent(res);
});

// ---------- SERVICE RECORDS ----------

addRoute('POST', '/api/vehicles/:id/service', async (req, res, params, body) => {
  const vehicle = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [params.id]);
  if (!vehicle) return notFound(res, 'Vozilo nije pronađeno');

  const { datum, kilometraza, opis, izvrsio } = body || {};
  if (!datum) return badRequest(res, 'Datum servisa je obavezan');

  await db.dbRun(
    `INSERT INTO service_records (vehicle_id, datum, kilometraza, opis, izvrsio) VALUES (?, ?, ?, ?, ?)`,
    [params.id, datum, kilometraza != null ? Number(kilometraza) : null, opis || null, izvrsio || null]
  );

  const shouldUpdate =
    !vehicle.zadnji_servis_datum || new Date(datum) >= new Date(vehicle.zadnji_servis_datum);

  if (shouldUpdate) {
    const kmVal = kilometraza != null ? Number(kilometraza) : null;
    const newKm =
      kmVal != null && kmVal > Number(vehicle.trenutna_kilometraza || 0)
        ? kmVal
        : Number(vehicle.trenutna_kilometraza || 0);

    await db.dbRun(
      `UPDATE vehicles SET
        zadnji_servis_datum = ?,
        zadnji_servis_km = COALESCE(?, zadnji_servis_km),
        trenutna_kilometraza = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      [datum, kmVal, newKm, params.id]
    );
  }

  const updatedVehicle = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [params.id]);
  const service_records = await db.dbAll(
    'SELECT * FROM service_records WHERE vehicle_id = ? ORDER BY datum DESC, id DESC',
    [params.id]
  );

  sendJson(res, 201, { vehicle: withServiceInfo(updatedVehicle), service_records });
});

addRoute('DELETE', '/api/service/:id', async (req, res, params) => {
  const info = await db.dbRun('DELETE FROM service_records WHERE id = ?', [params.id]);
  if (info.changes === 0) return notFound(res, 'Zapis nije pronađen');
  sendNoContent(res);
});

// ---------- KONTROLA VOZILA (brzi unos: km + ime + uočeni nedostaci) ----------

addRoute('POST', '/api/vehicles/:id/kontrola', async (req, res, params, body) => {
  const vehicle = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [params.id]);
  if (!vehicle) return notFound(res, 'Vozilo nije pronađeno');

  const { kilometraza, ime, nedostaci } = body || {};
  if (kilometraza == null || kilometraza === '') {
    return badRequest(res, 'Trenutna kilometraža je obavezna');
  }
  if (!ime || !String(ime).trim()) {
    return badRequest(res, 'Ime i prezime su obavezni');
  }

  const km = Number(kilometraza);
  const danas = new Date().toISOString().slice(0, 10);
  const nedostaciText = nedostaci && String(nedostaci).trim() ? String(nedostaci).trim() : null;

  const info = await db.dbRun(
    `INSERT INTO kontrole (vehicle_id, datum, kilometraza, ime, nedostaci) VALUES (?, ?, ?, ?, ?)`,
    [params.id, danas, km, String(ime).trim(), nedostaciText]
  );

  await db.dbRun(`UPDATE vehicles SET trenutna_kilometraza = ?, updated_at = datetime('now') WHERE id = ?`, [
    km,
    params.id,
  ]);

  if (nedostaciText) {
    await db.dbRun('INSERT INTO notes (vehicle_id, autor, tekst) VALUES (?, ?, ?)', [
      params.id,
      String(ime).trim(),
      nedostaciText,
    ]);
  }

  const kontrola = await db.dbGet('SELECT * FROM kontrole WHERE id = ?', [info.lastInsertRowid]);
  const updatedVehicle = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [params.id]);
  const notes = await db.dbAll('SELECT * FROM notes WHERE vehicle_id = ? ORDER BY created_at DESC, id DESC', [
    params.id,
  ]);
  const kontrole = await db.dbAll('SELECT * FROM kontrole WHERE vehicle_id = ? ORDER BY datum DESC, id DESC', [
    params.id,
  ]);

  sendJson(res, 201, { kontrola, vehicle: withServiceInfo(updatedVehicle), notes, kontrole });
});

// ---------- NOTES ----------

addRoute('POST', '/api/vehicles/:id/notes', async (req, res, params, body) => {
  const vehicle = await db.dbGet('SELECT * FROM vehicles WHERE id = ?', [params.id]);
  if (!vehicle) return notFound(res, 'Vozilo nije pronađeno');

  const { autor, tekst } = body || {};
  if (!tekst || !String(tekst).trim()) {
    return badRequest(res, 'Tekst napomene je obavezan');
  }

  const info = await db.dbRun('INSERT INTO notes (vehicle_id, autor, tekst) VALUES (?, ?, ?)', [
    params.id,
    autor || null,
    String(tekst).trim(),
  ]);

  const note = await db.dbGet('SELECT * FROM notes WHERE id = ?', [info.lastInsertRowid]);
  sendJson(res, 201, note);
});

addRoute('PUT', '/api/notes/:id', async (req, res, params, body) => {
  const note = await db.dbGet('SELECT * FROM notes WHERE id = ?', [params.id]);
  if (!note) return notFound(res, 'Napomena nije pronađena');

  const rijeseno =
    body && Object.prototype.hasOwnProperty.call(body, 'rijeseno') ? (body.rijeseno ? 1 : 0) : note.rijeseno;
  const tekst = body && body.tekst != null ? String(body.tekst) : note.tekst;

  await db.dbRun('UPDATE notes SET rijeseno = ?, tekst = ? WHERE id = ?', [rijeseno, tekst, params.id]);
  sendJson(res, 200, await db.dbGet('SELECT * FROM notes WHERE id = ?', [params.id]));
});

addRoute('DELETE', '/api/notes/:id', async (req, res, params) => {
  const info = await db.dbRun('DELETE FROM notes WHERE id = ?', [params.id]);
  if (info.changes === 0) return notFound(res, 'Napomena nije pronađena');
  sendNoContent(res);
});

// ---------- BAZE ----------

addRoute('GET', '/api/baze', async (req, res) => {
  const rows = await db.dbAll(
    "SELECT DISTINCT baza FROM vehicles WHERE baza IS NOT NULL AND baza != '' ORDER BY baza COLLATE NOCASE"
  );
  sendJson(res, 200, rows.map((r) => r.baza));
});

addRoute('GET', '/api/health', async (req, res) => sendJson(res, 200, { ok: true, backend: db.backend }));

// ---------- Statički frontend ----------

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Zaštita od path traversal-a
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return notFound(res, 'Nije pronađeno');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback - posluži index.html za nepoznate rute (npr. /vozilo/5)
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Greška servera');
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname);
  } else {
    serveStatic(req, res, pathname);
  }
});

async function start() {
  await db.initSchema();
  server.listen(PORT, () => {
    console.log(`Fleet service app pokrenuta na http://localhost:${PORT} (baza: ${db.backend})`);
  });
}

start().catch((e) => {
  console.error('Neuspjelo pokretanje servera:', e);
  process.exit(1);
});
