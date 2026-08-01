// ⚠️ PROVISÓRIO — botão pra aplicar a nova escala do Lobozó (praticada 05→31/08).
// Escreve SÓ na praticada (real); a prevista fica intacta como recibo do que foi
// pago. Depois de aplicado, a aba Ajustes calcula a diferença de VT sozinha.
// REMOVER depois de usado (o painel + o import em Beneficios2Page).
import { useMemo, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { contarDiasTrabalhadosNoRange } from "../vt/calc";
import { vtDiarioDe } from "./calc";
import type { Empregado, EscalaMes, ScheduleStatus } from "../../core/types";

const DE = "2026-08-05", ATE = "2026-08-31";
const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", signDisplay: "exceptZero" });
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const ehTrab = (s?: string) => s === "trabalho" || s === "comp_trab";

// Escala nova (dias 05→31), já mapeada pros status do sistema. Gerada do PDF
// Escala_Agosto2026.pdf. Freela não conta VT; comp/ferias/folga = sem VT.
const ESCALA_0508: { nome: string; dias: Record<string, ScheduleStatus> }[] = [
  { nome: "Gabriel Henrique Xavier de Almeida", dias: { "2026-08-05": "folga", "2026-08-06": "folga", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "trabalho", "2026-08-11": "trabalho", "2026-08-12": "folga", "2026-08-13": "folga", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "trabalho", "2026-08-17": "trabalho", "2026-08-18": "trabalho", "2026-08-19": "folga", "2026-08-20": "folga", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "folga", "2026-08-24": "trabalho", "2026-08-25": "trabalho", "2026-08-26": "folga", "2026-08-27": "comp", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "trabalho", "2026-08-31": "trabalho" } },
  { nome: "Maria da Conceição Soares de Sousa Silva", dias: { "2026-08-05": "trabalho", "2026-08-06": "trabalho", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "folga", "2026-08-11": "folga", "2026-08-12": "trabalho", "2026-08-13": "trabalho", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "folga", "2026-08-17": "folga", "2026-08-18": "comp", "2026-08-19": "trabalho", "2026-08-20": "trabalho", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "folga", "2026-08-25": "folga", "2026-08-26": "trabalho", "2026-08-27": "trabalho", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "folga", "2026-08-31": "folga" } },
  { nome: "Diego Ferreira", dias: { "2026-08-05": "folga", "2026-08-06": "comp_trab", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "trabalho", "2026-08-11": "trabalho", "2026-08-12": "folga", "2026-08-13": "freela", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "trabalho", "2026-08-17": "trabalho", "2026-08-18": "trabalho", "2026-08-19": "folga", "2026-08-20": "freela", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "trabalho", "2026-08-25": "trabalho", "2026-08-26": "folga", "2026-08-27": "freela", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "folga", "2026-08-31": "trabalho" } },
  { nome: "Helio Gomes dos Santos", dias: { "2026-08-05": "folga", "2026-08-06": "folga", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "trabalho", "2026-08-11": "trabalho", "2026-08-12": "folga", "2026-08-13": "folga", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "folga", "2026-08-17": "trabalho", "2026-08-18": "trabalho", "2026-08-19": "folga", "2026-08-20": "comp", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "trabalho", "2026-08-25": "trabalho", "2026-08-26": "folga", "2026-08-27": "folga", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "trabalho", "2026-08-31": "trabalho" } },
  { nome: "Gabriel Barros Souza Silva", dias: { "2026-08-05": "folga", "2026-08-06": "folga", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "folga", "2026-08-10": "trabalho", "2026-08-11": "trabalho", "2026-08-12": "folga", "2026-08-13": "comp", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "trabalho", "2026-08-17": "trabalho", "2026-08-18": "trabalho", "2026-08-19": "folga", "2026-08-20": "folga", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "trabalho", "2026-08-25": "trabalho", "2026-08-26": "folga", "2026-08-27": "folga", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "trabalho", "2026-08-31": "trabalho" } },
  { nome: "Sérgio Carozzi Gama", dias: { "2026-08-05": "folga", "2026-08-06": "folga", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "trabalho", "2026-08-11": "trabalho", "2026-08-12": "folga", "2026-08-13": "folga", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "trabalho", "2026-08-17": "trabalho", "2026-08-18": "trabalho", "2026-08-19": "folga", "2026-08-20": "folga", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "folga", "2026-08-24": "trabalho", "2026-08-25": "trabalho", "2026-08-26": "folga", "2026-08-27": "comp", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "trabalho", "2026-08-31": "trabalho" } },
  { nome: "José Ilton Moura Bezerra", dias: { "2026-08-05": "trabalho", "2026-08-06": "trabalho", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "folga", "2026-08-11": "folga", "2026-08-12": "trabalho", "2026-08-13": "trabalho", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "folga", "2026-08-17": "folga", "2026-08-18": "comp", "2026-08-19": "trabalho", "2026-08-20": "trabalho", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "folga", "2026-08-25": "folga", "2026-08-26": "trabalho", "2026-08-27": "trabalho", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "trabalho", "2026-08-31": "folga" } },
  { nome: "Vinicius Barros", dias: { "2026-08-05": "trabalho", "2026-08-06": "trabalho", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "folga", "2026-08-11": "folga", "2026-08-12": "trabalho", "2026-08-13": "trabalho", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "trabalho", "2026-08-17": "folga", "2026-08-18": "folga", "2026-08-19": "trabalho", "2026-08-20": "trabalho", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "folga", "2026-08-25": "comp", "2026-08-26": "comp", "2026-08-27": "comp", "2026-08-28": "comp", "2026-08-29": "comp", "2026-08-30": "comp", "2026-08-31": "comp" } },
  { nome: "Frederico Lessa da Cruz", dias: { "2026-08-05": "trabalho", "2026-08-06": "trabalho", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "folga", "2026-08-11": "folga", "2026-08-12": "trabalho", "2026-08-13": "trabalho", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "trabalho", "2026-08-17": "folga", "2026-08-18": "folga", "2026-08-19": "trabalho", "2026-08-20": "trabalho", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "folga", "2026-08-25": "folga", "2026-08-26": "trabalho", "2026-08-27": "trabalho", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "folga", "2026-08-31": "folga" } },
  { nome: "Kaique Gabriel Silva Araújo", dias: { "2026-08-05": "trabalho", "2026-08-06": "trabalho", "2026-08-07": "trabalho", "2026-08-08": "trabalho", "2026-08-09": "trabalho", "2026-08-10": "folga", "2026-08-11": "folga", "2026-08-12": "trabalho", "2026-08-13": "trabalho", "2026-08-14": "trabalho", "2026-08-15": "trabalho", "2026-08-16": "trabalho", "2026-08-17": "folga", "2026-08-18": "folga", "2026-08-19": "trabalho", "2026-08-20": "trabalho", "2026-08-21": "trabalho", "2026-08-22": "trabalho", "2026-08-23": "trabalho", "2026-08-24": "folga", "2026-08-25": "folga", "2026-08-26": "trabalho", "2026-08-27": "trabalho", "2026-08-28": "trabalho", "2026-08-29": "trabalho", "2026-08-30": "folga", "2026-08-31": "folga" } },
  { nome: "Yasmin", dias: { "2026-08-05": "freela", "2026-08-06": "freela", "2026-08-07": "freela", "2026-08-08": "freela", "2026-08-09": "freela", "2026-08-10": "folga", "2026-08-11": "folga", "2026-08-12": "freela", "2026-08-13": "freela", "2026-08-14": "freela", "2026-08-15": "freela", "2026-08-16": "freela", "2026-08-17": "folga", "2026-08-18": "folga", "2026-08-19": "freela", "2026-08-20": "freela", "2026-08-21": "freela", "2026-08-22": "freela", "2026-08-23": "freela", "2026-08-24": "folga", "2026-08-25": "folga", "2026-08-26": "freela", "2026-08-27": "freela", "2026-08-28": "freela", "2026-08-29": "freela", "2026-08-30": "freela", "2026-08-31": "folga" } },
  { nome: "Regiane de Souza Reis", dias: { "2026-08-05": "comp", "2026-08-06": "ferias", "2026-08-07": "ferias", "2026-08-08": "ferias", "2026-08-09": "ferias", "2026-08-10": "ferias", "2026-08-11": "ferias", "2026-08-12": "ferias", "2026-08-13": "ferias", "2026-08-14": "ferias", "2026-08-15": "ferias", "2026-08-16": "ferias", "2026-08-17": "ferias", "2026-08-18": "ferias", "2026-08-19": "ferias", "2026-08-20": "ferias", "2026-08-21": "ferias", "2026-08-22": "ferias", "2026-08-23": "ferias", "2026-08-24": "ferias", "2026-08-25": "ferias", "2026-08-26": "ferias", "2026-08-27": "ferias", "2026-08-28": "ferias", "2026-08-29": "ferias", "2026-08-30": "ferias", "2026-08-31": "ferias" } },
];

export function AplicarEscala0508({ rid, empregados, escala }: { rid: string; empregados: Empregado[]; escala: EscalaMes | null }) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(false);

  const linhas = useMemo(() => ESCALA_0508.map((item) => {
    const alvo = norm(item.nome);
    const emp = empregados.find((e) => norm(e.nome) === alvo)
      || empregados.find((e) => norm(e.nome).startsWith(alvo))
      || (alvo.split(" ").length === 1 ? empregados.find((e) => norm(e.nome).split(" ")[0] === alvo) : undefined);
    const vtDia = emp ? vtDiarioDe(emp) : 0;
    const diasNovo = Object.values(item.dias).filter(ehTrab).length;
    const diasPrev = emp ? contarDiasTrabalhadosNoRange(emp, escala, 2026, 8, DE, ATE, "prevista").dias : 0;
    const diffDias = diasNovo - diasPrev;
    return { item, emp, vtDia, diasNovo, diasPrev, diffDias, diffRs: Math.round(diffDias * vtDia * 100) / 100 };
  }), [empregados, escala]);

  const semMatch = linhas.filter((l) => !l.emp);
  const totalDiff = Math.round(linhas.reduce((s, l) => s + l.diffRs, 0) * 100) / 100;

  async function aplicar() {
    if (!escala) { alert("Escala de agosto ainda não carregou."); return; }
    if (semMatch.length && !confirm(`${semMatch.length} não encontrado(s): ${semMatch.map((l) => l.item.nome).join(", ")}.\nAplicar só os encontrados?`)) return;
    if (!confirm(`Gravar a praticada de 05→31/08 para ${linhas.length - semMatch.length} pessoa(s)? A prevista (recibo do pago) não é tocada.`)) return;
    setSalvando(true);
    try {
      const real: Record<string, Record<string, ScheduleStatus>> = { ...(escala.real || {}) };
      for (const l of linhas) {
        if (!l.emp) continue;
        real[l.emp.id] = { ...(real[l.emp.id] || {}), ...l.item.dias };
      }
      await setDoc(doc(db, "escalas", `${rid}_2026-08`), sanitizeForFirestore({ real, updatedAt: new Date().toISOString() }), { merge: true });
      setFeito(true);
    } catch (e) { alert("Erro ao gravar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="mb-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <span>🔧 Provisório · aplicar nova escala do Lobozó na praticada (05→31/08)</span>
        <span>{aberto ? "▲" : "▼"}</span>
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[12px] text-amber-800/80 dark:text-amber-200/80">
            Grava SÓ na <b>praticada</b> (dias 05→31); a prevista fica intacta. Depois, na aba <b>Ajustes</b>, a diferença de VT sai sozinha. Prévia da diferença (dias 05→31, prevista paga × nova × valor-dia):
          </p>
          <div className="overflow-x-auto rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900">
            <table className="w-full text-[12px]">
              <thead className="text-gray-500 dark:text-gray-400 text-[10px] uppercase">
                <tr><th className="text-left px-2 py-1">Empregado</th><th className="text-center px-2 py-1">Prev.</th><th className="text-center px-2 py-1">Nova</th><th className="text-center px-2 py-1">Dif</th><th className="text-right px-2 py-1">VT R$</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {linhas.map((l, i) => (
                  <tr key={i} className={!l.emp ? "bg-rose-50 dark:bg-rose-900/20" : ""}>
                    <td className="px-2 py-1">{l.emp ? l.emp.nome : <span className="text-rose-600">⚠️ {l.item.nome} (não encontrado)</span>}</td>
                    <td className="text-center px-2 py-1 text-gray-500">{l.diasPrev}</td>
                    <td className="text-center px-2 py-1 text-gray-500">{l.diasNovo}</td>
                    <td className={`text-center px-2 py-1 font-semibold ${l.diffDias < 0 ? "text-rose-600" : l.diffDias > 0 ? "text-emerald-600" : "text-gray-400"}`}>{l.diffDias > 0 ? `+${l.diffDias}` : l.diffDias}</td>
                    <td className={`text-right px-2 py-1 tabular-nums font-semibold ${l.diffRs < 0 ? "text-rose-600" : l.diffRs > 0 ? "text-emerald-600" : "text-gray-400"}`}>{l.diffRs ? fmt(l.diffRs) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-800/40 font-bold"><tr><td className="px-2 py-1" colSpan={4}>Diferença total de VT (05→31)</td><td className={`text-right px-2 py-1 tabular-nums ${totalDiff < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(totalDiff)}</td></tr></tfoot>
            </table>
          </div>
          {feito ? (
            <div className="text-sm text-emerald-700 dark:text-emerald-300">✅ Praticada gravada. Vá na aba <b>Ajustes</b> pra fechar o ajuste de VT.</div>
          ) : (
            <Button onClick={() => void aplicar()} disabled={salvando}>{salvando ? "Gravando…" : "Aplicar na praticada (05→31/08)"}</Button>
          )}
        </div>
      )}
    </div>
  );
}
