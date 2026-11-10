import { FSError } from "./errors.js";
import { BLOCK_SIZE, BLOCK_COUNT } from "./ramdisk.js";

export const FS_MAGIC = "RAMFS1";
export const INODE_COUNT = 64;
export const INODE_SIZE = 64;
export const DIRECT_POINTERS = 12;
export const PTRS_PER_BLOCK = BLOCK_SIZE / 2;
export const DIR_ENTRY_SIZE = 32;
export const MAX_NAME_BYTES = 29;

export const SUPERBLOCK_BLOCK = 0;
export const BLOCK_BITMAP_BLOCK = 1;
export const INODE_BITMAP_BLOCK = 2;
export const INODE_TABLE_START = 3;
export const INODE_TABLE_BLOCKS = 8;
export const DATA_START = 11;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bitGet(block, bit) {
  return (block[bit >> 3] >> (bit & 7)) & 1;
}

function bitSet(block, bit, value) {
  const byte = bit >> 3;
  const mask = 1 << (bit & 7);
  block[byte] = value ? block[byte] | mask : block[byte] & ~mask;
}

/**
 * RAMFS1: sistema de archivos mínimo con superbloque, bitmaps e inodos.
 * Bloques 0-10 son metadatos; 11-127 son datos.
 */
export class FileSystem {
  constructor(disk, clock) {
    this.disk = disk;
    this.clock = clock;
    this.mounted = false;
    this.cwd = "/";
    this.lastTouchedBlock = null;
  }

  // ---------------------------------------------------------------------
  // Superbloque y bitmaps
  // ---------------------------------------------------------------------

  _readSuperblock() {
    const block = this.disk.readBlock(SUPERBLOCK_BLOCK);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    let magic = "";
    for (let i = 0; i < 6; i += 1) magic += String.fromCharCode(block[i]);
    return {
      magic,
      version: view.getUint16(8, true),
      blockSize: view.getUint16(10, true),
      blockCount: view.getUint16(12, true),
      inodeCount: view.getUint16(14, true),
      rootInode: view.getUint16(16, true),
      freeBlocks: view.getUint16(18, true),
      freeInodes: view.getUint16(20, true),
    };
  }

  _writeSuperblock(superblock) {
    const block = new Uint8Array(BLOCK_SIZE);
    const view = new DataView(block.buffer);
    for (let i = 0; i < 6; i += 1) block[i] = FS_MAGIC.charCodeAt(i);
    view.setUint16(8, superblock.version, true);
    view.setUint16(10, superblock.blockSize, true);
    view.setUint16(12, superblock.blockCount, true);
    view.setUint16(14, superblock.inodeCount, true);
    view.setUint16(16, superblock.rootInode, true);
    view.setUint16(18, superblock.freeBlocks, true);
    view.setUint16(20, superblock.freeInodes, true);
    this.disk.writeBlock(SUPERBLOCK_BLOCK, block);
  }

