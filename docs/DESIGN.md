# Guía de diseño · GUVEL Quality

## Principios
1. **Industrial y sobrio**: fondo navy profundo, información densa pero ordenada.
2. **Geometría del logotipo**: ángulos de 30°, esquinas biseladas, rombos como viñetas.
3. **Cian = acción / foco**; rojo, ámbar y verde solo para estado (severidad, vencido, cumplido).

## Tokens (`css/tokens.css`)
| Token | Valor | Uso |
|---|---|---|
| `--bg-1` | `#0f1b2d` | Fondo del logotipo / superficies |
| `--g-cyan` | `#0cc0df` | Acento, acción primaria, foco |
| `--g-ice` | `#eaf2f8` | Texto principal / elementos claros |
| `--danger` `--warn` `--ok` | `#ff4d5e` `#ffb020` `#2dd4a0` | Estados |
| `--font-display` | Barlow Condensed | Títulos (mayúsculas) |
| `--font-ui` | Inter | Interfaz |
| `--font-mono` | JetBrains Mono | Folios y códigos |

## Elementos distintivos
- **Botón primario** y **avatar**: esquinas biseladas (`clip-path`).
- **Encabezado de página** y **login**: patrón isométrico (`--iso`).
- **KPI**: triángulo de color en la esquina = tono del indicador.
- **Stepper de estados**: chevrones que recuerdan las flechas del logotipo.
- **Insignias**: borde izquierdo de color + fondo tenue.

## Alinear con GUVEL Operational
Si Operational define otros colores, tipografías o radios, **basta con editar `css/tokens.css`**; los componentes solo consumen variables.
