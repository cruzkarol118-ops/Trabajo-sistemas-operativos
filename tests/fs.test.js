import { FileSystem } from "../src/core/fs.js";
import { RamDisk } from "../src/core/ramdisk.js";
import { assert, assertDeepEqual, assertEqual, assertThrows, group, test } from "./harness.js";

group("RAMFS1");

const clock = { now: () => new Date(1_700_000_000_000) };

function makeFS() {
  const disk = new RamDisk();
  const fs = new FileSystem(disk, clock);
  fs.format();
  fs.mount();
  return { disk, fs };
}

function write(fs, path, text) {
  return fs.writeFile(path, new TextEncoder().encode(text));
}

function read(fs, path) {
  return new TextDecoder().decode(fs.readFile(path));
}

test("format deja una raíz vacía y consistente", () => {
  const { fs } = makeFS();
  const df = fs.df();
  assertEqual(df.usedBlocks, 0);
  assertEqual(df.freeBlocks, 117);
  assertEqual(df.usedInodes, 1);
  assertEqual(df.freeInodes, 63);
  assertEqual(fs.pwd(), "/");
  assertDeepEqual(fs.listDir("/"), []);
  assert(fs.fsck().ok, "fsck debe aceptar un disco recién formateado");
});

test("mount rechaza un disco sin RAMFS1", () => {
  const disk = new RamDisk();
  const fs = new FileSystem(disk, clock);
  assertThrows(() => fs.mount(), "EIO");
});

test("crea directorios anidados y cambia de directorio", () => {
  const { fs } = makeFS();
  fs.mkdir("/home");
  fs.mkdir("/home/usuario");
  assertEqual(fs.chdir("/home/usuario"), "/home/usuario");
  assertEqual(fs.pwd(), "/home/usuario");
  assertEqual(fs.normalize(".."), "/home");
  assertEqual(fs.normalize("../../"), "/");
  assertEqual(fs.normalize("./docs/../notas"), "/home/usuario/notas");
  assertThrows(() => fs.chdir("/home/usuario/nada"), "ENOENT");
  write(fs, "/home/usuario/archivo.txt", "x");
  assertThrows(() => fs.chdir("/home/usuario/archivo.txt"), "ENOTDIR");
});

test("escribe, lee, añade y lista archivos", () => {
  const { fs } = makeFS();
  write(fs, "/nota.txt", "hola");
  assertEqual(read(fs, "/nota.txt"), "hola");

  fs.appendFile("/nota.txt", new TextEncoder().encode(" mundo"));
  assertEqual(read(fs, "/nota.txt"), "hola mundo");

  write(fs, "/otra.txt", "x");
  assertDeepEqual(
    fs.listDir("/").map((entry) => entry.name),
    ["nota.txt", "otra.txt"],
  );

  const info = fs.stat("/nota.txt");
  assertEqual(info.type, "file");
  assertEqual(info.size, 10);
  assertEqual(info.blocks, 1);
  assertEqual(info.links, 1);
});

test("appendFile crea el archivo si no existe", () => {
  const { fs } = makeFS();
  fs.appendFile("/nuevo.txt", new TextEncoder().encode("abc"));
  assertEqual(read(fs, "/nuevo.txt"), "abc");
});

test("reutiliza un hueco al borrar y volver a crear", () => {
  const { fs } = makeFS();
  write(fs, "/a.txt", "uno");
  write(fs, "/b.txt", "dos");
  fs.unlink("/a.txt");
  write(fs, "/c.txt", "tres");
  assertDeepEqual(fs.listDir("/").map((entry) => entry.name), ["b.txt", "c.txt"]);
  assertEqual(read(fs, "/c.txt"), "tres");
  assert(fs.fsck().ok, "fsck tras reutilizar un hueco");
});

test("un archivo grande usa bloques directos e indirectos", () => {
  const { fs } = makeFS();
  const payload = new Uint8Array(7000).map((_, index) => index % 251);
  fs.writeFile("/grande.bin", payload);

  const back = fs.readFile("/grande.bin");
  assertEqual(back.length, payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    if (back[index] !== payload[index]) {
      throw new Error(`byte ${index}: esperado ${payload[index]}, obtenido ${back[index]}`);
    }
  }

  const info = fs.stat("/grande.bin");
  assertEqual(info.blocks, 14);
  assert(info.indirect > 0, "el archivo debe tener un bloque indirecto");

  const map = fs.blockMap();
  const owned = map.filter((block) => block.inode === info.inode);
  assertEqual(owned.filter((block) => block.type === "data").length, 14);
  assertEqual(owned.filter((block) => block.type === "meta").length, 1);

  assert(fs.fsck().ok, "fsck debe aceptar el archivo con bloque indirecto");
});

