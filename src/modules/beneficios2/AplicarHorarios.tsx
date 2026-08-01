// ⚠️ PROVISÓRIO — botão pra aplicar os horários novos do Lobozó (vigência 05/08).
// Acrescenta um WorkSchedule novo (não apaga o antigo, que vale até 04/08).
// Vigência 05/08: passa a valer do dia 5 (o usuário já capturou os valores do
// ajuste de VT de agosto, então mexer na prevista derivada não afeta). REMOVER após uso.
import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { calcDayHours } from "../../core/escala/horarios";
import type { Empregado, HorarioDia, SundayCycle, WorkSchedule, Pessoa } from "../../core/types";

const VALID_FROM = "2026-08-05";
const VF_BR = VALID_FROM.split("-").reverse().slice(0, 2).join("/");
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const HORARIOS: { nome: string; days: Record<number, HorarioDia>; sundayCycle: SundayCycle | null }[] = [
  { nome: "Gabriel Henrique Xavier de Almeida", days: {0:{active:true,in:"10:15",out:"19:15",break:60},1:{active:true,in:"10:00",out:"19:12",break:60},2:{active:true,in:"10:00",out:"19:00",break:60},3:{active:false},4:{active:false},5:{active:true,in:"11:30",out:"23:15",break:120},6:{active:true,in:"11:30",out:"23:15",break:120}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-23"} },
  { nome: "Maria da Conceição Soares de Sousa Silva", days: {0:{active:true,in:"10:00",out:"19:00",break:60},1:{active:false},2:{active:false},3:{active:true,in:"10:00",out:"19:00",break:60},4:{active:true,in:"10:00",out:"19:12",break:60},5:{active:true,in:"11:15",out:"23:00",break:120},6:{active:true,in:"11:15",out:"23:00",break:120}}, sundayCycle: {workCount:1,offCount:1,refDate:"2026-08-02"} },
  { nome: "Regiane de Souza Reis", days: {0:{active:true,in:"10:00",out:"19:00",break:60},1:{active:false},2:{active:false},3:{active:true,in:"10:00",out:"19:00",break:60},4:{active:true,in:"10:00",out:"19:00",break:60},5:{active:true,in:"10:00",out:"22:00",break:120},6:{active:true,in:"10:00",out:"22:00",break:120}}, sundayCycle: null },
  { nome: "Diego Ferreira", days: {0:{active:true,in:"08:00",out:"17:00",break:60},1:{active:true,in:"09:30",out:"18:30",break:60},2:{active:true,in:"09:30",out:"18:30",break:60},3:{active:false},4:{active:false},5:{active:true,in:"09:30",out:"20:30",break:60},6:{active:true,in:"09:30",out:"20:30",break:60}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-02"} },
  { nome: "Helio Gomes dos Santos", days: {0:{active:true,in:"08:00",out:"17:48",break:60},1:{active:true,in:"08:00",out:"17:48",break:60},2:{active:true,in:"08:00",out:"17:48",break:60},3:{active:false},4:{active:false},5:{active:true,in:"08:00",out:"17:48",break:60},6:{active:true,in:"08:00",out:"17:48",break:60}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-16"} },
  { nome: "Gabriel Barros Souza Silva", days: {0:{active:true,in:"08:00",out:"17:00",break:60},1:{active:true,in:"09:30",out:"18:30",break:60},2:{active:true,in:"09:30",out:"18:30",break:60},3:{active:false},4:{active:false},5:{active:true,in:"09:30",out:"20:30",break:60},6:{active:true,in:"09:30",out:"20:30",break:60}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-09"} },
  { nome: "Sérgio Carozzi Gama", days: {0:{active:true,in:"08:00",out:"19:00",break:60},1:{active:true,in:"08:00",out:"17:00",break:60},2:{active:true,in:"08:00",out:"17:00",break:60},3:{active:false},4:{active:false},5:{active:true,in:"08:00",out:"17:00",break:60},6:{active:true,in:"08:00",out:"19:00",break:60}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-23"} },
  { nome: "José Ilton Moura Bezerra", days: {0:{active:true,in:"10:00",out:"19:00",break:60},1:{active:false},2:{active:false},3:{active:true,in:"09:30",out:"18:30",break:60},4:{active:true,in:"09:30",out:"18:42",break:60},5:{active:true,in:"12:15",out:"23:00",break:60},6:{active:true,in:"12:15",out:"23:00",break:60}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-16"} },
  { nome: "Frederico Lessa da Cruz", days: {0:{active:true,in:"10:00",out:"19:00",break:60},1:{active:false},2:{active:false},3:{active:true,in:"09:30",out:"18:30",break:60},4:{active:true,in:"09:30",out:"18:42",break:60},5:{active:true,in:"12:15",out:"23:00",break:60},6:{active:true,in:"12:15",out:"23:00",break:60}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-02"} },
  { nome: "Kaique Gabriel Silva Araújo", days: {0:{active:true,in:"10:00",out:"19:00",break:60},1:{active:false},2:{active:false},3:{active:true,in:"08:00",out:"17:00",break:60},4:{active:true,in:"08:00",out:"17:12",break:60},5:{active:true,in:"12:15",out:"23:00",break:60},6:{active:true,in:"12:15",out:"23:00",break:60}}, sundayCycle: {workCount:3,offCount:1,refDate:"2026-08-30"} },
  { nome: "Vinicius Barros", days: {0:{active:true,in:"10:00",out:"19:00",break:60},1:{active:false},2:{active:false},3:{active:true,in:"08:00",out:"17:00",break:60},4:{active:true,in:"08:00",out:"17:12",break:60},5:{active:true,in:"12:15",out:"23:00",break:60},6:{active:true,in:"12:15",out:"23:00",break:60}}, sundayCycle: null },
];

function totalContractDe(days: Record<number, HorarioDia>): number {
  let t = 0;
  for (const dia of Object.values(days)) if (dia.active) t += calcDayHours(dia.in, dia.out, dia.break || 0).totalContract;
  return t;
}
function cicloLbl(c: SundayCycle | null): string {
  if (!c) return "trabalha todos";
  const br = c.refDate.split("-").reverse().slice(0, 2).join("/");
  return `${c.workCount}×${c.offCount} · folga ${br}`;
}

export function AplicarHorarios({ empregados, me }: { empregados: Empregado[]; me: Pessoa | null }) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(0);

  const linhas = useMemo(() => HORARIOS.map((h) => {
    const alvo = norm(h.nome);
    const emp = empregados.find((e) => norm(e.nome) === alvo) || empregados.find((e) => norm(e.nome).startsWith(alvo));
    const ativos = Object.entries(h.days).filter(([, v]) => v.active).map(([k]) => DIAS[Number(k)]);
    const tc = totalContractDe(h.days);
    return { h, emp, ativos, tc };
  }), [empregados]);
  const semMatch = linhas.filter((l) => !l.emp);

  async function aplicar() {
    if (semMatch.length && !confirm(`${semMatch.length} não encontrado(s): ${semMatch.map((l) => l.h.nome).join(", ")}.\nAplicar só os encontrados?`)) return;
    if (!confirm(`Gravar horário novo (vigência ${VALID_FROM.split("-").reverse().join("/")}) para ${linhas.length - semMatch.length} pessoa(s)? O horário antigo continua valendo até o dia anterior.`)) return;
    setSalvando(true);
    let n = 0;
    try {
      for (const l of linhas) {
        if (!l.emp) continue;
        const novo: WorkSchedule = {
          validFrom: VALID_FROM, type: "single", days: l.h.days, sundayCycle: l.h.sundayCycle,
          totalContract: l.tc, registradoEm: new Date().toISOString(), registradoPor: me?.id || "provisorio",
          motivo: "Horário novo Lobozó (grade set/2026)",
        };
        // idempotente: remove qualquer schedule já gravado com essa mesma vigência
        const anteriores = (l.emp.workSchedules || []).filter((w) => w.validFrom !== VALID_FROM);
        await updateDoc(doc(db, "empregados", l.emp.id), sanitizeForFirestore({ workSchedules: [...anteriores, novo] }));
        n++;
      }
      setFeito(n);
    } catch (e) { alert("Erro ao gravar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="mb-3 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/20">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-sky-800 dark:text-sky-200">
        <span>🕐 Provisório · aplicar horários novos do Lobozó (vigência {VF_BR})</span>
        <span>{aberto ? "▲" : "▼"}</span>
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[12px] text-sky-800/80 dark:text-sky-200/80">
            Acrescenta o horário novo com vigência <b>{VF_BR}</b> (o antigo vale até o dia anterior). Passa a valer do dia 5. Confira antes:
          </p>
          <div className="overflow-x-auto rounded-lg border border-sky-200 dark:border-sky-800 bg-white dark:bg-gray-900">
            <table className="w-full text-[12px]">
              <thead className="text-gray-500 dark:text-gray-400 text-[10px] uppercase">
                <tr><th className="text-left px-2 py-1">Empregado</th><th className="text-left px-2 py-1">Dias</th><th className="text-left px-2 py-1">Ciclo domingo</th><th className="text-right px-2 py-1">Carga</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {linhas.map((l, i) => (
                  <tr key={i} className={!l.emp ? "bg-rose-50 dark:bg-rose-900/20" : ""}>
                    <td className="px-2 py-1">{l.emp ? l.emp.nome : <span className="text-rose-600">⚠️ {l.h.nome} (não encontrado)</span>}</td>
                    <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{l.ativos.join(" · ")}</td>
                    <td className="px-2 py-1 text-gray-500">{cicloLbl(l.h.sundayCycle)}</td>
                    <td className="text-right px-2 py-1 tabular-nums text-gray-500">{(l.tc / 60).toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {feito > 0 ? (
            <div className="text-sm text-emerald-700 dark:text-emerald-300">✅ Horários gravados para {feito} pessoa(s). Do dia {VF_BR} em diante já sai com a grade nova.</div>
          ) : (
            <Button onClick={() => void aplicar()} disabled={salvando}>{salvando ? "Gravando…" : `Aplicar horários (vigência ${VF_BR})`}</Button>
          )}
        </div>
      )}
    </div>
  );
}
