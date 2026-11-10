import { FileSystem } from "../src/core/fs.js";
import { RamDisk } from "../src/core/ramdisk.js";
import { Shell, tokenize } from "../src/core/shell.js";
import { assert, assertDeepEqual, assertEqual, assertThrows, group, test } from "./harness.js";

group("Intérprete de comandos");

function makeClock() {
  let current = new Date(2024, 0, 2, 3, 4, 5);
  let speed = 1;
  const events = [];
  let nextId = 1;
  return {
    now: () => new Date(current.getTime()),
    uptimeMs: () => 0,
    get speed() {
      return speed;
    },
    setSpeed(value) {
      speed = value;
    },
    setDate(date) {
      current = new Date(date.getTime());
    },
    schedule(delay, callback) {
      const id = nextId++;
      events.push({ id, due: delay, callback });
      return id;
    },
    cancel(id) {
      const index = events.findIndex((event) => event.id === id);
      if (index !== -1) events.splice(index, 1);
    },
  };
}

function makeShell() {
  const clock = makeClock();
  const disk = new RamDisk();
  const fs = new FileSystem(disk, clock);
  fs.format();
  fs.mount();
  const calls = { reset: 0, halt: 0 };
  const shell = new Shell({
    clock,
    disk,
    fs,
    onReset: () => {
      calls.reset += 1;
    },
    onHalt: () => {
      calls.halt += 1;
    },
  });
  return { clock, disk, fs, shell, calls };
}

function text(result) {
  return result.output.map((item) => item.text).join("\n");
}

function decode(bytes) {
  return new TextDecoder().decode(bytes);
}

test("tokenize respeta comillas y escapes", () => {
  assertDeepEqual(tokenize('write "a b.txt" hola'), ["write", "a b.txt", "hola"]);
  assertDeepEqual(tokenize("echo 'texto con espacios'"), ["echo", "texto con espacios"]);
  assertDeepEqual(tokenize("echo hola\\ mundo"), ["echo", "hola mundo"]);
  assertThrows(() => tokenize('echo "sin cerrar'), "EINVAL");
});

test("help lista los comandos y detalla uno", async () => {
  const { shell } = makeShell();
  const all = await shell.execute("help");
  assert(text(all).includes("COMANDOS DISPONIBLES"), "debe listar los comandos");
  assert(text(all).includes("mkdir"), "debe incluir mkdir");

  const one = await shell.execute("help cat");
  assert(text(one).includes("cat <ruta>"), "debe mostrar el uso de cat");
  assertThrows(() => shell.commands.get("help").run(["nada"], shell._context([])), "ENOENT");
});

test("flujo completo de archivos desde la shell", async () => {
  const { shell, fs } = makeShell();
  assertEqual(text(await shell.execute("pwd")), "/");

  await shell.execute("mkdir docs");
  await shell.execute("write docs/a.txt hola mundo");
  assertEqual(text(await shell.execute("cat docs/a.txt")).trim(), "hola mundo");
  assertEqual(decode(fs.readFile("/docs/a.txt")), "hola mundo\n");

  const listing = text(await shell.execute("ls docs"));
  assert(listing.includes("a.txt"), "ls debe listar a.txt");

  const df = text(await shell.execute("df"));
  assert(df.includes("RAMFS1"), "df debe mostrar el sistema");

  const stat = text(await shell.execute("stat docs/a.txt"));
  assert(stat.includes("Inodo:"), "stat debe mostrar el inodo");
  assert(stat.includes("Tamaño: 11 B"), "stat debe mostrar el tamaño");

  const tree = text(await shell.execute("tree"));
  assert(tree.includes("docs/"), "tree debe mostrar el directorio");

  const fsck = text(await shell.execute("fsck"));
  assert(fsck.includes("consistente"), "fsck debe aceptar el disco");
});

test("la redirección escribe la salida en un archivo", async () => {
  const { shell, fs } = makeShell();
  const result = await shell.execute("echo hola mundo > salida.txt");
  assert(text(result).includes("salida.txt"), "debe confirmar la escritura");
  assertEqual(decode(fs.readFile("/salida.txt")), "hola mundo\n");
});

