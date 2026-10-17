// Expõe a "ponte do PDV" pro site (renderer), de forma isolada e segura.
// O web app detecta `window.pdvBridge` e, se existir, imprime por aqui (ESC/POS
// direto no IP da Epson) em vez de usar window.print().
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdvBridge", {
  versao: 1,
  print: (job) => ipcRenderer.invoke("pdv-print", job),
  printTest: () => ipcRenderer.invoke("pdv-print-test"),
  config: () => ipcRenderer.invoke("pdv-config"),
  setConfig: (patch) => ipcRenderer.invoke("pdv-set-config", patch),
});
