<p align="center"><img src="assets/guvel-logo.png" width="96" alt="GUVEL"></p>

# GUVEL Quality

Portal de gestión de calidad de **GUVEL · Smarter Industrial Systems**: auditorías, hallazgos, acciones, notificaciones de cliente, riesgos y oportunidades en un solo lugar.

Aplicación web estática (HTML + CSS + JavaScript ES modules, **sin build**) con **Supabase** como backend (Auth + PostgreSQL + RLS). Se publica tal cual en GitHub Pages.

## Módulos

| Módulo | Qué hace |
|---|---|
| **Dashboard** | KPIs (hallazgos abiertos/vencidos, cumplimiento de auditorías, notificaciones, acciones vencidas, riesgos altos), gráficas, vencimientos críticos y actividad reciente. |
| **Auditorías** | Planes (LPA, Producto, Proceso, Sistema, Interna) con frecuencia semanal/quincenal/mensual/custom, **calendario mensual**, generación automática de auditorías, asignación, nivel LPA, límite de entrega y **ejecución de checklist** con resultado (%) y **hallazgos generados automáticamente** por cada punto que no cumple. |
| **Evidencias** | Fotos y documentos (imágenes, PDF, Office, TXT, CSV) en **hallazgos**, **notificaciones de cliente** y **auditorías** (generales y **por pregunta del checklist**). Las fotos se comprimen automáticamente antes de subir; archivos en bucket privado con URLs firmadas temporales. |
| **Hallazgos** | Flujo *Abierto → En análisis → En acción → Verificación → Cerrado*, severidad, origen, responsable, fecha compromiso, causa raíz, acciones vinculadas, exportación CSV. |
| **Acciones** | Contención / correctiva / preventiva, con seguimiento y filtros (vencidas, solo mías). |
| **Notificaciones de cliente** | Quejas, devoluciones, SCAR, alertas y auditorías de cliente con control de **fecha límite de respuesta** y botón para **generar hallazgo** vinculado. |
| **Riesgos** | Matriz 5×5 probabilidad × impacto y plan de mitigación. |
| **Oportunidades** | Ideas de mejora con beneficio, esfuerzo y responsable. |
| **Configuración** | Clientes, clasificaciones (catálogos), formularios/checklists con editor de preguntas, usuarios y roles. |

Además: búsqueda global (folio/título), códigos automáticos (`AUD-0001`, `HAL-0001`, `NCL-0001`…), bitácora de actividad en base de datos y diseño responsivo.

## Probar en 30 segundos (modo demo)

No requiere instalar nada ni configurar Supabase. Si `js/config.js` está vacío, la app arranca en **modo demo** con datos de ejemplo guardados en el navegador (botón *Restablecer* en el menú lateral).

```bash
# cualquier servidor estático; los ES modules no funcionan con file://
python3 -m http.server 8000
# abre http://localhost:8000
```

## Conectar Supabase (producción)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor** ejecuta, **en este orden**:
   1. `supabase/01_schema.sql` – tablas, códigos automáticos, triggers, bitácora.
   2. `supabase/02_policies.sql` – seguridad por roles (RLS).
   3. `supabase/03_seed.sql` – catálogos y 3 formatos base (LPA, Producto, Proceso).
   4. `supabase/04_attachments.sql` – evidencias: tabla `attachments`, bucket privado `evidence` (10 MB/archivo) y sus políticas.
3. En **Authentication → Users → Add user** crea tu usuario. **El primer usuario queda como administrador**; los siguientes inician como *Consulta* y el admin les asigna rol en *Configuración → Usuarios*.
4. En **Project Settings → API** copia *Project URL* y la clave **anon public** y pégalas en `js/config.js`:
   ```js
   export const CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",   // anon/public. NUNCA la service_role
   };
   ```
5. (Recomendado) En **Authentication → URL Configuration** agrega la URL donde publiques el sitio.

> La clave *anon* es pública por diseño: la seguridad real la dan las políticas RLS de `02_policies.sql`. Nunca subas la clave `service_role` al repositorio.

### Roles

| Rol | Permisos |
|---|---|
| `admin` | Todo, incluida la gestión de usuarios. |
| `quality_manager` | Todo lo operativo, catálogos, formularios y borrado de registros. |
| `auditor` | Crear y editar auditorías, hallazgos, acciones, notificaciones, riesgos y oportunidades. |
| `viewer` | Solo lectura. |

### Evidencias: notas
- Límite de **10 MB** por archivo (configurable en `04_attachments.sql` y `MAX_BYTES` de `js/db.js`). En **modo demo** el límite es 1.5 MB porque se guarda en el navegador.
- El bucket es **privado**: los archivos se ven mediante URLs firmadas que caducan en 1 hora.
- Al eliminar un hallazgo, auditoría o plan, la app borra también sus archivos de Storage.
- Subir y borrar evidencias requiere rol `auditor` o superior; un auditor solo puede borrar lo que él subió.

## Publicar en GitHub Pages

```bash
git init -b main
git add .
git commit -m "GUVEL Quality v1.0"
git remote add origin https://github.com/<tu-org>/Quality.git
git push -u origin main
```

En GitHub: **Settings → Pages → Source: GitHub Actions**. El workflow `.github/workflows/pages.yml` publica en cada push a `main`.

## Estructura

```
├── index.html
├── assets/                  logo y favicons
├── css/
│   ├── tokens.css           ← identidad visual (colores, tipografía, geometría)
│   ├── base.css             layout: sidebar, topbar, encabezado de página
│   └── components.css       botones, tablas, formularios, modales, calendario…
├── js/
│   ├── config.js            ← URL y clave de Supabase
│   ├── main.js              arranque, login, shell, búsqueda global
│   ├── router.js            router por hash (#/findings/…)
│   ├── db.js                capa de datos (Supabase o demo, misma API)
│   ├── seed.js              datos del modo demo
│   ├── ui.js · utils.js · icons.js · constants.js
│   └── modules/             un archivo por módulo
├── supabase/                01_schema · 02_policies · 03_seed · 04_attachments (SQL)
├── docs/DESIGN.md           guía de diseño
└── .github/workflows/       despliegue a GitHub Pages
```

## Diseño

El lenguaje visual sale del logotipo GUVEL: **navy `#0f1b2d`**, **cian `#0cc0df`** y **hielo `#eaf2f8`**, con la geometría isométrica a 30° (esquinas biseladas, patrón de líneas, indicadores en forma de rombo). Todo vive en `css/tokens.css`; ver [`docs/DESIGN.md`](docs/DESIGN.md).

## Hoja de ruta sugerida

- Notificaciones por correo de vencimientos (Edge Function + cron).
- Reporte 8D / PDF por notificación de cliente.
- Tablero de indicadores por área/línea y Pareto de defectos.
