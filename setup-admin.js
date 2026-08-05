// Script para crear usuario admin inicial
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const DB_DIR = process.env.DB_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DB_DIR, "rotador.db"));

function hashPassword(pwd) {
  return crypto.createHash("sha256").update(pwd + "salt_rotador").digest("hex");
}

const adminEmail = process.argv[2] || "admin@rotador.local";
const adminPassword = process.argv[3] || crypto.randomBytes(8).toString("hex");
const adminNombre = process.argv[4] || "Admin";

const hash = hashPassword(adminPassword);

db.run(
  "INSERT OR REPLACE INTO usuarios (email, password, nombre, rol, activo) VALUES (?,?,?,?,?)",
  [adminEmail, hash, adminNombre, "admin", 1],
  function (err) {
    if (err) {
      console.error("❌ Error:", err.message);
      process.exit(1);
    }
    console.log("✅ Admin creado exitosamente!\n");
    console.log("📧 Email:      " + adminEmail);
    console.log("🔑 Contraseña: " + adminPassword);
    console.log("\n💡 Cambiar contraseña en la app una vez dentro.\n");
    db.close();
    process.exit(0);
  }
);
