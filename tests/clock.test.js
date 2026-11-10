import { Clock } from "../src/core/clock.js";
import { assert, assertEqual, assertThrows, group, test } from "./harness.js";

group("Reloj simulado");

function makeClock() {
  let now = 0;
  const clock = new Clock({ now: () => now });
  return {
    clock,
    advance(ms) {
      now += ms;
      return clock.tick(now);
    },
  };
}

test("el tick acumula tiempo a velocidad x1", () => {
  const { clock, advance } = makeClock();
  advance(1000);
  advance(500);
  assertEqual(clock.uptimeMs(), 1500);
  assertEqual(clock.speed, 1);
});

test("la velocidad multiplica el tiempo simulado", () => {
  const { clock, advance } = makeClock();
  clock.setSpeed(10);
  advance(1000);
  assertEqual(clock.uptimeMs(), 10000);
  clock.setSpeed(60);
  advance(100);
  assertEqual(clock.uptimeMs(), 16000);
});

test("pausar detiene el avance y resume recupera la velocidad", () => {
  const { clock, advance } = makeClock();
  clock.setSpeed(10);
  advance(100);
  clock.pause();
  advance(5000);
  assertEqual(clock.uptimeMs(), 1000);
  assertEqual(clock.speed, 0);
  clock.resume();
  assertEqual(clock.speed, 10);
  advance(100);
  assertEqual(clock.uptimeMs(), 2000);
});

test("rechaza velocidades no soportadas", () => {
  const { clock } = makeClock();
  assertThrows(() => clock.setSpeed(2), undefined, "setSpeed(2)");
  assertThrows(() => clock.setSpeed(-1), undefined, "setSpeed(-1)");
});

test("los eventos se disparan una sola vez al vencer", () => {
  const { clock, advance } = makeClock();
  let calls = 0;
  clock.schedule(1000, () => {
    calls += 1;
  });
  advance(999);
  assertEqual(calls, 0);
  advance(1);
  assertEqual(calls, 1);
  advance(5000);
  assertEqual(calls, 1);
});

test("cancelar un evento impide su ejecución", () => {
  const { clock, advance } = makeClock();
  let calls = 0;
  const id = clock.schedule(1000, () => {
    calls += 1;
  });
  clock.cancel(id);
  advance(2000);
  assertEqual(calls, 0);
});

test("setDate ajusta el RTC conservando el uptime", () => {
  const { clock, advance } = makeClock();
  advance(2000);
  clock.setDate(new Date(2024, 0, 2, 3, 4, 5));
  const now = clock.now();
  assertEqual(now.getFullYear(), 2024);
  assertEqual(now.getMonth(), 0);
  assertEqual(now.getDate(), 2);
  assertEqual(now.getHours(), 3);
  assertEqual(now.getMinutes(), 4);
  assertEqual(now.getSeconds(), 5);
  assertEqual(clock.uptimeMs(), 2000);
});

test("un salto enorme de tiempo se limita a 5 s", () => {
  const { clock, advance } = makeClock();
  advance(60000);
  assertEqual(clock.uptimeMs(), 5000);
});

test("los listeners reciben el reloj y los errores no rompen el tick", () => {
  const { clock, advance } = makeClock();
  let seen = null;
  clock.onTick((instance) => {
    seen = instance;
  });
  clock.onTick(() => {
    throw new Error("listener roto");
  });
  const original = console.error;
  console.error = () => {};
  try {
    advance(100);
  } finally {
    console.error = original;
  }
  assert(seen === clock, "el listener no recibió la instancia del reloj");
  assertEqual(clock.uptimeMs(), 100);
});
