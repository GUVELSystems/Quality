# Guía de diseño · GUVEL Quality

Basada en **GUVEL Operational · design system v3.0**. Principio rector: *superficies neutras; el color solo comunica estado.*

## Tokens (`css/tokens.css`)
| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | `#EAF2F8` | `#0F1B2D` | Fondo de página |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F4F8FB` | `#16243A` / `#1B2B44` | Paneles y filas |
| `--ink` | `#0F1B2D` | `#EAF2F8` | Texto y botón primario |
| `--flow` (cian) | `#0CC0DF` | igual | Foco, activo, en curso |
| `--watch` (ámbar) | `#E9A21F` | `#F2B33D` | Atención / inhábil |
| `--stop` (rojo) | `#E83B3B` | `#FF5A5A` | Vencido / no cumple |
| `--ok` (verde) | `#1B9E77` | `#3CC79C` | Cerrado / cumple *(único añadido a la paleta de Operational)* |
| `--font` | Manrope | | Toda la interfaz; cifras tabulares |

El tema oscuro se activa por `prefers-color-scheme` o manualmente (`data-theme="dark|light"` en `<html>`, guardado en `localStorage`).

## Elementos distintivos
- **Barra superior navy** con logotipo, producto «QUALITY» y subrayado cian en la pestaña activa.
- **Panel**: fondo blanco con **esquina superior derecha biselada** (triángulo del color de fondo).
- **Marcador hexagonal** para estados (`--hex`), en insignias, leyendas y línea de tiempo.
- **Tira de KPIs** con celdas separadas por 1 px.
- **Botón primario navy**; cian sólo en acciones de alto énfasis (pantalla de acceso).
- **Calendario de planes**: sábado y domingo en **naranja tenue** (`--weekend`) cuando están sin asignar; al asignar a alguien el día vuelve a verse como hábil.
- **Modal** con esquina biselada y fondo navy translúcido.

## Mantener la alineación con Operational
`tokens.css` replica los tokens de Operational. Si Operational cambia (colores, tipografía, radios), actualiza ese archivo; los componentes sólo consumen variables.
