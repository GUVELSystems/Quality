# Flujo de hallazgos, milestones y notificaciones

## Etapas
**Abierto → En acción → Verificación → Cerrado.** (Ya no existe la etapa «En análisis».)
Al hacer clic en una etapa se muestra *solo* la información de esa etapa.

| Etapa | Qué se hace | Quién |
|---|---|---|
| **Abierto** | El responsable asignado **acepta** el hallazgo o lo **traslada** (una sola vez). | Responsable asignado o administrador |
| **En acción** | Responde *¿Qué se hará para corregir el hallazgo?* y adjunta evidencia (archivo o foto). Para cerrar las acciones se requiere la descripción y al menos 1 evidencia. | Responsable o administrador |
| **Verificación** | El administrador **acepta** (cierra el hallazgo) o **rechaza** (lo reabre). | **Solo administrador** |
| **Cerrado** | Resumen con el resultado de ambos milestones. | — |

Las reglas (quién acepta, traslada, acepta o rechaza) las hace cumplir **la base de datos**, no solo la pantalla.

## Milestones (nubes flotantes con días, horas y minutos)
Aparecen **fuera del panel del hallazgo**, arriba a la izquierda (en pantallas angostas pasan dentro del panel). Se actualizan solos cada 15 s.

1. **Cierre de acciones**: empieza al crearse el hallazgo y su plazo son los **días hábiles** de la clasificación (N1 = 3, N2 = 6…, configurable). Al cerrar las acciones queda **verde** (a tiempo) o **rojo** (tarde) y no cambia.
2. **Verificación**: empieza al cerrar las acciones y dura **5 días hábiles** (configurable). Es una ventana aparte, así no se pierde la trazabilidad del cierre.

**Tiempo hábil** = 24 h de lunes a viernes. Sábados y domingos no cuentan (los festivos no se descuentan).

### Si el administrador rechaza la verificación
El hallazgo vuelve a **Abierto** con el motivo del rechazo y el milestone de cierre **continúa con el tiempo que le quedaba** (si iba tarde, continúa con ese atraso). El responsable acepta de nuevo, corrige y vuelve a cerrar las acciones. Cada rechazo queda en el historial.

## Bandeja de notificaciones (campana)
- Muestra los **módulos** con su contador; al abrir uno aparecen sus pendientes: auditorías asignadas, hallazgos por aceptar / cerrar / verificar (administrador), respuestas a clientes y riesgos u oportunidades a tu cargo.
- Al entrar al portal aparece una ventana de **recordatorios** (una vez por sesión).
- Los avisos nuevos llevan la etiqueta *Nuevo* y se marcan como leídos al abrirlos.

## Avisos automáticos
Se avisa al responsable (bandeja + correo) cuando: se le **asigna** un hallazgo, se le **traslada** uno o se **rechaza** su verificación. A los **administradores** se les avisa cuando un hallazgo queda **listo para verificar**. El correo sale por la función `notify-finding` (ver `docs/SETUP_SUPABASE.md`).

## Cómo se asigna el responsable en una auditoría
Al marcar *No cumple* se elige la **Clasificación** y, al finalizar:
1. Se toma el **Área** de la pregunta (se define en *Formatos*).
2. Si el área tiene responsable para el **nivel LPA** de la auditoría, se asigna a esa persona; si no, al **dueño del área**; si tampoco, queda *sin responsable* para que un administrador lo asigne.

## Configuración (menú de iconos → Configuración)
- **Clasificaciones y niveles**: N1, N2… con sus días hábiles, los días de verificación y los niveles que usa tu LPA.
- **Áreas**: dueño del área y responsable por cada nivel LPA.
- **Catálogos**: categorías de hallazgo, causas raíz y tipos de riesgo.
