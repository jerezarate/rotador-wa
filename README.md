# Rotador de Grupos WhatsApp (self-hosted)

Un link maestro que rota automáticamente entre grupos de WhatsApp cuando se llenan. **Para equipos internos con seguridad completa.**

## Deploy en Railway (5 minutos)

1. Subí esta carpeta a un repo de GitHub (ej: `rotador-wa`).
2. En Railway: **New Project → Deploy from GitHub repo** → elegí el repo.
3. En **Variables** agregá:
   - `DB_DIR` = `/data`
4. En **Settings → Volumes**: agregá un volumen en `/data` (la BD sobrevive redeploys).
5. En **Settings → Networking**: generá el dominio público.

## Crear el Admin

Después del deploy, ejecutá esto en tu terminal para crear la cuenta admin:

```bash
# Opción 1: Con valores por defecto
node setup-admin.js

# Opción 2: Con tus datos
node setup-admin.js tu@email.com tu_password "Tu Nombre"
```

Te mostrará:
```
✅ Admin creado exitosamente!
📧 Email:      admin@rotador.local
🔑 Contraseña: abc123xyz
```

Luego entra a tu dominio de Railway y logueate con esos datos.

## Características de Seguridad

### 🔐 Sistema de Invitaciones
- Solo usuarios invitados pueden registrarse
- El admin genera códigos de invitación únicos
- Se usa el código para crear cuenta (no se puede registrar sin él)

### 👥 Roles y Permisos
- **Admin**: Panel de control, gestión de usuarios, crear invitaciones
- **Usuario**: Ver/crear/editar nichos, colaboradores, grupos

### 🔑 Admin Panel
- Ver todos los usuarios y su estado
- Cambiar roles (user/admin)
- Activar/desactivar usuarios
- Generar y rastrear invitaciones
- Ver códigos de invitación para compartir

### 🤝 Colaboradores
- Los usuarios invitados pueden compartir nichos con otros
- Los colaboradores ven pero no pueden crear nichos
- Control granular de permisos

## Uso

### Como Admin

1. Entra al dominio
2. Click en **⚙️ Admin** (arriba a la derecha)
3. Tab **Invitaciones**:
   - Ingresa emails de tu equipo
   - Comparte el código de invitación con ellos
4. Tab **Usuarios**:
   - Ver estado de usuarios
   - Cambiar roles
   - Desactivar usuarios si es necesario

### Como Usuario

1. Recibís un código de invitación del admin
2. Vas a `/` (home)
3. Click en **"Crear una"** (registrarse)
4. Pegás el código en el formulario
5. Creás tu cuenta y contraseña

### Para Equipos

- Crea un nicho por proyecto/cliente
- Invita a tu equipo como colaboradores
- Comparte el link maestro `/r/tu-slug`
- El sistema rota automáticamente entre grupos

## Cómo Funciona la Rotación

- Cada nicho tiene un **umbral de clics** (default 950)
- Al alcanzar el umbral, el grupo se marca **lleno**
- El link maestro automáticamente rota al siguiente grupo
- Los clics son un proxy de miembros (WhatsApp no expone el conteo real)
- Ajustá el umbral según tu tasa de entrada: si de 100 clics entran ~70 personas, para 1024 miembros pon 1350 clics

## Correr Local

```bash
npm install
node server.js
```

Panel en http://localhost:3000

Para crear admin local:
```bash
node setup-admin.js
```

## Variables de Entorno

- `DB_DIR` - Directorio de base de datos (default: `./data`)
- `PORT` - Puerto del servidor (default: 3000)

## Estructura de BD

- `usuarios` - Cuentas con roles (admin/user)
- `sesiones` - Sessions de 30 días
- `invitaciones` - Códigos de invitación únicos
- `listas` - Nichos/categorías
- `grupos` - Grupos de WhatsApp con tracking de clics
- `colaboradores` - Relaciones de acceso compartido

## Características

✅ Sistema de usuarios con registro por invitación  
✅ Admin panel para gestionar equipo  
✅ Invitaciones únicas y rastreables  
✅ Roles y permisos granulares  
✅ Colaboradores con acceso compartido  
✅ Links maestros públicos que rotan automáticamente  
✅ Tracking de clics por grupo  
✅ Sesiones de 30 días (httpOnly cookies)  
✅ BD persistente en volumen  
✅ Tutorial interactivo  
✅ Recuperación de contraseña  

## Seguridad

- Contraseñas hasheadas con SHA256 + salt
- Cookies httpOnly (no accesibles desde JS)
- Invitaciones de un solo uso
- Control de acceso basado en roles (RBAC)
- Usuarios pueden desactivarse
- Sesiones expiran después de 30 días
