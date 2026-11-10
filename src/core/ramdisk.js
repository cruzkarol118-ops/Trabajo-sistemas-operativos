import { FSError } from "./errors.js";

export const BLOCK_SIZE = 512;
export const BLOCK_COUNT = 128;
export const DISK_CAPACITY = BLOCK_SIZE * BLOCK_COUNT;
export const IMAGE_MAGIC = "SIM01IMG";

/**
 * Dispositivo de bloques volátil. Vive entero en memoria.
 */
export class RamDisk {
  constructor() {
    this.data = new Uint8Array(DISK_CAPACITY);
    this.stats = { reads: 0, writes: 0, lastWriteBlock: -1 };
  }

  _check(index) {
    if (!Number.isInteger(index) || index < 0 || index >= BLOCK_COUNT) {
      throw new FSError("EINVAL", `Bloque fuera de rango: ${index}`);
    }
  }

  readBlock(index) {
    this._check(index);
    this.stats.reads += 1;
    const start = index * BLOCK_SIZE;
    return this.data.slice(start, start + BLOCK_SIZE);
  }

  writeBlock(index, bytes) {
    this._check(index);
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (source.length > BLOCK_SIZE) {
      throw new FSError("EINVAL", `El bloque admite ${BLOCK_SIZE} bytes, llegaron ${source.length}`);
    }
    const start = index * BLOCK_SIZE;
    this.data.fill(0, start, start + BLOCK_SIZE);
    this.data.set(source, start);
    this.stats.writes += 1;
    this.stats.lastWriteBlock = index;
  }

  reset() {
    this.data.fill(0);
    this.stats = { reads: 0, writes: 0, lastWriteBlock: -1 };
  }

  /** Cabecera de 16 bytes + imagen completa. */
  toImage() {
    const buffer = new ArrayBuffer(16 + DISK_CAPACITY);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < IMAGE_MAGIC.length; i += 1) bytes[i] = IMAGE_MAGIC.charCodeAt(i);
    view.setUint16(8, 1, true);
    view.setUint16(10, BLOCK_SIZE, true);
    view.setUint16(12, BLOCK_COUNT, true);
    view.setUint16(14, 0, true);
    bytes.set(this.data, 16);
    return buffer;
  }

  loadImage(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 16 + DISK_CAPACITY) {
      throw new FSError("EINVAL", "Imagen de disco incompleta");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let magic = "";
    for (let i = 0; i < IMAGE_MAGIC.length; i += 1) magic += String.fromCharCode(bytes[i]);
    if (magic !== IMAGE_MAGIC) {
      throw new FSError("EINVAL", "La imagen no tiene el formato SIM01IMG");
    }
    if (view.getUint16(10, true) !== BLOCK_SIZE || view.getUint16(12, true) !== BLOCK_COUNT) {
      throw new FSError("EINVAL", "La imagen no coincide con este disco (512 B × 128)");
    }
    this.data.set(bytes.subarray(16, 16 + DISK_CAPACITY));
    this.stats = { reads: 0, writes: 0, lastWriteBlock: -1 };
  }

  static fromImage(buffer) {
    const disk = new RamDisk();
    disk.loadImage(buffer);
    return disk;
  }
}
