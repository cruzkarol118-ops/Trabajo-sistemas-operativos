const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Boot {
  constructor({ overlay, onDone }) {
    this.overlay = overlay;
    this.onDone = onDone;
    this.finished = false;
    this.skipped = false;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.lines = [...overlay.querySelectorAll("[data-boot-line]")];
    this.hint = overlay.querySelector("[data-boot-hint]");
    this.progress = overlay.querySelector("[data-boot-progress]");
    this._bind();
  }

  _bind() {
    this.overlay.addEventListener("click", () => this._finish());
    window.addEventListener("keydown", (event) => {
      if (this.finished) return;
      if (event.key === "Enter" || event.key === "Escape" || event.key === " ") {
        event.preventDefault();
        this._finish();
      }
    });
  }

  async run() {
    if (this.reduced) {
      for (const line of this.lines) line.textContent = line.dataset.bootLine;
      this.progress.style.width = "100%";
      this.hint.classList.add("is-visible");
      await this._waitForInput(1200);
      this._finish();
      return;
    }

    await sleep(180);
    for (const line of this.lines) line.textContent = "";
    for (const line of this.lines) {
      if (this.skipped) break;
      const text = line.dataset.bootLine;
      for (let index = 0; index < text.length; index += 1) {
        if (this.skipped) break;
        line.textContent += text[index];
        await sleep(text[index] === "." ? 8 : 14);
      }
      line.textContent = text;
      await sleep(70);
    }

    if (!this.skipped) {
      this.progress.style.width = "100%";
      this.hint.classList.add("is-visible");
      await this._waitForInput(4000);
    }
    this._finish();
  }

  _waitForInput(timeout) {
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        window.removeEventListener("keydown", onKey);
        this.overlay.removeEventListener("click", done);
        resolve();
      };
      const onKey = (event) => {
        if (event.key === "Enter" || event.key === "Escape" || event.key === " ") done();
      };
      window.addEventListener("keydown", onKey);
      this.overlay.addEventListener("click", done);
      timer = setTimeout(done, timeout);
    });
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.skipped = true;
    for (const line of this.lines) line.textContent = line.dataset.bootLine;
    this.progress.style.width = "100%";
    this.overlay.classList.add("is-done");
    setTimeout(() => {
      this.overlay.setAttribute("hidden", "");
      if (this.onDone) this.onDone();
    }, 280);
  }
}
