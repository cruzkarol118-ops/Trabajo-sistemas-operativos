import { FSError, formatError } from "./errors.js";
import { formatBytes, formatDate, formatUptime } from "./format.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function tokenize(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of String(input)) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) current += "\\";
  if (quote) throw new FSError("EINVAL", "Comillas sin cerrar");
  if (current) tokens.push(current);
  return tokens;
}

export class Shell {
  constructor({ clock, disk, fs, onExport, onImport, onHalt, onReset }) {
    this.clock = clock;
    this.disk = disk;
    this.fs = fs;
    this.onExport = onExport;
    this.onImport = onImport;
    this.onHalt = onHalt;
    this.onReset = onReset;
    this.history = [];
    this.historyIndex = 0;
    this.pendingConfirm = false;
    this.halted = false;
    this.commands = new Map();
    this._registerCommands();
  }

  prompt() {
    const cwd = this.fs.pwd();
    const shown = cwd === "/home/usuario" ? "~" : cwd;
    return `\x1b[38;2;67;230;166musuario@sim\x1b[0m:\x1b[38;2;89;200;242m${shown}\x1b[0m$ `;
  }

  _context(output) {
    const ctx = {
      output,
      clearRequested: false,
      out: (text = "") => output.push({ type: "out", text: String(text) }),
      info: (text = "") => output.push({ type: "info", text: String(text) }),
      ok: (text = "") => output.push({ type: "ok", text: String(text) }),
      warn: (text = "") => output.push({ type: "warn", text: String(text) }),
      err: (text = "") => output.push({ type: "error", text: String(text) }),
      muted: (text = "") => output.push({ type: "muted", text: String(text) }),
      clear: () => {
        ctx.clearRequested = true;
      },
    };
    return ctx;
  }

  async execute(line) {
    const raw = String(line ?? "").trim();
    const output = [];
    const ctx = this._context(output);

    if (this.halted) {
      ctx.err("Sistema detenido. Recargue la página para reiniciar.");
      return { output, clear: false, halted: true };
    }

    if (this.pendingConfirm) {
      this.pendingConfirm = false;
      const answer = raw.toLowerCase();
      if (["s", "si", "sí", "y", "yes"].includes(answer)) {
        this._doReset(ctx);
      } else {
        ctx.info("reset cancelado.");
      }
      return { output, clear: ctx.clearRequested, halted: this.halted };
    }

    if (!raw) return { output, clear: false, halted: false };

    this.history.push(raw);
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = this.history.length;

    try {
      const tokens = tokenize(raw);
      if (!tokens.length) return { output, clear: false, halted: false };

      const redirectIndex = tokens.indexOf(">");
      let redirect = null;
      let commandTokens = tokens;
      if (redirectIndex !== -1) {
        redirect = tokens[redirectIndex + 1];
        if (!redirect || redirectIndex + 2 !== tokens.length) {
          throw new FSError("EINVAL", "Redirección inválida. Uso: comando args > archivo");
        }
        commandTokens = tokens.slice(0, redirectIndex);
        if (!commandTokens.length) throw new FSError("EINVAL", "Falta el comando antes de >");
      }

      const [name, ...args] = commandTokens;
      const command = this.commands.get(name);
      if (!command) {
        ctx.err(`Orden no encontrada: ${name}. Escriba "help" para ver los comandos.`);
        return { output, clear: ctx.clearRequested, halted: this.halted };
      }

      if (redirect) {
        const captured = [];
        const captureCtx = this._context(captured);
        await command.run(args, captureCtx);
        const text = captured.map((item) => item.text).join("\n");
        this.fs.writeFile(redirect, encoder.encode(`${text}\n`));
        ctx.ok(`→ ${this.fs.normalize(redirect)} (${formatBytes(text.length + 1)})`);
      } else {
        await command.run(args, ctx);
      }
    } catch (error) {
      ctx.err(formatError(error));
    }

    return { output, clear: ctx.clearRequested, halted: this.halted };
  }

  _register(name, usage, summary, run) {
    this.commands.set(name, { name, usage, summary, run });
  }

  _doReset(ctx) {
    this.fs.format();
    this.fs.mount();
    if (this.onReset) this.onReset();
    ctx.ok("Disco reformateado. Sistema base restaurado.");
  }