test("borrar libera bloques e inodos y deja el fsck limpio", () => {
  const { fs } = makeFS();
  fs.writeFile("/temporal.bin", new Uint8Array(4096));
  const withFile = fs.df();
  fs.unlink("/temporal.bin");
  const after = fs.df();
  assertEqual(after.usedBlocks, withFile.usedBlocks - 8);
  assertEqual(after.usedInodes, withFile.usedInodes - 1);
  assert(fs.fsck().ok, "fsck tras borrar");
});

test("rmdir exige un directorio vacío", () => {
  const { fs } = makeFS();
  fs.mkdir("/tmp");
  write(fs, "/tmp/a.txt", "x");
  assertThrows(() => fs.rmdir("/tmp"), "ENOTEMPTY");
  fs.unlink("/tmp/a.txt");
  fs.rmdir("/tmp");
  assertThrows(() => fs.stat("/tmp"), "ENOENT");
});

test("rename mueve archivos y rechaza destinos ocupados", () => {
  const { fs } = makeFS();
  write(fs, "/a.txt", "contenido");
  fs.rename("/a.txt", "/b.txt");
  assertEqual(read(fs, "/b.txt"), "contenido");
  assertThrows(() => fs.stat("/a.txt"), "ENOENT");

  write(fs, "/c.txt", "otro");
  assertThrows(() => fs.rename("/b.txt", "/c.txt"), "EEXIST");
});

test("valida nombres y operaciones inválidas", () => {
  const { fs } = makeFS();
  assertThrows(() => fs.mkdir(""), "EINVAL");
  assertThrows(() => fs.mkdir("."), "EINVAL");
  assertThrows(() => fs.mkdir(".."), "EINVAL");
  assertThrows(() => fs.mkdir("a/b"), "ENOENT");
  assertThrows(() => fs.mkdir("x".repeat(30)), "EINVAL");
  assertThrows(() => fs.rmdir("/"), "EINVAL");
  assertThrows(() => fs.unlink("/no-existe"), "ENOENT");
  assertThrows(() => fs.readFile("/"), "EISDIR");
  assertThrows(() => fs.writeFile("/", new Uint8Array(1)), "EINVAL");
});

test("detecta ENOSPC antes de corromper el disco", () => {
  const { fs } = makeFS();
  assertThrows(() => fs.writeFile("/enorme.bin", new Uint8Array(60_000)), "ENOSPC");
  assertEqual(fs.df().freeInodes, 63);
  assert(fs.df().freeBlocks >= 116, "solo puede quedar el bloque del directorio raíz");
  assert(fs.fsck().ok, "el intento fallido no debe dejar basura");
});

test("fsck detecta un bitmap manipulado", () => {
  const { disk, fs } = makeFS();
  write(fs, "/a.txt", "x");
  const bitmap = disk.readBlock(1);
  bitmap[6] |= 1 << 2; // bloque 50 marcado como usado sin dueño
  disk.writeBlock(1, bitmap);
  const result = fs.fsck();
  assertEqual(result.ok, false);
  assert(result.issues.some((issue) => issue.includes("huérfano")), "debe reportar un bloque huérfano");
});

test("blockMap identifica metadatos y datos", () => {
  const { fs } = makeFS();
  const empty = fs.blockMap();
  assertEqual(empty.length, 128);
  assertEqual(empty[0].label, "SUPER");
  assertEqual(empty[1].label, "BMAP");
  assertEqual(empty[2].label, "IMAP");
  assertEqual(empty[3].label, "INODOS");
  assertEqual(empty[10].label, "INODOS");
  assertEqual(empty[11].type, "free");

  write(fs, "/a.txt", "hola");
  const map = fs.blockMap();
  const fileInode = fs.stat("/a.txt").inode;
  const data = map.find((block) => block.type === "data" && block.inode === fileInode);
  assert(data, "debe haber un bloque de datos del archivo");
  assertEqual(data.inode, fileInode);
});

test("rename y rmdir protegen el directorio actual", () => {
  const { fs } = makeFS();
  fs.mkdir("/a");
  fs.mkdir("/a/b");
  assertThrows(() => fs.rename("/a", "/a/b/c"), "EINVAL");
  fs.chdir("/a/b");
  assertThrows(() => fs.rmdir("/a/b"), "EBUSY");
  assertThrows(() => fs.rename("/a/b", "/c"), "EBUSY");
  fs.chdir("/");
  fs.rmdir("/a/b");
  fs.rmdir("/a");
  assert(fs.fsck().ok, "fsck tras las operaciones");
});
