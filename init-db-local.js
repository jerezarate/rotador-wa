const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const DB_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DB_DIR, "rotador.db"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT DEFAULT 'user',
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada_en TEXT DEFAULT (datetime('now')),
    expira_en TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS invitaciones (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    creada_por INTEGER NOT NULL REFERENCES usuarios(id),
    creada_en TEXT DEFAULT (datetime('now')),
    usada INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS actividades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    accion TEXT NOT NULL,
    detalles TEXT,
    creada_en TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_actividades_usuario ON actividades(usuario_id, creada_en)`);
  db.run(`CREATE TABLE IF NOT EXISTS colaboradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    colaborador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    rol TEXT DEFAULT 'editor',
    agregado_en TEXT DEFAULT (datetime('now')),
    UNIQUE(usuario_id, colaborador_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS listas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    slug TEXT NOT NULL,
    umbral INTEGER NOT NULL DEFAULT 950,
    fallback_url TEXT DEFAULT '',
    creada_en TEXT DEFAULT (datetime('now')),
    UNIQUE(usuario_id, slug)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS grupos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lista_id INTEGER NOT NULL REFERENCES listas(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    etiqueta TEXT DEFAULT '',
    posicion INTEGER NOT NULL DEFAULT 0,
    clics INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'cola',
    creado_en TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_grupos_lista ON grupos(lista_id, posicion)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_listas_usuario ON listas(usuario_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_colaboradores ON colaboradores(usuario_id)`, () => {
    console.log("✅ Tablas creadas correctamente");
    db.close();
  });
});
