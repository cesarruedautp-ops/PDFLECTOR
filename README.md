# SGD — Sistema de Gestión Documental (Netlify + Supabase, con Netlify Functions)

Frontend estático (HTML/CSS/JS) que habla directo con Supabase (Auth + PostgreSQL + Storage),
más un pequeño backend en **Netlify Functions** (JavaScript, corre en los servidores de Netlify)
solo para lo que no se puede hacer de forma segura desde el navegador: crear usuarios, reiniciar
contraseñas, e indexar en segundo plano los documentos con texto digital real.

## ⚠️ Cambio importante en cómo se sube el sitio

Como ahora hay Netlify Functions con dependencias de npm (`@supabase/supabase-js`, `jsonwebtoken`,
`pdf-parse`), **ya no sirve arrastrar la carpeta `frontend` directo a Netlify** — eso solo sube
archivos estáticos, sin instalar las dependencias que las funciones necesitan para correr.

Ahora hay que conectar el proyecto a un repositorio de Git (GitHub, GitLab o Bitbucket) para que
Netlify construya el sitio completo (instala las dependencias, arma las funciones, y publica todo
junto):

1. Sube esta carpeta completa (`sgd-netlify/`, con `netlify.toml`, `package.json`, `netlify/`,
   `frontend/` y `database/`) a un repositorio nuevo en [github.com](https://github.com).
2. En [app.netlify.com](https://app.netlify.com) → "Add new site" → "Import an existing project" →
   conecta ese repositorio.
3. Netlify detecta `netlify.toml` solo — no hace falta configurar nada más (ya trae
   `publish = "frontend"` y `functions = "netlify/functions"`).
4. Cada vez que quieras actualizar el sitio, subes los cambios a ese repositorio (Netlify lo
   vuelve a construir y publicar solo).

Si nunca has usado GitHub, es gratis y solo necesitas crear una cuenta y un repositorio nuevo;
puedes subir los archivos directo desde la web de GitHub sin instalar nada en tu computadora
(botón "Add file" → "Upload files").

## 1. Configurar Supabase

1. **SQL Editor** → pega y ejecuta `database/schema.sql` completo.
2. **Authentication → Hooks → Custom Access Token** → selecciona `custom_access_token_hook`.
3. **Authentication → Providers → Email** → desactiva "Allow new users to sign up".
4. **Authentication → URL Configuration** → agrega como Redirect URL:
   `https://TU-SITIO.netlify.app/reset-password.html`.
5. **Authentication → Users → Add user** → crea manualmente:
   - `cesarrueda.utp@gmail.com`
   - `santykfunez.utp@gmail.com`
   Marca "Auto confirm user". El trigger los deja como `ADMIN` automáticamente.

## 2. Configurar las variables de entorno en Netlify (secretas)

En Netlify → tu sitio → **Site configuration → Environment variables**, agrega estas 3
(los valores exactos están en Supabase → **Settings → API**):

| Variable | De dónde sacarla |
|---|---|
| `SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → clave `service_role` (**secreta**, nunca la pegues en el código ni en el chat) |
| `SUPABASE_JWT_SECRET` | Settings → API → JWT Settings → JWT Secret |

Estas variables solo las usan las funciones (`netlify/functions/*.js`), nunca llegan al navegador.

## 3. Desplegar

Conecta el repositorio como se explicó arriba. Netlify instala las dependencias y publica el
sitio junto con las 3 funciones (`create-user`, `reset-password`, `process-index-queue`).

## 4. Crear usuarios nuevos

Ahora sí se hace directo desde `users-admin.html` con el botón **"+ Nuevo usuario"** — ya no hace
falta ir al Dashboard de Supabase para esto. La función `create-user` verifica que quien la llama
sea un ADMIN de verdad (revisando su token) antes de crear nada. Reiniciar contraseñas también se
hace desde ahí con el botón "Reiniciar contraseña".

## Reglas de sesión implementadas

- **Cerrar la pestaña o el navegador → sesión cerrada**: el token se guarda en `sessionStorage`
  (no `localStorage`), que el navegador borra automáticamente al cerrar.
- **10 minutos sin actividad → sesión cerrada automáticamente**, sincronizado entre pestañas.
- **Una sola pestaña activa por sesión**: una segunda pestaña queda bloqueada hasta que la primera
  se cierre (usa `BroadcastChannel`).

## Búsqueda por mes y por palabra clave dentro del PDF

- **Documentos con texto digital real** (no escaneados): la función programada
  `process-index-queue` los indexa sola, cada 15 minutos, en el servidor — sin que nadie tenga el
  navegador abierto. Es 100% confiable porque no necesita convertir páginas a imagen.
- **Documentos escaneados** (necesitan OCR): se siguen indexando desde el navegador al subirlos
  (en segundo plano, con un aviso si intentas cerrar la pestaña antes de que termine). Esto es así
  porque hacer OCR de una imagen dentro de un servidor sin sistema operativo completo no es
  confiable hoy — necesitaría el plan Pro de Netlify (Background Functions, sin límite de tiempo)
  para hacerse con garantía total.
- El ADMIN puede usar el botón **"Indexar documentos anteriores"** (barra lateral) para completar
  cualquier documento que se haya quedado pendiente.

## Estructura

```
sgd-netlify/
├── netlify.toml              Configuracion de Netlify (publish, functions, horario de la funcion programada)
├── package.json              Dependencias de las funciones (@supabase/supabase-js, jsonwebtoken, pdf-parse)
├── netlify/functions/
│   ├── _shared.js             Cliente admin de Supabase + verificacion de que quien llama es ADMIN
│   ├── create-user.js         Crear usuario nuevo con contraseña temporal
│   ├── reset-password.js      Reiniciar la contraseña de un usuario existente
│   └── process-index-queue.js Funcion programada: indexa documentos con texto digital cada 15 min
├── frontend/
│   ├── login.html, forgot-password.html, reset-password.html, change-password.html
│   ├── index.html, upload.html, logs.html, users-admin.html
│   ├── css/styles.css
│   ├── js/ (supabase-client, tab-lock, idle-timeout, auth-guard, documents, sidebar-tree, pdf-viewer, users-admin, pdf-text, utils)
│   └── _redirects
├── database/schema.sql
└── README.md
```

## Nota técnica sobre el rol en el token

El rol del usuario (ADMIN/UPLOADER/READER) viaja dentro de los "claims" del JWT firmado por
Supabase (inyectado por `custom_access_token_hook`), no en `session.user.app_metadata`. Por eso
`auth-guard.js` (en el navegador) y `_shared.js` (en las funciones) decodifican/verifican el
`access_token` directamente en vez de leer `session.user.app_metadata`.