  _registerCommands() {
    this._register("help", "help [comando]", "Lista los comandos disponibles", (args, ctx) => {
      if (args[0]) {
        const command = this.commands.get(args[0]);
        if (!command) throw new FSError("ENOENT", `No existe el comando: ${args[0]}`);
        ctx.out(`${command.usage}\n  ${command.summary}`);
        return;
      }
      ctx.out("COMANDOS DISPONIBLES");
      const rows = [...this.commands.values()].map((command) => `  ${command.usage.padEnd(32)} ${command.summary}`);
      ctx.out(rows.join("\n"));
      ctx.muted('Use "help <comando>" para más detalle.');
    });

    this._register("clear", "clear", "Limpia la terminal", (args, ctx) => {
      ctx.clear();
    });

    this._register("echo", "echo <texto...>", "Imprime el texto indicado", (args, ctx) => {
      ctx.out(args.join(" "));
    });

    this._register("date", "date", "Muestra la fecha y hora simuladas", (args, ctx) => {
      ctx.out(formatDate(this.clock.now()));
    });

    this._register("setdate", 'setdate "AAAA-MM-DD HH:MM:SS"', "Ajusta el RTC", (args, ctx) => {
      const text = args.join(" ").trim();
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
      if (!match) throw new FSError("EINVAL", 'Formato esperado: "AAAA-MM-DD HH:MM:SS"');
      const [, year, month, day, hour, minute, second] = match.map(Number);
      const date = new Date(year, month - 1, day, hour, minute, second);
      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute ||
        date.getSeconds() !== second
      ) {
        throw new FSError("EINVAL", "Fecha u hora fuera de rango");
      }
      this.clock.setDate(date);
      ctx.ok(`RTC ajustado a ${formatDate(date)}`);
    });

    this._register("uptime", "uptime", "Tiempo desde el arranque", (args, ctx) => {
      ctx.out(`up ${formatUptime(this.clock.uptimeMs())} · velocidad x${this.clock.speed}`);
    });

