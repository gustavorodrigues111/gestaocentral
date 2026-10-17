// Planejamento PDV — processo principal do Electron.
// Abre o módulo Comandas numa janela dedicada e expõe uma "ponte de impressão":
// o site (renderer) manda o job de impressão e aqui a gente imprime direto na
// Epson por IP (ESC/POS). Assim não precisa de Chrome --kiosk-printing nem do
// diálogo de impressão; sai com corte de papel e QR.
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { imprimir, testar } = require("./print");
const { autoUpdater } = require("electron-updater");

// Auto-update: baixa a versão nova em segundo plano e INSTALA ao fechar o app
// (não interrompe o operador no meio da venda). Feed público no GCS (generic).
// Windows: funciona sem assinatura. macOS: só com app assinado (limitação Apple).
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
function checarUpdates() {
  try { autoUpdater.checkForUpdates().catch(() => {}); } catch { /* sem rede / não configurado */ }
}

// Config: defaults → config.json embutido (defaults de fábrica) → config do
// USUÁRIO (userData, editável pela tela de Ajustes do app, sobrevive a updates).
const DEFAULTS = { url: "https://comandas.planejamento.app", printerPort: 9100, larguraColunas: 48, caixaNome: "Caixa", kiosk: false };
function bundledConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch { return {}; }
}
function userConfigPath() { return path.join(app.getPath("userData"), "config.json"); }
function lerUserConfig() {
  try { return JSON.parse(fs.readFileSync(userConfigPath(), "utf8")); } catch { return {}; }
}
function lerConfig() { return { ...DEFAULTS, ...bundledConfig(), ...lerUserConfig() }; }
function salvarUserConfig(patch) {
  const atual = lerUserConfig();
  const novo = { ...atual, ...patch };
  fs.writeFileSync(userConfigPath(), JSON.stringify(novo, null, 2), "utf8");
  return novo;
}

let cfg = DEFAULTS;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#ffffff",
    title: `Planejamento PDV · ${cfg.caixaNome || "Caixa"}`,
    kiosk: !!cfg.kiosk,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(cfg.url || "https://comandas.planejamento.app");
  // Atalhos (sem menu): Cmd/Ctrl+R ou F5 = recarregar (pega a versão nova do
  // sistema na hora); Cmd/Ctrl+Shift+R = recarregar ignorando cache.
  win.webContents.on("before-input-event", (event, input) => {
    const mod = process.platform === "darwin" ? input.meta : input.control;
    const k = (input.key || "").toLowerCase();
    if ((mod && k === "r") || input.key === "F5") {
      event.preventDefault();
      if (mod && input.shift) win.webContents.reloadIgnoringCache(); else win.webContents.reload();
    }
  });
  return win;
}

app.whenReady().then(() => {
  cfg = lerConfig();
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Checa updates ao abrir e a cada 2h (se o app ficar aberto o dia todo).
  checarUpdates();
  setInterval(checarUpdates, 2 * 60 * 60 * 1000);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// Ponte de impressão: o renderer chama window.pdvBridge.print(job).
ipcMain.handle("pdv-print", async (_e, job) => {
  try { await imprimir(job, cfg); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
// Teste de impressão (botão de config).
ipcMain.handle("pdv-print-test", async () => {
  try { await testar(cfg); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
// Config atual (pra tela de Ajustes do PDV).
ipcMain.handle("pdv-config", () => ({ ...cfg, bridge: true }));
// Salva a config editada na tela de Ajustes (IP, caixa, etc.) — grava no userData.
ipcMain.handle("pdv-set-config", (_e, patch) => {
  try {
    const limpo = {};
    if (patch && typeof patch === "object") {
      if (typeof patch.printerIp === "string") limpo.printerIp = patch.printerIp.trim();
      if (patch.printerPort != null) limpo.printerPort = parseInt(patch.printerPort, 10) || 9100;
      if (typeof patch.caixaNome === "string") limpo.caixaNome = patch.caixaNome.trim();
      if (patch.larguraColunas != null) limpo.larguraColunas = parseInt(patch.larguraColunas, 10) || 48;
    }
    salvarUserConfig(limpo);
    cfg = lerConfig();
    return { ok: true, config: { ...cfg, bridge: true } };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
