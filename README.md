<p align="center"><img src="assets/guvel-logo.png" width="96" alt="GUVEL"></p>

# GUVEL Quality

Portal de gestión de calidad de **GUVEL · Smarter Industrial Systems**: auditorías, hallazgos, acciones, notificaciones de cliente, riesgos y oportunidades en un solo lugar.

Aplicación web estática (HTML + CSS + JavaScript ES modules, **sin build**) con **Supabase** como backend (Auth + PostgreSQL + RLS + Edge Functions) y **Resend** para correos. Se publica tal cual en GitHub Pages. Comparte el sistema de diseño de **GUVEL Operational**.

## Módulos

| Módulo | Qué hace |
|---|---|
| **Dashboard** | KPIs (hallazgos abiertos/vencidos, cumplimiento de auditorías, notificaciones, acciones vencidas, riesgos altos), gráficas, vencimientos críticos y actividad reciente. |
| **Auditorías** | **Asistente de plan** (tipo → frecuencia → fecha de inicio): el calendario se genera solo con la duración de la frecuencia (semanal 7 días, quincenal 15, mensual 1 mes, personalizado). Sábados y domingos aparecen en **naranja tenue** (inhábiles) y se habilitan solos al asignar a alguien. **Asignación rápida** por días y rotación de auditores, **exportación a PDF** del plan y **«Terminar y Enviar»**: cada persona recibe por correo el plan (PDF adjunto) y una notificación por auditoría con enlace directo para realizarla. Ejecución de checklist con resultado (%) y **hallazgos generados automáticamente** por cada punto que no cumple. |
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

Guía completa paso a paso (Auth, SMTP, Resend, Edge Functions, checklist de pruebas y solución de problemas): **[`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md)**.

Resumen:

1. Crea un proyecto en [supabase.com](https://supabase.com) y ejecuta en el **SQL Editor**, en orden: `supabase/01_schema.sql` → `02_policies.sql` → `03_seed.sql` → `04_attachments.sql` → `05_audit_notifications.sql`.
2. **Auth**: desactiva el registro libre («Allow new users to sign up»), define *Site URL* y *Redirect URLs* con la URL del portal.
3. Crea tu usuario en *Authentication → Users*. **El primer usuario es administrador**; a los demás los invitas desde el portal (*Configuración → Usuarios → Invitar usuario*).
4. Despliega las Edge Functions (`invite-user`, `notify-audit-plan`) y carga los secretos `RESEND_API_KEY`, `FROM_EMAIL`, `SITE_URL`.
5. Pega la URL y la clave **anon** en `js/config.js`.

> La clave *anon* es pública por diseño: la seguridad real la dan las políticas RLS. Nunca subas la `service_role`. Los usuarios sin perfil activo no ven ningún dato.

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
│   ├── pdf.js               exportación del plan a PDF
│   ├── vendor/              supabase-js, jsPDF, autotable (sin CDN)
│   ├── ui.js · utils.js · icons.js · constants.js
│   └── modules/             un archivo por módulo
├── supabase/
│   ├── 01…05_*.sql          esquema, seguridad, catálogos, adjuntos, notificaciones
│   └── functions/           Edge Functions: invite-user · notify-audit-plan (+ plantillas de correo)
├── docs/
│   ├── SETUP_SUPABASE.md    guía de configuración completa
│   └── DESIGN.md            guía de diseño
└── .github/workflows/       despliegue a GitHub Pages
```

## Diseño

Usa los mismos tokens que **GUVEL Operational** (design system v3): navy `#0F1B2D`, cian `#0CC0DF`, hielo `#EAF2F8`, tipografía Manrope, barra superior navy con subrayado cian, paneles blancos con esquina biselada y marcadores hexagonales de estado. Tema **claro/oscuro** (sigue al sistema y se puede cambiar con el botón de la barra). Todo vive en `css/tokens.css`; ver [`docs/DESIGN.md`](docs/DESIGN.md).

## Hoja de ruta sugerida

- Recordatorios automáticos por correo de auditorías próximas/vencidas (cron de Supabase).
- Reporte 8D / PDF por notificación de cliente.
- Tablero de indicadores por área/línea y Pareto de defectos.
