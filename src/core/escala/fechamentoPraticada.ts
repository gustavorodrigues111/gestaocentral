// ════════════════════════════════════════════════════════════════════════════
//  "Fechado até o dia D" da escala PRATICADA.
//  D = o último dia (até ontem) em que TODOS os empregados ativos naquele dia
//  estão FECHADOS na praticada (realAjustes.origem === "solides_sync").
//  A gorjeta só pode dividir/publicar até esse D — porque um dia só está pronto
//  quando toda a equipe foi conferida (inclusive quem faltou/folgou: precisa ter
//  o dia fechado pra confirmar que a ausência é real, não erro de conferência).
// ════════════════════════════════════════════════════════════════════════════
import type { EscalaMes, Empregado } from "../types";
import { empregadoAtivoEm } from "../utils/empregado";

export type PendenciaFechamento = { empId: string; nome: string; diasAbertos: string[] };

export type FechamentoPraticada = {
  fechadoAteDia: number;          // 0 = nada fechado; D = dias 1..D contíguos, todos fechados
  fechadoAteYmd: string | null;   // YYYY-MM-DD do dia D (ou null)
  ultimoDiaConsiderado: number;   // até ontem (mês corrente) / fim do mês (passado) / 0 (futuro)
  pendencias: PendenciaFechamento[]; // empregados com dias abertos até o último dia considerado
  totalDiasAbertos: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function calcularFechamentoPraticada(
  escala: EscalaMes | null,
  empregados: Empregado[],
  ano: number,
  mes: number,       // 1-12
  hojeYmd: string,   // YYYY-MM-DD (hoje, horário de Brasília)
): FechamentoPraticada {
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const ymdDe = (d: number) => `${ano}-${pad2(mes)}-${pad2(d)}`;
  const primeiroDoMes = ymdDe(1);
  const ultimoDoMes = ymdDe(diasNoMes);

  // Até que dia faz sentido cobrar fechamento: mês futuro = nada; mês passado =
  // o mês inteiro; mês corrente = até ONTEM (hoje ainda está acontecendo).
  let ultimoDiaConsiderado: number;
  if (hojeYmd < primeiroDoMes) ultimoDiaConsiderado = 0;
  else if (hojeYmd > ultimoDoMes) ultimoDiaConsiderado = diasNoMes;
  else ultimoDiaConsiderado = Math.max(0, Number(hojeYmd.slice(-2)) - 1);

  const fechado = (empId: string, ymd: string) =>
    (escala?.realAjustes?.[empId]?.[ymd] as { origem?: string } | undefined)?.origem === "solides_sync";

  const pendMap = new Map<string, { nome: string; dias: string[] }>();
  let fechadoAteDia = 0;
  let quebrou = false;   // depois do 1º dia incompleto, D não avança mais (contíguo)
  let totalDiasAbertos = 0;

  for (let d = 1; d <= ultimoDiaConsiderado; d++) {
    const ymd = ymdDe(d);
    let diaCompleto = true;
    for (const e of empregados) {
      if (!empregadoAtivoEm(e, ymd)) continue;   // só cobra dos ativos naquele dia
      if (!fechado(e.id, ymd)) {
        diaCompleto = false;
        totalDiasAbertos++;
        const cur = pendMap.get(e.id) || { nome: e.nome, dias: [] };
        cur.dias.push(ymd);
        pendMap.set(e.id, cur);
      }
    }
    if (diaCompleto && !quebrou) fechadoAteDia = d;
    else quebrou = true;
  }

  const pendencias = [...pendMap.entries()]
    .map(([empId, v]) => ({ empId, nome: v.nome, diasAbertos: v.dias }))
    .sort((a, b) => a.diasAbertos[0].localeCompare(b.diasAbertos[0]) || a.nome.localeCompare(b.nome));

  return {
    fechadoAteDia,
    fechadoAteYmd: fechadoAteDia > 0 ? ymdDe(fechadoAteDia) : null,
    ultimoDiaConsiderado,
    pendencias,
    totalDiasAbertos,
  };
}
