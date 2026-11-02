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
- `supabase/categorias.sql`: tabla `categories`, editable por la administradora desde Familia → Categorías (crear, renombrar, ocultar, borrar si no tiene gastos, ordenar). Los gastos apuntan a la categoría por nombre con `on update cascade`. Si la tabla no existe, la app usa las categorías de `config.js`.
- `supabase/v2_personales_y_avisos.sql`: columnas nuevas en `expenses` (`scope` 'comun'|'personal', `personal_amount`, `excluded`, `excluded_reason`, `excluded_by`, `excluded_at`, columna generada `shared_uyu` = lo que se imputa a la caja). Los personales solo los ven su dueño y la administradora. La función RPC `set_expense_excluded` es solo para la administradora y hay permisos por columna para que nadie más toque `excluded`. Tabla `push_subscriptions`.
- `supabase/functions/notify/index.ts`: Edge Function que manda los avisos push (tipos `expense`, `contribution`, `excluded`, `closed` y `key`, que devuelve la clave pública). Usa los secretos `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Tiene "Verify JWT" desactivado porque verifica al usuario en el código.
- `tools/claves-push.html`: genera las claves VAPID dentro del navegador.

## Reglas de negocio v2 (02/11/2026)
- Cada gasto es **🏠 Común** (entra en la caja) o **👤 Personal** (control propio, no toca la caja; se puede cargar aunque el mes esté cerrado).
- En un gasto común se puede descontar una **parte personal** (ej: la cerveza): a la caja va `(amount - personal_amount) * rate`.
- La administradora puede marcar un gasto común como **🚫 No imputa** (con motivo). Queda tachado en la lista común, pasa a ser gasto personal de quien lo cargó y se le avisa. Se puede revertir.
- Pestaña **Gastos → 👤 Mis gastos**: gastos personales, aportes, lo cargado en comunes y gastos por categoría. La administradora puede ver los de cualquier miembro.
- **Notificaciones push:** gasto común nuevo y aporte nuevo (a todos menos quien lo cargó), "No imputa" (al dueño del gasto) y cierre de mes (a todos). En iPhone requieren la app instalada e iOS 16.4 o posterior.

## Estado (30/10/2026)
- ✅ Código escrito. **Todavía no se probó**: el agente no pudo ejecutar comandos ("Access is denied").
- ⏳ **Pendiente 1:** copiar el logo a `icons/logo.jpg`.
- ✅ **Paso 2 hecho (30/10/2026):** `supabase/schema.sql` se ejecutó en Supabase ("Success"). Ahora el script se puede volver a ejecutar sin errores.
- ✅ **Paso 3 (Auth):** "Confirm email" desactivado. Revisar que estén cargadas la Site URL y las Redirect URLs (`https://yoaniarodriguez1973.github.io/labaut-gastos/**`).
- ✅ **Paso 4:** la app está publicada y abre en GitHub Pages.
- ⏳ **v1.1 (categorías editables):** ejecutar `supabase/categorias.sql` y volver a subir `js/app.js`, `styles.css` y `sw.js`.
- ⏳ **v2.0 (personales, No imputa y notificaciones):** ejecutar `v2_personales_y_avisos.sql` (después de `categorias.sql`), generar las claves VAPID, cargar los Secrets, crear la Edge Function `notify` con "Verify JWT" desactivado, subir todo a GitHub y activar las notificaciones en cada celular (Familia → Notificaciones).
- ⏳ **Pendiente 5:** instalar en los celulares y autorizar desde la app los emails de Camilo, Camilito y Ernesto.
