// Impressão ESC/POS direto na Epson por IP (TCP 9100), via node-thermal-printer.
// Recebe o ComandaPrintJob do web app e formata os 3 tipos: produção, conta/
// pré-conta e DANFCe (cupom fiscal com QR). Sai com corte de papel.
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");

function novaImpressora(cfg) {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${cfg.printerIp}:${cfg.printerPort || 9100}`,
    width: cfg.larguraColunas || 48,
    removeSpecialCharacters: false,
    options: { timeout: 6000 },
  });
}

async function imprimir(job, cfg) {
  if (!cfg.printerIp) throw new Error("printerIp não configurado no config.json");
  const p = novaImpressora(cfg);
  const conectada = await p.isPrinterConnected();
  if (!conectada) throw new Error(`Impressora não respondeu em ${cfg.printerIp}:${cfg.printerPort || 9100}`);

  if (job.tipo === "producao") {
    p.alignCenter(); p.bold(true); p.setTextSize(1, 1); p.println("PRODUCAO");
    p.setTextSize(1, 2); p.println("#" + (job.comandaNumero || "")); p.setTextSize(0, 0);
    if (job.clienteNome) p.println(job.clienteNome);
    p.bold(false); p.drawLine(); p.alignLeft(); p.setTextSize(1, 1); p.bold(true);
    (job.linhas || []).forEach((l) => p.println((l.qtd ? l.qtd + "  " : "") + l.nome));
    p.setTextSize(0, 0); p.bold(false); p.drawLine();
    if (job.rodape) p.println(job.rodape);
  } else {
    // conta / pré-conta / danfce
    const n = job.nfce;
    p.alignCenter();
    if (n && n.emitRazao) { p.bold(true); p.println(n.emitRazao); p.bold(false); }
    else { p.bold(true); p.println(job.titulo || ""); p.bold(false); }
    if (n && n.emitCnpj) p.println("CNPJ: " + n.emitCnpj + (n.emitIe ? "  IE: " + n.emitIe : ""));
    if (n && n.emitEndereco) p.println(n.emitEndereco);
    if (job.rotulo) { p.bold(true); p.println(job.rotulo); p.bold(false); }
    if (job.comandaNumero) p.println("#" + job.comandaNumero + (job.clienteNome ? " - " + job.clienteNome : ""));
    p.drawLine(); p.alignLeft();
    (job.linhas || []).forEach((l) => p.leftRight((l.qtd ? l.qtd + " " : "") + l.nome, l.valor || ""));
    if (job.total) { p.drawLine(); p.bold(true); p.leftRight("TOTAL", job.total); p.bold(false); }
    if (job.rodape) { p.drawLine(); p.println(job.rodape); }
    if (n && n.chave) {
      p.drawLine(); p.alignCenter();
      p.println(`NFC-e no ${n.numero || ""} serie ${n.serie || ""}`);
      if (n.cpfConsumidor) p.println("CPF: " + n.cpfConsumidor); else p.println("CONSUMIDOR NAO IDENTIFICADO");
      p.println("Consulte pela chave de acesso em:");
      p.println(n.urlConsulta || "www.nfce.fazenda.sp.gov.br");
      p.println(n.chave);
      if (n.protocolo) p.println("Protocolo: " + n.protocolo);
      if (n.qrcodeUrl) { try { await p.printQR(n.qrcodeUrl, { cellSize: 6, correction: "M" }); } catch (_) { /* segue sem QR */ } }
    } else {
      p.drawLine(); p.alignCenter(); p.println("Documento sem valor fiscal");
    }
  }
  p.cut();
  await p.execute();
}

async function testar(cfg) {
  await imprimir({ tipo: "conta", titulo: "TESTE DE IMPRESSAO", rotulo: "TESTE", comandaNumero: "0", linhas: [{ nome: "Item de teste", valor: "R$ 0,00" }], total: "R$ 0,00", rodape: "Planejamento PDV - " + (cfg.caixaNome || "Caixa") }, cfg);
}

module.exports = { imprimir, testar };
