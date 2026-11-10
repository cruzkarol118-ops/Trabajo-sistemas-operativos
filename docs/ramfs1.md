# RAMFS1 · formato en disco

RAMFS1 es el sistema de archivos que usa SIM-01. Está pensado para ser pequeño,
legible y verificable: cabe completo en 64 KiB y se puede inspeccionar byte a
byte desde la consola del navegador.

Todas las cantidades multibyte son **little-endian**. El disco se divide en 128
bloques de 512 B.

## Mapa de bloques

| Bloque(s) | Contenido |
| --- | --- |
| `0` | Superbloque |
| `1` | Bitmap de bloques (128 bits) |
| `2` | Bitmap de inodos (64 bits) |
| `3–10` | Tabla de inodos (64 inodos × 64 B) |
| `11–127` | Bloques de datos (117 bloques) |

Los 11 primeros bloques son metadatos y siempre están marcados como usados en
el bitmap de bloques. Un disco recién formateado tiene 117 bloques de datos
libres y 63 inodos libres (el 0 es la raíz).

## Superbloque (bloque 0)

| Offset | Tamaño | Campo |
| ---: | ---: | --- |
| `0` | 6 B | Firma `RAMFS1` |
| `6` | 2 B | Reservado |
| `8` | 2 B | Versión (`1`) |
| `10` | 2 B | Tamaño de bloque (`512`) |
| `12` | 2 B | Cantidad de bloques (`128`) |
| `14` | 2 B | Cantidad de inodos (`64`) |
| `16` | 2 B | Inodo raíz (`0`) |
| `18` | 2 B | Bloques libres |
| `20` | 2 B | Inodos libres |
| `22–511` | — | Reservado (ceros) |

`mount()` rechaza el disco si la firma no es `RAMFS1` o si los parámetros de
geometría no coinciden con 512 B × 128 bloques × 64 inodos.

## Bitmaps

### Bitmap de bloques (bloque 1)

Un bit por bloque, en orden ascendente y con el bit menos significativo primero:
el bloque `n` corresponde al byte `n >> 3`, máscara `1 << (n & 7)`.

Tras `format()` están en 1 los bits `0–10` (metadatos) y en 0 los bits `11–127`
(datos libres).

### Bitmap de inodos (bloque 2)

Misma convención, un bit por inodo. Tras `format()` solo está en 1 el bit `0`
(la raíz).

## Inodos

La tabla empieza en el bloque 3. Cada inodo ocupa 64 B, así que caben 8 inodos
por bloque y los 64 inodos ocupan exactamente los bloques 3–10.

| Offset | Tamaño | Campo |
| ---: | ---: | --- |
| `0` | 1 B | Modo: `0` libre, `1` archivo, `2` directorio |
| `1` | 1 B | Enlaces (reservado; hoy siempre `1`) |
| `2` | 4 B | Tamaño en bytes |
| `6` | 4 B | `mtime` (segundos Unix) |
| `10` | 4 B | `ctime` (segundos Unix) |
| `14` | 24 B | 12 punteros directos (`uint16` cada uno) |
| `38` | 2 B | Puntero al bloque indirecto |
| `40–63` | — | Reservado (ceros) |

Un puntero con valor `0` significa “sin bloque”.

### Bloques directos e indirectos

- Los primeros **12 bloques** de un archivo se referencian directamente desde
  el inodo.
- El bloque 13 y siguientes usan un **bloque indirecto**: un bloque de 512 B
  con 256 punteros `uint16`, también little-endian.
- Capacidad teórica por archivo: `12 + 256 = 268` bloques = 137 216 B
  (~134 KiB). En la práctica el disco solo tiene 117 bloques de datos, así que
  el límite real es menor.

`_writeData()` calcula primero cuántos bloques hacen falta y comprueba el
espacio libre antes de liberar los bloques antiguos. Si no cabe, lanza
`ENOSPC` sin dejar el archivo a medias.

## Directorios

El contenido de un directorio es una secuencia de entradas de 32 B:

| Offset | Tamaño | Campo |
| ---: | ---: | --- |
| `0` | 2 B | Número de inodo |
| `2` | 1 B | Longitud del nombre en bytes |
| `3` | 29 B | Nombre UTF-8 (sin terminador) |

Una entrada con inodo `0` y longitud `0` está libre y puede reutilizarse. Los
nombres no pueden ser `.` ni `..`, no pueden contener `/` y no pueden superar
los 29 bytes UTF-8.

El directorio raíz es el inodo `0`. No se guardan entradas `.` ni `..`: las
rutas se resuelven recorriendo componentes y `normalize()` elimina `.` y `..`
antes de tocar el disco.

## Imagen de disco (`export` / `import`)

El archivo `.img` tiene una cabecera de 16 B seguida del disco completo:

| Offset | Tamaño | Campo |
| ---: | ---: | --- |
| `0` | 8 B | Firma `SIM01IMG` |
| `8` | 2 B | Versión (`1`) |
| `10` | 2 B | Tamaño de bloque (`512`) |
| `12` | 2 B | Cantidad de bloques (`128`) |
| `14` | 2 B | Reservado |
| `16` | 65 536 B | Contenido del disco |

Tamaño total: **65 552 B**.

`loadImage()` valida firma, longitud y geometría antes de copiar nada. Si la
imagen no es compatible, el disco actual no se modifica.

## Invariantes que verifica `fsck`

1. La firma del superbloque es `RAMFS1`.
2. Los contadores `freeBlocks` y `freeInodes` coinciden con sus bitmaps.
3. El inodo raíz está marcado como usado.
4. Todo puntero directo o indirecto apunta a un bloque de datos válido
   (`11–127`) marcado como usado.
5. Ningún bloque está referenciado por dos inodos.
6. La cantidad de bloques asignados coincide con `ceil(size / 512)`.
7. Las entradas de directorio apuntan a inodos usados, con nombres válidos y
   sin duplicados.
8. No hay bloques marcados como usados que ningún inodo referencie
   (huérfanos).

`fsck` no repara: solo informa. Para recuperar un disco inconsistente se puede
reformatear con `reset -f`.

## Límites

| Recurso | Valor |
| --- | --- |
| Bloques totales | 128 |
| Tamaño de bloque | 512 B |
| Capacidad total | 65 536 B (64 KiB) |
| Bloques de datos | 117 (59 904 B) |
| Inodos | 64 |
| Nombre máximo | 29 bytes UTF-8 |
| Archivo máximo teórico | 268 bloques (~134 KiB) |
| Archivo máximo real | limitado por los 117 bloques libres |
