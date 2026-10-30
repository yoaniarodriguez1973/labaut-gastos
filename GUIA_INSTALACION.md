# 📲 Guía de instalación: App Labaut "Juntos en casa"

Carpeta de la app: `C:\Trabajo Yoania\labaut-gastos`

Son **6 pasos** y se hacen una sola vez. Llevan unos 15 minutos.

---

## Paso 1: Poner el logo en la carpeta de la app
1. Abrí el **Explorador de archivos** y pegá esta ruta en la barra de arriba:
   `C:\Users\Admin\.gemini\antigravity\brain\4dd8d730-35fc-4e2c-b168-de3fa520f85b`
2. Copiá el archivo `labaut_family_logo_1793371648783.jpg`.
3. Pegalo en `C:\Trabajo Yoania\labaut-gastos\icons`.
4. Cambiale el nombre a **`logo.jpg`**.

## Paso 2: Crear la base de datos en Supabase
1. Entrá a **https://supabase.com/dashboard** y abrí tu proyecto.
2. En el menú de la izquierda tocá **SQL Editor** (el ícono `>_`) y después **"+ New query"**.
3. Abrí `supabase\schema.sql` con el **Bloc de notas**. Seleccioná todo (**Ctrl+A**), copialo (**Ctrl+C**) y pegalo en Supabase (**Ctrl+V**).
4. Tocá **"Run"**. Tiene que aparecer **"Success. No rows returned"** ✅
   - Ejecutalo **una sola vez**.

## Paso 3: Configurar el acceso en Supabase
1. Andá a **Authentication → Sign In / Providers → Email**. **Desactivá "Confirm email"** y tocá **Save**.
2. Andá a **Authentication → URL Configuration**.
   - En **Site URL** pegá `https://yoaniarodriguez1973.github.io/labaut-gastos/`
   - En **Redirect URLs** agregá la misma dirección.
   - Tocá **Save**.

## Paso 4: Subir la app a GitHub
1. Entrá a **https://github.com/new**.
   - **Repository name:** `labaut-gastos`
   - Elegí **Public** y tocá **Create repository**.
2. Tocá el enlace **"uploading an existing file"**.
3. Arrastrá **todo el contenido** de la carpeta `labaut-gastos`:
   - `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`
   - las carpetas `js`, `icons` y `supabase`
4. Tocá **"Commit changes"**.

## Paso 5: Publicar con GitHub Pages
1. Andá a **Settings → Pages**.
2. En **Source** elegí **"Deploy from a branch"**.
3. En **Branch** elegí **`main`** y **`/ (root)`**, y tocá **Save**.
4. En 1 o 2 minutos la app queda publicada en **https://yoaniarodriguez1973.github.io/labaut-gastos/** 🎉

## Paso 6: Instalar en los celulares

| 🤖 Android (Chrome) | 🍎 iPhone (Safari) |
|---|---|
| 1. Abrí el enlace en **Chrome** | 1. Abrí el enlace en **Safari** |
| 2. Tocá **"Instalar"** o el menú **⋮** y después **"Instalar app"** | 2. Tocá **Compartir ⬆️** |
| 3. Confirmá con **"Instalar"** | 3. Elegí **"Agregar a inicio"** y después **"Agregar"** |

---

## 👩 Primeros pasos (Yoania)
1. Tocá **"Crear cuenta"** con **yoania.rodriguez1973@gmail.com**.
2. Andá a tu perfil (círculo de arriba a la derecha) y en **Emails autorizados** agregá a Camilo, Camilito y Ernesto.
3. Tocá **"🔗 Compartir enlace con la familia"** y mandáselo por WhatsApp.
4. En **⚖️ Balance** tocá **"Definir"** y poné la cuota por persona.

## 👨‍👦‍👦 Camilo, Camilito y Ernesto
1. Abren el enlace y crean su cuenta con el email que autorizaste.
2. Instalan la app como se explica en el Paso 6.
