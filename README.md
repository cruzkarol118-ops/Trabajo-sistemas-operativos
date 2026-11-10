<p align="center">
  <img src="assets/branding/logo-universidad.png" alt="Universidad Simón Bolívar" width="420" />
</p>

<h1 align="center">SIM-01</h1>

<p align="center">
  Simulador embebido didáctico con reloj del sistema, disco en RAM de 64 KiB,
  sistema de archivos <strong>RAMFS1</strong> y terminal interactiva.
</p>

<p align="center">
  <a href="https://cruzkarol118-ops.github.io/Trabajo-sistemas-operativos/">Simulador en GitHub Pages</a>
  ·
  <a href="tests/">Pruebas</a>
  ·
  <a href="docs/ramfs1.md">Formato RAMFS1</a>
</p>

---

## Qué es

**SIM-01** es una máquina virtual mínima que se ejecuta por completo en el
navegador. Modela los componentes que suelen aparecer en un sistema embebido
básico:

- un **RTC simulado** con hora, fecha, uptime y velocidades `x0`, `x1`, `x10` y `x60`;
- un **disco en RAM** volátil de 128 bloques × 512 B (64 KiB);
- un **sistema de archivos propio, RAMFS1**, con superbloque, bitmaps de bloques
  e inodos, 64 inodos y bloques directos e indirectos;
- una **terminal** con disciplina de línea, historial, autocompletado y
  comandos para operar el disco;
- un **mapa visual de bloques** que muestra en tiempo real qué ocupa cada bloque.

No hay backend, no hay frameworks y no hay paso de compilación: HTML, CSS y
JavaScript ES modules servidos como archivos estáticos.

## Simulador

La versión publicada vive en:

<https://cruzkarol118-ops.github.io/Trabajo-sistemas-operativos/>

También funciona abriendo la carpeta con cualquier servidor estático. No abra
`index.html` con `file://`: los módulos ES y las fuentes requieren HTTP.

## Cómo ejecutar en local

Se incluye un servidor mínimo que fuerza los MIME correctos (en Windows,
`python -m http.server` a veces sirve `.js` como `text/plain` y rompe los
módulos ES):

```bash
python serve.py 8000
```

Luego abra <http://localhost:8000/>.

También puede usar cualquier otro servidor estático:

```bash
npx serve .
# o
php -S localhost:8000
```

## Cómo desplegar en GitHub Pages

1. Suba el proyecto a la rama `main`.
2. En GitHub: **Settings → Pages → Build and deployment**.
3. Elija **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
4. Guarde. El archivo `.nojekyll` ya está incluido para que GitHub no procese
   el sitio con Jekyll.

La URL queda como
`https://<usuario>.github.io/<repositorio>/`.

## Comandos

Escriba `help` dentro de la terminal para ver la lista completa.

| Comando | Descripción |
| --- | --- |
| `help [comando]` | Lista los comandos o detalla uno. |
| `clear` | Limpia la pantalla. |
| `echo <texto...>` | Imprime el texto. |
| `date` | Muestra la fecha y hora simuladas. |
| `setdate "AAAA-MM-DD HH:MM:SS"` | Ajusta el RTC. |
| `uptime` | Tiempo desde el arranque y velocidad actual. |
| `sleep <segundos>` | Espera en tiempo simulado. |
| `speed <0\|1\|10\|60>` | Cambia la velocidad del reloj. |
| `df` | Uso de bloques e inodos. |
| `ls [-l] [ruta]` | Lista un directorio. |
| `cd [ruta]` | Cambia de directorio. |
| `pwd` | Directorio actual. |
| `mkdir <ruta>` | Crea un directorio. |
| `rmdir <ruta>` | Borra un directorio vacío. |
| `touch <ruta>` | Crea un archivo vacío o actualiza su fecha. |
| `write <ruta> <texto...>` | Escribe texto en un archivo. |
| `cat <ruta>` | Muestra un archivo. |
| `rm <ruta>` | Borra un archivo. |
| `stat <ruta>` | Metadatos del inodo. |
| `tree [ruta]` | Árbol de directorios. |
| `fsck` | Verifica la consistencia del sistema de archivos. |
| `reset [-f]` | Reformatea el disco en RAM. |
| `export` | Descarga una imagen `.img` del disco. |
| `import` | Carga una imagen `.img`. |
| `halt` | Detiene el sistema. |
| `whoami` | Usuario actual. |
| `uname` | Identificación del sistema. |

También se admite redirección de salida:

```text
echo hola mundo > saludo.txt
cat saludo.txt
```

### Ejemplo de sesión

```text
usuario@sim:~$ ls -l
-    173  2026-11-10 16:36  nota.txt
-    155  2026-11-10 16:36  README
usuario@sim:~$ mkdir proyectos
Directorio creado: /home/usuario/proyectos
usuario@sim:~$ write proyectos/hola.txt Hola desde el disco en RAM
Escrito 27 B en /home/usuario/proyectos/hola.txt
usuario@sim:~$ cat proyectos/hola.txt
Hola desde el disco en RAM
usuario@sim:~$ df
Sistema   Bloques   Usados   Libres   Uso   Montaje
RAMFS1        117        9      108     8%   /

Inodos         64       12       52    19%
usuario@sim:~$ fsck
fsck: sistema de archivos consistente. 0 problemas.
```

