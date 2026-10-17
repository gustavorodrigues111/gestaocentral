// ESTAÇÃO DE IMPRESSÃO — abre num PC logado no sistema (aba com ?estacao=1),
// com a Epson TM-T20 instalada como impressora e o Chrome em impressão
// silenciosa (--kiosk-printing). Ouve a fila `comandaPrintJobs` e imprime cada
// comanda pendente (ticket 80mm), marcando como impressa. Desacoplado do app:
// qualquer celular/PC lança; aqui só imprime.
import { useEffect, useMemo, useRef, useState } from "react";
import { Printer, CheckCircle2, AlertTriangle } from "lucide-react";
import { ouvirPrintJobsPendentes, marcarPrintJob } from "./comandasRepo";
import type { ComandaPrintJob, ComandaEstacao } from "../../core/types";

// URLs dos instaladores do App de Caixa (hospedar no Firebase Storage e colar
// aqui). Vazio → mostra "em breve". Quando preenchido, viram botões de download.
// Mesmos arquivos do feed de auto-update (pdv-updates/, token compartilhado) —
// 1 upload serve download + update.
const APP_CAIXA_DOWNLOAD = {
  mac: "https://firebasestorage.googleapis.com/v0/b/gestaocentral-85b13.firebasestorage.app/o/pdv-updates%2FPlanejamento%20PDV-1.0.3-arm64.dmg?alt=media&token=87522B2C-9534-4645-B0E0-F5348BB246C6",
  win: "https://firebasestorage.googleapis.com/v0/b/gestaocentral-85b13.firebasestorage.app/o/pdv-updates%2FPlanejamento%20PDV%20Setup%201.0.3.exe?alt=media&token=87522B2C-9534-4645-B0E0-F5348BB246C6",
};

// CSS de impressão: só o #comanda-print sai no papel (80mm).
const PRINT_CSS = `
  #comanda-print { display: none; }
  @media print {
    body { background: #fff !important; }
    body * { visibility: hidden !important; }
    #comanda-print, #comanda-print * { visibility: visible !important; }
    #comanda-print { display: block !important; position: absolute; left: 0; top: 0; width: 72mm; color: #000; font-family: ui-monospace, "Courier New", monospace; }
    @page { size: 80mm auto; margin: 3mm; }
  }
`;

