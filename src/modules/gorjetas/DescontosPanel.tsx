import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { DescontoCalc, GorjetaDesconto } from "./descontos";
import { fimDoMes } from "./descontos";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  restaurantId: string;
  competencia: string;                // YYYY-MM
  areas: string[];                    // áreas presentes na divisão
  descontosCalc: DescontoCalc[];      // já calculados (valor + detalhe)
  criadoPor: { id: string; nome: string };
  podeEditar: boolean;
};

export function DescontosPanel({ restaurantId, competencia, areas, descontosCalc, criadoPor, podeEditar }: Props) {
  const [novo, setNovo] = useState(false);
  const total = useMemo(() => descontosCalc.reduce((s, d) => s + d.valor, 0), [descontosCalc]);

  async function remover(id: string) {
    if (!confirm("Remover este desconto? A divisão volta ao valor cheio.")) return;
    await deleteDoc(doc(db, "gorjetaDescontos", id));
  }

  if (!podeEditar && descontosCalc.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 mb-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          ➖ Descontos da gorjeta {descontosCalc.length > 0 && <span className="text-rose-600 dark:text-rose-400 tabular-nums">· −{fmtBR(total)}</span>}
        </div>
        {podeEditar && <Button size="sm" variant="secondary" onClick={() => setNovo(true)}>＋ Adicionar desconto</Button>}
      </div>
      {descontosCalc.length > 0 && (
        <div className="mt-2 space-y-1">
          {descontosCalc.map(dc => (
            <div key={dc.desconto.id} className="flex items-center gap-2 text-[12.5px] text-gray-600 dark:text-gray-300 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wide bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{dc.desconto.area}</span>
              <span className="truncate">{dc.desconto.descricao || (dc.desconto.tipo === "percFreelas" ? `${dc.desconto.perc}% dos freelas` : "Desconto")}</span>
              {dc.desconto.tipo === "percFreelas" && <span className="text-gray-400">({dc.desconto.perc}% de {fmtBR(dc.valorBase)} em freelas)</span>}
              <span className="text-rose-600 dark:text-rose-400 font-semibold tabular-nums ml-auto">−{fmtBR(dc.valor)}</span>
              {podeEditar && <button type="button" onClick={() => void remover(dc.desconto.id)} className="text-rose-500 hover:text-rose-600 text-xs">✕</button>}
            </div>
          ))}
        </div>
      )}
      {novo && (
        <NovoDescontoModal restaurantId={restaurantId} competencia={competencia} areas={areas} criadoPor={criadoPor} onClose={() => setNovo(false)} />
      )}
    </div>
  );
}

function NovoDescontoModal({ restaurantId, competencia, areas, criadoPor, onClose }: {
  restaurantId: string; competencia: string; areas: string[]; criadoPor: { id: string; nome: string }; onClose: () => void;
}) {
  const [area, setArea] = useState(areas[0] || "");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<"percFreelas" | "valor">("percFreelas");
  const [perc, setPerc] = useState("50");
  const [valorFixo, setValorFixo] = useState("");
  const [periodoDe, setPeriodoDe] = useState(`${competencia}-01`);
  const [periodoAte, setPeriodoAte] = useState(fimDoMes(competencia));
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const lbl = "text-xs font-semibold text-gray-600 dark:text-gray-400";

  async function salvar() {
    if (!area) { setErr("Escolha a área."); return; }
    if (tipo === "percFreelas" && !(Number(perc) > 0)) { setErr("Informe o percentual."); return; }
    if (tipo === "valor" && !(Number(valorFixo.replace(",", ".")) > 0)) { setErr("Informe o valor."); return; }
    setErr(""); setSalvando(true);
    try {
      const d: Omit<GorjetaDesconto, "id"> = {
        restaurantId, competencia, area, descricao: descricao.trim(),
        tipo,
        ...(tipo === "percFreelas" ? { perc: Number(perc), periodoDe, periodoAte } : { valorFixo: Number(valorFixo.replace(/[^\d,.-]/g, "").replace(",", ".")) }),
        criadoEm: new Date().toISOString(), criadoPor,
      };
      await addDoc(collection(db, "gorjetaDescontos"), sanitizeForFirestore(d));
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao salvar."); setSalvando(false); }
  }

  return (
    <Modal title="Adicionar desconto da gorjeta" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="flex flex-col gap-1"><label className={lbl}>Área</label>
          <select value={area} onChange={e => setArea(e.target.value)} className={inp}>
            {areas.length === 0 && <option value="">— sem áreas —</option>}
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1"><label className={lbl}>Descrição (motivo — aparece na linha)</label>
          <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="ex: 50% dos freelas de salão de agosto" className={inp} />
        </div>
        <div className="flex gap-2">
          <label className={`flex-1 flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm ${tipo === "percFreelas" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-gray-300 dark:border-gray-700"}`}>
            <input type="radio" checked={tipo === "percFreelas"} onChange={() => setTipo("percFreelas")} /> % dos freelas
          </label>
          <label className={`flex-1 flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm ${tipo === "valor" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-gray-300 dark:border-gray-700"}`}>
            <input type="radio" checked={tipo === "valor"} onChange={() => setTipo("valor")} /> Valor fixo
          </label>
        </div>
        {tipo === "percFreelas" ? (
          <>
            <div className="flex flex-col gap-1"><label className={lbl}>Percentual da diária dos freelas da área (%)</label>
              <input type="number" min="0" max="100" value={perc} onChange={e => setPerc(e.target.value)} className={inp} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1"><label className={lbl}>Período — de</label><input type="date" value={periodoDe} onChange={e => setPeriodoDe(e.target.value)} className={inp} /></div>
              <div className="flex flex-col gap-1"><label className={lbl}>até</label><input type="date" value={periodoAte} onChange={e => setPeriodoAte(e.target.value)} className={inp} /></div>
            </div>
            <p className="text-[11px] text-gray-500">Desconta {perc || 0}% do total pago em <strong>diárias</strong> de freelas da área <strong>{area || "—"}</strong> no período. O valor sai da gorjeta dos empregados dessa área (proporcional).</p>
          </>
        ) : (
          <div className="flex flex-col gap-1"><label className={lbl}>Valor a descontar (R$)</label>
            <input value={valorFixo} onChange={e => setValorFixo(e.target.value)} placeholder="0,00" className={inp} />
          </div>
        )}
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Adicionar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
