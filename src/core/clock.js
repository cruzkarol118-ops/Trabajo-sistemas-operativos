/**
 * Reloj simulado: RTC + uptime monotónico + eventos + multiplicador de velocidad.
 *
 * La fuente de tiempo es inyectable para poder testear sin esperar.
 * `tick()` se llama desde un rAF (o manualmente en tests).
 */
export class Clock {
  constructor({ now = () => (globalThis.performance?.now?.() ?? Date.now()) } = {}) {
    this._now = now;
    this._rtcBase = Date.now();
    this._simElapsed = 0;
    this._speed = 1;
    this._lastSpeed = 1;
    this._running = false;
    this._last = this._now();
    this._events = [];
    this._nextEventId = 1;
    this._listeners = new Set();
    this._timer = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = this._now();
    // setInterval (en lugar de rAF) mantiene el reloj avanzando aunque la
    // pestaña quede en segundo plano; los navegadores lo limitan a ~1 Hz.
    this._timer = setInterval(() => this.tick(this._now()), 100);
  }

  stop() {
    this._running = false;
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Avanza el reloj simulado hasta `nowPerf` (ms de la fuente de tiempo). */
  tick(nowPerf = this._now()) {
    // Limita saltos enormes si el equipo se suspende o la pestaña se congela.
    const delta = Math.min(Math.max(0, nowPerf - this._last), 5000);
    this._last = nowPerf;
    if (this._speed > 0) this._simElapsed += delta * this._speed;
    this._runEvents();
    this._emit();
    return this._simElapsed;
  }

  now() {
    return new Date(this._rtcBase + this._simElapsed);
  }

  uptimeMs() {
    return this._simElapsed;
  }

  setDate(date) {
    const value = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (!Number.isFinite(value)) throw new Error("Fecha inválida");
    this._rtcBase = value - this._simElapsed;
    this._emit();
  }

  get speed() {
    return this._speed;
  }

  setSpeed(speed) {
    const value = Number(speed);
    if (![0, 1, 10, 60].includes(value)) {
      throw new Error("Velocidad inválida: use 0, 1, 10 o 60");
    }
    if (value > 0) this._lastSpeed = value;
    this._speed = value;
    this._emit();
  }

  pause() {
    this.setSpeed(0);
  }

  resume() {
    this.setSpeed(this._lastSpeed || 1);
  }

  schedule(delayMs, callback) {
    const delay = Math.max(0, Number(delayMs) || 0);
    const id = this._nextEventId++;
    this._events.push({ id, due: this._simElapsed + delay, callback });
    return id;
  }

  cancel(id) {
    const index = this._events.findIndex((event) => event.id === id);
    if (index !== -1) this._events.splice(index, 1);
  }

  onTick(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _runEvents() {
    if (!this._events.length) return;
    const due = this._events.filter((event) => event.due <= this._simElapsed);
    if (!due.length) return;
    this._events = this._events.filter((event) => event.due > this._simElapsed);
    for (const event of due) {
      try {
        event.callback();
      } catch (error) {
        console.error("Error en evento del reloj:", error);
      }
    }
  }

  _emit() {
    for (const listener of this._listeners) {
      try {
        listener(this);
      } catch (error) {
        console.error("Error en listener del reloj:", error);
      }
    }
  }
}