export function EstacaoImpressao({ rid, nomeRest, estacaoId, estacoes, logoUrl, embedded }: { rid: string; nomeRest: string; estacaoId: string | null; estacoes: ComandaEstacao[]; logoUrl: string | null; embedded?: boolean }) {
  const [todosJobs, setTodosJobs] = useState<ComandaPrintJob[]>([]);
  const [atual, setAtual] = useState<ComandaPrintJob | null>(null);
  const [log, setLog] = useState<{ id: string; titulo: string; em: string; ok: boolean }[]>([]);
  const [auto, setAuto] = useState(true);
  const [teste, setTeste] = useState<ComandaPrintJob | null>(null);
  const ocupadoRef = useRef(false);
  // Tamanho da fonte da comanda de PRODUÇÃO (px do item), por dispositivo.
  const [fonteProd, setFonteProd] = useState<number>(() => { try { return parseInt(localStorage.getItem("comandas_fonte_producao") || "", 10) || 22; } catch { return 22; } });
  const mudarFonte = (px: number) => { setFonteProd(px); try { localStorage.setItem("comandas_fonte_producao", String(px)); } catch { /* */ } };

  useEffect(() => { if (!rid) return; return ouvirPrintJobsPendentes(rid, setTodosJobs); }, [rid]);

  // Filtra os jobs que ESTA estação deve imprimir. Sem estacaoId (?estacao=1):
  // imprime tudo (impressora única). Com estacaoId: imprime os dela; contas
  // (estacaoId null) só saem na estação "geral" (sem categorias) ou na única.
  const estacaoObj = estacoes.find((e) => e.id === estacaoId);
  const estacaoGeral = !estacaoObj || !(estacaoObj.categorias || []).length;
  const estacaoNome = estacaoObj?.nome || "Impressão";
  const jobs = useMemo(() => todosJobs.filter((j) => {
    if (!estacaoId) return true;                       // estação única: imprime tudo
    if (j.estacaoId === estacaoId) return true;        // destinado a esta
    if (j.estacaoId == null) return estacaoGeral;      // conta/sem destino → só na geral
    return false;
  }), [todosJobs, estacaoId, estacaoGeral]);

  // Processa 1 job por vez: renderiza o ticket, chama window.print(), marca.
  useEffect(() => {
    if (!auto || ocupadoRef.current) return;
    const prox = jobs[0];
    if (!prox) return;
    ocupadoRef.current = true;
    // Fila presa: NÃO imprime ticket velho (a comanda já pode ter mudado). Jobs
    // com mais de 10min são descartados — evita sair conta/produção desatualizada.
    const idadeMin = (Date.now() - new Date(prox.criadoEm || 0).getTime()) / 60000;
    if (idadeMin > 10) {
      marcarPrintJob(prox.id, "erro").catch(() => {}).finally(() => { ocupadoRef.current = false; });
      setLog((l) => [{ id: prox.id, titulo: prox.titulo + " (expirado — fila presa)", em: new Date().toLocaleTimeString("pt-BR"), ok: false }, ...l].slice(0, 30));
      return;
    }
    setAtual(prox);
    // App de caixa (Electron): imprime DIRETO na Epson por IP (ESC/POS), sem
    // diálogo. Fora do app: window.print() (Chrome --kiosk-printing).
    const bridge = (typeof window !== "undefined" ? (window as unknown as { pdvBridge?: { print: (j: unknown) => Promise<{ ok: boolean; error?: string }> } }).pdvBridge : undefined);
    const t = setTimeout(async () => {
      let ok = true;
      if (bridge) {
        try { const r = await bridge.print(prox); ok = !!r?.ok; if (!ok) console.error("[pdvBridge]", r?.error); } catch { ok = false; }
      } else {
        try { window.print(); } catch { ok = false; }
      }
      try { await marcarPrintJob(prox.id, ok ? "impresso" : "erro"); } catch { /* o listener retenta */ }
      setLog((l) => [{ id: prox.id, titulo: prox.titulo, em: new Date().toLocaleTimeString("pt-BR"), ok }, ...l].slice(0, 30));
      setAtual(null);
      ocupadoRef.current = false;
    }, bridge ? 50 : 400);
    return () => clearTimeout(t);
  }, [jobs, auto]);

  const alvo = atual || teste;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://comandas.planejamento.app";
  // Teste de impressão: usa a ponte (ESC/POS por IP) quando roda no app; senão window.print().
  async function imprimirTeste(job: ComandaPrintJob) {
    const bridge = (typeof window !== "undefined" ? (window as unknown as { pdvBridge?: { print: (j: unknown) => Promise<{ ok: boolean; error?: string }> } }).pdvBridge : undefined);
    if (bridge) {
      try { const r = await bridge.print(job); if (!r.ok) alert("Erro na impressão: " + (r.error || "")); }
      catch (e) { alert("Erro: " + (e instanceof Error ? e.message : "?")); }
      return;
    }
    setTeste(job); setTimeout(() => { try { window.print(); } catch { /* ignore */ } setTeste(null); }, 300);
  }

  // Modo EMBUTIDO: roda dentro do próprio PDV (mesmo PC da Epson). Sem painel —
  // só o listener (acima) + a área de impressão oculta. Imprime automático.
  if (embedded) {
    return (
      <>
        <style>{PRINT_CSS}</style>
        <div id="comanda-print">{alvo && <TicketConteudo job={alvo} nomeRest={nomeRest} fonteProd={fonteProd} />}</div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Área de impressão (só ela aparece no papel) */}
      <style>{PRINT_CSS}</style>
      <div id="comanda-print">
        {alvo && <TicketConteudo job={alvo} nomeRest={nomeRest} fonteProd={fonteProd} />}
      </div>

      {/* Painel (tela) */}
      <div className="max-w-xl mx-auto p-4 no-print">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Printer size={20} className="text-indigo-500" /> {estacaoNome}</h1>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-indigo-600" /> imprimir automático</label>
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-center mb-3">
          <div className="text-3xl font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">{jobs.length}</div>
          <div className="text-sm text-gray-500">na fila{atual ? " · imprimindo…" : ""}</div>
          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
            <button onClick={() => void imprimirTeste({ id: "teste", restaurantId: rid, tipo: "conta", rotulo: "TESTE", comandaId: "", comandaNumero: "TESTE", clienteNome: "Teste", logoUrl, titulo: `${nomeRest || "COMANDA"} · TESTE`, linhas: [{ nome: "1x Item de teste", qtd: null, valor: "R$ 0,00" }], total: "R$ 0,00", rodape: "impressão de teste", status: "pendente", criadoEm: new Date().toISOString(), impressoEm: null })}
              className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold inline-flex items-center gap-1.5"><Printer size={15} /> Imprimir teste (conta)</button>
            <button onClick={() => void imprimirTeste({ id: "teste", restaurantId: rid, tipo: "producao", comandaId: "", comandaNumero: "99", clienteNome: "Teste", logoUrl: null, titulo: "PRODUÇÃO · #99", linhas: [{ nome: "Item de teste", qtd: "2x", valor: null }], total: null, rodape: "teste", status: "pendente", criadoEm: new Date().toISOString(), impressoEm: null })}
              className="h-9 px-4 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm font-semibold inline-flex items-center gap-1.5"><Printer size={15} /> Teste (produção)</button>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <div className="text-[11px] font-semibold text-gray-500 mb-1.5">Tamanho da fonte da produção</div>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 text-sm">
              {[{ px: 18, l: "P" }, { px: 22, l: "M" }, { px: 26, l: "G" }, { px: 30, l: "GG" }].map((o) => (
                <button key={o.px} onClick={() => mudarFonte(o.px)} className={`px-3 py-1 rounded-md font-semibold ${fonteProd === o.px ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}>{o.l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Dentro do app de caixa: tela de ajustes (IP da Epson, nome do caixa).
            Fora do app: card de download. */}
        <AppCaixaConfig />

        {/* App de caixa (recomendado) — imprime direto na Epson, sem Chrome */}
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 p-3.5 text-[12px] text-indigo-900 dark:text-indigo-100 mb-3 pdv-so-fora-do-app">
          <div className="font-bold text-[13px] inline-flex items-center gap-1.5"><Printer size={14} /> App de caixa (recomendado)</div>
          <p className="opacity-90 mt-0.5">Instale o <b>Planejamento PDV</b> no computador do caixa: abre direto o sistema e imprime na Epson <b>por IP</b> (sem Chrome, sem diálogo, com corte e QR). Também funciona offline.</p>
          {(APP_CAIXA_DOWNLOAD.mac || APP_CAIXA_DOWNLOAD.win) ? (
            <div className="flex flex-wrap gap-2 mt-2">
              {APP_CAIXA_DOWNLOAD.mac && <a href={APP_CAIXA_DOWNLOAD.mac} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">⬇ Baixar para Mac (.dmg)</a>}
              {APP_CAIXA_DOWNLOAD.win && <a href={APP_CAIXA_DOWNLOAD.win} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">⬇ Baixar para Windows (.exe)</a>}
            </div>
          ) : (
            <p className="text-[11px] text-indigo-700/80 dark:text-indigo-300/70 mt-1.5">Instaladores em breve. Enquanto isso, use a configuração do Chrome abaixo.</p>
          )}
        </div>

        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 text-[12px] text-amber-900 dark:text-amber-100 mb-3 space-y-3 pdv-so-fora-do-app">
          <div className="font-bold text-[13px]">Configurar a impressão pelo Chrome (sem o app)</div>

          <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-2.5">
            <div className="font-semibold text-emerald-800 dark:text-emerald-200">⚡ Jeito automático (Windows)</div>
            <p className="text-emerald-800/90 dark:text-emerald-200/90 mt-0.5">Baixe e dê 2 cliques — ele configura impressora + Chrome sozinho (pede admin).</p>
            <a href="/configurar-pdv-windows.bat" download className="inline-block mt-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">⬇ Baixar configurador (Windows)</a>
            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/70 mt-1">Já precisa ter o driver da Epson e o Chrome instalados (passos abaixo). O Chrome pode avisar "arquivo perigoso" — é só manter.</p>
          </div>

          <div className="font-semibold text-[12px] opacity-70">Ou manualmente, passo a passo:</div>

          <div>
            <div className="font-semibold">1 · Instalar a impressora pela rede</div>
            <p className="opacity-90 mt-0.5">Baixe o driver da Epson (APD 6) no site oficial e instale:</p>
            <a href="https://download-center.epson.com/softwares/?device_id=TM-T20X-II&os=WIN1164&language=pt" target="_blank" rel="noreferrer" className="inline-block mt-1 font-semibold text-indigo-700 dark:text-indigo-300 underline">↗ Baixar driver EPSON TM-T20X-II (APD 6)</a>
            <p className="opacity-90 mt-1">No Windows: <b>Adicionar impressora → porta Standard TCP/IP</b> → digite o <b>IP da impressora</b> (veja no config dela) → porta <b>9100</b> → escolha o driver <b>EPSON TM-T20X</b>.</p>
          </div>

          <div>
            <div className="font-semibold">2 · Deixar a Epson como padrão</div>
            <p className="opacity-90 mt-0.5">Windows → <b>Impressoras e scanners</b> → desligue “Permitir que o Windows gerencie a padrão” → na TM-T20X, <b>Definir como padrão</b>. (Sem isso, imprime no lugar errado.)</p>
          </div>

          <div>
            <div className="font-semibold">3 · Abrir o Chrome em modo silencioso</div>
            <p className="opacity-90 mt-0.5">Crie um atalho na área de trabalho com este destino (abre sem o diálogo de impressão):</p>
            <code className="block bg-white/70 dark:bg-black/30 px-2 py-1.5 rounded mt-1 break-all leading-relaxed">{`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --user-data-dir="C:\\pdv" `}{origin}</code>
            <p className="opacity-80 mt-1">Mac: <code className="bg-white/60 dark:bg-black/30 px-1 rounded">open -a "Google Chrome" --args --kiosk-printing</code>. Chrome: <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer" className="text-indigo-700 dark:text-indigo-300 underline">baixar</a>.</p>
          </div>

          <div>
            <div className="font-semibold">4 · Manter imprimindo</div>
            <p className="opacity-90 mt-0.5">Deixe <b>esta aba da Estação aberta</b> — ou, no PDV, ligue o toggle <b>“Imprimir nesta tela”</b> (menu ☰) nesse mesmo PC, dispensando esta aba.</p>
          </div>

          <p className="opacity-70 pt-1 border-t border-amber-200/60 dark:border-amber-900/40">Dica: fixe o IP da impressora (reserva de DHCP) e deixe o papel em 80mm no driver. Sem o <code className="bg-white/60 dark:bg-black/30 px-1 rounded">--kiosk-printing</code>, cada impressão abre o diálogo do Chrome (é só confirmar).</p>
        </div>

        {log.length > 0 && (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {log.map((l, i) => (
              <div key={l.id + i} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                {l.ok ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={15} className="text-rose-500 shrink-0" />}
                <span className="truncate flex-1 text-gray-700 dark:text-gray-200">{l.titulo}</span>
                <span className="text-gray-400 tabular-nums">{l.em}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TicketConteudo({ job, nomeRest, fonteProd = 22 }: { job: ComandaPrintJob; nomeRest: string; fonteProd?: number }) {
  // Comanda de PRODUÇÃO (cozinha): fonte GRANDE e GROSSA (tamanho configurável)
  // + altura mínima de ~10cm pra destacar/pendurar, mesmo com 1 item só.
  if (job.tipo === "producao") {
    const f = Math.max(12, Math.min(40, fonteProd));
    return (
      <div style={{ minHeight: "100mm", color: "#000" }}>
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: `${Math.round(f * 0.85)}px`, letterSpacing: "3px" }}>PRODUÇÃO</div>
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: `${Math.round(f * 1.35)}px`, lineHeight: 1.05 }}>#{job.comandaNumero}</div>
        {job.clienteNome && <div style={{ textAlign: "center", fontWeight: 700, fontSize: `${Math.round(f * 0.72)}px`, marginTop: "2px" }}>{job.clienteNome}</div>}
        <div style={{ borderTop: "3px solid #000", margin: "10px 0" }} />
        {job.linhas.map((ln, i) => (
          <div key={i} style={{ fontSize: `${f}px`, fontWeight: 800, lineHeight: 1.4, margin: "3px 0" }}>
            {ln.qtd ? `${ln.qtd}  ` : ""}{ln.nome}
          </div>
        ))}
        <div style={{ borderTop: "3px solid #000", margin: "10px 0" }} />
        {job.rodape && <div style={{ whiteSpace: "pre-line", fontSize: "14px", fontWeight: 600 }}>{job.rodape}</div>}
        <div style={{ height: "32px" }} />
      </div>
    );
  }
  // CANCELAMENTO (cozinha ou nota): GIGANTE, fundo preto / letra branca, impossível passar batido.
  if (job.tipo === "cancelamento") {
    const f = Math.max(12, Math.min(40, fonteProd));
    const cozinha = job.rotulo === "COZINHA";
    // forcePrintBg garante que o fundo preto saia na impressão (navegadores não imprimem fundo por padrão)
    const forcePrintBg = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as React.CSSProperties;
    return (
      <div style={{ minHeight: "90mm", color: "#000" }}>
        <div style={{ height: "8px" }} />
        {/* Faixa preta GIGANTE */}
        <div style={{ ...forcePrintBg, background: "#000", color: "#fff", textAlign: "center", padding: "14px 4px", lineHeight: 1 }}>
          <div style={{ fontWeight: 900, fontSize: `${Math.round(f * 1.0)}px`, letterSpacing: "6px" }}>✗✗✗✗✗✗✗✗</div>
          <div style={{ fontWeight: 900, fontSize: `${Math.round(f * 1.7)}px`, letterSpacing: "2px", margin: "8px 0" }}>CANCELAMENTO</div>
          <div style={{ fontWeight: 900, fontSize: `${Math.round(f * 1.0)}px`, letterSpacing: "6px" }}>✗✗✗✗✗✗✗✗</div>
        </div>
        {cozinha && <div style={{ ...forcePrintBg, background: "#000", color: "#fff", textAlign: "center", fontWeight: 900, fontSize: `${Math.round(f * 0.95)}px`, padding: "8px 4px", marginTop: "3px" }}>NAO PREPARAR<br />NAO ENTREGAR</div>}
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: `${Math.round(f * 1.15)}px`, lineHeight: 1.05, marginTop: "10px" }}>#{job.comandaNumero}{job.clienteNome ? ` · ${job.clienteNome}` : ""}</div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: `${Math.round(f * 0.85)}px`, letterSpacing: "1px", marginTop: "10px" }}>{job.linhas.length > 1 ? "ITENS CANCELADOS" : "ITEM CANCELADO"}</div>
        <div style={{ borderTop: "4px solid #000", margin: "6px 0" }} />
        {job.linhas.map((ln, i) => (
          <div key={i} style={{ fontSize: `${Math.round(f * 1.25)}px`, fontWeight: 900, lineHeight: 1.3, margin: "6px 0", display: "flex", gap: "8px" }}>
            <span>✗</span><span>{ln.qtd ? `${ln.qtd}x ` : ""}{ln.nome}{ln.valor ? ` — ${ln.valor}` : ""}</span>
          </div>
        ))}
        <div style={{ borderTop: "4px solid #000", margin: "6px 0" }} />
        {job.rodape && <div style={{ whiteSpace: "pre-line", fontSize: "13px", fontWeight: 700, textAlign: "center" }}>{job.rodape}</div>}
        <div style={{ height: "40px" }} />
      </div>
    );
  }
  const sep = <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />;
  const brDataHora = (iso?: string | null) => iso ? new Date(iso).toLocaleString("pt-BR") : "";

  // DANFCe — cupom fiscal da NFC-e (emitente + itens + chave + protocolo + QR).
  if (job.tipo === "danfce" && job.nfce) {
    const n = job.nfce;
    const chaveFmt = (n.chave || "").replace(/(\d{4})(?=\d)/g, "$1 ");
    return (
      <div style={{ fontSize: "11px", lineHeight: 1.3, fontWeight: 600, color: "#000" }}>
        {/* Cabeçalho — emitente */}
        {job.logoUrl && <div style={{ textAlign: "center", marginBottom: "3px" }}><img src={job.logoUrl} alt="" style={{ maxHeight: "40px", maxWidth: "60mm", margin: "0 auto", display: "block" }} /></div>}
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "13px" }}>{n.emitRazao || job.titulo}</div>
        <div style={{ textAlign: "center", fontSize: "10px", lineHeight: 1.25 }}>
          {n.emitCnpj && <div>CNPJ: {n.emitCnpj}{n.emitIe ? ` · IE: ${n.emitIe}` : ""}</div>}
          {n.emitEndereco && <div>{n.emitEndereco}</div>}
        </div>
        {sep}
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "11px" }}>DANFE NFC-e — Documento Auxiliar da</div>
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "11px", marginBottom: "2px" }}>Nota Fiscal de Consumidor Eletrônica</div>
        {sep}
        {/* Itens: descrição + qtd x = total */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", textTransform: "uppercase" }}><span>Descrição</span><span>Qtd · Valor</span></div>
        {job.linhas.map((ln, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "6px", fontWeight: 700 }}>
            <span>{ln.nome}</span>
            <span style={{ whiteSpace: "nowrap" }}>{ln.qtd ? `${ln.qtd} ` : ""}{ln.valor || ""}</span>
          </div>
        ))}
        {job.total && (<>{sep}<div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "14px" }}><span>TOTAL</span><span>{job.total}</span></div></>)}
        {job.rodape && <div style={{ whiteSpace: "pre-line", fontSize: "11px", marginTop: "2px" }}>{job.rodape}</div>}
        {sep}
        <div style={{ textAlign: "center", fontSize: "10px", lineHeight: 1.3 }}>
          <div style={{ fontWeight: 800 }}>NFC-e nº {n.numero} · série {n.serie}</div>
          <div>Emissão: {brDataHora(n.dataEmissao)}</div>
          <div>Consumidor: {n.cpfConsumidor ? `CPF ${n.cpfConsumidor}` : "não identificado"}</div>
          <div style={{ marginTop: "3px" }}>Consulte pela chave de acesso em:</div>
          <div style={{ wordBreak: "break-all" }}>{n.urlConsulta || "www.nfce.fazenda.sp.gov.br"}</div>
          <div style={{ marginTop: "3px", fontWeight: 700 }}>Chave de acesso</div>
          <div style={{ wordBreak: "break-all", fontFamily: "ui-monospace, monospace" }}>{chaveFmt}</div>
          {n.protocolo && <div style={{ marginTop: "2px" }}>Protocolo de autorização: {n.protocolo}</div>}
        </div>
        {n.qrDataUrl && <div style={{ textAlign: "center", marginTop: "6px" }}><img src={n.qrDataUrl} alt="QR" style={{ width: "40mm", height: "40mm", margin: "0 auto", display: "block" }} /></div>}
        <div style={{ height: "24px" }} />
      </div>
    );
  }
  // Conta / Pré-conta — mesmo layout base, identificado pelo rótulo. SEM valor fiscal.
  return (
    <div style={{ fontSize: "13px", lineHeight: 1.4, fontWeight: 600, color: "#000" }}>
      {job.logoUrl && <div style={{ textAlign: "center", marginBottom: "4px" }}><img src={job.logoUrl} alt="" style={{ maxHeight: "48px", maxWidth: "60mm", margin: "0 auto", display: "block" }} /></div>}
      <div style={{ textAlign: "center", fontWeight: 800, fontSize: "15px" }}>{job.titulo || nomeRest}</div>
      {job.rotulo && <div style={{ textAlign: "center", fontWeight: 800, fontSize: "13px", letterSpacing: "2px" }}>{job.rotulo}</div>}
      <div style={{ textAlign: "center", fontSize: "11px" }}>#{job.comandaNumero}{job.clienteNome ? ` · ${job.clienteNome}` : ""}</div>
      <div style={{ textAlign: "center", fontSize: "10px" }}>{brDataHora(job.criadoEm)}</div>
      {sep}
      {job.linhas.map((ln, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "6px", fontWeight: 700 }}>
          <span>{ln.qtd ? `${ln.qtd} ` : ""}{ln.nome}</span>
          {ln.valor && <span style={{ whiteSpace: "nowrap" }}>{ln.valor}</span>}
        </div>
      ))}
      {job.total && (<>{sep}<div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "16px" }}><span>TOTAL</span><span>{job.total}</span></div></>)}
      {job.rodape && (<>{sep}<div style={{ whiteSpace: "pre-line", fontSize: "12px", fontWeight: 600 }}>{job.rodape}</div></>)}
      {sep}
      <div style={{ textAlign: "center", fontSize: "10px" }}>Documento sem valor fiscal</div>
      <div style={{ height: "16px" }} />
    </div>
  );
}

// ── Ajustes do app de caixa (só aparece DENTRO do Planejamento PDV) ─────────
// Lê/grava a config do app (IP da Epson, nome do caixa, etc.) via window.pdvBridge.
// Quando presente, esconde os cards de "download" e "configurar Chrome".
type PdvBridge = {
  config: () => Promise<Record<string, unknown>>;
  setConfig: (p: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; config?: Record<string, unknown> }>;
  printTest: () => Promise<{ ok: boolean; error?: string }>;
};
export function AppCaixaConfig({ semEsconder }: { semEsconder?: boolean } = {}) {
  const bridge = (typeof window !== "undefined" ? (window as unknown as { pdvBridge?: PdvBridge }).pdvBridge : undefined);
  const [ip, setIp] = useState("");
  const [porta, setPorta] = useState("9100");
  const [caixa, setCaixa] = useState("");
  const [largura, setLargura] = useState("48");
  const [versao, setVersao] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    bridge.config().then((c) => {
      setIp(String(c.printerIp || "")); setPorta(String(c.printerPort || 9100));
      setCaixa(String(c.caixaNome || "")); setLargura(String(c.larguraColunas || 48));
      setVersao(String((c as { appVersion?: string }).appVersion || ""));
    }).catch(() => {});
  }, [bridge]);
  if (!bridge) return null;
  async function salvar() {
    setBusy(true);
    try { const r = await bridge!.setConfig({ printerIp: ip, printerPort: porta, caixaNome: caixa, larguraColunas: largura }); setMsg(r.ok ? "salvo ✓" : ("erro: " + (r.error || ""))); }
    catch (e) { setMsg("erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setBusy(false); setTimeout(() => setMsg(""), 3000); }
  }
  async function teste() {
    setBusy(true);
    try { const r = await bridge!.printTest(); setMsg(r.ok ? "impresso ✓" : ("erro: " + (r.error || ""))); }
    catch (e) { setMsg("erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setBusy(false); setTimeout(() => setMsg(""), 5000); }
  }
  const campo = "w-full h-10 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums";
  const rot = "text-[10px] font-semibold text-gray-500 dark:text-gray-400 block mb-1";
  return (
    <>
      {!semEsconder && <style>{".pdv-so-fora-do-app{display:none !important;}"}</style>}
      <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 p-3.5 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-[13px] text-indigo-900 dark:text-indigo-100 inline-flex items-center gap-1.5"><Printer size={14} /> Ajustes do app de caixa</div>
          {versao && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 tabular-nums">v{versao}</span>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><label className={rot}>IP da impressora (Epson)</label><input value={ip} onChange={(e) => setIp(e.target.value)} inputMode="decimal" placeholder="ex.: 192.168.0.50" className={campo} /></div>
          <div><label className={rot}>Porta</label><input value={porta} onChange={(e) => setPorta(e.target.value)} inputMode="numeric" placeholder="9100" className={campo} /></div>
          <div><label className={rot}>Largura (colunas)</label><input value={largura} onChange={(e) => setLargura(e.target.value)} inputMode="numeric" placeholder="48" className={campo} /></div>
          <div className="col-span-2"><label className={rot}>Nome do caixa</label><input value={caixa} onChange={(e) => setCaixa(e.target.value)} placeholder="Caixa 1" className={campo} /></div>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">80mm = 48 colunas · 58mm = 32. Fixe o IP da Epson por reserva de DHCP.</p>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => void salvar()} disabled={busy} className="flex-1 h-10 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">Salvar</button>
          <button onClick={() => void teste()} disabled={busy} className="h-10 px-4 rounded-lg border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-sm font-semibold disabled:opacity-40">Imprimir teste</button>
        </div>
        {msg && <div className="text-[12px] font-semibold text-center mt-2 text-gray-700 dark:text-gray-200">{msg}</div>}
      </div>
    </>
  );
}
