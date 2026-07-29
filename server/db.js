// Baza podataka.
//
// Lokalno (na tvom računalu) koristi ugrađeni node:sqlite (Node.js 22.5+, bez ikakvih
// vanjskih ovisnosti) i sprema podatke u data/fleet.db.
//
// Kad je postavljena varijabla okoline DATABASE_URL (npr. kad je aplikacija pokrenuta
// na Renderu ili sličnom hostingu), umjesto lokalne datoteke koristi Turso - besplatnu,
// pouzdanu bazu u oblaku koja NE briše podatke kod restarta servera. To omogućuje da
// server bude hostan na besplatnom, "efemernom" hostingu (koji sam po sebi ne čuva
// datoteke), dok su stvarni podaci uvijek sigurni u Turso bazi.
//
// Sve funkcije ispod (dbAll/dbGet/dbRun/dbExec) rade identično bez obzira koji se način
// rada koristi - ostatak aplikacije (server/index.js) ne mora znati razliku.

const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DATABASE_AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN || '';

const backend = DATABASE_URL ? 'turso' : 'sqlite';

let sqliteDb = null;
let libsqlClient = null;

if (backend === 'sqlite') {
  const { DatabaseSync } = require('node:sqlite');

  const DATA_DIR = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  sqliteDb = new DatabaseSync(path.join(DATA_DIR, 'fleet.db'));

  // WAL način rada ne radi na nekim mrežnim/sinkroniziranim diskovima (npr. Dropbox/OneDrive/FUSE
  // montirane mape) - u tom slučaju vraćamo se na standardni (DELETE) journal mode.
  try {
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
  } catch (e) {
    console.warn('WAL journal mode nije podržan na ovom disku, koristi se standardni mod:', e.message);
    try {
      sqliteDb.exec('PRAGMA journal_mode = DELETE;');
    } catch (e2) {
      console.warn('Nije moguće postaviti journal mode, nastavljam sa zadanim:', e2.message);
    }
  }
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
} else {
  // Lijeni require - lokalna instalacija (na tvom računalu) nikad ne dolazi do ove linije
  // pa @libsql/client tamo uopće ne treba biti instaliran.
  const { createClient } = require('@libsql/client');
  libsqlClient = createClient({ url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN });
  console.log('Baza: koristim Turso (cloud) - DATABASE_URL je postavljen.');
}

function normalizeValue(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}

function normalizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) out[k] = normalizeValue(row[k]);
  return out;
}

// params može biti: undefined, niz (za ? placeholdere) ili objekt (za @ime placeholdere).
async function dbAll(sql, params) {
  if (backend === 'sqlite') {
    const stmt = sqliteDb.prepare(sql);
    const rows = Array.isArray(params) ? stmt.all(...params) : params ? stmt.all(params) : stmt.all();
    return rows.map(normalizeRow);
  }
  const rs = await libsqlClient.execute({ sql, args: params || [] });
  return rs.rows.map(normalizeRow);
}

async function dbGet(sql, params) {
  const rows = await dbAll(sql, params);
  return rows[0] || null;
}

async function dbRun(sql, params) {
  if (backend === 'sqlite') {
    const stmt = sqliteDb.prepare(sql);
    const info = Array.isArray(params) ? stmt.run(...params) : params ? stmt.run(params) : stmt.run();
    return { lastInsertRowid: normalizeValue(info.lastInsertRowid), changes: normalizeValue(info.changes) };
  }
  const rs = await libsqlClient.execute({ sql, args: params || [] });
  return {
    lastInsertRowid: rs.lastInsertRowid != null ? normalizeValue(rs.lastInsertRowid) : null,
    changes: normalizeValue(rs.rowsAffected || 0),
  };
}

// Izvršava jedan ili više SQL naredbi odvojenih s ';' (bez parametara) - koristi se za shemu.
async function dbExec(sql) {
  if (backend === 'sqlite') {
    sqliteDb.exec(sql);
    return;
  }
  await libsqlClient.executeMultiple(sql);
}

async function initSchema() {
  await dbExec(`
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naziv TEXT NOT NULL,
  registracija TEXT,
  baza TEXT,
  status TEXT NOT NULL DEFAULT 'ispravno',
  trenutna_kilometraza INTEGER DEFAULT 0,
  interval_mjeseci INTEGER DEFAULT 6,
  interval_km INTEGER DEFAULT 1500,
  prvi_servis_km INTEGER DEFAULT 500,
  zadnji_servis_datum TEXT,
  zadnji_servis_km INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  kilometraza INTEGER,
  opis TEXT,
  izvrsio TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  autor TEXT,
  tekst TEXT NOT NULL,
  rijeseno INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kontrole (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  kilometraza INTEGER NOT NULL,
  ime TEXT,
  nedostaci TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

  // Migracija za baze napravljene prije dodavanja stupca prvi_servis_km.
  try {
    await dbExec('ALTER TABLE vehicles ADD COLUMN prvi_servis_km INTEGER DEFAULT 500');
  } catch (e) {
    // stupac vjerojatno već postoji - u redu je
  }

  // Migracija za baze napravljene prije dodavanja stupca tip (quad / buggy).
  try {
    await dbExec('ALTER TABLE vehicles ADD COLUMN tip TEXT');
  } catch (e) {
    // stupac vjerojatno već postoji - u redu je
  }
}

module.exports = { dbAll, dbGet, dbRun, dbExec, initSchema, backend };
