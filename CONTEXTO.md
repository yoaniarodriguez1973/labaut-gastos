# Contexto del proyecto: App Labaut "Juntos en casa"

Resumen para continuar en otra conversación de Antigravity.

## Qué es
App web instalable (PWA) para registrar los gastos del hogar de la familia Labaut (Uruguay).
Sin paso de compilación: HTML + CSS + JavaScript (módulos ES), Supabase cargado desde CDN y Chart.js.

- **Familia (4):** Yoania (administradora, yoania.rodriguez1973@gmail.com), Camilo (padre), Camilito y Ernesto (hijos).
- **Teléfonos:** algunos Android y otros iPhone.
- **Categorías:** Renta, Agua, Luz, Gas, Comida, Cárnicos, Agro, Otros.
- **Moneda:** UYU. Los gastos en USD se convierten con la cotización del día (open.er-api.com) y la cotización se puede editar.
- **Permisos:** todos registran gastos, pero cada uno edita o borra solo los suyos (RLS en la base de datos).
- **Caja común:** la misma cuota mensual por persona. El sobrante pasa al mes siguiente. Si falta dinero, cada uno aporta 1/4 como "ajuste". La administradora define la cuota y cierra el mes.
- **Extras:** foto del ticket (bucket privado `tickets`, se comprime en el navegador), análisis con gráficos y alertas, tiempo real, botón "Instalar".

## Servicios (todos gratis)
- **Supabase:** https://sleppbwqufrncipxrlyc.supabase.co. La publishable key está en `js/config.js`.
- **GitHub:** usuario `yoaniarodriguez1973`. Repositorio previsto: `labaut-gastos`, público.
- **Publicación:** GitHub Pages en https://yoaniarodriguez1973.github.io/labaut-gastos/

## Archivos
- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`
- `js/config.js`: URL y key de Supabase, categorías, tamaño de la familia (4) y paleta de colores.
- `js/app.js`: toda la lógica (login, gastos, balance, análisis, familia).
- `icons/icon.svg`: logo en vector. Falta copiar `icons/logo.jpg` (el logo generado).
- `supabase/schema.sql`: tablas, RLS, trigger que solo deja registrarse a los emails autorizados, bucket de fotos y tiempo real.

## Estado (30/10/2026)
- ✅ Código escrito. **Todavía no se probó**: el agente no pudo ejecutar comandos ("Access is denied").
- ⏳ **Pendiente 1:** copiar el logo a `icons/logo.jpg`.
- ✅ **Paso 2 hecho (30/10/2026):** `supabase/schema.sql` se ejecutó en Supabase ("Success"). Ahora el script se puede volver a ejecutar sin errores.
- ✅ **Paso 3 (Auth):** "Confirm email" desactivado. Revisar que estén cargadas la Site URL y las Redirect URLs (`https://yoaniarodriguez1973.github.io/labaut-gastos/**`).
- ⏳ **Pendiente 4:** subir los archivos a GitHub y activar Pages (rama `main`, carpeta `/ (root)`).
- ⏳ **Pendiente 5:** instalar en los celulares y autorizar desde la app los emails de Camilo, Camilito y Ernesto.
