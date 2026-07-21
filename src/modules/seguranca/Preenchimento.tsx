// Preenchimento da avaliação. Renderiza DENTRO da área de conteúdo (o shell —
// menu/header — continua visível, como todo módulo). Responsivo: no celular os
// alvos de toque ficam confortáveis; no desktop a largura é limitada. Grava
// item-a-item ao vivo (retoma de onde parou).
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import type { Area, SegurancaAvaliacao, SegurancaItem, SegurancaResposta } from "../../core/types";
import { AREAS, AREA_SLUG, segKey, segurancaFaixaDe } from "../../core/types";
import {
  ouvirAvaliacao, salvarResultado, limparResultado, calcularScore, finalizarAvaliacao,
} from "./repository";
import { SegurancaFotos } from "./SegurancaFotos";

const dmy = (ymd: string) => (ymd || "").split("-").reverse().join("/");

export function Preenchimento({ avaliacaoId, autor, onClose }: {
  avaliacaoId: string;
  autor: { id: string; nome: string };
  onClose: () => void;
}) {
  const [av, setAv] = useState<SegurancaAvaliacao | null>(null);
  const [area, setArea] = useState<Area>("Cozinha");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => ouvirAvaliacao(avaliacaoId, setAv), [avaliacaoId]);

  const rid = av?.restaurantId || "";
  const itens = av?.itensSnapshot || [];
  const blocos = (av?.blocosSnapshot || []).slice().sort((a, b) => a.ordem - b.ordem);
  const readOnly = av?.status === "finalizada";

  const ncPorArea = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [key, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const slug = key.slice(0, key.indexOf("__"));
      m[slug] = (m[slug] || 0) + 1;
    }
    return m;
  }, [av?.resultado]);

  const resumo = useMemo(() => calcularScore(av?.resultado || {}, itens), [av?.resultado, itens]);
  const faixa = segurancaFaixaDe(resumo.score, av?.faixasSnapshot || []);

  const porBloco = useMemo(() => {
    const daArea = itens.filter((i) => i.areas.includes(area)).sort((a, b) => a.ordem - b.ordem);
    return blocos
      .map((b) => ({ bloco: b, itens: daArea.filter((i) => i.blocoId === b.id) }))
      .filter((g) => g.itens.length > 0);
  }, [itens, blocos, area]);

  function marcar(item: SegurancaItem, resposta: SegurancaResposta) {
    if (!av || readOnly) return;
    const key = segKey(area, item.id);
    const cur = av.resultado?.[key];
    if (cur?.resposta === resposta) { void limparResultado(av.id, key); return; }
    void salvarResultado(av.id, key, {
      resposta,
      observacao: cur?.observacao,
      fotos: cur?.fotos,
      acaoId: cur?.acaoId ?? null,
      marcadoEm: new Date().toISOString(),
      marcadoPorId: autor.id,
      marcadoPorNome: autor.nome,
    });
  }

  async function finalizar() {
    if (!av) return;
    if (resumo.respondidos === 0) { alert("Responda pelo menos um item antes de finalizar."); return; }
    setSalvando(true);
    try { await finalizarAvaliacao(av, autor); onClose(); }
    finally { setSalvando(false); }
  }

  if (!av) return <p className="text-sm text-gray-500 py-16 text-center">Carregando avaliação…</p>;

  return (
    <div className="space-y-4 pb-4">
      {/* Toolbar: voltar + título + status */}
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-sm inline-flex items-center gap-1">
          <span className="text-base leading-none">←</span> Voltar
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
            {readOnly ? "Avaliação finalizada" : "Avaliação em andamento"}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{av.avaliadorNome || "—"} · {dmy(av.data)}</p>
        </div>
        {readOnly && faixa && (
          <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums" style={{ background: `color-mix(in srgb, ${faixa.cor} 14%, transparent)`, color: faixa.cor }}>
            {av.score}% · {av.faixaLabel}
          </span>
        )}
      </div>

      {/* Chips de área + progresso */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
        <div className="flex gap-2 overflow-x-auto">
          {AREAS.map((a) => {
            const nc = ncPorArea[AREA_SLUG[a]] || 0;
            const on = area === a;
            return (
              <button key={a} type="button" onClick={() => setArea(a)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors ${on ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                {a}{nc > 0 && <span className={`ml-1.5 text-[11px] ${on ? "opacity-90" : "text-rose-600 dark:text-rose-400"}`}>{nc}⚠</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="tabular-nums shrink-0">{resumo.respondidos} respondidos</span>
          <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${resumo.score}%`, background: faixa?.cor || "#4f46e5" }} />
          </div>
          <span className="tabular-nums font-semibold shrink-0" style={{ color: faixa?.cor || "inherit" }}>{resumo.score}%</span>
        </div>
      </div>

      {/* Itens */}
      {porBloco.length === 0 && <p className="text-sm text-gray-400 text-center py-12">Nenhum item nesta área.</p>}
      {porBloco.map(({ bloco, itens: its }) => (
        <div key={bloco.id}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-0.5">{bloco.nome}</div>
          <div className="space-y-2">
            {its.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                rid={rid}
                readOnly={readOnly}
                resultado={av.resultado?.[segKey(area, item.id)]}
                onMarcar={(resp) => marcar(item, resp)}
                onObs={(txt) => {
                  const key = segKey(area, item.id); const cur = av.resultado?.[key];
                  if (cur) void salvarResultado(av.id, key, { ...cur, observacao: txt || undefined });
                }}
                onFotos={(fotos) => {
                  const key = segKey(area, item.id); const cur = av.resultado?.[key];
                  if (cur) void salvarResultado(av.id, key, { ...cur, fotos: fotos.length ? fotos : undefined });
                }}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Barra de ação (flutua no rodapé, sem cobrir o shell) */}
      <div className="sticky bottom-3 z-10 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-lg px-4 py-2.5 flex items-center gap-3">
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight shrink-0">
          Nota parcial<br /><b className="text-lg text-gray-900 dark:text-gray-100 tabular-nums">{resumo.score}%</b>
        </div>
        {readOnly
          ? <Button variant="secondary" onClick={onClose} className="flex-1">Fechar</Button>
          : <Button onClick={() => void finalizar()} disabled={salvando} className="flex-1">{salvando ? "Finalizando…" : "Finalizar avaliação"}</Button>}
      </div>
    </div>
  );
}

// ── Card de um item ──
function ItemCard({ item, rid, readOnly, resultado, onMarcar, onObs, onFotos }: {
  item: SegurancaItem;
  rid: string;
  readOnly: boolean;
  resultado?: { resposta: SegurancaResposta; observacao?: string; fotos?: string[] };
  onMarcar: (r: SegurancaResposta) => void;
  onObs: (txt: string) => void;
  onFotos: (fotos: string[]) => void;
}) {
  const resp = resultado?.resposta;
  const nc = resp === "nao_conforme";
  const [obs, setObs] = useState(resultado?.observacao || "");
  useEffect(() => { setObs(resultado?.observacao || ""); }, [resultado?.observacao]);

  const btnBase = "py-2.5 rounded-lg text-[13.5px] font-semibold flex items-center justify-center gap-1.5 border transition-colors disabled:opacity-60";

  return (
    <div className={`rounded-xl border p-3.5 ${nc ? "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
      <div className="text-[15px] leading-snug text-gray-900 dark:text-gray-100 mb-3">
        {item.texto}
        {!item.pontua && <span className="text-gray-400 text-[12px]"> (sem pontuação)</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 max-w-md">
        <button type="button" disabled={readOnly} onClick={() => onMarcar("conforme")}
          className={`${btnBase} ${resp === "conforme" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:border-emerald-400"}`}>
          <span className="text-[15px]">✓</span> Conforme
        </button>
        <button type="button" disabled={readOnly} onClick={() => onMarcar("nao_conforme")}
          className={`${btnBase} ${nc ? "bg-rose-600 border-rose-600 text-white" : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:border-rose-400"}`}>
          <span className="text-[15px]">✕</span> Não conforme
        </button>
      </div>
      {nc && (
        <div className="mt-3 space-y-2.5">
          <textarea
            value={obs} onChange={(e) => setObs(e.target.value)} onBlur={() => onObs(obs)}
            disabled={readOnly} rows={2} placeholder="O que foi observado…"
            className="w-full text-[15px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100" />
          <SegurancaFotos rid={rid} urls={resultado?.fotos || []} onChange={onFotos} disabled={readOnly} />
        </div>
      )}
    </div>
  );
}
