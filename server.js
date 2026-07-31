// ============================================================
// ROTADOR DE GRUPOS WHATSAPP — self-hosted
// Un link maestro por lista. Rota solo cuando el grupo se llena.
// ============================================================
const express = require("express");
const Database = require("better-sqlite3");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cambiame123";
const DB_DIR = process.env.DB_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, "rotador.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS listas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  umbral INTEGER NOT NULL DEFAULT 950,
  fallback_url TEXT DEFAULT '',
  creada_en TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS grupos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lista_id INTEGER NOT NULL REFERENCES listas(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  etiqueta TEXT DEFAULT '',
  posicion INTEGER NOT NULL DEFAULT 0,
  clics INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'cola', -- cola | activo | lleno
  creado_en TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grupos_lista ON grupos(lista_id, posicion);
`);

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---------- auth ----------
const sessions = new Set();
function auth(req, res, next) {
  if (sessions.has(req.cookies.sid)) return next();
  res.status(401).json({ error: "no autorizado" });
}

app.post("/api/login", (req, res) => {
  if ((req.body.password || "") !== ADMIN_PASSWORD)
    return res.status(401).json({ error: "Contraseña incorrecta" });
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.add(sid);
  res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 30 });
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  sessions.delete(req.cookies.sid);
  res.clearCookie("sid");
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => res.json({ auth: sessions.has(req.cookies.sid) }));

// ---------- helpers ----------
function grupoActivo(listaId) {
  return db
    .prepare("SELECT * FROM grupos WHERE lista_id=? AND estado!='lleno' ORDER BY posicion, id LIMIT 1")
    .get(listaId);
}
function normalizarEstados(listaId) {
  // asegura que sólo el primero no-lleno figure como 'activo'
  db.prepare("UPDATE grupos SET estado='cola' WHERE lista_id=? AND estado='activo'").run(listaId);
  const g = grupoActivo(listaId);
  if (g) db.prepare("UPDATE grupos SET estado='activo' WHERE id=?").run(g.id);
}
function listaConGrupos(l) {
  const grupos = db.prepare("SELECT * FROM grupos WHERE lista_id=? ORDER BY posicion, id").all(l.id);
  return { ...l, grupos, total_clics: grupos.reduce((a, g) => a + g.clics, 0) };
}

// ---------- REDIRECT PÚBLICO (el link maestro) ----------
app.get("/r/:slug", (req, res) => {
  const lista = db.prepare("SELECT * FROM listas WHERE slug=?").get(req.params.slug);
  if (!lista) return res.status(404).send("Link no encontrado");

  const g = grupoActivo(lista.id);
  if (!g) {
    if (lista.fallback_url) return res.redirect(302, lista.fallback_url);
    return res
      .status(200)
      .send("<html><body style='font-family:sans-serif;text-align:center;padding-top:80px'><h2>Grupos completos por ahora 🙌</h2><p>Volvé a intentar en un rato.</p></body></html>");
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE grupos SET clics = clics + 1 WHERE id=?").run(g.id);
    const actualizado = db.prepare("SELECT clics FROM grupos WHERE id=?").get(g.id);
    if (actualizado.clics >= lista.umbral) {
      db.prepare("UPDATE grupos SET estado='lleno' WHERE id=?").run(g.id);
      normalizarEstados(lista.id);
    } else if (g.estado !== "activo") {
      normalizarEstados(lista.id);
    }
  });
  tx();

  res.redirect(302, g.url);
});

// ---------- API listas ----------
app.get("/api/listas", auth, (req, res) => {
  const listas = db.prepare("SELECT * FROM listas ORDER BY id").all();
  res.json(listas.map(listaConGrupos));
});

app.post("/api/listas", auth, (req, res) => {
  let { nombre, slug, umbral, fallback_url } = req.body;
  if (!nombre) return res.status(400).json({ error: "Falta el nombre" });
  slug = (slug || nombre)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return res.status(400).json({ error: "Slug inválido" });
  try {
    const info = db
      .prepare("INSERT INTO listas (nombre, slug, umbral, fallback_url) VALUES (?,?,?,?)")
      .run(nombre, slug, parseInt(umbral) || 950, fallback_url || "");
    res.json(listaConGrupos(db.prepare("SELECT * FROM listas WHERE id=?").get(info.lastInsertRowid)));
  } catch (e) {
    res.status(400).json({ error: "Ese slug ya existe, elegí otro" });
  }
});

app.patch("/api/listas/:id", auth, (req, res) => {
  const { nombre, umbral, fallback_url } = req.body;
  const l = db.prepare("SELECT * FROM listas WHERE id=?").get(req.params.id);
  if (!l) return res.status(404).json({ error: "Lista no encontrada" });
  db.prepare("UPDATE listas SET nombre=?, umbral=?, fallback_url=? WHERE id=?").run(
    nombre ?? l.nombre,
    parseInt(umbral) || l.umbral,
    fallback_url ?? l.fallback_url,
    l.id
  );
  normalizarEstados(l.id);
  res.json(listaConGrupos(db.prepare("SELECT * FROM listas WHERE id=?").get(l.id)));
});

app.delete("/api/listas/:id", auth, (req, res) => {
  db.prepare("DELETE FROM grupos WHERE lista_id=?").run(req.params.id);
  db.prepare("DELETE FROM listas WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- API grupos ----------
app.post("/api/listas/:id/grupos", auth, (req, res) => {
  const lista = db.prepare("SELECT * FROM listas WHERE id=?").get(req.params.id);
  if (!lista) return res.status(404).json({ error: "Lista no encontrada" });
  const texto = req.body.urls || "";
  const urls = texto
    .split(/\n|,/) 
    .map((s) => s.trim())
    .filter((s) => s.startsWith("http"));
  if (!urls.length) return res.status(400).json({ error: "Pegá al menos un link válido (uno por línea)" });

  const max = db.prepare("SELECT COALESCE(MAX(posicion),0) m FROM grupos WHERE lista_id=?").get(lista.id).m;
  const ins = db.prepare("INSERT INTO grupos (lista_id, url, etiqueta, posicion) VALUES (?,?,?,?)");
  const tx = db.transaction(() => {
    urls.forEach((u, i) => {
      const n = max + i + 1;
      ins.run(lista.id, u, `Grupo ${n}`, n);
    });
    normalizarEstados(lista.id);
  });
  tx();
  res.json(listaConGrupos(lista));
});

app.patch("/api/grupos/:id", auth, (req, res) => {
  const g = db.prepare("SELECT * FROM grupos WHERE id=?").get(req.params.id);
  if (!g) return res.status(404).json({ error: "Grupo no encontrado" });
  const { accion, url, etiqueta } = req.body;

  if (accion === "lleno") db.prepare("UPDATE grupos SET estado='lleno' WHERE id=?").run(g.id);
  if (accion === "reabrir") db.prepare("UPDATE grupos SET estado='cola' WHERE id=?").run(g.id);
  if (accion === "reset_clics") db.prepare("UPDATE grupos SET clics=0 WHERE id=?").run(g.id);
  if (url) db.prepare("UPDATE grupos SET url=? WHERE id=?").run(url, g.id);
  if (etiqueta !== undefined) db.prepare("UPDATE grupos SET etiqueta=? WHERE id=?").run(etiqueta, g.id);

  normalizarEstados(g.lista_id);
  res.json(listaConGrupos(db.prepare("SELECT * FROM listas WHERE id=?").get(g.lista_id)));
});

app.delete("/api/grupos/:id", auth, (req, res) => {
  const g = db.prepare("SELECT * FROM grupos WHERE id=?").get(req.params.id);
  if (!g) return res.status(404).json({ error: "Grupo no encontrado" });
  db.prepare("DELETE FROM grupos WHERE id=?").run(g.id);
  normalizarEstados(g.lista_id);
  res.json(listaConGrupos(db.prepare("SELECT * FROM listas WHERE id=?").get(g.lista_id)));
});

// ---------- panel ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "panel.html")));

app.listen(PORT, () => console.log(`Rotador corriendo en puerto ${PORT}`));
