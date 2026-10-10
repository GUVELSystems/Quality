# Configuración de Supabase · GUVEL Quality

Guía completa para dejar el portal funcionando con inicios de sesión reales y envío de correos.
Tiempo estimado: 30–40 min la primera vez.

## 0. Qué vas a configurar

| Pieza | Para qué sirve |
|---|---|
| **Base de datos + RLS** (SQL 01–05) | Tablas, roles y seguridad |
| **Auth** | Inicio de sesión, invitaciones y recuperación de contraseña |
| **Edge Function `invite-user`** | El administrador invita personas desde el portal |
| **Edge Function `notify-audit-plan`** | «Terminar y Enviar»: correos del plan y de cada auditoría |
| **Resend** (correo) | Proveedor que entrega los correos |

---

## 1. Crear el proyecto y la base de datos

1. Crea un proyecto en [supabase.com](https://supabase.com). Guarda la contraseña de la base.
2. **SQL Editor → New query**. Pega y ejecuta **en orden**, uno por uno:
   1. `supabase/01_schema.sql`
   2. `supabase/02_policies.sql`
   3. `supabase/03_seed.sql`
   4. `supabase/04_attachments.sql`
   5. `supabase/05_audit_notifications.sql`
   6. `supabase/06_modules.sql` (separa los hallazgos por módulo; ejecútalo **antes** de publicar la versión con módulos independientes)
   7. `supabase/07_workflow.sql` (clasificaciones con días hábiles, niveles LPA, áreas y flujo del hallazgo; ejecútalo **antes** de publicar la versión con el nuevo flujo)
   8. `supabase/08_milestones_notifications.sql` (milestones con hora, verificación aceptar/rechazar, bandeja de notificaciones)
   9. `supabase/09_class_scopes.sql` (clasificaciones por tipo de auditoría: N1/N2 para LPA, NCM/NCm para internas…)

> Todos son re-ejecutables. Si ya habías corrido una versión anterior, vuelve a ejecutar los 5 en orden (migra sin perder datos).

## 2. Configurar Auth (muy importante)

**Authentication → Sign In / Providers**
- **Email**: habilitado. Deja activo *Confirm email*.
- **Desactiva «Allow new users to sign up»**. Así nadie puede registrarse por su cuenta; solo entran las personas que invites. *(Aunque alguien lograra registrarse, el sistema lo deja inactivo y sin acceso a datos.)*

**Authentication → URL Configuration**
- **Site URL**: la URL pública del portal, p. ej. `https://TU-ORG.github.io/Quality/`
- **Redirect URLs**: agrega `https://TU-ORG.github.io/Quality/**` (y `http://localhost:8000/**` si pruebas local).

**Authentication → SMTP Settings** *(recomendado)*
El correo integrado de Supabase tiene un límite muy bajo (≈2 por hora) y solo para tu equipo de Supabase. Para producción usa SMTP propio. Con Resend:

| Campo | Valor |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | tu API key de Resend |
| Sender email | `calidad@tudominio.com` (dominio verificado en Resend) |
| Sender name | `GUVEL Quality` |

**Authentication → Email Templates** *(opcional, en español)*
- *Invite user* — Asunto: `Te invitaron a GUVEL Quality` — Cuerpo:
  ```html
  <h2>Bienvenido a GUVEL Quality</h2>
  <p>Te dieron acceso al portal de calidad. Crea tu contraseña para entrar:</p>
  <p><a href="{{ .ConfirmationURL }}">Crear mi contraseña</a></p>
  ```
- *Reset password* — Asunto: `Restablece tu contraseña de GUVEL Quality`.

## 3. Crear el primer administrador

**Authentication → Users → Add user → Create new user**: tu correo + contraseña, marca *Auto Confirm User*.
**El primer usuario queda como `admin` activo**. Después invitas al resto desde el portal (*Configuración → Usuarios → Invitar usuario*).

## 4. Correo con Resend

1. Crea cuenta en [resend.com](https://resend.com) → **Domains → Add domain** y agrega los registros DNS (SPF/DKIM) que te indica. Espera a que diga *Verified*.
2. **API Keys → Create API key** (permiso *Sending access*). Cópiala (empieza con `re_`).

> Sin dominio verificado, Resend solo permite enviar a tu propio correo con el remitente `onboarding@resend.dev`. Sirve para probar, no para producción.

## 5. Desplegar las Edge Functions

### Opción A · Supabase CLI (recomendada)

```bash
npm i -g supabase                       # o usa: npx supabase ...
supabase login
supabase link --project-ref TU_PROJECT_REF     # Project Settings → General → Reference ID

supabase secrets set \
  RESEND_API_KEY="re_xxxxxxxxx" \
  FROM_EMAIL="GUVEL Quality <calidad@tudominio.com>" \
  SITE_URL="https://TU-ORG.github.io/Quality"

supabase functions deploy notify-audit-plan
supabase functions deploy invite-user
```
Opcional: `REPLY_TO="calidad@tudominio.com"` para que las respuestas lleguen a un buzón.

### Opción B · Desde el panel
**Edge Functions → Deploy a new function → Via Editor.** Crea `notify-audit-plan` pegando `index.ts` **y** `templates.ts` (mismo nombre de archivo) y `invite-user` pegando su `index.ts`. Los secretos se cargan en **Edge Functions → Secrets**.

## 6. Conectar el portal

Project Settings → **API**: copia *Project URL* y la clave **anon public** en `js/config.js`:

```js
export const CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",       // anon/public. NUNCA la service_role
  APP_NAME: "GUVEL Quality",
};
```
Haz commit y publica en Cloudflare (ver README: «Publicar en Cloudflare»).

## 7. Probar todo (checklist)

- [ ] Entras con el administrador creado en el paso 3.
- [ ] *Configuración → Usuarios → Invitar usuario* con tu otro correo: llega el correo, creas contraseña y entras.
- [ ] *Auditorías → Crear plan*: eliges tipo, frecuencia y fecha; aparece el calendario.
- [ ] *Asignación rápida* (o clic en un día) asigna a la persona invitada.
- [ ] **Terminar y Enviar**: llegan 1 correo con el plan (PDF adjunto) y 1 por auditoría (con .ics).
- [ ] En el correo de la auditoría, **Realizar auditoría** abre el portal, pide iniciar sesión y te lleva directo al checklist.

## Cómo funciona el acceso

- Cada persona entra con **su correo y contraseña** (Supabase Auth).
- Al invitar se crea su perfil con el rol elegido (`admin`, `quality_manager`, `auditor`, `viewer`).
- Una persona **desactivada** o sin perfil activo no puede ver ningún dato (RLS).
- Los enlaces de correo usan `https://tu-sitio/#/audits/<id>`: si no hay sesión, pide login y continúa en esa pantalla.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| «La función de correo no está disponible» | La función no está desplegada o el nombre no coincide. Revisa el paso 5. |
| «Falta configurar RESEND_API_KEY y FROM_EMAIL» | No se cargaron los secretos (`supabase secrets set …`). |
| Resend responde *domain not verified* | Verifica el dominio o usa un remitente de un dominio ya verificado. |
| El enlace del correo lleva a una página de error / «redirect_to not allowed» | Falta la URL en *Redirect URLs* (paso 2). |
| «Email link is invalid or has expired» con correos corporativos (Gmail sí funciona) | Un filtro de seguridad del correo (Safe Links, Mimecast, Proofpoint…) abrió el enlace antes que la persona. Usa las plantillas de `supabase/email-templates/` (llevan a `/?token_hash=…` con botón «Continuar») y reenvía la invitación. |
| «Tu usuario está desactivado» | Un admin debe activarlo en *Usuarios* (o fue creado manualmente en Auth sin invitación). |
| «Ese correo ya tiene una cuenta» al invitar | Ya existe en Auth. Abre su perfil y usa *Enviar enlace de acceso*. |
| Logo roto en los correos | `SITE_URL` incorrecto: el logo se sirve desde `SITE_URL/assets/guvel-logo.png`. |
| No llegan correos | Revisa spam; la tabla `notification_log` guarda cada envío con su estado y error. |

Para auditar los envíos: `select * from notification_log order by created_at desc;`

---

## Anexo · Hostinger → Cloudflare → Resend (sin instalar nada)

- **Dominio**: si lo compraste en Hostinger, sus *nameservers* deben apuntar a Cloudflare (en Cloudflare el dominio debe decir **Active**). Los registros DNS se editan **en Cloudflare**, no en Hostinger.
- **Usa un subdominio para los correos** (p. ej. `mail.tudominio.com`) para no chocar con buzones de Hostinger en el dominio raíz. Remitente: `GUVEL Quality <calidad@mail.tudominio.com>`.
- En Resend: *Domains → Add Domain* → botón **Sign in to Cloudflare** (automático) o copia a mano los 3 registros (MX prioridad 10, TXT SPF, TXT DKIM `resend._domainkey`) en *Cloudflare → DNS → Records* con la nube **gris (DNS only)** y sin repetir el dominio en el *Name*.
- **Funciones sin CLI**: pega `docs/pegar-en-supabase/invite-user.ts` y `docs/pegar-en-supabase/notify-audit-plan.ts` (un solo archivo cada una) en *Edge Functions → Deploy a new function → Via Editor*. Las llaves se cargan en *Edge Functions → Secrets*.

## Anexo · Correo de invitación con diseño GUVEL

En `supabase/email-templates/` hay dos plantillas HTML:
- `invite.html` → Supabase → **Authentication → Emails → Templates → Invite user** (asunto: *Te invitaron a GUVEL Quality*).
- `recovery.html` → **Reset password** (asunto: *Restablece tu contraseña · GUVEL Quality*).

Pega el HTML completo en el recuadro de contenido y guarda. El logotipo se carga desde `https://quality.guvelsystems.com/assets/guvel-logo.png`; si tu dominio es otro, cámbialo en ambos archivos. No modifiques `{{ .ConfirmationURL }}`, `{{ .Email }}` ni `{{ .Data.full_name }}`.

> **Importante:** las plantillas de invitación y recuperación usan `{{ .TokenHash }}` y llevan al portal, que canjea el token **solo cuando la persona pulsa «Continuar»**. Así los filtros de correo corporativo no consumen el enlace. Si usas Resend con *Click tracking* activado, desactívalo para el dominio (Resend → Domains), porque reescribe los enlaces.

## Anexo · Función `notify-finding` (aviso por correo al asignar un hallazgo)
Es una tercera Edge Function, igual que `invite-user` y `notify-audit-plan`: **Edge Functions → Deploy a new function → Via Editor**, nombre exacto `notify-finding`, pega `docs/pegar-en-supabase/notify-finding.ts` y despliega. Usa los mismos secretos (`RESEND_API_KEY`, `FROM_EMAIL`, `SITE_URL`). Si no está desplegada, el portal sigue funcionando y los avisos llegan solo a la bandeja; el correo se omite y se muestra un aviso.
