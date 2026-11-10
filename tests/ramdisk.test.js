import { BLOCK_COUNT, BLOCK_SIZE, DISK_CAPACITY, RamDisk } from "../src/core/ramdisk.js";
import { assert, assertDeepEqual, assertEqual, assertThrows, group, test } from "./harness.js";

group("Disco en RAM");

test("expone 128 bloques de 512 B (64 KiB)", () => {
  assertEqual(BLOCK_COUNT, 128);
  assertEqual(BLOCK_SIZE, 512);
  assertEqual(DISK_CAPACITY, 65536);
  const disk = new RamDisk();
  assertEqual(disk.data.length, DISK_CAPACITY);
});

test("escribe y lee un bloque completo", () => {
  const disk = new RamDisk();
  const data = new Uint8Array(BLOCK_SIZE).fill(7);
  disk.writeBlock(3, data);
  assertDeepEqual(disk.readBlock(3), data);
  assertEqual(disk.stats.writes, 1);
  assertEqual(disk.stats.reads, 1);
  assertEqual(disk.stats.lastWriteBlock, 3);
});

test("escribe un bloque parcial y rellena con ceros", () => {
  const disk = new RamDisk();
  disk.writeBlock(0, new Uint8Array([1, 2, 3]));
  const block = disk.readBlock(0);
  assertEqual(block[0], 1);
  assertEqual(block[2], 3);
  assertEqual(block[3], 0);
  assertEqual(block[511], 0);
});

test("rechaza bloques fuera de rango", () => {
  const disk = new RamDisk();
  assertThrows(() => disk.readBlock(128), "EINVAL");
  assertThrows(() => disk.writeBlock(-1, new Uint8Array(1)), "EINVAL");
});

test("rechaza escrituras mayores que un bloque", () => {
  const disk = new RamDisk();
  assertThrows(() => disk.writeBlock(0, new Uint8Array(BLOCK_SIZE + 1)), "EINVAL");
});

test("reset borra los datos y las estadísticas", () => {
  const disk = new RamDisk();
  disk.writeBlock(5, new Uint8Array(BLOCK_SIZE).fill(9));
  disk.reset();
  assertEqual(disk.stats.writes, 0);
  assertEqual(disk.stats.lastWriteBlock, -1);
  assertEqual(disk.readBlock(5).every((value) => value === 0), true);
  assertEqual(disk.stats.reads, 1);
});

test("la imagen SIM01IMG conserva el contenido", () => {
  const disk = new RamDisk();
  const payload = new Uint8Array(BLOCK_SIZE).map((_, index) => index % 251);
  disk.writeBlock(11, payload);
  const image = disk.toImage();
  assertEqual(image.byteLength, 16 + DISK_CAPACITY);

  const restored = RamDisk.fromImage(image);
  assertDeepEqual(restored.readBlock(11), payload);
  assertEqual(restored.stats.writes, 0);
});

test("rechaza imágenes incompletas o con formato ajeno", () => {
  assertThrows(() => RamDisk.fromImage(new ArrayBuffer(10)), "EINVAL");

  const image = new Uint8Array(16 + DISK_CAPACITY);
  image.set(new TextEncoder().encode("OTROIMG!"), 0);
  assertThrows(() => RamDisk.fromImage(image.buffer), "EINVAL");

  const wrongGeometry = new RamDisk().toImage();
  new DataView(wrongGeometry).setUint16(10, 1024, true);
  assertThrows(() => RamDisk.fromImage(wrongGeometry), "EINVAL");
});
