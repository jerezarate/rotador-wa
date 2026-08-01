// ============================================================
// ROTADOR DE GRUPOS WHATSAPP — self-hosted
// Un link maestro por lista. Rota solo cuando el grupo se llena.
// ============================================================
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cambiame123";
const DB_DIR = process.env.DB_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DB_DIR, "rotador.db"));
db.configure("busyTimeout", 5000);

// Initialize DB schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS listas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      umbral INTEGER NOT NULL DEFAULT 950,
      fallback_url TEXT DEFAULT '',
      creada_en TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS grupos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lista_id INTEGER NOT NULL REFERENCES listas(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      etiqueta TEXT DEFAULT '',
      posicion INTEGER NOT NULL DEFAULT 0,
      clics INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'cola',
      creado_en TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_grupos_lista ON grupos(lista_id, posicion)`);
});

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
function grupoActivo(listaId, callback) {
  db.get(
    "SELECT * FROM grupos WHERE lista_id=? AND estado!='lleno' ORDER BY posicion, id LIMIT 1",
    [listaId],
    callback
  );
}

function normalizarEstados(listaId, callback) {
  db.run("UPDATE grupos SET estado='cola' WHERE lista_id=? AND estado='activo'", [listaId], () => {
    grupoActivo(listaId, (err, g) => {
      if (g) {
        db.run("UPDATE grupos SET estado='activo' WHERE id=?", [g.id], callback);
      } else {
        callback(err);
      }
    });
  });
}

function listaConGrupos(l, callback) {
  db.all("SELECT * FROM grupos WHERE lista_id=? ORDER BY posicion, id", [l.id], (err, grupos) => {
    if (err) return callback(err);
    const total_clics = grupos.reduce((a, g) => a + g.clics, 0);
    callback(null, { ...l, grupos, total_clics });
  });
}

// ---------- REDIRECT PÚBLICO (el link maestro) ----------
app.get("/r/:slug", (req, res) => {
  db.get("SELECT * FROM listas WHERE slug=?", [req.params.slug], (err, lista) => {
    if (err || !lista) return res.status(404).send("Link no encontrado");

    grupoActivo(lista.id, (err, g) => {
      if (!g) {
        if (lista.fallback_url) return res.redirect(302, lista.fallback_url);
        return res
          .status(200)
          .send("<html><body style='font-family:sans-serif;text-align:center;padding-top:80px'><h2>Grupos completos por ahora 🙌</h2><p>Volvé a intentar en un rato.</p></body></html>");
      }

      db.run("UPDATE grupos SET clics = clics + 1 WHERE id=?", [g.id], () => {
        db.get("SELECT clics FROM grupos WHERE id=?", [g.id], (err, actualizado) => {
          if (actualizado.clics >= lista.umbral) {
            db.run("UPDATE grupos SET estado='lleno' WHERE id=?", [g.id], () => {
              normalizarEstados(lista.id, () => res.redirect(302, g.url));
            });
          } else {
            normalizarEstados(lista.id, () => res.redirect(302, g.url));
          }
        });
      });
    });
  });
});

// ---------- API listas ----------
app.get("/api/listas", auth, (req, res) => {
  db.all("SELECT * FROM listas ORDER BY id", (err, listas) => {
    if (err) return res.status(500).json({ error: err.message });
    let remaining = listas.length;
    if (remaining === 0) return res.json([]);

    const result = [];
    listas.forEach((l, idx) => {
      listaConGrupos(l, (err, listWithGrupos) => {
        if (!err) result[idx] = listWithGrupos;
        remaining--;
        if (remaining === 0) res.json(result.filter(Boolean));
      });
    });
  });
});

app.post("/api/listas", auth, (req, res) => {
  let { nombre, slug, umbral, fallback_url } = req.body;
  if (!nombre) return res.status(400).json({ error: "Falta el nombre" });
  slug = (slug || nombre)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return res.status(400).json({ error: "Slug inválido" });

  db.run(
    "INSERT INTO listas (nombre, slug, umbral, fallback_url) VALUES (?,?,?,?)",
    [nombre, slug, parseInt(umbral) || 950, fallback_url || ""],
    function (err) {
      if (err) return res.status(400).json({ error: "Ese slug ya existe, elegí otro" });
      db.get("SELECT * FROM listas WHERE id=?", [this.lastID], (err, l) => {
        listaConGrupos(l, (err, result) => {
          res.json(result);
        });
      });
    }
  );
});

app.patch("/api/listas/:id", auth, (req, res) => {
  const { nombre, umbral, fallback_url } = req.body;
  db.get("SELECT * FROM listas WHERE id=?", [req.params.id], (err, l) => {
    if (err || !l) return res.status(404).json({ error: "Lista no encontrada" });
    db.run(
      "UPDATE listas SET nombre=?, umbral=?, fallback_url=? WHERE id=?",
      [nombre ?? l.nombre, parseInt(umbral) || l.umbral, fallback_url ?? l.fallback_url, l.id],
      () => {
        normalizarEstados(l.id, () => {
          db.get("SELECT * FROM listas WHERE id=?", [l.id], (err, updated) => {
            listaConGrupos(updated, (err, result) => {
              res.json(result);
            });
          });
        });
      }
    );
  });
});

app.delete("/api/listas/:id", auth, (req, res) => {
  db.run("DELETE FROM grupos WHERE lista_id=?", [req.params.id], () => {
    db.run("DELETE FROM listas WHERE id=?", [req.params.id], () => {
      res.json({ ok: true });
    });
  });
});

// ---------- API grupos ----------
app.post("/api/listas/:id/grupos", auth, (req, res) => {
  db.get("SELECT * FROM listas WHERE id=?", [req.params.id], (err, lista) => {
    if (err || !lista) return res.status(404).json({ error: "Lista no encontrada" });

    const texto = req.body.urls || "";
    const urls = texto
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http"));
    if (!urls.length) return res.status(400).json({ error: "Pegá al menos un link válido (uno por línea)" });

    db.get("SELECT COALESCE(MAX(posicion),0) m FROM grupos WHERE lista_id=?", [lista.id], (err, row) => {
      const max = row.m;
      let inserted = 0;

      urls.forEach((u, i) => {
        const n = max + i + 1;
        db.run(
          "INSERT INTO grupos (lista_id, url, etiqueta, posicion) VALUES (?,?,?,?)",
          [lista.id, u, `Grupo ${n}`, n],
          () => {
            inserted++;
            if (inserted === urls.length) {
              normalizarEstados(lista.id, () => {
                listaConGrupos(lista, (err, result) => {
                  res.json(result);
                });
              });
            }
          }
        );
      });
    });
  });
});

app.patch("/api/grupos/:id", auth, (req, res) => {
  db.get("SELECT * FROM grupos WHERE id=?", [req.params.id], (err, g) => {
    if (err || !g) return res.status(404).json({ error: "Grupo no encontrado" });

    const { accion, url, etiqueta } = req.body;
    let updates = [];

    if (accion === "lleno") updates.push(() => db.run("UPDATE grupos SET estado='lleno' WHERE id=?", [g.id]));
    if (accion === "reabrir") updates.push(() => db.run("UPDATE grupos SET estado='cola' WHERE id=?", [g.id]));
    if (accion === "reset_clics") updates.push(() => db.run("UPDATE grupos SET clics=0 WHERE id=?", [g.id]));
    if (url) updates.push(() => db.run("UPDATE grupos SET url=? WHERE id=?", [url, g.id]));
    if (etiqueta !== undefined) updates.push(() => db.run("UPDATE grupos SET etiqueta=? WHERE id=?", [etiqueta, g.id]));

    if (updates.length === 0) {
      normalizarEstados(g.lista_id, () => {
        db.get("SELECT * FROM listas WHERE id=?", [g.lista_id], (err, l) => {
          listaConGrupos(l, (err, result) => {
            res.json(result);
          });
        });
      });
    } else {
      let done = 0;
      updates.forEach((u) => {
        u();
        done++;
        if (done === updates.length) {
          normalizarEstados(g.lista_id, () => {
            db.get("SELECT * FROM listas WHERE id=?", [g.lista_id], (err, l) => {
              listaConGrupos(l, (err, result) => {
                res.json(result);
              });
            });
          });
        }
      });
    }
  });
});

app.delete("/api/grupos/:id", auth, (req, res) => {
  db.get("SELECT * FROM grupos WHERE id=?", [req.params.id], (err, g) => {
    if (err || !g) return res.status(404).json({ error: "Grupo no encontrado" });
    db.run("DELETE FROM grupos WHERE id=?", [req.params.id], () => {
      normalizarEstados(g.lista_id, () => {
        db.get("SELECT * FROM listas WHERE id=?", [g.lista_id], (err, l) => {
          listaConGrupos(l, (err, result) => {
            res.json(result);
          });
        });
      });
    });
  });
});

// ---------- panel ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "panel.html")));

app.listen(PORT, () => console.log(`Rotador corriendo en puerto ${PORT}`));
