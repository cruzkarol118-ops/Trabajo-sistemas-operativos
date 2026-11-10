const COLORS = {
  meta: "#59c8f2",
  data: "#43e6a6",
  free: "#1a2c24",
  flash: "#f2efe4",
  border: "#0a1511",
};

export class BlockMap {
  constructor({ canvas, tooltip }) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.ctx = canvas.getContext("2d");
    this.map = [];
    this.cols = 16;
    this.rows = 8;
    this.gap = 2;
    this.hover = -1;
    this.flashBlock = -1;
    this.flashTimer = null;
    this.width = 0;
    this.height = 0;

    canvas.addEventListener("mousemove", (event) => this._onMove(event));
    canvas.addEventListener("mouseleave", () => {
      this.hover = -1;
      this.tooltip.classList.remove("is-visible");
      this.draw();
    });
    canvas.addEventListener("click", (event) => this._onMove(event));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(180, rect.width);
    const height = width / 2;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
    this.draw();
  }

  setData(map) {
    this.map = map;
    this.draw();
  }

  flash(block) {
    this.flashBlock = block;
    this.draw();
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashBlock = -1;
      this.draw();
    }, 280);
  }

  _cellAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cellWidth = (this.width - this.gap * (this.cols - 1)) / this.cols;
    const cellHeight = (this.height - this.gap * (this.rows - 1)) / this.rows;
    const col = Math.floor(x / (cellWidth + this.gap));
    const row = Math.floor(y / (cellHeight + this.gap));
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return { index: row * this.cols + col, col, row, cellWidth, cellHeight };
  }

  _onMove(event) {
    const cell = this._cellAt(event);
    if (!cell) {
      this.hover = -1;
      this.tooltip.classList.remove("is-visible");
      this.draw();
      return;
    }
    this.hover = cell.index;
    const item = this.map[cell.index];
    if (item) {
      const kind = item.type === "meta" ? (item.label || "METADATO") : item.type === "data" ? "DATO" : "LIBRE";
      const owner = item.inode === null || item.inode === undefined ? "" : ` · INODO ${String(item.inode).padStart(2, "0")}`;
      this.tooltip.textContent = `BLOQUE ${String(item.block).padStart(3, "0")} · ${kind}${owner} · 512 B`;
      this.tooltip.style.left = `${cell.col * (cell.cellWidth + this.gap) + cell.cellWidth / 2}px`;
      this.tooltip.style.top = `${cell.row * (cell.cellHeight + this.gap) + cell.cellHeight / 2}px`;
      this.tooltip.classList.add("is-visible");
    }
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    if (!this.width || !this.height) return;
    ctx.clearRect(0, 0, this.width, this.height);
    const cellWidth = (this.width - this.gap * (this.cols - 1)) / this.cols;
    const cellHeight = (this.height - this.gap * (this.rows - 1)) / this.rows;

    for (let index = 0; index < this.cols * this.rows; index += 1) {
      const item = this.map[index] || { type: "free", block: index, inode: null };
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      const x = col * (cellWidth + this.gap);
      const y = row * (cellHeight + this.gap);

      let fill = COLORS[item.type] || COLORS.free;
      if (item.type === "free") fill = COLORS.free;
      if (index === this.flashBlock) fill = COLORS.flash;

      ctx.fillStyle = fill;
      ctx.fillRect(x, y, cellWidth, cellHeight);

      if (index === this.hover) {
        ctx.strokeStyle = "#f2efe4";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
      }
    }
  }

  dispose() {
    this.resizeObserver.disconnect();
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }
}
