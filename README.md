# Rotador de Grupos WhatsApp (self-hosted)

Un link maestro que rota automáticamente entre grupos de WhatsApp cuando se llenan.

## Deploy en Railway (5 minutos)

1. Subí esta carpeta a un repo de GitHub (ej: `rotador-wa`).
2. En Railway: **New Project → Deploy from GitHub repo** → elegí el repo.
3. En **Variables** agregá:
   - `ADMIN_PASSWORD` = tu contraseña del panel
   - `DB_DIR` = `/data`
4. En **Settings → Volumes**: agregá un volumen montado en `/data` (así la base de datos sobrevive los redeploys — SIN ESTO PERDÉS LOS DATOS EN CADA DEPLOY).
5. En **Settings → Networking**: generá el dominio público.

Listo. Entrás al dominio, ponés tu contraseña, creás una lista, pegás los 10 links de grupos y copiás el link maestro `/r/tu-slug` para ponerlo en todos los números.

## Cómo funciona la rotación

- Cada lista tiene un umbral de clics (default 950). Al llegar, el grupo se marca **lleno** y el link maestro pasa solo al siguiente.
- Los clics son un proxy de miembros (WhatsApp no expone el conteo real por link de invitación). Ajustá el umbral según tu tasa de entrada real: si de cada 100 clics entran ~70, poné umbral ~1350 para un grupo de 1024.
- También podés marcar **lleno** a mano desde el panel en cualquier momento.

## Correr local

```
npm install
ADMIN_PASSWORD=miclave node server.js
```
Panel en http://localhost:3000
