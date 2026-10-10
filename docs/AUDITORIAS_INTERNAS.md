# Auditorías Internas: a fondo

## 1. Proceso declarado a auditar
Al asignar o editar una auditoría interna, además de la fecha y el responsable, se declara el **proceso a auditar** (del catálogo de Áreas). A la derecha aparece un panel de solo lectura con el responsable de ese proceso (y, si eliges un nivel, el responsable específico de ese nivel).

## 2. Formatos de auditoría interna
Al crear un formato de tipo **Interna** aparecen dos campos adicionales:
- **Proceso**: a qué proceso pertenece el formato (catálogo de Áreas).
- **Norma aplicable**: IATF, ISO, VDA o un manual de cliente. Se administran en **Configuración → Normas**.

Cada pregunta de un formato interno lleva además una **Cláusula** (por ejemplo `8.5.1`), y el comentario de la auditoría se llama **Evidencia/Observaciones** en este tipo de auditoría.

## 3. Folio propio: IF-0001
Los hallazgos de Auditorías Internas tienen su propio consecutivo, **IF-0001, IF-0002…**, separado del folio HAL- que usan los demás módulos.

## 4. CAPA Files y Root Cause Files
En **Configuración** hay dos módulos de plantillas:
- **CAPA Files**: 8D, 4D, CAPA, A4, Alerta de calidad o un formato personalizado.
- **Root Cause Files**: 5 Porqués, Ishikawa o personalizado.

Cada plantilla se arma con secciones y campos (texto, texto largo, fecha, número, opciones o una **tabla tipo hoja de cálculo** con las columnas que definas), para que cada organización arme su propio formato. Al llenar el análisis de causa raíz o la acción correctiva de un hallazgo interno, puedes elegir una plantilla o seguir con texto libre.

## 5. Hallazgo interno a pantalla completa
En Auditorías Internas, un hallazgo no se abre en la ventana lateral pequeña: se abre en una **pantalla completa**, con:
- **Izquierda**: Milestone (dos relojes: cierre de acciones y verificación), Archivos (todas las evidencias) e Historial.
- **Centro**: los 7 pasos — **Abierto → Descripción del problema → Acciones de contención → Análisis causa raíz → Acciones → Verificación → Cierre** — y el contenido de la etapa seleccionada.
- **Derecha**: Detalles, fijo en todo momento (responsable, clasificación, proceso, norma, cláusula, origen, fechas).

El resto del flujo (aceptar, trasladar una sola vez, verificar con aceptar/rechazar, milestones en días hábiles con horas y minutos) funciona igual que en los demás módulos.
