import { Clock } from "./core/clock.js";
import { RamDisk } from "./core/ramdisk.js";
import { FileSystem } from "./core/fs.js";
import { Shell } from "./core/shell.js";
import { formatTime } from "./core/format.js";
import { SimTerminal } from "./ui/terminal.js";
import { Panels } from "./ui/panels.js";
import { Boot } from "./ui/boot.js";

const encoder = new TextEncoder();

function seedFileSystem(fs) {
  const ensureDir = (path) => {
    try {
      fs.mkdir(path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  };

  ensureDir("/home");
  ensureDir("/home/usuario");
  ensureDir("/tmp");
  ensureDir("/etc");
  ensureDir("/bin");
  ensureDir("/dev");

  try {
    fs.writeFile(
      "/etc/motd",
      encoder.encode(
        [
          "SIM-01 · MCU virtual",
          "Disco en RAM: 64 KiB / 128 bloques de 512 B",
          "Sistema de archivos: RAMFS1",
          "Reloj: RTC simulado + ticks monótonos",
          "",
        ].join("\n"),
      ),
    );
  } catch (error) {
    if (error.code !== "EEXIST") console.error(error);
  }

  try {
    fs.writeFile(
      "/home/usuario/nota.txt",
      encoder.encode(
        [
          "Bienvenido al simulador.",
          "",
          "Pruebe:",
          "  ls -l",
          "  mkdir proyectos",
          "  write proyectos/hola.txt Hola desde el disco en RAM",
          "  cat proyectos/hola.txt",
          "  df",
          "  date",
          "  speed 10",
          "  reset -f",
          "",
        ].join("\n"),
      ),
    );
  } catch (error) {
    if (error.code !== "EEXIST") console.error(error);
  }

  try {
    fs.writeFile(
      "/home/usuario/README",
      encoder.encode(
        [
          "SIM-01 — simulador embebido",
          "",
          "El disco vive en memoria: al recargar la página se pierde.",
          "Use export para descargar una imagen y import para restaurarla.",
          "",
        ].join("\n"),
      ),
    );
  } catch (error) {
    if (error.code !== "EEXIST") console.error(error);
  }

  try {
    fs.chdir("/home/usuario");
  } catch {
    fs.chdir("/");
  }
}

function downloadImage(disk) {
  const blob = new Blob([disk.toImage()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "sim-01.img";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function pickImage(disk, fs, panels) {
  return new Promise((resolve, reject) => {
    const input = document.querySelector("#import-input");
    input.value = "";

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
    };

    const onCancel = () => {
      cleanup();
      reject(new Error("Importación cancelada"));
    };

    const onChange = async () => {
      cleanup();
      const file = input.files && input.files[0];
      if (!file) {
        reject(new Error("No se seleccionó ninguna imagen"));
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        disk.loadImage(buffer);
        fs.mount();
        panels.refresh();
        resolve(`Imagen importada: ${file.name} (${file.size} B)`);
      } catch (error) {
        reject(error);
      }
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    input.click();
  });
}

function setupResetDialog(runReset) {
  const dialog = document.querySelector("#reset-dialog");
  const confirm = document.querySelector("#reset-confirm");
  const cancel = document.querySelector("#reset-cancel");

  const close = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };

  confirm.addEventListener("click", async () => {
    close();
    await runReset();
  });
  cancel.addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  return () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  };
}

async function main() {
  const clock = new Clock();
  const disk = new RamDisk();
  const fs = new FileSystem(disk, clock);

  fs.format();
  fs.mount();
  seedFileSystem(fs);

  const panels = new Panels({ clock, disk, fs });

  let terminal = null;

  const onExport = async () => {
    downloadImage(disk);
    panels.refresh();
  };

  const onImport = async () => {
    const message = await pickImage(disk, fs, panels);
    return message;
  };

  const onHalt = () => {
    clock.stop();
    panels.setHalted();
    document.body.classList.add("is-halted");
    const resetButton = document.querySelector("#btn-reset");
    if (resetButton) resetButton.textContent = "Recargar";
    for (const id of ["#btn-export", "#btn-import"]) {
      const button = document.querySelector(id);
      if (button) button.disabled = true;
    }
  };

  const onReset = () => {
    seedFileSystem(fs);
    panels.refresh();
  };

  const shell = new Shell({
    clock,
    disk,
    fs,
    onExport,
    onImport,
    onHalt,
    onReset,
  });

  terminal = new SimTerminal({
    container: document.querySelector("#terminal"),
    shell,
    onHalt,
  });

  const runCommand = async (line) => {
    if (!terminal) return;
    if (shell.halted && line.startsWith("reset")) {
      window.location.reload();
      return;
    }
    await terminal.run(line);
    panels.refresh();
  };

  const openReset = setupResetDialog(async () => {
    await runCommand("reset -f");
  });

  document.querySelector("#btn-reset").addEventListener("click", () => {
    if (shell.halted) {
      window.location.reload();
      return;
    }
    openReset();
  });
  document.querySelector("#btn-export").addEventListener("click", () => runCommand("export"));
  document.querySelector("#btn-import").addEventListener("click", () => runCommand("import"));

  let lastUiUpdate = 0;
  clock.onTick(() => {
    const now = performance.now();
    if (now - lastUiUpdate >= 90) {
      lastUiUpdate = now;
      panels.update();
      panels.updateSpeed();
    }
  });

  const bootRtc = document.querySelector('[data-boot-line*="RTC"]');
  if (bootRtc) {
    bootRtc.dataset.bootLine = bootRtc.dataset.bootLine.replace(/\d{2}:\d{2}:\d{2}/, formatTime(clock.now()));
  }

  const boot = new Boot({
    overlay: document.querySelector("#boot"),
    onDone: () => {
      terminal.start();
      clock.start();
      panels.update();
      panels.refresh();
      terminal.fit();
    },
  });

  window.sim = { clock, disk, fs, shell, terminal, panels, runCommand };
  boot.run();
}

main().catch((error) => {
  console.error(error);
  const boot = document.querySelector("#boot");
  if (boot) {
    boot.innerHTML = `<div class="boot__inner"><p class="boot__error">Error al iniciar SIM-01</p><pre>${String(error && error.stack ? error.stack : error)}</pre></div>`;
  }
});
