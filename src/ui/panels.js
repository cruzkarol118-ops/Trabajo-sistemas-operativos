import { formatDateShort, formatTime, formatUptime } from "../core/format.js";
import { BlockMap } from "./blockmap.js";

export class Panels {
  constructor({ clock, disk, fs }) {
    this.clock = clock;
    this.disk = disk;
    this.fs = fs;

    this.el = {
      time: document.querySelector("#rtc-time"),
      date: document.querySelector("#rtc-date"),
      uptime: document.querySelector("#uptime"),
      uptimeBar: document.querySelector("#uptime-bar"),
      diskPercent: document.querySelector("#disk-percent"),
      diskBlocks: document.querySelector("#disk-blocks"),
      diskBar: document.querySelector("#disk-bar"),
      inodeCount: document.querySelector("#inode-count"),
      inodeBar: document.querySelector("#inode-bar"),
      reads: document.querySelector("#disk-reads"),
      writes: document.querySelector("#disk-writes"),
      ledDisk: document.querySelector("#led-disk"),
      speedButtons: [...document.querySelectorAll("[data-speed]")],
      mapCanvas: document.querySelector("#blockmap-canvas"),
      mapTooltip: document.querySelector("#blockmap-tooltip"),
    };

    this.blockmap = new BlockMap({ canvas: this.el.mapCanvas, tooltip: this.el.mapTooltip });
    this.blockmap.resize();

    for (const button of this.el.speedButtons) {
      button.addEventListener("click", () => {
        this.clock.setSpeed(Number(button.dataset.speed));
        this.updateSpeed();
        this.update();
      });
    }

    this._flashTimer = null;
    this._lastTouchedBlock = null;
    this.updateSpeed();
    this.update();
    this.refresh();
  }

  updateSpeed() {
    for (const button of this.el.speedButtons) {
      const active = Number(button.dataset.speed) === this.clock.speed;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  update() {
    const now = this.clock.now();
    const weekday = now.toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "").toUpperCase();
    this.el.time.textContent = formatTime(now);
    this.el.date.textContent = `${weekday} · ${formatDateShort(now)}`;
    this.el.uptime.textContent = formatUptime(this.clock.uptimeMs());
    const dayProgress = Math.min(100, (this.clock.uptimeMs() / 86_400_000) * 100);
    this.el.uptimeBar.style.width = `${dayProgress}%`;
  }

  refresh() {
    const df = this.fs.df();
    const diskPercent = df.totalDataBlocks ? Math.round((df.usedBlocks / df.totalDataBlocks) * 100) : 0;
    const inodePercent = df.inodeCount ? Math.round((df.usedInodes / df.inodeCount) * 100) : 0;

    this.el.diskPercent.textContent = `${diskPercent}%`;
    this.el.diskBlocks.textContent = `${df.usedBlocks} / ${df.totalDataBlocks} bloques`;
    this.el.diskBar.style.width = `${diskPercent}%`;
    this.el.inodeCount.textContent = `${df.usedInodes} / ${df.inodeCount}`;
    this.el.inodeBar.style.width = `${inodePercent}%`;
    this.el.reads.textContent = String(this.disk.stats.reads);
    this.el.writes.textContent = String(this.disk.stats.writes);
    this.blockmap.setData(this.fs.blockMap());

    const lastWrite = this.fs.lastTouchedBlock;
    if (Number.isInteger(lastWrite) && lastWrite !== this._lastTouchedBlock) {
      this._lastTouchedBlock = lastWrite;
      this.blockmap.flash(lastWrite);
      this.flashDisk();
    }
  }

  flashBlock(block) {
    this.blockmap.flash(block);
    this.flashDisk();
  }

  flashDisk() {
    if (!this.el.ledDisk) return;
    this.el.ledDisk.classList.add("is-active");
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => this.el.ledDisk.classList.remove("is-active"), 180);
  }

  setHalted() {
    this.el.time.textContent = "--:--:--";
    this.el.date.textContent = "SISTEMA DETENIDO";
    this.el.uptime.textContent = "--:--:--";
    this.el.uptimeBar.style.width = "0%";
  }

  dispose() {
    this.blockmap.dispose();
  }
}