  _nowSec() {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  // ---------------------------------------------------------------------
  // Inodos
  // ---------------------------------------------------------------------

  _readInode(index) {
    if (!Number.isInteger(index) || index < 0 || index >= INODE_COUNT) {
      throw new FSError("EINVAL", `Inodo fuera de rango: ${index}`);
    }
    const blockIndex = INODE_TABLE_START + Math.floor((index * INODE_SIZE) / BLOCK_SIZE);
    const offset = (index * INODE_SIZE) % BLOCK_SIZE;
    const block = this.disk.readBlock(blockIndex);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const direct = [];
    for (let i = 0; i < DIRECT_POINTERS; i += 1) {
      direct.push(view.getUint16(offset + 14 + i * 2, true));
    }
    return {
      mode: block[offset],
      links: block[offset + 1],
      size: view.getUint32(offset + 2, true),
      mtime: view.getUint32(offset + 6, true),
      ctime: view.getUint32(offset + 10, true),
      direct,
      indirect: view.getUint16(offset + 38, true),
    };
  }

  _writeInode(index, inode) {
    if (!Number.isInteger(index) || index < 0 || index >= INODE_COUNT) {
      throw new FSError("EINVAL", `Inodo fuera de rango: ${index}`);
    }
    const blockIndex = INODE_TABLE_START + Math.floor((index * INODE_SIZE) / BLOCK_SIZE);
    const offset = (index * INODE_SIZE) % BLOCK_SIZE;
    const block = this.disk.readBlock(blockIndex);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    block.fill(0, offset, offset + INODE_SIZE);
    block[offset] = inode.mode;
    block[offset + 1] = inode.links;
    view.setUint32(offset + 2, inode.size, true);
    view.setUint32(offset + 6, inode.mtime, true);
    view.setUint32(offset + 10, inode.ctime, true);
    for (let i = 0; i < DIRECT_POINTERS; i += 1) {
      view.setUint16(offset + 14 + i * 2, inode.direct[i] || 0, true);
    }
    view.setUint16(offset + 38, inode.indirect || 0, true);
    this.disk.writeBlock(blockIndex, block);
  }

  _allocInode() {
    const bitmap = this.disk.readBlock(INODE_BITMAP_BLOCK);
    for (let i = 0; i < INODE_COUNT; i += 1) {
      if (!bitGet(bitmap, i)) {
        bitSet(bitmap, i, 1);
        this.disk.writeBlock(INODE_BITMAP_BLOCK, bitmap);
        const superblock = this._readSuperblock();
        superblock.freeInodes -= 1;
        this._writeSuperblock(superblock);
        this._writeInode(i, {
          mode: 0,
          links: 0,
          size: 0,
          mtime: this._nowSec(),
          ctime: this._nowSec(),
          direct: new Array(DIRECT_POINTERS).fill(0),
          indirect: 0,
        });
        return i;
      }
    }
    throw new FSError("ENOSPC", "No quedan inodos libres");
  }

  _freeInode(index) {
    const bitmap = this.disk.readBlock(INODE_BITMAP_BLOCK);
    if (!bitGet(bitmap, index)) return;
    bitSet(bitmap, index, 0);
    this.disk.writeBlock(INODE_BITMAP_BLOCK, bitmap);
    const superblock = this._readSuperblock();
    superblock.freeInodes += 1;
    this._writeSuperblock(superblock);
    this._writeInode(index, {
      mode: 0,
      links: 0,
      size: 0,
      mtime: 0,
      ctime: 0,
      direct: new Array(DIRECT_POINTERS).fill(0),
      indirect: 0,
    });
  }

  // ---------------------------------------------------------------------
  // Bloques
  // ---------------------------------------------------------------------

  _allocBlock() {
    const bitmap = this.disk.readBlock(BLOCK_BITMAP_BLOCK);
    for (let i = DATA_START; i < BLOCK_COUNT; i += 1) {
      if (!bitGet(bitmap, i)) {
        bitSet(bitmap, i, 1);
        this.disk.writeBlock(BLOCK_BITMAP_BLOCK, bitmap);
        const superblock = this._readSuperblock();
        superblock.freeBlocks -= 1;
        this._writeSuperblock(superblock);
        this.disk.writeBlock(i, new Uint8Array(BLOCK_SIZE));
        return i;
      }
    }
    throw new FSError("ENOSPC", "No quedan bloques de datos libres");
  }

  _freeBlock(index) {
    if (!Number.isInteger(index) || index < DATA_START || index >= BLOCK_COUNT) {
      throw new FSError("EINVAL", `Bloque de datos inválido: ${index}`);
    }
    const bitmap = this.disk.readBlock(BLOCK_BITMAP_BLOCK);
    if (!bitGet(bitmap, index)) return;
    bitSet(bitmap, index, 0);
    this.disk.writeBlock(BLOCK_BITMAP_BLOCK, bitmap);
    const superblock = this._readSuperblock();
    superblock.freeBlocks += 1;
    this._writeSuperblock(superblock);
    this.disk.writeBlock(index, new Uint8Array(BLOCK_SIZE));
  }

  _allocatedBlocks(inode) {
    let count = 0;
    for (const pointer of inode.direct) if (pointer) count += 1;
    if (inode.indirect) {
      const block = this.disk.readBlock(inode.indirect);
      const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
      for (let i = 0; i < PTRS_PER_BLOCK; i += 1) {
        if (view.getUint16(i * 2, true)) count += 1;
      }
    }
    return count;
  }

  _fileBlockPointer(inodeIndex, inode, fileBlock, { allocate = false } = {}) {
    if (fileBlock < 0 || fileBlock >= DIRECT_POINTERS + PTRS_PER_BLOCK) {
      throw new FSError("ENOSPC", "Archivo demasiado grande");
    }
    if (fileBlock < DIRECT_POINTERS) {
      if (!inode.direct[fileBlock] && allocate) {
        inode.direct[fileBlock] = this._allocBlock();
        this._writeInode(inodeIndex, inode);
      }
      return inode.direct[fileBlock];
    }

    const indirectIndex = fileBlock - DIRECT_POINTERS;
    if (!inode.indirect && allocate) {
      inode.indirect = this._allocBlock();
      this._writeInode(inodeIndex, inode);
    }
    if (!inode.indirect) return 0;
    const block = this.disk.readBlock(inode.indirect);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    let pointer = view.getUint16(indirectIndex * 2, true);
    if (!pointer && allocate) {
      pointer = this._allocBlock();
      view.setUint16(indirectIndex * 2, pointer, true);
      this.disk.writeBlock(inode.indirect, block);
    }
    return pointer;
  }

  _ensureBlocks(inodeIndex, inode, bytes) {
    const needed = Math.ceil(bytes / BLOCK_SIZE);
    for (let i = this._allocatedBlocks(inode); i < needed; i += 1) {
      this._fileBlockPointer(inodeIndex, inode, i, { allocate: true });
    }
  }

  _freeInodeBlocks(inodeIndex, inode) {
    for (let i = 0; i < DIRECT_POINTERS; i += 1) {
      if (inode.direct[i]) {
        this._freeBlock(inode.direct[i]);
        inode.direct[i] = 0;
      }
    }
    if (inode.indirect) {
      const block = this.disk.readBlock(inode.indirect);
      const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
      for (let i = 0; i < PTRS_PER_BLOCK; i += 1) {
        const pointer = view.getUint16(i * 2, true);
        if (pointer) this._freeBlock(pointer);
      }
      this._freeBlock(inode.indirect);
      inode.indirect = 0;
    }
    this._writeInode(inodeIndex, inode);
  }

  _readData(inode) {
    const data = new Uint8Array(inode.size);
    let offset = 0;
    let fileBlock = 0;
    while (offset < inode.size) {
      const pointer = this._fileBlockPointer(0, inode, fileBlock, { allocate: false });
      if (pointer) {
        const block = this.disk.readBlock(pointer);
        const chunk = Math.min(BLOCK_SIZE, inode.size - offset);
        data.set(block.subarray(0, chunk), offset);
      }
      offset += BLOCK_SIZE;
      fileBlock += 1;
    }
    return data;
  }

  _writeData(inodeIndex, inode, bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const needed = Math.ceil(data.length / BLOCK_SIZE);
    const indirectNeeded = needed > DIRECT_POINTERS ? 1 : 0;
    const current = this._allocatedBlocks(inode);
    const currentIndirect = inode.indirect ? 1 : 0;
    const available = this._readSuperblock().freeBlocks + current + currentIndirect;
    if (available < needed + indirectNeeded) {
      throw new FSError("ENOSPC", "No hay espacio suficiente en el disco");
    }

    this._freeInodeBlocks(inodeIndex, inode);
    inode.size = 0;
    this._ensureBlocks(inodeIndex, inode, data.length);

    let lastPointer = null;
    for (let i = 0; i < needed; i += 1) {
      const pointer = this._fileBlockPointer(inodeIndex, inode, i, { allocate: true });
      this.disk.writeBlock(pointer, data.subarray(i * BLOCK_SIZE, Math.min((i + 1) * BLOCK_SIZE, data.length)));
      lastPointer = pointer;
    }
    if (lastPointer !== null) this.lastTouchedBlock = lastPointer;

    inode.size = data.length;
    inode.mtime = this._nowSec();
    inode.ctime = inode.ctime || inode.mtime;
    this._writeInode(inodeIndex, inode);
  }

  // ---------------------------------------------------------------------
  // Nombres y directorios
  // ---------------------------------------------------------------------

  _validateName(name) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
      throw new FSError("EINVAL", `Nombre inválido: ${name}`);
    }
    const bytes = encoder.encode(name);
    if (bytes.length > MAX_NAME_BYTES) {
      throw new FSError("EINVAL", `Nombre demasiado largo (máx. ${MAX_NAME_BYTES} bytes): ${name}`);
    }
    return bytes;
  }

  _decodeName(bytes) {
    return decoder.decode(bytes);
  }

  _readDirEntries(inode) {
    if (inode.mode !== 2) throw new FSError("ENOTDIR", "No es un directorio");
    const data = this._readData(inode);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const entries = [];
    for (let offset = 0; offset + DIR_ENTRY_SIZE <= data.length; offset += DIR_ENTRY_SIZE) {
      const inodeNumber = view.getUint16(offset, true);
      const nameLength = data[offset + 2];
      if (!inodeNumber || !nameLength) continue;
      const name = this._decodeName(data.subarray(offset + 3, offset + 3 + nameLength));
      entries.push({ inode: inodeNumber, name });
    }
    return entries;
  }

  _findEntry(inode, name) {
    return this._readDirEntries(inode).find((entry) => entry.name === name) || null;
  }

  _addDirEntry(inodeIndex, inode, name, inodeNumber) {
    const nameBytes = this._validateName(name);
    const data = this._readData(inode);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Primero verificar duplicados en todo el directorio.
    for (let offset = 0; offset + DIR_ENTRY_SIZE <= data.length; offset += DIR_ENTRY_SIZE) {
      const currentInode = view.getUint16(offset, true);
      const nameLength = data[offset + 2];
      if (!currentInode || !nameLength) continue;
      const currentName = this._decodeName(data.subarray(offset + 3, offset + 3 + nameLength));
      if (currentName === name) throw new FSError("EEXIST", `Ya existe: ${name}`);
    }

    // Luego reutilizar un hueco libre o añadir al final.
    for (let offset = 0; offset + DIR_ENTRY_SIZE <= data.length; offset += DIR_ENTRY_SIZE) {
      const currentInode = view.getUint16(offset, true);
      if (!currentInode) {
        data.fill(0, offset, offset + DIR_ENTRY_SIZE);
        view.setUint16(offset, inodeNumber, true);
        data[offset + 2] = nameBytes.length;
        data.set(nameBytes, offset + 3);
        this._writeData(inodeIndex, inode, data);
        return;
      }
    }

    const offset = data.length;
    const next = new Uint8Array(offset + DIR_ENTRY_SIZE);
    next.set(data);
    const nextView = new DataView(next.buffer);
    nextView.setUint16(offset, inodeNumber, true);
    next[offset + 2] = nameBytes.length;
    next.set(nameBytes, offset + 3);
    this._writeData(inodeIndex, inode, next);
  }

  _removeDirEntry(inodeIndex, inode, name) {
    const data = this._readData(inode);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let offset = 0; offset + DIR_ENTRY_SIZE <= data.length; offset += DIR_ENTRY_SIZE) {
      const inodeNumber = view.getUint16(offset, true);
      const nameLength = data[offset + 2];
      if (!inodeNumber || !nameLength) continue;
      const currentName = this._decodeName(data.subarray(offset + 3, offset + 3 + nameLength));
      if (currentName === name) {
        data.fill(0, offset, offset + DIR_ENTRY_SIZE);
        this._writeData(inodeIndex, inode, data);
        return;
      }
    }
    throw new FSError("ENOENT", `No existe: ${name}`);
  }

  // ---------------------------------------------------------------------
  // Rutas
  // ---------------------------------------------------------------------

  normalize(path) {
    let value = String(path ?? "/");
    if (!value.startsWith("/")) {
      value = `${this.cwd === "/" ? "" : this.cwd}/${value}`;
    }
    const parts = [];
    for (const part of value.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (parts.length) parts.pop();
        continue;
      }
      parts.push(part);
    }
    return `/${parts.join("/")}`;
  }

  _splitPath(path) {
    const normalized = this.normalize(path);
    if (normalized === "/") return { parentPath: "/", name: "", path: normalized };
    const index = normalized.lastIndexOf("/");
    return {
      parentPath: index === 0 ? "/" : normalized.slice(0, index),
      name: normalized.slice(index + 1),
      path: normalized,
    };
  }

  resolve(path) {
    const normalized = this.normalize(path);
    if (normalized === "/") return { inode: 0, path: "/", name: "/" };
    let current = 0;
    let currentPath = "";
    for (const part of normalized.split("/").filter(Boolean)) {
      const inode = this._readInode(current);
      if (inode.mode !== 2) throw new FSError("ENOTDIR", `No es un directorio: ${currentPath || "/"}`);
      const entry = this._findEntry(inode, part);
      if (!entry) throw new FSError("ENOENT", `No existe: ${part}`);
      current = entry.inode;
      currentPath += `/${part}`;
    }
    return { inode: current, path: normalized, name: normalized.split("/").pop() };
  }

  _resolveParent(path) {
    const { parentPath, name, path: normalized } = this._splitPath(path);
    if (!name) throw new FSError("EINVAL", "No se puede operar sobre la raíz");
    const parent = this.resolve(parentPath);
    const inode = this._readInode(parent.inode);
    if (inode.mode !== 2) throw new FSError("ENOTDIR", `No es un directorio: ${parentPath}`);
    return { parentInode: parent.inode, parent, name, path: normalized };
  }

  // ---------------------------------------------------------------------
  // Operaciones públicas
  // ---------------------------------------------------------------------

  format() {
    this.disk.reset();
    const now = this._nowSec();
    this._writeSuperblock({
      magic: FS_MAGIC,
      version: 1,
      blockSize: BLOCK_SIZE,
      blockCount: BLOCK_COUNT,
      inodeCount: INODE_COUNT,
      rootInode: 0,
      freeBlocks: BLOCK_COUNT - DATA_START,
      freeInodes: INODE_COUNT - 1,
    });

    const blockBitmap = new Uint8Array(BLOCK_SIZE);
    for (let i = 0; i < DATA_START; i += 1) bitSet(blockBitmap, i, 1);
    this.disk.writeBlock(BLOCK_BITMAP_BLOCK, blockBitmap);

    const inodeBitmap = new Uint8Array(BLOCK_SIZE);
    bitSet(inodeBitmap, 0, 1);
    this.disk.writeBlock(INODE_BITMAP_BLOCK, inodeBitmap);

    this._writeInode(0, {
      mode: 2,
      links: 1,
      size: 0,
      mtime: now,
      ctime: now,
      direct: new Array(DIRECT_POINTERS).fill(0),
      indirect: 0,
    });

    this.mounted = true;
    this.cwd = "/";
    this.lastTouchedBlock = null;
    return this;
  }

  mount() {
    const superblock = this._readSuperblock();
    if (superblock.magic !== FS_MAGIC) {
      throw new FSError("EIO", "El disco no contiene un sistema RAMFS1 válido");
    }
    if (
      superblock.blockSize !== BLOCK_SIZE ||
      superblock.blockCount !== BLOCK_COUNT ||
      superblock.inodeCount !== INODE_COUNT
    ) {
      throw new FSError("EIO", "Parámetros de RAMFS1 incompatibles");
    }
    const root = this._readInode(superblock.rootInode);
    if (root.mode !== 2) throw new FSError("EIO", "El inodo raíz no es un directorio");
    this.mounted = true;
    this.cwd = "/";
    this.lastTouchedBlock = null;
    return this;
  }

  chdir(path) {
    const target = this.resolve(path);
    const inode = this._readInode(target.inode);
    if (inode.mode !== 2) throw new FSError("ENOTDIR", `No es un directorio: ${target.path}`);
    this.cwd = target.path;
    return this.cwd;
  }

  pwd() {
    return this.cwd;
  }

  create(path) {
    const { parentInode, parent, name } = this._resolveParent(path);
    const parentInodeData = this._readInode(parentInode);
    if (this._findEntry(parentInodeData, name)) throw new FSError("EEXIST", `Ya existe: ${name}`);
    const inodeNumber = this._allocInode();
    const now = this._nowSec();
    try {
      this._writeInode(inodeNumber, {
        mode: 1,
        links: 1,
        size: 0,
        mtime: now,
        ctime: now,
        direct: new Array(DIRECT_POINTERS).fill(0),
        indirect: 0,
      });
      this._addDirEntry(parentInode, parentInodeData, name, inodeNumber);
    } catch (error) {
      this._freeInode(inodeNumber);
      throw error;
    }
    return this.stat(`${parent.path === "/" ? "" : parent.path}/${name}`);
  }

  mkdir(path) {
    const { parentInode, parent, name } = this._resolveParent(path);
    const parentInodeData = this._readInode(parentInode);
    if (this._findEntry(parentInodeData, name)) throw new FSError("EEXIST", `Ya existe: ${name}`);
    const inodeNumber = this._allocInode();
    const now = this._nowSec();
    try {
      this._writeInode(inodeNumber, {
        mode: 2,
        links: 1,
        size: 0,
        mtime: now,
        ctime: now,
        direct: new Array(DIRECT_POINTERS).fill(0),
        indirect: 0,
      });
      this._addDirEntry(parentInode, parentInodeData, name, inodeNumber);
    } catch (error) {
      this._freeInode(inodeNumber);
      throw error;
    }
    return this.stat(`${parent.path === "/" ? "" : parent.path}/${name}`);
  }

  readFile(path) {
    const target = this.resolve(path);
    const inode = this._readInode(target.inode);
    if (inode.mode === 2) throw new FSError("EISDIR", `Es un directorio: ${target.path}`);
    if (inode.mode !== 1) throw new FSError("ENOENT", `No existe: ${target.path}`);
    return this._readData(inode);
  }

  writeFile(path, bytes) {
    const { parentInode, parent, name } = this._resolveParent(path);
    const parentInodeData = this._readInode(parentInode);
    let entry = this._findEntry(parentInodeData, name);
    let inodeNumber;
    let inode;

    if (entry) {
      inodeNumber = entry.inode;
      inode = this._readInode(inodeNumber);
      if (inode.mode === 2) throw new FSError("EISDIR", `Es un directorio: ${name}`);
    } else {
      inodeNumber = this._allocInode();
      inode = {
        mode: 1,
        links: 1,
        size: 0,
        mtime: this._nowSec(),
        ctime: this._nowSec(),
        direct: new Array(DIRECT_POINTERS).fill(0),
        indirect: 0,
      };
      this._writeInode(inodeNumber, inode);
      try {
        this._addDirEntry(parentInode, parentInodeData, name, inodeNumber);
      } catch (error) {
        this._freeInode(inodeNumber);
        throw error;
      }
    }

    try {
      this._writeData(inodeNumber, inode, bytes);
    } catch (error) {
      if (!entry) {
        this._removeDirEntry(parentInode, parentInodeData, name);
        this._freeInode(inodeNumber);
      }
      throw error;
    }
    return this.stat(`${parent.path === "/" ? "" : parent.path}/${name}`);
  }

  appendFile(path, bytes) {
    let current;
    try {
      current = this.readFile(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      current = new Uint8Array(0);
    }
    const addition = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const next = new Uint8Array(current.length + addition.length);
    next.set(current);
    next.set(addition, current.length);
    return this.writeFile(path, next);
  }

  listDir(path = this.cwd) {
    const target = this.resolve(path);
    const inode = this._readInode(target.inode);
    if (inode.mode !== 2) throw new FSError("ENOTDIR", `No es un directorio: ${target.path}`);
    return this._readDirEntries(inode)
      .map((entry) => {
        const child = this._readInode(entry.inode);
        return {
          name: entry.name,
          inode: entry.inode,
          type: child.mode === 2 ? "dir" : "file",
          mode: child.mode,
          size: child.size,
          mtime: child.mtime,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  stat(path) {
    const target = this.resolve(path);
    const inode = this._readInode(target.inode);
    return {
      path: target.path,
      name: target.path === "/" ? "/" : target.name,
      inode: target.inode,
      type: inode.mode === 2 ? "dir" : inode.mode === 1 ? "file" : "free",
      mode: inode.mode,
      links: inode.links,
      size: inode.size,
      mtime: inode.mtime,
      ctime: inode.ctime,
      direct: [...inode.direct],
      indirect: inode.indirect,
      blocks: this._allocatedBlocks(inode),
    };
  }

  unlink(path) {
    const { parentInode, name } = this._resolveParent(path);
    const parentInodeData = this._readInode(parentInode);
    const entry = this._findEntry(parentInodeData, name);
    if (!entry) throw new FSError("ENOENT", `No existe: ${name}`);
    const inode = this._readInode(entry.inode);
    if (inode.mode === 2) throw new FSError("EISDIR", `Es un directorio: ${name}`);
    this._removeDirEntry(parentInode, parentInodeData, name);
    this._freeInodeBlocks(entry.inode, inode);
    this._freeInode(entry.inode);
  }

  rmdir(path) {
    const normalized = this.normalize(path);
    if (normalized === "/") throw new FSError("EINVAL", "No se puede borrar la raíz");
    if (this.cwd === normalized || this.cwd.startsWith(`${normalized}/`)) {
      throw new FSError("EBUSY", "No se puede borrar el directorio actual");
    }
    const { parentInode, name } = this._resolveParent(path);
    const parentInodeData = this._readInode(parentInode);
    const entry = this._findEntry(parentInodeData, name);
    if (!entry) throw new FSError("ENOENT", `No existe: ${name}`);
    const inode = this._readInode(entry.inode);
    if (inode.mode !== 2) throw new FSError("ENOTDIR", `No es un directorio: ${name}`);
    if (this._readDirEntries(inode).length > 0) {
      throw new FSError("ENOTEMPTY", `El directorio no está vacío: ${name}`);
    }
    this._removeDirEntry(parentInode, parentInodeData, name);
    this._freeInodeBlocks(entry.inode, inode);
    this._freeInode(entry.inode);
  }

  rename(oldPath, newPath) {
    const oldNormalized = this.normalize(oldPath);
    const newNormalized = this.normalize(newPath);
    if (oldNormalized === newNormalized) return this.stat(oldNormalized);
    const oldTarget = this.resolve(oldNormalized);
    if (oldNormalized === "/") throw new FSError("EINVAL", "No se puede renombrar la raíz");
    if (newNormalized.startsWith(`${oldNormalized}/`)) {
      throw new FSError("EINVAL", "No se puede mover un directorio dentro de sí mismo");
    }
    if (this.cwd === oldNormalized || this.cwd.startsWith(`${oldNormalized}/`)) {
      throw new FSError("EBUSY", "No se puede renombrar el directorio actual");
    }
    const { parentInode: oldParentInode, name: oldName } = this._resolveParent(oldNormalized);
    const oldParent = this._readInode(oldParentInode);
    const oldEntry = this._findEntry(oldParent, oldName);
    if (!oldEntry) throw new FSError("ENOENT", `No existe: ${oldName}`);

    const { parentInode: newParentInode, name: newName } = this._resolveParent(newNormalized);
    const newParent = this._readInode(newParentInode);
    if (this._findEntry(newParent, newName)) throw new FSError("EEXIST", `Ya existe: ${newName}`);

    this._addDirEntry(newParentInode, newParent, newName, oldEntry.inode);
    // Releer el padre antiguo: si es el mismo directorio, _addDirEntry ya
    // reescribió sus bloques y la copia anterior quedaría obsoleta.
    const oldParentFresh = this._readInode(oldParentInode);
    this._removeDirEntry(oldParentInode, oldParentFresh, oldName);
    return this.stat(newNormalized);
  }

  touch(path) {
    try {
      const target = this.resolve(path);
      const inode = this._readInode(target.inode);
      inode.mtime = this._nowSec();
      this._writeInode(target.inode, inode);
      return this.stat(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return this.create(path);
    }
  }

  df() {
    const superblock = this._readSuperblock();
    return {
      blockSize: superblock.blockSize,
      blockCount: superblock.blockCount,
      dataStart: DATA_START,
      totalDataBlocks: superblock.blockCount - DATA_START,
      freeBlocks: superblock.freeBlocks,
      usedBlocks: superblock.blockCount - DATA_START - superblock.freeBlocks,
      inodeCount: superblock.inodeCount,
      freeInodes: superblock.freeInodes,
      usedInodes: superblock.inodeCount - superblock.freeInodes,
    };
  }

  blockMap() {
    const map = Array.from({ length: BLOCK_COUNT }, (_, block) => ({
      block,
      type: block < DATA_START ? "meta" : "free",
      inode: null,
      label: null,
    }));
    map[0].label = "SUPER";
    map[1].label = "BMAP";
    map[2].label = "IMAP";
    for (let i = 3; i < DATA_START; i += 1) map[i].label = "INODOS";

    for (let index = 0; index < INODE_COUNT; index += 1) {
      const inode = this._readInode(index);
      if (inode.mode !== 1 && inode.mode !== 2) continue;
      for (const pointer of inode.direct) {
        if (pointer) {
          map[pointer].type = "data";
          map[pointer].inode = index;
        }
      }
      if (inode.indirect) {
        map[inode.indirect].type = "meta";
        map[inode.indirect].inode = index;
        map[inode.indirect].label = "IND";
        const block = this.disk.readBlock(inode.indirect);
        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        for (let i = 0; i < PTRS_PER_BLOCK; i += 1) {
          const pointer = view.getUint16(i * 2, true);
          if (pointer) {
            map[pointer].type = "data";
            map[pointer].inode = index;
          }
        }
      }
    }
    return map;
  }

  fsck() {
    const issues = [];
    try {
      const superblock = this._readSuperblock();
      if (superblock.magic !== FS_MAGIC) {
        return { ok: false, issues: ["Superbloque inválido: falta la firma RAMFS1"] };
      }

      const blockBitmap = this.disk.readBlock(BLOCK_BITMAP_BLOCK);
      const inodeBitmap = this.disk.readBlock(INODE_BITMAP_BLOCK);
      let usedBlocks = 0;
      for (let i = 0; i < BLOCK_COUNT; i += 1) if (bitGet(blockBitmap, i)) usedBlocks += 1;
      let usedInodes = 0;
      for (let i = 0; i < INODE_COUNT; i += 1) if (bitGet(inodeBitmap, i)) usedInodes += 1;

      if (usedBlocks !== superblock.blockCount - superblock.freeBlocks) {
        issues.push(`freeBlocks inconsistente: superbloque ${superblock.freeBlocks}, bitmap ${superblock.blockCount - usedBlocks}`);
      }
      if (usedInodes !== superblock.inodeCount - superblock.freeInodes) {
        issues.push(`freeInodes inconsistente: superbloque ${superblock.freeInodes}, bitmap ${superblock.inodeCount - usedInodes}`);
      }
      if (!bitGet(inodeBitmap, superblock.rootInode)) issues.push("El inodo raíz no está marcado como usado");

      const referenced = new Map();
      const addReference = (block, inodeNumber, kind) => {
        if (!Number.isInteger(block) || block < DATA_START || block >= BLOCK_COUNT) {
          issues.push(`Inodo ${inodeNumber}: puntero ${kind} fuera de rango (${block})`);
          return;
        }
        if (!bitGet(blockBitmap, block)) {
          issues.push(`Inodo ${inodeNumber}: bloque ${block} referenciado pero marcado libre`);
        }
        if (referenced.has(block)) {
          issues.push(`Bloque ${block} referenciado por los inodos ${referenced.get(block)} y ${inodeNumber}`);
        } else {
          referenced.set(block, inodeNumber);
        }
      };

      for (let index = 0; index < INODE_COUNT; index += 1) {
        if (!bitGet(inodeBitmap, index)) continue;
        const inode = this._readInode(index);
        if (inode.mode !== 1 && inode.mode !== 2) {
          issues.push(`Inodo ${index}: marcado usado pero con modo inválido (${inode.mode})`);
          continue;
        }
        const expected = Math.ceil(inode.size / BLOCK_SIZE);
        const actual = this._allocatedBlocks(inode);
        if (expected !== actual) {
          issues.push(`Inodo ${index}: tamaño ${inode.size} requiere ${expected} bloques, tiene ${actual}`);
        }
        for (let i = 0; i < DIRECT_POINTERS; i += 1) {
          if (inode.direct[i]) addReference(inode.direct[i], index, `directo[${i}]`);
        }
        if (inode.indirect) {
          addReference(inode.indirect, index, "indirecto");
          const block = this.disk.readBlock(inode.indirect);
          const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
          for (let i = 0; i < PTRS_PER_BLOCK; i += 1) {
            const pointer = view.getUint16(i * 2, true);
            if (pointer) addReference(pointer, index, `indirecto[${i}]`);
          }
        }
        if (inode.mode === 2) {
          const data = this._readData(inode);
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const names = new Set();
          for (let offset = 0; offset + DIR_ENTRY_SIZE <= data.length; offset += DIR_ENTRY_SIZE) {
            const child = view.getUint16(offset, true);
            const nameLength = data[offset + 2];
            if (!child && !nameLength) continue;
            if (!child) {
              issues.push(`Inodo ${index}: entrada de directorio sin inodo`);
              continue;
            }
            if (nameLength < 1 || nameLength > MAX_NAME_BYTES) {
              issues.push(`Inodo ${index}: longitud de nombre inválida (${nameLength})`);
              continue;
            }
            if (child >= INODE_COUNT) {
              issues.push(`Inodo ${index}: entrada apunta a inodo fuera de rango (${child})`);
              continue;
            }
            if (!bitGet(inodeBitmap, child)) {
              issues.push(`Inodo ${index}: entrada apunta al inodo libre ${child}`);
            }
            const name = this._decodeName(data.subarray(offset + 3, offset + 3 + nameLength));
            if (names.has(name)) issues.push(`Inodo ${index}: nombre duplicado "${name}"`);
            names.add(name);
          }
        }
      }

      for (let block = DATA_START; block < BLOCK_COUNT; block += 1) {
        if (bitGet(blockBitmap, block) && !referenced.has(block)) {
          issues.push(`Bloque ${block}: marcado usado pero huérfano`);
        }
      }
    } catch (error) {
      issues.push(`fsck: ${error.message}`);
    }
    return { ok: issues.length === 0, issues };
  }
}
