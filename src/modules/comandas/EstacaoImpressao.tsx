// ESTAÇÃO DE IMPRESSÃO — abre num PC logado no sistema (aba com ?estacao=1),
// com a Epson TM-T20 instalada como impressora e o Chrome em impressão
// silenciosa (--kiosk-printing). Ouve a fila `comandaPrintJobs` e imprime cada
// comanda pendente (ticket 80mm), marcando como impressa. Desacoplado do app:
// qualquer celular/PC lança; aqui só imprime.
import { useEffect, useMemo, useRef, useState } from "react";
import { Printer, CheckCircle2, AlertTriangle } from "lucide-react";
import { ouvirPrintJobsPendentes, marcarPrintJob } from "./comandasRepo";
import type { ComandaPrintJob, ComandaEstacao } from "../../core/types";

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
    setAtual(prox);
    const t = setTimeout(async () => {
      let ok = true;
      try { window.print(); } catch { ok = false; }
      try { await marcarPrintJob(prox.id, ok ? "impresso" : "erro"); } catch { /* o listener retenta */ }
      setLog((l) => [{ id: prox.id, titulo: prox.titulo, em: new Date().toLocaleTimeString("pt-BR"), ok }, ...l].slice(0, 30));
      setAtual(null);
      ocupadoRef.current = false;
    }, 400);
    return () => clearTimeout(t);
  }, [jobs, auto]);

  const alvo = atual || teste;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://comandas.planejamento.app";

  // Modo EMBUTIDO: roda dentro do próprio PDV (mesmo PC da Epson). Sem painel —
  // só o listener (acima) + a área de impressão oculta. Imprime automático.
  if (embedded) {
    return (
      <>
        <style>{PRINT_CSS}</style>
        <div id="comanda-print">{alvo && <TicketConteudo job={alvo} nomeRest={nomeRest} />}</div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Área de impressão (só ela aparece no papel) */}
      <style>{PRINT_CSS}</style>
      <div id="comanda-print">
        {alvo && <TicketConteudo job={alvo} nomeRest={nomeRest} />}
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
          <button onClick={() => { setTeste({ id: "teste", restaurantId: rid, tipo: "conta", comandaId: "", comandaNumero: "TESTE", clienteNome: "Teste", logoUrl, titulo: `${nomeRest || "COMANDA"} · TESTE`, linhas: [{ nome: "1x Item de teste", qtd: null, valor: "R$ 0,00" }], total: "R$ 0,00", rodape: "impressão de teste", status: "pendente", criadoEm: new Date().toISOString(), impressoEm: null }); setTimeout(() => { window.print(); setTeste(null); }, 300); }}
            className="mt-3 h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold inline-flex items-center gap-1.5"><Printer size={15} /> Imprimir teste</button>
        </div>

        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 text-[12px] text-amber-900 dark:text-amber-100 mb-3 space-y-3">
          <div className="font-bold text-[13px]">Configurar a impressão (uma vez por PC)</div>

          <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-2.5">
            <div className="font-semibold text-emerald-800 dark:text-emerald-200">⚡ Jeito automático (Windows)</div>
            <p className="text-emerald-800/90 dark:text-emerald-200/90 mt-0.5">Baixe e dê 2 cliques — ele configura impressora + Chrome sozinho (pede admin).</p>
            <a href="/configurar-pdv-windows.bat" download className="inline-block mt-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">⬇ Baixar configurador (Windows)</a>
            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/70 mt-1">Já precisa ter o driver da Epson e o Chrome instalados (passos abaixo). O Chrome pode avisar "arquivo perigoso" — é só manter.</p>
          </div>

          <div className="font-semibold text-[12px] opacity-70">Ou manualmente, passo a passo:</div>

          <div>
            <div className="font-semibold">1 · Instalar a impressora pela rede</div>
            <p className="opacity-90 mt-0.5">Baixe o driver da Epson (APD) no site oficial e instale:</p>
            <a href="https://download.epson-biz.com/modules/pos/" target="_blank" rel="noreferrer" className="inline-block mt-1 font-semibold text-indigo-700 dark:text-indigo-300 underline">↗ Baixar driver Epson POS (APD)</a>
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

function TicketConteudo({ job, nomeRest }: { job: ComandaPrintJob; nomeRest: string }) {
  // Comanda de PRODUÇÃO (cozinha): fontes GRANDES e GROSSAS + altura mínima de
  // ~10cm pra ficar fácil de ler e destacar/pendurar, mesmo com 1 item só.
  if (job.tipo === "producao") {
    return (
      <div style={{ minHeight: "100mm", color: "#000" }}>
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "22px", letterSpacing: "3px" }}>PRODUÇÃO</div>
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "34px", lineHeight: 1.05 }}>#{job.comandaNumero}</div>
        {job.clienteNome && <div style={{ textAlign: "center", fontWeight: 700, fontSize: "17px", marginTop: "2px" }}>{job.clienteNome}</div>}
        <div style={{ borderTop: "3px solid #000", margin: "10px 0" }} />
        {job.linhas.map((ln, i) => (
          <div key={i} style={{ fontSize: "26px", fontWeight: 800, lineHeight: 1.4, margin: "3px 0" }}>
            {ln.qtd ? `${ln.qtd}  ` : ""}{ln.nome}
          </div>
        ))}
        <div style={{ borderTop: "3px solid #000", margin: "10px 0" }} />
        {job.rodape && <div style={{ whiteSpace: "pre-line", fontSize: "14px", fontWeight: 600 }}>{job.rodape}</div>}
        <div style={{ height: "32px" }} />
      </div>
    );
  }
  // Conta / cupom (layout normal)
  return (
    <div style={{ fontSize: "12px", lineHeight: 1.35 }}>
      {job.logoUrl && job.tipo === "conta" && <div style={{ textAlign: "center", marginBottom: "4px" }}><img src={job.logoUrl} alt="" style={{ maxHeight: "48px", maxWidth: "60mm", margin: "0 auto", display: "block" }} /></div>}
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "14px" }}>{job.titulo}</div>
      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
      {job.linhas.map((ln, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
          <span>{ln.qtd ? `${ln.qtd} ` : ""}{ln.nome}</span>
          {ln.valor && <span style={{ whiteSpace: "nowrap" }}>{ln.valor}</span>}
        </div>
      ))}
      {job.total && (
        <>
          <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "14px" }}>
            <span>TOTAL</span><span>{job.total}</span>
          </div>
        </>
      )}
      {job.rodape && (
        <>
          <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
          <div style={{ whiteSpace: "pre-line", fontSize: "11px" }}>{job.rodape}</div>
        </>
      )}
      <div style={{ textAlign: "center", fontSize: "10px", marginTop: "6px" }}>{nomeRest}</div>
      <div style={{ height: "16px" }} />
    </div>
  );
}
