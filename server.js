// ============================================================
// ROTADOR DE GRUPOS WHATSAPP — self-hosted con usuarios
// ============================================================
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const DB_DIR = process.env.DB_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DB_DIR, "rotador.db"));
db.configure("busyTimeout", 5000);

// Initialize DB schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      nombre TEXT NOT NULL,
      creado_en TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sesiones (
      id TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      creada_en TEXT DEFAULT (datetime('now')),
      expira_en TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS colaboradores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      colaborador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      rol TEXT DEFAULT 'editor',
      agregado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(usuario_id, colaborador_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS listas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      slug TEXT NOT NULL,
      umbral INTEGER NOT NULL DEFAULT 950,
      fallback_url TEXT DEFAULT '',
      creada_en TEXT DEFAULT (datetime('now')),
      UNIQUE(usuario_id, slug)
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_listas_usuario ON listas(usuario_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_colaboradores ON colaboradores(usuario_id)`);
});

const app = express();
app.use(express.json());
app.use(cookieParser());

// Hash password
function hashPassword(pwd) {
  return crypto.createHash("sha256").update(pwd + "salt_rotador").digest("hex");
}

// Generate session
function generateSession(userId, callback) {
  const sid = crypto.randomBytes(24).toString("hex");
  const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.run(
    "INSERT INTO sesiones (id, usuario_id, expira_en) VALUES (?,?,?)",
    [sid, userId, expira],
    (err) => callback(err, sid)
  );
}

// Auth middleware
function auth(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid) return res.status(401).json({ error: "No autorizado" });

  db.get(
    "SELECT usuario_id FROM sesiones WHERE id=? AND datetime(expira_en) > datetime('now')",
    [sid],
    (err, row) => {
      if (err || !row) return res.status(401).json({ error: "Sesión expirada" });
      req.userId = row.usuario_id;
      next();
    }
  );
}

// ---------- AUTH ROUTES ----------
app.post("/api/register", (req, res) => {
  const { email, password, nombre } = req.body;
  if (!email || !password || !nombre)
    return res.status(400).json({ error: "Faltan datos" });
  if (password.length < 6)
    return res.status(400).json({ error: "Contraseña mínimo 6 caracteres" });

  const hash = hashPassword(password);
  db.run(
    "INSERT INTO usuarios (email, password, nombre) VALUES (?,?,?)",
    [email, hash, nombre],
    function (err) {
      if (err)
        return res.status(400).json({ error: "Email ya registrado" });

      generateSession(this.lastID, (err, sid) => {
        res.cookie("sid", sid, {
          httpOnly: true,
          sameSite: "lax",
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });
        res.json({ ok: true });
      });
    }
  );
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Faltan datos" });

  const hash = hashPassword(password);
  db.get(
    "SELECT id FROM usuarios WHERE email=? AND password=?",
    [email, hash],
    (err, user) => {
      if (err || !user)
        return res.status(401).json({ error: "Email o contraseña incorrectos" });

      generateSession(user.id, (err, sid) => {
        res.cookie("sid", sid, {
          httpOnly: true,
          sameSite: "lax",
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });
        res.json({ ok: true });
      });
    }
  );
});

app.post("/api/logout", (req, res) => {
  const sid = req.cookies.sid;
  if (sid) db.run("DELETE FROM sesiones WHERE id=?", [sid]);
  res.clearCookie("sid");
  res.json({ ok: true });
});

app.post("/api/reset-password", (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) return res.status(400).json({ error: "Faltan datos" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Contraseña mínimo 6 caracteres" });

  db.get("SELECT id FROM usuarios WHERE email=?", [email], (err, user) => {
    if (err || !user) return res.status(404).json({ error: "Email no encontrado" });

    const hash = hashPassword(newPassword);
    db.run("UPDATE usuarios SET password=? WHERE id=?", [hash, user.id], (err) => {
      if (err) return res.status(400).json({ error: "Error al actualizar contraseña" });
      res.json({ ok: true });
    });
  });
});

app.get("/api/me", auth, (req, res) => {
  db.get("SELECT id, email, nombre FROM usuarios WHERE id=?", [req.userId], (err, user) => {
    res.json({ ...user, auth: true });
  });
});

// ---------- COLABORADORES ----------
app.get("/api/colaboradores", auth, (req, res) => {
  db.all(
    `SELECT u.id, u.email, u.nombre, c.rol
     FROM colaboradores c
     JOIN usuarios u ON c.colaborador_id = u.id
     WHERE c.usuario_id = ?`,
    [req.userId],
    (err, rows) => {
      res.json(rows || []);
    }
  );
});

app.post("/api/colaboradores", auth, (req, res) => {
  const { email, rol } = req.body;
  if (!email) return res.status(400).json({ error: "Falta email" });

  db.get("SELECT id FROM usuarios WHERE email=?", [email], (err, user) => {
    if (err || !user) return res.status(404).json({ error: "Usuario no encontrado" });
    if (user.id === req.userId) return res.status(400).json({ error: "No puedes agregarte a ti mismo" });

    db.run(
      "INSERT OR REPLACE INTO colaboradores (usuario_id, colaborador_id, rol) VALUES (?,?,?)",
      [req.userId, user.id, rol || "editor"],
      (err) => {
        if (err) return res.status(400).json({ error: "Ya es colaborador" });
        res.json({ ok: true });
      }
    );
  });
});

app.delete("/api/colaboradores/:id", auth, (req, res) => {
  db.run(
    "DELETE FROM colaboradores WHERE usuario_id=? AND colaborador_id=?",
    [req.userId, req.params.id],
    () => res.json({ ok: true })
  );
});

// ---------- HELPERS ----------
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

// ---------- API LISTAS ----------
app.get("/api/listas", auth, (req, res) => {
  db.all(
    `SELECT DISTINCT l.* FROM listas l
     LEFT JOIN colaboradores c ON l.usuario_id = c.usuario_id
     WHERE l.usuario_id=? OR c.colaborador_id=?
     ORDER BY l.id`,
    [req.userId, req.userId],
    (err, listas) => {
      if (err || !listas) return res.json([]);
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
    }
  );
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
    "INSERT INTO listas (usuario_id, nombre, slug, umbral, fallback_url) VALUES (?,?,?,?,?)",
    [req.userId, nombre, slug, parseInt(umbral) || 950, fallback_url || ""],
    function (err) {
      if (err) return res.status(400).json({ error: "Ese slug ya existe" });
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
  db.get("SELECT * FROM listas WHERE id=? AND usuario_id=?", [req.params.id, req.userId], (err, l) => {
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
  db.get("SELECT id FROM listas WHERE id=? AND usuario_id=?", [req.params.id, req.userId], (err, l) => {
    if (!l) return res.status(404).json({ error: "Lista no encontrada" });
    db.run("DELETE FROM grupos WHERE lista_id=?", [req.params.id], () => {
      db.run("DELETE FROM listas WHERE id=?", [req.params.id], () => {
        res.json({ ok: true });
      });
    });
  });
});

// ---------- API GRUPOS ----------
app.post("/api/listas/:id/grupos", auth, (req, res) => {
  // Verificar que sea propietario O colaborador
  db.get(
    `SELECT l.* FROM listas l
     LEFT JOIN colaboradores c ON l.usuario_id = c.usuario_id
     WHERE l.id=? AND (l.usuario_id=? OR c.colaborador_id=?)`,
    [req.params.id, req.userId, req.userId],
    (err, lista) => {
      if (err || !lista) return res.status(404).json({ error: "Lista no encontrada" });

      // Solo propietario puede agregar grupos
      if (lista.usuario_id !== req.userId) return res.status(403).json({ error: "Sin permisos para agregar grupos" });

      const texto = req.body.urls || "";
      const urls = texto
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("http"));
      if (!urls.length) return res.status(400).json({ error: "Pegá al menos un link válido" });

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
    }
  );
});

app.patch("/api/grupos/:id", auth, (req, res) => {
  db.get(
    `SELECT g.*, l.usuario_id, l.id as lista_id FROM grupos g
     JOIN listas l ON g.lista_id=l.id
     LEFT JOIN colaboradores c ON l.usuario_id = c.usuario_id
     WHERE g.id=? AND (l.usuario_id=? OR c.colaborador_id=?)`,
    [req.params.id, req.userId, req.userId],
    (err, g) => {
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
    }
  );
});

app.delete("/api/grupos/:id", auth, (req, res) => {
  db.get(
    "SELECT g.*, l.usuario_id FROM grupos g JOIN listas l ON g.lista_id=l.id WHERE g.id=?",
    [req.params.id],
    (err, g) => {
      if (err || !g) return res.status(404).json({ error: "Grupo no encontrado" });

      // Solo propietario puede borrar grupos
      if (g.usuario_id !== req.userId) return res.status(403).json({ error: "Sin permisos para borrar" });

      db.run("DELETE FROM grupos WHERE id=?", [req.params.id], () => {
        normalizarEstados(g.lista_id, () => {
          db.get("SELECT * FROM listas WHERE id=?", [g.lista_id], (err, l) => {
            listaConGrupos(l, (err, result) => {
              res.json(result);
            });
          });
        });
      });
    }
  );
});

// ---------- PANEL ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "panel.html")));

app.listen(PORT, () => console.log(`Rotador corriendo en puerto ${PORT}`));
