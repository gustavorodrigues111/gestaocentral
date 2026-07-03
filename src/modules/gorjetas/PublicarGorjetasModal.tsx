import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { parseYmd, pad2, dowShort, fmtBR as fmtDataBR } from "../../core/utils/date";
import type {
  Cargo, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade,
} from "../../core/types";
import { publicarGorjeta } from "./publicar";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  onClose: () => void;
  gorjetas: Gorjeta[];               // gorjetas do mês visualizado
  empregados: Empregado[];
  cargos: Cargo[];
  escala: EscalaMes | null;
  splitVersions: SplitVersion[];
  unidades: Unidade[];
  usaMultiUnidades: boolean;
  meId: string;
  meNome: string;
};

export function PublicarGorjetasModal({
  onClose, gorjetas, empregados, cargos, escala, splitVersions, unidades,
  usaMultiUnidades, meId, meNome,
}: Props) {
  // Candidatos: gorjetas com valor > 0 ainda não publicadas (e não semGorjeta)
  const candidatos = useMemo(() => {
    return gorjetas
      .filter(g => !g.publicada && !g.semGorjeta && g.valorBruto > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.unidadeId || "").localeCompare(b.unidadeId || ""));
  }, [gorjetas]);

  const [sel, setSel] = useState<Set<string>>(() => new Set(candidatos.map(g => g.id)));
  const [confirmacao, setConfirmacao] = useState(false);
  const [working, setWorking] = useState<{ feitos: number; total: number } | null>(null);
  const [erros, setErros] = useState<{ gorjetaId: string; date: string; msg: string }[]>([]);

  const todosSelecionados = sel.size === candidatos.length && candidatos.length > 0;
  const algunsSelecionados = sel.size > 0 && sel.size < candidatos.length;
  const totalBrutoSelecionado = candidatos
    .filter(g => sel.has(g.id))
    .reduce((s, g) => s + g.valorBruto, 0);

  function toggleAll() {
    if (todosSelecionados) setSel(new Set());
    else setSel(new Set(candidatos.map(g => g.id)));
  }
  function toggle(id: string) {
    setSel(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function executar() {
    if (sel.size === 0) return;
    const lista = candidatos.filter(g => sel.has(g.id));
    setWorking({ feitos: 0, total: lista.length });
    setErros([]);
    const errosLocal: typeof erros = [];
    for (let i = 0; i < lista.length; i++) {
      const g = lista[i];
      try {
        await publicarGorjeta({
          gorjeta: g,
          empregados, cargos, escala, splitVersions, unidades,
          publicadoPorId: meId,
          publicadoPorNome: meNome,
        });
      } catch (e) {
        errosLocal.push({
          gorjetaId: g.id,
          date: g.date,
          msg: e instanceof Error ? e.message : "Erro desconhecido",
        });
      }
      setWorking({ feitos: i + 1, total: lista.length });
    }
    setErros(errosLocal);
    if (errosLocal.length === 0) {
      // Sucesso total → fecha
      setTimeout(() => onClose(), 800);
    }
  }

  // ── Tela de confirmação (passo 2) ──
  if (confirmacao && !working) {
    const lista = candidatos.filter(g => sel.has(g.id));
    return (
      <Modal title="⚠ Confirmar publicação" onClose={onClose} maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              A escala destes dias foi conferida?
            </p>
            <p className="text-amber-800 dark:text-amber-300 mt-1 text-[13px]">
              O cálculo da divisão vai ser feito agora <strong>em cima da escala
              que está gravada</strong> e <strong>congelado</strong>. Edições posteriores
              na escala desses dias <strong>não vão recalcular</strong> a divisão das
              gorjetas. Pra forçar recálculo, é só despublicar e publicar de novo.
            </p>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Vai publicar <strong>{lista.length} gorjeta(s)</strong>, totalizando{" "}
            <strong>{fmtBR(totalBrutoSelecionado)}</strong> em valor bruto.
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={() => setConfirmacao(false)}>← Voltar</Button>
            <Button onClick={executar}>📢 Publicar agora</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Tela de progresso / resultado ──
  if (working) {
    const pct = working.total > 0 ? Math.round((working.feitos / working.total) * 100) : 0;
    const terminou = working.feitos === working.total;
    return (
      <Modal title={terminou ? (erros.length ? "Concluído com erros" : "✓ Publicado") : "Publicando..."} onClose={terminou ? onClose : () => { /* não fecha durante */ }} maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            {working.feitos} / {working.total} gorjeta(s) processadas
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          {erros.length > 0 && (
            <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm">
              <p className="font-semibold text-rose-800 dark:text-rose-200 mb-1">
                {erros.length} erro(s):
              </p>
              <ul className="text-[12px] text-rose-700 dark:text-rose-300 list-disc pl-5 space-y-0.5">
                {erros.map((e, i) => (
                  <li key={i}>{fmtDataBR(e.date)}: {e.msg}</li>
                ))}
              </ul>
            </div>
          )}
          {terminou && (
            <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
              <Button onClick={onClose}>Fechar</Button>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  // ── Tela de seleção (passo 1) ──
  return (
    <Modal title="📢 Publicar gorjetas" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {candidatos.length === 0 ? (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-6 text-center">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Não há gorjetas pendentes de publicação neste mês.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Lance valor nos dias primeiro — depois publica em lote por aqui.
            </p>
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Selecione os dias pra publicar. Pra cada um, vou rodar o cálculo
              da divisão em cima da escala atual e congelar pro empregado ver.
            </div>

            {/* Header de seleção em massa */}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={todosSelecionados}
                  ref={el => { if (el) el.indeterminate = algunsSelecionados; }}
                  onChange={toggleAll}
                  className="accent-indigo-600"
                />
                <span className="font-medium">
                  {sel.size} de {candidatos.length} selecionada(s)
                </span>
              </label>
              <span className="text-xs text-gray-600 dark:text-gray-400 tabular-nums">
                Bruto: {fmtBR(totalBrutoSelecionado)}
              </span>
            </div>

            {/* Lista */}
            <div className="max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              {candidatos.map(g => {
                const d = parseYmd(g.date);
                const wd = d.getDay();
                const weekend = wd === 0 || wd === 6;
                const u = g.unidadeId ? unidades.find(x => x.id === g.unidadeId) : null;
                const checked = sel.has(g.id);
                return (
                  <label
                    key={g.id}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 ${weekend ? "bg-amber-50/30 dark:bg-amber-900/10" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(g.id)}
                      className="accent-indigo-600 shrink-0"
                    />
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="font-bold tabular-nums w-12 shrink-0">{pad2(d.getDate())}/{pad2(d.getMonth() + 1)}</span>
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 w-8 shrink-0">{dowShort(d)}</span>
                      {usaMultiUnidades && u && (
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 shrink-0">
                          {u.nome}
                        </span>
                      )}
                    </div>
                    <span className="font-bold tabular-nums text-gray-900 dark:text-gray-100 shrink-0">
                      {fmtBR(g.valorBruto)}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {candidatos.length > 0 && (
            <Button onClick={() => setConfirmacao(true)} disabled={sel.size === 0}>
              Avançar →
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
