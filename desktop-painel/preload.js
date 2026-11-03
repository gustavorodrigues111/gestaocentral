// Ponte mínima pro Painel do Salão (renderer). O painel é só visualização, então
// não há ações nativas — a casca Electron só carrega a rota /painel-estacao.
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("painelBridge", { versao: 1 });
