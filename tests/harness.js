/**
 * Harness de pruebas mínimo, sin dependencias.
 * Se ejecuta en el navegador desde tests/index.html.
 */

const tests = [];
let currentGroup = "General";

export function group(name) {
  currentGroup = name;
}

export function test(name, fn) {
  tests.push({ group: currentGroup, name, fn });
}

export function assert(condition, message = "La condición es falsa") {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message = "assertEqual") {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: esperado ${show(expected)}, obtenido ${show(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message = "assertDeepEqual") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: esperado ${b}, obtenido ${a}`);
}

export function assertThrows(fn, code, message = "assertThrows") {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!thrown) throw new Error(`${message}: no se lanzó ninguna excepción`);
  if (code && thrown.code !== code) {
    throw new Error(`${message}: se esperaba el código ${code}, llegó ${thrown.code || thrown.name}`);
  }
  return thrown;
}

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function render(results) {
  const root = document.querySelector("#test-results");
  const summary = document.querySelector("#test-summary");
  if (!root) return;
  root.textContent = "";

  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.group)) groups.set(result.group, []);
    groups.get(result.group).push(result);
  }

  for (const [name, items] of groups) {
    const section = document.createElement("section");
    section.className = "test-group";

    const heading = document.createElement("h2");
    heading.textContent = name;
    section.append(heading);

    const list = document.createElement("ul");
    list.className = "test-list";

    for (const item of items) {
      const li = document.createElement("li");
      li.className = item.ok ? "test test--pass" : "test test--fail";

      const badge = document.createElement("span");
      badge.className = "test__badge";
      badge.textContent = item.ok ? "PASS" : "FAIL";

      const label = document.createElement("span");
      label.className = "test__name";
      label.textContent = item.name;

      const time = document.createElement("span");
      time.className = "test__time";
      time.textContent = `${item.ms.toFixed(1)} ms`;

      li.append(badge, label, time);

      if (!item.ok) {
        const pre = document.createElement("pre");
        pre.className = "test__error";
        pre.textContent = item.error;
        li.append(pre);
      }

      list.append(li);
    }

    section.append(list);
    root.append(section);
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  summary.textContent = failed === 0
    ? `OK · ${passed}/${results.length} pruebas superadas`
    : `FALLÓ · ${failed} de ${results.length} pruebas`;
  summary.className = failed === 0 ? "summary summary--pass" : "summary summary--fail";

  document.documentElement.dataset.tests = failed === 0 ? "pass" : "fail";
  window.__testResults = results;
}

export async function run() {
  const results = [];
  for (const item of tests) {
    const start = performance.now();
    try {
      await item.fn();
      results.push({ group: item.group, name: item.name, ok: true, ms: performance.now() - start });
    } catch (error) {
      results.push({
        group: item.group,
        name: item.name,
        ok: false,
        ms: performance.now() - start,
        error: error && error.stack ? error.stack : String(error),
      });
    }
  }
  render(results);
  return results;
}

export function count() {
  return tests.length;
}
