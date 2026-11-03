// Painel do Salão — processo principal do Electron. É uma CASCA de kiosk: abre
// a rota pública /painel-estacao do planejamento.app em tela cheia, sempre
// ligada numa tela de parede. A estação se identifica por um "código de estação"
// (token) — digitado uma vez na própria tela (fica salvo) OU pré-provisionado no
// config.json. Só visualização: as ações do painel já caem no portão de login.
// Auto-update em segundo plano (feed /painel-update). Sem impressão (≠ PDV).
const { app, BrowserWindow, Menu, powerSaveBlocker } = require("electron");
const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");

// Telas de parede costumam ser máquinas baratas (GPU fraca): desliga detecção de
// oclusão e aceleração de hardware, que travam input/render nessas placas.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}
app.disableHardwareAcceleration();

// Auto-update: baixa em 2º plano e instala ao fechar. Feed público no domínio
// (admin.planejamento.app/painel-update) que redireciona pro Storage por token.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.disableDifferentialDownload = true;
function logUpd(nivel, ...args) {
  try {
    const linha = `[${new Date().toISOString()}] ${nivel} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "update.log"), linha);
  } catch { /* ignore */ }
}
autoUpdater.logger = { info: (...a) => logUpd("INFO", ...a), warn: (...a) => logUpd("WARN", ...a), error: (...a) => logUpd("ERROR", ...a), debug: (...a) => logUpd("DEBUG", ...a) };
autoUpdater.on("error", (e) => logUpd("ERROR", "update error:", e && e.message ? e.message : String(e)));
autoUpdater.on("update-available", (i) => logUpd("INFO", "update disponível:", i && i.version));
autoUpdater.on("update-not-available", (i) => logUpd("INFO", "sem update:", i && i.version));
autoUpdater.on("update-downloaded", (i) => logUpd("INFO", "update baixado, instala ao fechar:", i && i.version));
function checarUpdates() {
  try { autoUpdater.checkForUpdates().catch((e) => logUpd("ERROR", "checkForUpdates rejeitou:", e && e.message ? e.message : String(e))); } catch (e) { logUpd("ERROR", "checarUpdates throw:", String(e)); }
}

// Config: defaults → config.json embutido → config do usuário (userData).
const DEFAULTS = { url: "https://admin.planejamento.app/painel-estacao", token: "", kiosk: true };
function bundledConfig() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch { return {}; } }
function userConfigPath() { return path.join(app.getPath("userData"), "config.json"); }
function lerUserConfig() { try { return JSON.parse(fs.readFileSync(userConfigPath(), "utf8")); } catch { return {}; } }
function lerConfig() { return { ...DEFAULTS, ...bundledConfig(), ...lerUserConfig() }; }

let cfg = DEFAULTS;

function urlComToken() {
  const base = cfg.url || DEFAULTS.url;
  const t = (cfg.token || "").trim();
  return t ? `${base}${base.includes("?") ? "&" : "?"}t=${encodeURIComponent(t)}` : base;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: "#121317",
    title: `Painel do Salão v${app.getVersion()}`,
    kiosk: cfg.kiosk !== false,
    fullscreen: cfg.kiosk !== false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // fica aberto o dia todo — sem throttling de timers
    },
  });
  win.loadURL(urlComToken());

  const refocar = () => { try { if (!win.isDestroyed()) win.webContents.focus(); } catch { /* ignore */ } };
  win.on("focus", refocar);
  win.on("show", refocar);
  win.webContents.on("did-finish-load", refocar);

  // Atalhos (sem menu): Ctrl/Cmd+R ou F5 = recarregar; Ctrl/Cmd+Shift+Q = sair
  // do kiosk (pra manutenção na parede). Mantém a estação "presa" no resto.
  win.webContents.on("before-input-event", (event, input) => {
    const mod = process.platform === "darwin" ? input.meta : input.control;
    const k = (input.key || "").toLowerCase();
    if ((mod && k === "r") || input.key === "F5") { event.preventDefault(); win.webContents.reload(); }
    if (mod && input.shift && k === "q") { event.preventDefault(); app.quit(); }
  });
  return win;
}

app.whenReady().then(() => {
  cfg = lerConfig();
  Menu.setApplicationMenu(null);
  // Tela de parede não pode dormir/apagar.
  try { powerSaveBlocker.start("prevent-display-sleep"); } catch { /* ignore */ }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  checarUpdates();
  setInterval(checarUpdates, 2 * 60 * 60 * 1000);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
