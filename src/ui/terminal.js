const COLORS = {
  out: "",
  info: "\x1b[38;2;127;154;141m",
  ok: "\x1b[38;2;67;230;166m",
  warn: "\x1b[38;2;244;185;66m",
  error: "\x1b[38;2;255;111;97m",
  muted: "\x1b[38;2;75;98;88m",
};
const RESET = "\x1b[0m";

export class SimTerminal {
  constructor({ container, shell, onHalt }) {
    this.container = container;
    this.shell = shell;
    this.onHalt = onHalt;
    this.buffer = "";
    this.cursor = 0;
    this.historyIndex = 0;
    this.busy = false;
    this.enabled = true;
    this.halted = false;
    this._fitFrame = null;

    if (!window.Terminal) throw new Error("xterm.js no está cargado");
    if (!window.FitAddon) throw new Error("El addon FitAddon no está cargado");

    this.term = new window.Terminal({
      fontFamily: '"IBM Plex Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 2500,
      allowTransparency: true,
      convertEol: false,
      macOptionIsMeta: true,
      theme: {
        background: "#060d0a",
        foreground: "#d7e4dc",
        cursor: "#43e6a6",
        cursorAccent: "#060d0a",
        selectionBackground: "rgba(67, 230, 166, 0.30)",
        black: "#08120e",
        red: "#ff6f61",
        green: "#43e6a6",
        yellow: "#f4b942",
        blue: "#59c8f2",
        magenta: "#c792ea",
        cyan: "#59c8f2",
        white: "#d7e4dc",
        brightBlack: "#4b6258",
        brightRed: "#ff8a7d",
        brightGreen: "#6cf0bd",
        brightYellow: "#ffd166",
        brightBlue: "#8bdcff",
        brightMagenta: "#d9a9ff",
        brightCyan: "#8bdcff",
        brightWhite: "#f2efe4",
      },
    });

    this.fitAddon = new window.FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);
    this._bind();
    this.fit();
  }

  _bind() {
    this.term.onData((data) => this._onData(data));
    this.container.addEventListener("click", () => this.term.focus());
    this.container.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        this.clear();
      }
    });

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this._scheduleFit());
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener("resize", () => this._scheduleFit());
  }

  _scheduleFit() {
    if (this._fitFrame !== null) cancelAnimationFrame(this._fitFrame);
    this._fitFrame = requestAnimationFrame(() => {
      this._fitFrame = null;
      this.fit();
    });
  }

  fit() {
    try {
      this.fitAddon.fit();
    } catch {
      // El contenedor aún no tiene dimensiones (por ejemplo, durante el arranque).
    }
  }

  start() {
    this.term.writeln("\x1b[38;2;67;230;166mSIM-01\x1b[0m  \x1b[38;2;215;228;220mMCU virtual · 64 KiB RAM\x1b[0m");
    this.term.writeln("\x1b[38;2;127;154;141mRAMFS1 · UART0 115200 8N1 · reloj simulado\x1b[0m");
    this.term.writeln("\x1b[38;2;75;98;88mEscriba \"help\" para ver los comandos. Ctrl+L limpia la pantalla.\x1b[0m");
    this.term.writeln("");
    this._writePrompt();
    this.term.focus();
  }

  _writePrompt() {
    this.term.write(this.shell.prompt());
  }

  _redraw() {
    const prompt = this.shell.prompt();
    this.term.write(`\r\x1b[K${prompt}${this.buffer}`);
    const move = this.buffer.length - this.cursor;
    if (move > 0) this.term.write(`\x1b[${move}D`);
  }

  _setBuffer(next, cursor = next.length) {
    this.buffer = next;
    this.cursor = Math.max(0, Math.min(cursor, next.length));
    this._redraw();
  }

  _onData(data) {
    if (!this.enabled || this.busy) return;

    if (data.startsWith("\x1b")) {
      this._handleEscape(data);
      return;
    }

    for (const char of data) {
      if (char === "\r" || char === "\n") {
        this._submit();
        return;
      }
      if (char === "\x7f" || char === "\b") {
        if (this.cursor > 0) {
          this._setBuffer(this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor), this.cursor - 1);
        }
        continue;
      }
      if (char === "\x03") {
        this.term.write("^C\r\n");
        this.buffer = "";
        this.cursor = 0;
        this._writePrompt();
        continue;
      }
      if (char === "\x0c") {
        this.clear();
        continue;
      }
      if (char === "\t") {
        this._complete();
        continue;
      }
      if (char === "\x1b") continue;
      if (char < " " || char === "\x7f") continue;
      this._setBuffer(this.buffer.slice(0, this.cursor) + char + this.buffer.slice(this.cursor), this.cursor + 1);
    }
  }

  _handleEscape(data) {
    switch (data) {
      case "\x1b[A": {
        if (!this.shell.history.length) return;
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        this._setBuffer(this.shell.history[this.historyIndex] || "");
        return;
      }
      case "\x1b[B": {
        if (!this.shell.history.length) return;
        this.historyIndex = Math.min(this.shell.history.length, this.historyIndex + 1);
        this._setBuffer(this.shell.history[this.historyIndex] || "");
        return;
      }
      case "\x1b[C":
        if (this.cursor < this.buffer.length) this._setBuffer(this.buffer, this.cursor + 1);
        return;
      case "\x1b[D":
        if (this.cursor > 0) this._setBuffer(this.buffer, this.cursor - 1);
        return;
      case "\x1b[H":
      case "\x1b[1~":
        this._setBuffer(this.buffer, 0);
        return;
      case "\x1b[F":
      case "\x1b[4~":
        this._setBuffer(this.buffer, this.buffer.length);
        return;
      case "\x1b[3~":
        if (this.cursor < this.buffer.length) {
          this._setBuffer(this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1), this.cursor);
        }
        return;
      default:
        return;
    }
  }

  _complete() {
    const result = this.shell.complete(this.buffer, this.cursor);
    if (!result) return;
    if (result.matches.length > 1 && result.line === this.buffer && result.cursor === this.cursor) {
      this.term.write(`\r\n${result.matches.join("   ")}\r\n`);
      this._redraw();
      return;
    }
    this._setBuffer(result.line, result.cursor);
  }

  async run(line) {
    if (this.busy || !this.enabled) return;
    this.buffer = line;
    this.cursor = line.length;
    this._redraw();
    await this._submit();
  }

  async _submit() {
    const line = this.buffer;
    this.buffer = "";
    this.cursor = 0;
    this.term.write("\r\n");
    this.busy = true;
    try {
      const result = await this.shell.execute(line);
      this.historyIndex = this.shell.history.length;
      if (result.clear) {
        this.clear(false);
      }
      for (const item of result.output) this._writeOutput(item);
      if (result.halted || this.shell.halted) {
        this.halted = true;
        this.enabled = false;
        if (this.onHalt) this.onHalt();
        return;
      }
      this._writePrompt();
      this.fit();
    } catch (error) {
      this._writeOutput({ type: "error", text: error.message || String(error) });
      this._writePrompt();
    } finally {
      this.busy = false;
    }
  }

  _writeOutput({ type, text }) {
    const color = COLORS[type] ?? "";
    const lines = String(text).split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      this.term.writeln(`${color}${line}${color ? RESET : ""}`);
    }
  }

  clear(withPrompt = true) {
    this.term.clear();
    this.term.write("\x1b[2J\x1b[H");
    this.buffer = "";
    this.cursor = 0;
    if (withPrompt) this._writePrompt();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  dispose() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.term.dispose();
  }
}