## Estructura del proyecto

```text
.
├── index.html              # Interfaz principal
├── css/styles.css          # Sistema de diseño y responsive
├── src/
│   ├── main.js             # Cableado, arranque, semilla, import/export
│   ├── core/
│   │   ├── clock.js        # RTC, uptime, velocidad y eventos
│   │   ├── ramdisk.js      # Dispositivo de bloques e imagen SIM01IMG
│   │   ├── fs.js           # RAMFS1
│   │   ├── shell.js        # Intérprete de comandos
│   │   ├── errors.js       # FSError y códigos
│   │   └── format.js       # Fechas, bytes y uptime
│   └── ui/
│       ├── terminal.js     # xterm.js + disciplina de línea
│       ├── panels.js       # Reloj, disco e indicadores
│       ├── blockmap.js     # Mapa de bloques en canvas
│       └── boot.js         # Secuencia de arranque
├── tests/                  # 46 pruebas en el navegador
├── docs/ramfs1.md          # Formato binario de RAMFS1
├── assets/
│   ├── branding/           # Logos y favicons
│   └── fonts/              # Space Grotesk e IBM Plex Mono
├── vendor/xterm/           # xterm.js 5.5.0 y addon-fit
├── serve.py                # Servidor estático con MIME correctos
└── .nojekyll               # GitHub Pages
```

## RAMFS1 en breve

| Bloques | Uso |
| --- | --- |
| `0` | Superbloque |
| `1` | Bitmap de bloques |
| `2` | Bitmap de inodos |
| `3–10` | Tabla de 64 inodos de 64 B |
| `11–127` | Bloques de datos (117 bloques) |

- **Inodo:** modo, enlaces, tamaño, `mtime`, `ctime`, 12 punteros directos y
  un puntero indirecto.
- **Directorio:** entradas de 32 B con inodo (2 B), longitud del nombre (1 B) y
  nombre UTF-8 de hasta 29 B.
- **Archivo máximo:** 12 bloques directos + 256 bloques indirectos
  (268 bloques, ~134 KiB), limitado en la práctica por los 117 bloques de datos.
- **Imagen de disco:** cabecera `SIM01IMG` de 16 B + 64 KiB de datos.

El detalle byte a byte está en [`docs/ramfs1.md`](docs/ramfs1.md).

## Pruebas

Abra [`tests/`](tests/) con el servidor local:

```text
http://localhost:8000/tests/
```

El harness no tiene dependencias. Cubre 46 casos:

- reloj: acumulación, velocidades, pausa, eventos, `setDate`, saltos;
- disco: lectura/escritura, límites, reset, imágenes;
- RAMFS1: formato, montaje, rutas, archivos, directorios, bloques indirectos,
  `rename`, `unlink`, `rmdir`, `ENOSPC`, `fsck` y mapa de bloques;
- shell: tokenizador, comandos, redirección, confirmación de `reset`, `halt` y
  autocompletado.

Cada prueba muestra su resultado y su tiempo en la página. El resumen también
queda en `window.__testResults` para inspección desde la consola.

## Decisiones de diseño

- **Sin build step.** Todo son módulos ES nativos. Se puede auditar y desplegar
  copiando la carpeta.
- **xterm.js vendorizado.** No se depende de un CDN en tiempo de ejecución.
- **Disco volátil a propósito.** El estado vive en memoria; para conservarlo se
  exporta una imagen `.img` y se importa después.
- **Reloj con `setInterval`, no `requestAnimationFrame`.** Así el uptime sigue
  avanzando aunque la pestaña quede en segundo plano. Los saltos mayores a 5 s
  (equipo suspendido) se recortan para no distorsionar la simulación.
- **Estética de instrumento de laboratorio.** Chasis oscuro, acentos menta y
  cian, franja institucional crema, tipografía Space Grotesk + IBM Plex Mono.
  El logo de la universidad se usa sobre placas crema con
  `mix-blend-mode: multiply`; el icono del programa va en una insignia crema.

## Créditos y licencias

- **xterm.js 5.5.0** y **@xterm/addon-fit 0.10.0** — MIT. Licencia en
  [`vendor/xterm/LICENSE`](vendor/xterm/LICENSE).
- **Space Grotesk** y **IBM Plex Mono** — SIL Open Font License 1.1. Licencias
  en [`assets/fonts/`](assets/fonts/).
- Logos de la Universidad Simón Bolívar y del programa, aportados por los
  autores del trabajo. Los originales se conservan en
  [`assets/branding/original/`](assets/branding/original/).

## Limitaciones

- No hay persistencia automática ni `localStorage`.
- Un solo usuario; no se modelan permisos, enlaces simbólicos ni `hard links`
  (el campo `links` está reservado).
- `sleep` espera tiempo simulado, no bloquea el hilo.
- No es un emulador de hardware real: es un modelo didáctico de los conceptos
  de reloj, dispositivo de bloques y sistema de archivos.

---

**Universidad Simón Bolívar · Barranquilla y Cúcuta**  
Sistemas Operativos · Tema 5
