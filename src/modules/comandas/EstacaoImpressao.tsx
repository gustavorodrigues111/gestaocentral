// ESTAÇÃO DE IMPRESSÃO — abre num PC logado no sistema (aba com ?estacao=1),
// com a Epson TM-T20 instalada como impressora e o Chrome em impressão
// silenciosa (--kiosk-printing). Ouve a fila `comandaPrintJobs` e imprime cada
// comanda pendente (ticket 80mm), marcando como impressa. Desacoplado do app:
// qualquer celular/PC lança; aqui só imprime.
import { useEffect, useMemo, useRef, useState } from "react";
import { Printer, CheckCircle2, AlertTriangle } from "lucide-react";
import { ouvirPrintJobsPendentes, marcarPrintJob } from "./comandasRepo";
import type { ComandaPrintJob, ComandaEstacao } from "../../core/types";

export function EstacaoImpressao({ rid, nomeRest, estacaoId, estacoes, logoUrl }: { rid: string; nomeRest: string; estacaoId: string | null; estacoes: ComandaEstacao[]; logoUrl: string | null }) {
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Área de impressão (só ela aparece no papel) */}
      <style>{`
        #comanda-print { display: none; }
        @media print {
          body { background: #fff !important; }
          body * { visibility: hidden !important; }
          #comanda-print, #comanda-print * { visibility: visible !important; }
          #comanda-print { display: block !important; position: absolute; left: 0; top: 0; width: 72mm; color: #000; font-family: ui-monospace, "Courier New", monospace; }
          @page { size: 80mm auto; margin: 3mm; }
        }
      `}</style>
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

        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-[12px] text-amber-800 dark:text-amber-200 mb-3">
          <div className="font-bold mb-1">Pra imprimir sem diálogo:</div>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Instale a Epson TM-T20 como impressora <b>padrão</b> do PC.</li>
            <li>Abra o Chrome assim: <code className="bg-white/60 dark:bg-black/30 px-1 rounded">chrome --kiosk-printing</code> (Windows) ou <code className="bg-white/60 dark:bg-black/30 px-1 rounded">open -a "Google Chrome" --args --kiosk-printing</code> (Mac).</li>
            <li>Abra esta página nessa janela e deixe aberta.</li>
          </ol>
          <div className="mt-1 opacity-80">Sem o kiosk, cada impressão abre o diálogo do Chrome (é só confirmar).</div>
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
  return (
    <div style={{ fontSize: "12px", lineHeight: 1.35 }}>
      {job.logoUrl && job.tipo === "conta" && <div style={{ textAlign: "center", marginBottom: "4px" }}><img src={job.logoUrl} alt="" style={{ maxHeight: "48px", maxWidth: "60mm", margin: "0 auto", display: "block" }} /></div>}
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "14px" }}>{job.titulo}</div>
      {job.tipo === "producao" && <div style={{ textAlign: "center", fontWeight: 700 }}>*** PRODUÇÃO ***</div>}
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