    this._register("sleep", "sleep <segundos>", "Espera en tiempo simulado", async (args, ctx) => {
      const seconds = Number(args[0]);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
        throw new FSError("EINVAL", "Indique entre 0 y 3600 segundos");
      }
      if (this.clock.speed === 0) {
        throw new FSError("EINVAL", "El reloj está pausado; reanude antes de usar sleep");
      }
      const before = this.clock.uptimeMs();
      await new Promise((resolve) => this.clock.schedule(seconds * 1000, resolve));
      const elapsed = this.clock.uptimeMs() - before;
      ctx.muted(`sleep: ${(elapsed / 1000).toFixed(2)} s simulados`);
    });

    this._register("speed", "speed <0|1|10|60>", "Cambia la velocidad del reloj", (args, ctx) => {
      const value = Number(args[0]);
      if (![0, 1, 10, 60].includes(value)) throw new FSError("EINVAL", "Use 0, 1, 10 o 60");
      this.clock.setSpeed(value);
      ctx.ok(value === 0 ? "Reloj pausado." : `Velocidad x${value}.`);
    });

    this._register("df", "df", "Uso de bloques e inodos", (args, ctx) => {
      const df = this.fs.df();
      const percent = Math.round((df.usedBlocks / df.totalDataBlocks) * 100);
      const inodePercent = Math.round((df.usedInodes / df.inodeCount) * 100);
      ctx.out(
        [
          "Sistema   Bloques   Usados   Libres   Uso   Montaje",
          `RAMFS1    ${String(df.totalDataBlocks).padStart(7)}   ${String(df.usedBlocks).padStart(6)}   ${String(df.freeBlocks).padStart(6)}   ${String(percent).padStart(3)}%   /`,
          "",
          `Inodos    ${String(df.inodeCount).padStart(7)}   ${String(df.usedInodes).padStart(6)}   ${String(df.freeInodes).padStart(6)}   ${String(inodePercent).padStart(3)}%`,
        ].join("\n"),
      );
    });

    this._register("ls", "ls [-l] [ruta]", "Lista un directorio", (args, ctx) => {
      let long = false;
      let path = ".";
      for (const arg of args) {
        if (arg === "-l") long = true;
        else if (arg.startsWith("-")) throw new FSError("EINVAL", `Opción no soportada: ${arg}`);
        else path = arg;
      }
      const entries = this.fs.listDir(path);
      if (!entries.length) {
        ctx.muted("(directorio vacío)");
        return;
      }
      if (!long) {
        ctx.out(entries.map((entry) => `${entry.name}${entry.type === "dir" ? "/" : ""}`).join("   "));
        return;
      }
      const rows = entries.map((entry) => {
        const type = entry.type === "dir" ? "d" : "-";
        const size = String(entry.size).padStart(6);
        const date = formatDate(new Date(entry.mtime * 1000)).slice(0, 16);
        const name = `${entry.name}${entry.type === "dir" ? "/" : ""}`;
        return `${type} ${size}  ${date}  ${name}`;
      });
      ctx.out(rows.join("\n"));
    });

    this._register("cd", "cd [ruta]", "Cambia de directorio", (args, ctx) => {
      if (args[0]) {
        this.fs.chdir(args[0]);
        return;
      }
      try {
        this.fs.chdir("/home/usuario");
      } catch {
        this.fs.chdir("/");
      }
    });

    this._register("pwd", "pwd", "Muestra el directorio actual", (args, ctx) => {
      ctx.out(this.fs.pwd());
    });

    this._register("mkdir", "mkdir <ruta>", "Crea un directorio", (args, ctx) => {
      if (!args[0]) throw new FSError("EINVAL", "Uso: mkdir <ruta>");
      this.fs.mkdir(args[0]);
      ctx.ok(`Directorio creado: ${this.fs.normalize(args[0])}`);
    });

    this._register("rmdir", "rmdir <ruta>", "Borra un directorio vacío", (args, ctx) => {
      if (!args[0]) throw new FSError("EINVAL", "Uso: rmdir <ruta>");
      this.fs.rmdir(args[0]);
      ctx.ok(`Directorio borrado: ${this.fs.normalize(args[0])}`);
    });

    this._register("touch", "touch <ruta>", "Crea o actualiza un archivo", (args, ctx) => {
      if (!args[0]) throw new FSError("EINVAL", "Uso: touch <ruta>");
      this.fs.touch(args[0]);
      ctx.ok(`touch: ${this.fs.normalize(args[0])}`);
    });

    this._register("write", "write <ruta> <texto...>", "Escribe texto en un archivo", (args, ctx) => {
      if (!args[0]) throw new FSError("EINVAL", "Uso: write <ruta> <texto...>");
      const text = `${args.slice(1).join(" ")}\n`;
      this.fs.writeFile(args[0], encoder.encode(text));
      ctx.ok(`Escrito ${formatBytes(text.length)} en ${this.fs.normalize(args[0])}`);
    });

    this._register("cat", "cat <ruta>", "Muestra el contenido de un archivo", (args, ctx) => {
      if (!args[0]) throw new FSError("EINVAL", "Uso: cat <ruta>");
      const bytes = this.fs.readFile(args[0]);
      ctx.out(decoder.decode(bytes));
    });

    this._register("rm", "rm <ruta>", "Borra un archivo", (args, ctx) => {
      if (!args[0]) throw new FSError("EINVAL", "Uso: rm <ruta>");
      this.fs.unlink(args[0]);
      ctx.ok(`Archivo borrado: ${this.fs.normalize(args[0])}`);
    });

    this._register("stat", "stat <ruta>", "Muestra los metadatos de un inodo", (args, ctx) => {
      if (!args[0]) throw new FSError("EINVAL", "Uso: stat <ruta>");
      const info = this.fs.stat(args[0]);
      ctx.out(
        [
          `  Archivo: ${info.path}`,
          `  Inodo: ${info.inode}   Tipo: ${info.type}   Enlaces: ${info.links}`,
          `  Tamaño: ${formatBytes(info.size)} (${info.blocks} bloque${info.blocks === 1 ? "" : "s"})`,
          `  mtime: ${formatDate(new Date(info.mtime * 1000))}`,
          `  ctime: ${formatDate(new Date(info.ctime * 1000))}`,
          `  directos: [${info.direct.join(", ")}]`,
          `  indirecto: ${info.indirect}`,
        ].join("\n"),
      );
    });

    this._register("tree", "tree [ruta]", "Muestra el árbol de directorios", (args, ctx) => {
      const root = this.fs.normalize(args[0] || ".");
      const lines = [root];
      const walk = (path, prefix, depth) => {
        if (depth > 4) return;
        const entries = this.fs.listDir(path);
        entries.forEach((entry, index) => {
          const last = index === entries.length - 1;
          lines.push(`${prefix}${last ? "└──" : "├──"} ${entry.name}${entry.type === "dir" ? "/" : ""}`);
          if (entry.type === "dir") {
            const child = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
            walk(child, `${prefix}${last ? "    " : "│   "}`, depth + 1);
          }
        });
      };
      walk(root, "", 0);
      ctx.out(lines.join("\n"));
    });

    this._register("fsck", "fsck", "Verifica la consistencia del disco", (args, ctx) => {
      const result = this.fs.fsck();
      if (result.ok) {
        ctx.ok("fsck: sistema de archivos consistente. 0 problemas.");
        return;
      }
      ctx.err(`fsck: ${result.issues.length} problema${result.issues.length === 1 ? "" : "s"}`);
      ctx.out(result.issues.map((issue) => `  - ${issue}`).join("\n"));
    });

    this._register("reset", "reset [-f]", "Reformatea el disco en RAM", (args, ctx) => {
      if (args.includes("-f") || args.includes("--force")) {
        this._doReset(ctx);
        return;
      }
      this.pendingConfirm = true;
      ctx.warn("reset: se perderán todos los archivos. ¿Continuar? [s/N]");
    });

    this._register("export", "export", "Descarga una imagen del disco", async (args, ctx) => {
      if (!this.onExport) throw new FSError("EIO", "Exportación no disponible");
      await this.onExport();
      ctx.ok("Imagen exportada: sim-01.img");
    });

    this._register("import", "import", "Carga una imagen de disco", async (args, ctx) => {
      if (!this.onImport) throw new FSError("EIO", "Importación no disponible");
      const message = await this.onImport();
      ctx.ok(message || "Imagen importada.");
    });

    this._register("halt", "halt", "Detiene el sistema", (args, ctx) => {
      this.halted = true;
      if (this.onHalt) this.onHalt();
      ctx.warn("Sistema detenido. Recargue la página para reiniciar.");
    });

    this._register("whoami", "whoami", "Usuario actual", (args, ctx) => {
      ctx.out("usuario");
    });

    this._register("uname", "uname", "Identificación del sistema", (args, ctx) => {
      ctx.out("SIM-01 RAMFS1 1.0 mcu-virtual");
    });
  }

  complete(line, cursor = line.length) {
    const before = line.slice(0, cursor);
    const after = line.slice(cursor);
    const tokenMatch = before.match(/([^\s]*)$/);
    const token = tokenMatch ? tokenMatch[1] : "";
    const start = cursor - token.length;
    const isCommand = before.slice(0, start).trim() === "";
    let candidates = [];

    if (isCommand) {
      candidates = [...this.commands.keys()].filter((name) => name.startsWith(token));
    } else {
      const slash = token.lastIndexOf("/");
      const dirPart = slash >= 0 ? token.slice(0, slash + 1) : "";
      const base = slash >= 0 ? token.slice(slash + 1) : token;
      let entries = [];
      try {
        entries = this.fs.listDir(dirPart || ".");
      } catch {
        entries = [];
      }
      candidates = entries
        .filter((entry) => entry.name.startsWith(base))
        .map((entry) => `${dirPart}${entry.name}${entry.type === "dir" ? "/" : ""}`);
    }

    if (!candidates.length) return null;

    let common = candidates[0];
    for (const candidate of candidates.slice(1)) {
      let i = 0;
      while (i < common.length && i < candidate.length && common[i] === candidate[i]) i += 1;
      common = common.slice(0, i);
    }

    if (candidates.length === 1) {
      const value = candidates[0];
      return { line: line.slice(0, start) + value + after, cursor: start + value.length, matches: candidates };
    }

    if (common.length > token.length) {
      return {
        line: line.slice(0, start) + common + after,
        cursor: start + common.length,
        matches: candidates,
      };
    }

    return { line, cursor, matches: candidates };
  }
}
