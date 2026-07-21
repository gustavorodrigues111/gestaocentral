// Preenchimento da avaliação — MOBILE-FIRST. É a tela que a nutricionista usa
// andando pela operação: chips de área, itens Conforme/Não conforme com alvos
// de toque grandes, foto pela câmera e observação nos não-conformes. Grava
// item-a-item ao vivo (retoma de onde parou).
import { useEffect, useMemo, useState } from "react";
import type { Area, SegurancaAvaliacao, SegurancaItem, SegurancaResposta } from "../../core/types";
import { AREAS, AREA_SLUG, segKey, segurancaFaixaDe } from "../../core/types";
import {
  ouvirAvaliacao, salvarResultado, limparResultado, calcularScore, finalizarAvaliacao,
} from "./repository";
import { SegurancaFotos } from "./SegurancaFotos";

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

  // Nº de não-conformes por área (pro badge do chip).
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

  // Itens da área selecionada, agrupados por bloco.
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
    if (cur?.resposta === resposta) { void limparResultado(av.id, key); return; } // toca de novo = desmarca
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

  if (!av) {
    return (
      <div className="fixed inset-0 z-50 bg-white dark:bg-gray-950 flex items-center justify-center text-sm text-gray-500">
        Carregando avaliação…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Cabeçalho fixo */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-teal-600 text-white grid place-items-center text-lg shrink-0">🧪</div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
              {readOnly ? "Avaliação finalizada" : "Avaliação em andamento"}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {av.avaliadorNome || "—"} · {av.data.split("-").reverse().join("/")}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>
        {/* Chips de área (scroll horizontal) */}
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto">
          {AREAS.map((a) => {
            const nc = ncPorArea[AREA_SLUG[a]] || 0;
            const on = area === a;
            return (
              <button key={a} type="button" onClick={() => setArea(a)}
                className={`shrink-0 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${on ? "bg-teal-600 border-teal-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                {a}{nc > 0 && <span className={`ml-1.5 text-[11px] ${on ? "opacity-90" : "text-rose-600 dark:text-rose-400"}`}>{nc}⚠</span>}
              </button>
            );
          })}
        </div>
        {/* Barra de progresso + nota parcial */}
        <div className="px-4 pb-2.5 flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="tabular-nums">{resumo.respondidos} respondidos</span>
          <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${resumo.score}%`, background: faixa?.cor || "#0f766e" }} />
          </div>
          <span className="tabular-nums font-semibold" style={{ color: faixa?.cor || "inherit" }}>{resumo.score}%</span>
        </div>
      </div>

      {/* Corpo scrollável */}
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-28">
        {porBloco.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-16">Nenhum item nesta área.</p>
        )}
        {porBloco.map(({ bloco, itens: its }) => (
          <div key={bloco.id} className="mt-4 first:mt-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-0.5">{bloco.nome}</div>
            <div className="space-y-2.5">
              {its.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  rid={rid}
                  readOnly={readOnly}
                  resultado={av.resultado?.[segKey(area, item.id)]}
                  onMarcar={(resp) => marcar(item, resp)}
                  onObs={(txt) => {
                    const key = segKey(area, item.id);
                    const cur = av.resultado?.[key];
                    if (!cur) return;
                    void salvarResultado(av.id, key, { ...cur, observacao: txt || undefined });
                  }}
                  onFotos={(fotos) => {
                    const key = segKey(area, item.id);
                    const cur = av.resultado?.[key];
                    if (!cur) return;
                    void salvarResultado(av.id, key, { ...cur, fotos: fotos.length ? fotos : undefined });
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Rodapé fixo */}
      <div className="absolute inset-x-0 bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
          Nota parcial<br /><b className="text-xl text-gray-900 dark:text-gray-100 tabular-nums">{resumo.score}%</b>
        </div>
        {readOnly ? (
          <button onClick={onClose} className="flex-1 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold text-[15px] py-3.5 rounded-2xl">Fechar</button>
        ) : (
          <button onClick={() => void finalizar()} disabled={salvando}
            className="flex-1 bg-teal-600 text-white font-semibold text-[15px] py-3.5 rounded-2xl disabled:opacity-60 active:scale-[.99] transition-transform">
            {salvando ? "Finalizando…" : "Finalizar avaliação"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Card de um item (mantém o texto da observação em estado local) ──
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

  return (
    <div className={`rounded-2xl border p-3.5 ${nc ? "border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
      <div className="text-[14px] leading-snug text-gray-900 dark:text-gray-100 mb-2.5">
        {item.texto}
        {!item.pontua && <span className="text-gray-400 text-[12px]"> (sem pontuação)</span>}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" disabled={readOnly} onClick={() => onMarcar("conforme")}
          className={`py-3 rounded-xl text-[14px] font-bold flex items-center justify-center gap-1.5 border transition-colors ${resp === "conforme" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300"} disabled:opacity-60`}>
          <span className="text-base">✓</span> Conforme
        </button>
        <button type="button" disabled={readOnly} onClick={() => onMarcar("nao_conforme")}
          className={`py-3 rounded-xl text-[14px] font-bold flex items-center justify-center gap-1.5 border transition-colors ${nc ? "bg-rose-600 border-rose-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300"} disabled:opacity-60`}>
          <span className="text-base">✕</span> Não conf.
        </button>
      </div>
      {nc && (
        <div className="mt-3 space-y-2.5">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            onBlur={() => onObs(obs)}
            disabled={readOnly}
            rows={2}
            placeholder="O que foi observado…"
            className="w-full text-[14px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-gray-900 dark:text-gray-100"
          />
          <SegurancaFotos rid={rid} urls={resultado?.fotos || []} onChange={onFotos} disabled={readOnly} />
        </div>
      )}
    </div>
  );
}
