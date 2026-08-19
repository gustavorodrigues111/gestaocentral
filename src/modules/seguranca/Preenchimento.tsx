// Preenchimento da avaliação. Renderiza DENTRO da área de conteúdo (shell
// intacto). UMA pergunta pode valer pra VÁRIAS áreas — aparece uma vez e recebe
// um Conforme/Não conforme POR ÁREA. Filtro por área ("Todas" + cada área);
// filtrando, mostra só a resposta daquela área. Grava resposta-a-resposta ao
// vivo (retoma de onde parou). Responsivo (mobile-first).
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { SegurancaAvaliacao, SegurancaFoto, SegurancaItem, SegurancaResposta, SegurancaResultadoItem } from "../../core/types";
import { segAreaCor, segurancaFaixaDe, segItemAreas, segResKey, segResParse } from "../../core/types";
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
  const { activeRestaurant } = useRestaurant();
  const [av, setAv] = useState<SegurancaAvaliacao | null>(null);
  const [filtro, setFiltro] = useState<string>("todas");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => ouvirAvaliacao(avaliacaoId, setAv), [avaliacaoId]);

  const rid = activeRestaurant?.id;   // fotos vão pro Firebase Storage (seguranca/{rid}/…)
  // Nome da pasta da avaliação: "dd-mm-aaaa HHhMM" (estável pelo iniciadoEm).
  const pastaLabel = useMemo(() => {
    if (!av) return "";
    const d = new Date(av.iniciadoEm);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${dmy(av.data)} ${p(d.getHours())}h${p(d.getMinutes())}`;
  }, [av]);
  const itens = useMemo(() => av?.itensSnapshot || [], [av]);
  const blocos = (av?.blocosSnapshot || []).slice().sort((a, b) => a.ordem - b.ordem);
  const readOnly = av?.status === "finalizada";
  // Áreas: do snapshot da avaliação; fallback deriva das áreas dos itens.
  const areas = useMemo(() => (
    av?.areasSnapshot?.length ? av.areasSnapshot : Array.from(new Set(itens.flatMap(segItemAreas)))
  ), [av?.areasSnapshot, itens]);

  // Não-conformes por área (badge do chip) — lê a área da chave do resultado.
  const ncPorArea = useMemo(() => {
    const m = {} as Record<string, number>;
    for (const [key, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const a = segResParse(key).area;
      if (a) m[a] = (m[a] || 0) + 1;
    }
    return m;
  }, [av?.resultado]);

  const resumo = useMemo(() => calcularScore(av?.resultado || {}, itens), [av?.resultado, itens]);
  const faixa = segurancaFaixaDe(resumo.score, av?.faixasSnapshot || []);

  // Itens visíveis (filtro por área) agrupados por bloco.
  const porBloco = useMemo(() => {
    const vis = itens
      .filter((i) => filtro === "todas" || segItemAreas(i).includes(filtro))
      .sort((a, b) => a.ordem - b.ordem);
    return blocos
      .map((b) => ({ bloco: b, itens: vis.filter((i) => i.blocoId === b.id) }))
      .filter((g) => g.itens.length > 0);
  }, [itens, blocos, filtro]);

  function marcar(item: SegurancaItem, area: string | undefined, resposta: SegurancaResposta) {
    if (!av || readOnly) return;
    const key = segResKey(item.id, area);
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
  function patchResultado(key: string, patch: Partial<SegurancaResultadoItem>) {
    if (!av) return;
    const cur = av.resultado?.[key];
    if (cur) void salvarResultado(av.id, key, { ...cur, ...patch });
  }

  async function finalizar() {
    if (!av) return;
    if (resumo.respondidos === 0) { alert("Responda pelo menos um item antes de finalizar."); return; }
    setSalvando(true);
    try { await finalizarAvaliacao(av, autor); onClose(); }
    finally { setSalvando(false); }
  }

  if (!av) return <p className="text-sm text-gray-500 py-16 text-center">Carregando avaliação…</p>;

  const chips: string[] = ["todas", ...areas];

  return (
    <div className="space-y-4 pb-4">
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

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
        <div className="flex gap-2 overflow-x-auto">
          {chips.map((c) => {
            const on = filtro === c;
            const nc = c === "todas" ? 0 : (ncPorArea[c] || 0);
            return (
              <button key={c} type="button" onClick={() => setFiltro(c)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors ${on ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                {c === "todas" ? "Todas" : c}{nc > 0 && <span className={`ml-1.5 text-[11px] ${on ? "opacity-90" : "text-rose-600 dark:text-rose-400"}`}>{nc}⚠</span>}
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

      {porBloco.length === 0 && <p className="text-sm text-gray-400 text-center py-12">Nenhum item {filtro === "todas" ? "no checklist" : `na área ${filtro}`}.</p>}
      {porBloco.map(({ bloco, itens: its }) => (
        <div key={bloco.id}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-0.5">{bloco.nome}</div>
          <div className="space-y-2">
            {its.map((item) => {
              const todas = segItemAreas(item);
              const areasToShow: (string | undefined)[] = filtro === "todas" ? (todas.length ? todas : [undefined]) : [filtro];
              return (
                <ItemCard
                  key={item.id}
                  item={item}
                  areasToShow={areasToShow}
                  rid={rid}
                  pastaLabel={pastaLabel}
                  readOnly={readOnly}
                  resultadoDe={(area) => av.resultado?.[segResKey(item.id, area)]}
                  onMarcar={(area, resp) => marcar(item, area, resp)}
                  onObs={(area, txt) => patchResultado(segResKey(item.id, area), { observacao: txt || undefined })}
                  onFotos={(area, fotos) => patchResultado(segResKey(item.id, area), { fotos: fotos.length ? fotos : undefined })}
                />
              );
            })}
          </div>
        </div>
      ))}

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

// ── Card de uma pergunta (com 1 linha de resposta por área) ──
function ItemCard({ item, areasToShow, rid, pastaLabel, readOnly, resultadoDe, onMarcar, onObs, onFotos }: {
  item: SegurancaItem;
  areasToShow: (string | undefined)[];
  rid?: string;
  pastaLabel: string;
  readOnly: boolean;
  resultadoDe: (area: string | undefined) => SegurancaResultadoItem | undefined;
  onMarcar: (area: string | undefined, r: SegurancaResposta) => void;
  onObs: (area: string | undefined, txt: string) => void;
  onFotos: (area: string | undefined, fotos: SegurancaFoto[]) => void;
}) {
  const algumNc = areasToShow.some((a) => resultadoDe(a)?.resposta === "nao_conforme");
  return (
    <div className={`rounded-xl border p-3.5 ${algumNc ? "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
      <div className="text-[15px] leading-snug text-gray-900 dark:text-gray-100 mb-3">
        {item.texto}
        {!item.pontua && <span className="text-gray-400 text-[12px]"> (sem pontuação)</span>}
      </div>
      <div className="space-y-3">
        {areasToShow.map((area) => (
          <AreaAnswer
            key={area || "_"}
            area={area}
            multi={areasToShow.length > 1}
            readOnly={readOnly}
            rid={rid}
            pastaLabel={pastaLabel}
            resultado={resultadoDe(area)}
            onMarcar={(r) => onMarcar(area, r)}
            onObs={(txt) => onObs(area, txt)}
            onFotos={(fotos) => onFotos(area, fotos)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Uma resposta (Conforme/Não conforme) de uma área ──
function AreaAnswer({ area, multi, readOnly, rid, pastaLabel, resultado, onMarcar, onObs, onFotos }: {
  area?: string;
  multi: boolean;
  readOnly: boolean;
  rid?: string;
  pastaLabel: string;
  resultado?: SegurancaResultadoItem;
  onMarcar: (r: SegurancaResposta) => void;
  onObs: (txt: string) => void;
  onFotos: (fotos: SegurancaFoto[]) => void;
}) {
  const resp = resultado?.resposta;
  const nc = resp === "nao_conforme";
  const [obs, setObs] = useState(resultado?.observacao || "");
  useEffect(() => { setObs(resultado?.observacao || ""); }, [resultado?.observacao]);

  const btnBase = "py-2 rounded-lg text-[13.5px] font-semibold flex items-center justify-center gap-1.5 border transition-colors disabled:opacity-60";
  const c = multi && area ? segAreaCor(area) : null;

  return (
    <div
      className={multi ? `rounded-lg border p-2.5 ${c ? c.bg : "bg-gray-50/50 dark:bg-gray-800/20 border-gray-200 dark:border-gray-800"}` : ""}
      style={c ? { borderColor: `color-mix(in srgb, ${c.dot} 35%, transparent)` } : undefined}>
      {multi && area && (
        <div className="mb-2.5 text-center text-[13px] font-extrabold uppercase tracking-wider inline-flex items-center justify-center gap-1.5 w-full" style={{ color: c!.dot }}>
          <span className="w-2 h-2 rounded-full" style={{ background: c!.dot }} />{area}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
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
          <SegurancaFotos rid={rid} pastaLabel={pastaLabel} fotos={resultado?.fotos || []} onChange={onFotos} disabled={readOnly} />
        </div>
      )}
    </div>
  );
}
