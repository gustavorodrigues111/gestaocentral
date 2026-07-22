// Relatório de uma avaliação FINALIZADA (Fase 2) + Plano de Ação por
// inconformidade (Fase 3). Mostra nota/classificação, gráficos de não-conformes
// por bloco e por área, e a lista de inconformidades — cada uma pode virar/
// acompanhar uma Ação do módulo Plano de Ação (coleção `acoes`).
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import type {
  Tarefa, TarefaStatus, Pessoa,
  SegurancaAvaliacao, SegurancaResultadoItem,
} from "../../core/types";
import { TAREFA_STATUS_LABEL, segAreaCor, segurancaFaixaDe } from "../../core/types";
import { ouvirAvaliacao, salvarResultado, calcularScore, reabrirAvaliacao } from "./repository";
import { criarTarefaOperacional, atualizarTarefa } from "../tarefas/repository";
import { SegurancaFotos } from "./SegurancaFotos";
import { VirarAcaoModal } from "../planoDeAcao/VirarAcaoModal";
import { DatePickerBR } from "../prazos/campos";

const dmy = (ymd?: string | null) => (ymd || "").split("-").reverse().join("/");
const brToYmd = (br: string) => { const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

const STATUS_PILL: Record<TarefaStatus, string> = {
  a_fazer: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  em_andamento: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  concluida: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  cancelada: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
};

// Prefixo do refId que amarra uma ação a esta avaliação: `${av.id}:${itemId}`.
const refItemId = (avId: string, refId?: string | null) =>
  (refId || "").startsWith(avId + ":") ? (refId as string).slice(avId.length + 1) : null;

export function Relatorio({ avaliacaoId, autor, onClose, onVerPreenchimento }: {
  avaliacaoId: string;
  autor: { id: string; nome: string };
  onClose: () => void;
  onVerPreenchimento: () => void;
}) {
  const { pessoa: me } = useAuth();
  const isMaster = !!me?.isMaster;
  const [av, setAv] = useState<SegurancaAvaliacao | null>(null);
  const [acoes, setAcoes] = useState<Tarefa[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [criarPara, setCriarPara] = useState<string | null>(null); // itemId
  const [gerando, setGerando] = useState(false);
  const [exportando, setExportando] = useState(false);

  useEffect(() => ouvirAvaliacao(avaliacaoId, setAv), [avaliacaoId]);

  const rid = av?.restaurantId || "";
  const { can } = useCanAcao(rid);
  const podePreencher = isMaster || can("seguranca", "preencher");
  const podeResolver = isMaster || can("seguranca", "resolverAcoes");
  const podeTransferir = isMaster || can("seguranca", "transferirResponsavel");

  // Ações desta avaliação (filtro client-side por origem + refId).
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "tarefas"), where("origem", "==", "avaliacao_sanitaria")), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tarefa)
        .filter((a) => !a.deletadoEm && refItemId(avaliacaoId, a.origemRefId) != null);
      setAcoes(list);
    }, () => setAcoes([]));
  }, [rid, avaliacaoId]);

  // Pessoas do restaurante (para transferir responsável).
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      (snap) => setPessoas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa).filter((p) => p.ativa !== false)),
      () => setPessoas([]));
  }, [rid]);

  const itens = useMemo(() => av?.itensSnapshot || [], [av]);
  const blocos = useMemo(() => (av?.blocosSnapshot || []).slice().sort((a, b) => a.ordem - b.ordem), [av]);
  const faixas = av?.faixasSnapshot || [];
  const areasLista = useMemo(() => (
    av?.areasSnapshot?.length ? av.areasSnapshot : (Array.from(new Set(itens.map((i) => i.area).filter(Boolean))) as string[])
  ), [av?.areasSnapshot, itens]);
  const itemById = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens]);
  const blocoById = useMemo(() => new Map(blocos.map((b) => [b.id, b])), [blocos]);

  // Nota: usa a persistida se finalizada; senão recompute.
  const calc = useMemo(() => calcularScore(av?.resultado || {}, itens), [av?.resultado, itens]);
  const score = av?.status === "finalizada" && typeof av.score === "number" ? av.score : calc.score;
  const faixa = segurancaFaixaDe(score, faixas);
  const faixaLabel = av?.status === "finalizada" && av.faixaLabel ? av.faixaLabel : faixa?.label || "—";
  const cor = faixa?.cor || "#4f46e5";

  // Inconformidades (itens não-conformes) ordenadas por área e bloco.
  const inconformidades = useMemo(() => {
    const out: Array<{ itemId: string; r: SegurancaResultadoItem; area?: string; blocoNome: string; texto: string }> = [];
    for (const [itemId, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const it = itemById.get(itemId);
      out.push({ itemId, r, area: it?.area, blocoNome: blocoById.get(it?.blocoId || "")?.nome || "—", texto: it?.texto || "(item removido)" });
    }
    const areaOrder = (a?: string) => (a ? areasLista.indexOf(a) : 99);
    return out.sort((a, b) => areaOrder(a.area) - areaOrder(b.area) || a.blocoNome.localeCompare(b.blocoNome) || a.texto.localeCompare(b.texto));
  }, [av?.resultado, itemById, blocoById]);

  // Não-conformes PONTUÁVEIS por bloco.
  const ncPorBloco = useMemo(() => {
    const m = new Map<string, number>();
    for (const [itemId, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const it = itemById.get(itemId);
      if (!it || !it.pontua) continue;
      m.set(it.blocoId, (m.get(it.blocoId) || 0) + 1);
    }
    return blocos.map((b) => ({ nome: b.nome, n: m.get(b.id) || 0 })).filter((x) => x.n > 0);
  }, [av?.resultado, itemById, blocos]);

  // Não-conformes por área.
  const ncPorArea = useMemo(() => {
    const m = {} as Record<string, number>;
    for (const [itemId, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const a = itemById.get(itemId)?.area;
      if (a) m[a] = (m[a] || 0) + 1;
    }
    return areasLista.map((a) => ({ area: a, n: m[a] || 0 })).filter((x) => x.n > 0);
  }, [av?.resultado, itemById]);

  const acaoPorItem = useMemo(() => {
    const m = new Map<string, Tarefa>();
    for (const a of acoes) { const k = refItemId(avaliacaoId, a.origemRefId); if (k) m.set(k, a); }
    return m;
  }, [acoes, avaliacaoId]);

  const semAcao = useMemo(() => inconformidades.filter((i) => !acaoPorItem.has(i.itemId)), [inconformidades, acaoPorItem]);

  async function reabrir() {
    if (!av) return;
    if (!confirm("Reabrir esta avaliação para edição? A nota volta a ser parcial.")) return;
    await reabrirAvaliacao(av, autor);
    onVerPreenchimento();
  }

  // Cria uma TAREFA operacional DIRETO (sem modal) e amarra o id ao resultado.
  async function criarAcaoDireta(itemId: string, texto: string, obs?: string) {
    if (!av) return;
    const id = await criarTarefaOperacional({
      rid, titulo: texto, descricao: obs || "",
      origem: "avaliacao_sanitaria", origemRefId: `${av.id}:${itemId}`, origemRefLabel: texto,
      prioridade: "normal", criadoPor: autor.id, criadoPorNome: autor.nome,
    });
    const cur = av.resultado?.[itemId];
    if (cur) await salvarResultado(av.id, itemId, { ...cur, acaoId: id });
  }

  async function gerarTodas() {
    if (!av || semAcao.length === 0) return;
    setGerando(true);
    try { for (const i of semAcao) await criarAcaoDireta(i.itemId, i.texto, i.r.observacao); }
    finally { setGerando(false); }
  }

  async function exportarPdf() {
    if (!av) return;
    setExportando(true);
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const d = new jsPDF({ unit: "mm", format: "a4" });
      const M = 12;
      d.setFont("helvetica", "bold"); d.setFontSize(16); d.setTextColor(30, 30, 30);
      d.text("Segurança Sanitária — Relatório", M, 14);
      d.setFont("helvetica", "normal"); d.setFontSize(10); d.setTextColor(100, 116, 139);
      d.text(`${av.avaliadorNome || "—"}  ·  ${dmy(av.data)}`, M, 20);
      d.setFont("helvetica", "bold"); d.setFontSize(13);
      const rgb = hexToRgb(cor);
      d.setTextColor(rgb[0], rgb[1], rgb[2]);
      d.text(`Nota ${score}%  ·  ${faixaLabel}`, M, 27);
      autoTable(d, {
        startY: 32,
        head: [["Área", "Item", "Observação"]],
        body: inconformidades.map((i) => [i.area || "—", i.texto, i.r.observacao || ""]),
        theme: "grid",
        margin: { left: M, right: M },
        styles: { fontSize: 8, cellPadding: 1.6, lineWidth: 0.1, lineColor: [200, 200, 200], valign: "top", textColor: [30, 30, 30] },
        headStyles: { fillColor: [233, 226, 209], textColor: [30, 30, 30], fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 78 } },
      });
      d.save(`seguranca-${av.data}.pdf`);
    } finally { setExportando(false); }
  }

  if (!av) return <p className="text-sm text-gray-500 py-16 text-center">Carregando avaliação…</p>;

  const maxBloco = Math.max(1, ...ncPorBloco.map((x) => x.n));
  const maxArea = Math.max(1, ...ncPorArea.map((x) => x.n));

  return (
    <div className="space-y-5 pb-6">
      {/* Cabeçalho */}
      <div className="flex items-start gap-3 flex-wrap">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-sm inline-flex items-center gap-1 mt-1">
          <span className="text-base leading-none">←</span> Voltar
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">Relatório da avaliação</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{av.avaliadorNome || "—"} · {dmy(av.data)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => void exportarPdf()} disabled={exportando}>{exportando ? "Gerando…" : "⤓ PDF"}</Button>
          <Button variant="secondary" size="sm" onClick={onVerPreenchimento}>Ver preenchimento</Button>
          {podePreencher && <Button variant="secondary" size="sm" onClick={() => void reabrir()}>Reabrir</Button>}
        </div>
      </div>

      {/* Badge grande de nota */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 flex items-center gap-5">
        <div className="shrink-0 w-24 h-24 rounded-2xl flex flex-col items-center justify-center tabular-nums"
          style={{ background: `color-mix(in srgb, ${cor} 14%, transparent)`, color: cor }}>
          <span className="text-3xl font-extrabold leading-none">{score}%</span>
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold" style={{ color: cor }}>{faixaLabel}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {calc.conformes} conforme(s) · <span className="text-rose-600 dark:text-rose-400 font-semibold">{calc.naoConformes} não-conforme(s)</span> · {calc.respondidos} pontuados
          </div>
          {av.status !== "finalizada" && <div className="text-[11px] mt-1 text-amber-600 dark:text-amber-400">Rascunho — nota parcial</div>}
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Não-conformes por bloco</div>
          {ncPorBloco.length === 0 ? <p className="text-sm text-gray-400 py-2">Nenhuma inconformidade pontuável. 🎉</p> : (
            <div className="space-y-2">
              {ncPorBloco.map((x) => (
                <div key={x.nome} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[12px] text-gray-600 dark:text-gray-300 truncate" title={x.nome}>{x.nome}</span>
                  <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded bg-rose-500/80" style={{ width: `${(x.n / maxBloco) * 100}%` }} />
                  </div>
                  <span className="w-6 shrink-0 text-right text-[12px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">{x.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Não-conformes por área</div>
          {ncPorArea.length === 0 ? <p className="text-sm text-gray-400 py-2">Nenhuma inconformidade. 🎉</p> : (
            <div className="space-y-2">
              {ncPorArea.map((x) => (
                <div key={x.area} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[12px] text-gray-600 dark:text-gray-300 truncate">{x.area}</span>
                  <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${(x.n / maxArea) * 100}%`, background: segAreaCor(x.area).dot }} />
                  </div>
                  <span className="w-6 shrink-0 text-right text-[12px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">{x.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Inconformidades + plano de ação */}
      <section>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Inconformidades ({inconformidades.length})
          </div>
          {podeResolver && semAcao.length > 0 && (
            <Button size="sm" onClick={() => void gerarTodas()} disabled={gerando}>
              {gerando ? "Gerando…" : `🎯 Gerar ações (${semAcao.length})`}
            </Button>
          )}
        </div>
        {inconformidades.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Nenhuma inconformidade nesta avaliação. 🎉</p>}
        <div className="space-y-2.5">
          {inconformidades.map((i) => (
            <div key={i.itemId} className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 p-3.5">
              <div className="flex items-start gap-2 flex-wrap">
                <AreaChip area={i.area} />
                <span className="text-[11px] text-gray-400 dark:text-gray-500">{i.blocoNome}</span>
              </div>
              <div className="text-[15px] leading-snug text-gray-900 dark:text-gray-100 mt-1.5">{i.texto}</div>
              {i.r.observacao && <div className="text-[13px] text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">{i.r.observacao}</div>}
              {(i.r.fotos?.length || 0) > 0 && (
                <div className="mt-2">
                  <SegurancaFotos disabled fotos={i.r.fotos || []} pastaLabel="" onChange={() => {}} />
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-rose-200/60 dark:border-rose-900/40">
                {acaoPorItem.has(i.itemId)
                  ? <AcaoAcompanhamento acao={acaoPorItem.get(i.itemId)!} autor={autor} pessoas={pessoas} podeResolver={podeResolver} podeTransferir={podeTransferir} />
                  : podeResolver
                    ? <button type="button" onClick={() => setCriarPara(i.itemId)} className="text-[13px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline">🎯 Virar ação</button>
                    : <span className="text-[12px] text-gray-400">Sem ação vinculada.</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {criarPara && (() => {
        const inc = inconformidades.find((x) => x.itemId === criarPara);
        if (!inc) return null;
        return (
          <VirarAcaoModal
            rid={rid} meId={autor.id} meNome={autor.nome}
            origem={{ tipo: "avaliacao_sanitaria", refId: `${av.id}:${inc.itemId}`, label: inc.texto }}
            tituloInicial={inc.texto} descricaoInicial={inc.r.observacao}
            destino="tarefa"
            onClose={() => setCriarPara(null)}
            onCriada={async (acao) => {
              const cur = av.resultado?.[inc.itemId];
              if (cur) await salvarResultado(av.id, inc.itemId, { ...cur, acaoId: acao.id });
            }}
          />
        );
      })()}
    </div>
  );
}

// ── Acompanhamento de uma ação vinculada ──────────────────────────────────────
function AcaoAcompanhamento({ acao, autor, pessoas, podeResolver, podeTransferir }: {
  acao: Tarefa;
  autor: { id: string; nome: string };
  pessoas: Pessoa[];
  podeResolver: boolean;
  podeTransferir: boolean;
}) {
  const [prazoOpen, setPrazoOpen] = useState(false);
  const [prazoBr, setPrazoBr] = useState(dmy(acao.prazo));
  const [transfOpen, setTransfOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pessoasOrd = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);

  async function patch(p: Partial<Tarefa>, logAcao: "status_mudou" | "responsavel_mudou" | "editada", texto: string) {
    setBusy(true);
    try { await atualizarTarefa(acao.id, p, autor, { acao: logAcao, detalhe: texto }); }
    finally { setBusy(false); }
  }

  const resolver = () => patch({ status: "concluida" }, "status_mudou", "Concluída");
  const salvarPrazo = () => {
    const ymd = brToYmd(prazoBr);
    if (!ymd) { alert("Data inválida (use dd/mm/aaaa)."); return; }
    void patch({ prazo: ymd }, "editada", `Novo prazo: ${dmy(ymd)}`).then(() => setPrazoOpen(false));
  };
  const transferir = (pid: string) => {
    const nome = pessoasOrd.find((p) => p.id === pid)?.nome || "";
    void patch({ responsavelId: pid || "", responsavelNome: nome }, "responsavel_mudou", `Responsável: ${nome || "—"}`).then(() => setTransfOpen(false));
  };
  const solicitar = () => {
    const t = prompt("Descreva a solicitação (compra, serviço, etc.):");
    if (!t?.trim()) return;
    void patch({ status: "em_andamento" }, "status_mudou", `Solicitação: ${t.trim()}`);
  };

  const concluida = acao.status === "concluida";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_PILL[acao.status]}`}>{TAREFA_STATUS_LABEL[acao.status]}</span>
        <span className="text-gray-500 dark:text-gray-400">{acao.responsavelNome || "sem responsável"}</span>
        {acao.prazo && <span className="text-gray-500 dark:text-gray-400 tabular-nums">📅 {dmy(acao.prazo)}</span>}
      </div>
      {!concluida && (podeResolver || podeTransferir) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {podeResolver && <button type="button" disabled={busy} onClick={() => void resolver()} className="text-[12px] px-2 py-1 rounded-md border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30">✓ Resolver</button>}
          {podeResolver && <button type="button" disabled={busy} onClick={() => setPrazoOpen((o) => !o)} className="text-[12px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">📅 Novo prazo</button>}
          {podeTransferir && <button type="button" disabled={busy} onClick={() => setTransfOpen((o) => !o)} className="text-[12px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">↔ Transferir</button>}
          {podeResolver && <button type="button" disabled={busy} onClick={solicitar} className="text-[12px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">🛒 Solicitação</button>}
        </div>
      )}
      {prazoOpen && !concluida && (
        <div className="flex items-center gap-2">
          <div className="w-44"><DatePickerBR value={prazoBr} onChange={setPrazoBr} /></div>
          <Button size="sm" onClick={salvarPrazo} disabled={busy}>Salvar</Button>
        </div>
      )}
      {transfOpen && !concluida && (
        <select autoFocus value={acao.responsavelId || ""} onChange={(e) => transferir(e.target.value)} disabled={busy}
          className="h-8 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-[13px] dark:text-gray-100 max-w-xs">
          <option value="">— sem responsável —</option>
          {pessoasOrd.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
    </div>
  );
}

function AreaChip({ area }: { area?: string }) {
  if (!area) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400">sem área</span>;
  const c = segAreaCor(area);
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.fg}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />{area}
    </span>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const v = parseInt(n, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
