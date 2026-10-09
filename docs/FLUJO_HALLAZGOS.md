# Flujo de hallazgos, clasificaciones y responsables

## Etapas
**Abierto → En análisis → En acción → Verificación → Cerrado.** Al hacer clic en una etapa se muestra *solo* la información de esa etapa.

| Etapa | Qué se hace | Quién |
|---|---|---|
| **Abierto** | El responsable asignado **acepta** el hallazgo o lo **traslada** (una sola vez). | Responsable asignado o administrador |
| **En análisis** | Responde: *¿Por qué se presentó esta situación?* | Responsable o administrador |
| **En acción** | Responde: *¿Qué se hará para corregir el hallazgo?* y adjunta evidencia (archivo o foto). Requiere descripción y al menos 1 evidencia para cerrar las acciones. | Responsable o administrador |
| **Verificación** | Verifica que las acciones fueron efectivas y cierra el hallazgo. | **Solo administrador** |
| **Cerrado** | Resumen con el resultado de ambos milestones. | — |

Las reglas (quién acepta, traslada o verifica) las hace cumplir **la base de datos**, no solo la pantalla.

## Milestones (dos ventanas independientes)
1. **Cierre de acciones**: empieza al crearse el hallazgo y termina al cerrar las acciones. Su plazo son los **días hábiles** de la clasificación (N1 = 3, N2 = 6… configurable). Al cerrarse queda **verde** (a tiempo) o **rojo** (tarde) y **no se modifica más**.
2. **Verificación**: empieza cuando se cierran las acciones y dura N días hábiles (15 por defecto, configurable). También queda verde o rojo al cerrarse.

Así siempre se sabe si el cierre fue a tiempo, aunque la verificación tarde.

Los días hábiles son de lunes a viernes. **No se descuentan días festivos.**

## Cómo se asigna el responsable en una auditoría
Al marcar *No cumple* se elige la **Clasificación** y, al finalizar la auditoría:
1. Se toma el **Área** de la pregunta (se define en *Formatos*).
2. Si el área tiene un responsable para el **nivel LPA** de la auditoría, el hallazgo se asigna a esa persona.
3. Si no, se asigna al **dueño del área**.
4. Si el área no tiene ninguno, queda *sin responsable* y un administrador lo asigna.

El plazo se cuenta desde el día en que se finaliza la auditoría.

## Configuración (menú de iconos → Configuración)
- **Clasificaciones**: N1, N2… con sus días hábiles, y los días de verificación.
- **Niveles LPA**: cuántos niveles usa tu LPA y su nombre.
- **Áreas**: dueño del área y responsable por cada nivel LPA.
- **Catálogos**: categorías de hallazgo, causas raíz y tipos de riesgo.