test("una orden desconocida produce un error", async () => {
  const { shell } = makeShell();
  const result = await shell.execute("inventado");
  assertEqual(result.output.length, 1);
  assertEqual(result.output[0].type, "error");
  assert(result.output[0].text.includes("no encontrada"), "debe indicar que no existe");
});

test("cd y pwd mantienen el directorio actual", async () => {
  const { shell } = makeShell();
  await shell.execute("mkdir /tmp");
  await shell.execute("cd /tmp");
  assertEqual(text(await shell.execute("pwd")), "/tmp");
  await shell.execute("cd /");
  assertEqual(text(await shell.execute("pwd")), "/");
});

test("cd sin argumentos vuelve al home", async () => {
  const { shell } = makeShell();
  await shell.execute("mkdir /home");
  await shell.execute("mkdir /home/usuario");
  await shell.execute("cd");
  assertEqual(text(await shell.execute("pwd")), "/home/usuario");
});

test("setdate valida y ajusta el RTC", async () => {
  const { shell, clock } = makeShell();
  const ok = await shell.execute('setdate "2025-12-31 23:59:58"');
  assertEqual(ok.output[0].type, "ok");
  assertEqual(clock.now().getFullYear(), 2025);
  assertEqual(clock.now().getMonth(), 11);
  assertEqual(clock.now().getDate(), 31);

  const bad = await shell.execute('setdate "2025-02-30 10:00:00"');
  assertEqual(bad.output[0].type, "error");
});

test("speed, date y uptime reflejan el reloj simulado", async () => {
  const { shell, clock } = makeShell();
  const speed = await shell.execute("speed 10");
  assertEqual(speed.output[0].type, "ok");
  assertEqual(clock.speed, 10);

  const date = text(await shell.execute("date"));
  assert(date.startsWith("2024-01-02"), "date debe usar el RTC simulado");

  const uptime = text(await shell.execute("uptime"));
  assert(uptime.includes("x10"), "uptime debe mostrar la velocidad");
});

test("reset -f reformatea y avisa al resto de la aplicación", async () => {
  const { shell, fs, calls } = makeShell();
  await shell.execute("mkdir docs");
  await shell.execute("write docs/a.txt hola");
  const result = await shell.execute("reset -f");
  assertEqual(result.output[0].type, "ok");
  assertEqual(calls.reset, 1);
  assertDeepEqual(fs.listDir("/"), []);
  assertEqual(fs.df().freeBlocks, 117);
});

test("reset pide confirmación salvo con -f", async () => {
  const { shell, fs } = makeShell();
  const warning = await shell.execute("reset");
  assertEqual(warning.output[0].type, "warn");
  assertEqual(fs.df().usedInodes, 1);

  const cancelled = await shell.execute("n");
  assert(text(cancelled).includes("cancelado"), "debe cancelar con n");

  await shell.execute("reset");
  const confirmed = await shell.execute("s");
  assertEqual(confirmed.output[0].type, "ok");
});

test("halt detiene el sistema y bloquea nuevas órdenes", async () => {
  const { shell, calls } = makeShell();
  const result = await shell.execute("halt");
  assertEqual(result.halted, true);
  assertEqual(calls.halt, 1);
  const after = await shell.execute("pwd");
  assertEqual(after.output[0].type, "error");
});

test("complete propone comandos y rutas", async () => {
  const { shell } = makeShell();
  const command = shell.complete("mk");
  assertEqual(command.line, "mkdir");
  assertEqual(command.cursor, 5);

  await shell.execute("write nota.txt hola");
  const file = shell.complete("cat no");
  assertEqual(file.line, "cat nota.txt");

  const none = shell.complete("zzz");
  assertEqual(none, null);
});

test("whoami y uname identifican el sistema", async () => {
  const { shell } = makeShell();
  assertEqual(text(await shell.execute("whoami")), "usuario");
  assert(text(await shell.execute("uname")).includes("SIM-01"), "uname debe identificar SIM-01");
});
