// AppTip PDV — processo principal do Electron.
// Abre o módulo Comandas numa janela dedicada e expõe uma "ponte de impressão":
// o site (renderer) manda o job de impressão e aqui a gente imprime direto na
// Epson por IP (ESC/POS). Assim não precisa de Chrome --kiosk-printing nem do
// diálogo de impressão; sai com corte de papel e QR.
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { imprimir, testar } = require("./print");

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); }
  catch { return { url: "https://comandas.planejamento.app", printerPort: 9100 }; }
}
let cfg = lerConfig();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#ffffff",
    title: `AppTip PDV · ${cfg.caixaNome || "Caixa"}`,
    kiosk: !!cfg.kiosk,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(cfg.url || "https://comandas.planejamento.app");
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
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
// Config visível pro renderer (nome do caixa, sinaliza que a ponte existe).
ipcMain.handle("pdv-config", () => ({ caixaNome: cfg.caixaNome || "Caixa", printerIp: cfg.printerIp || null, bridge: true }));
