// Puxa remuneração de referência (salário + gorjeta média) de um empregado
// existente, pra pré-preencher uma vaga. Salário vem da admissão vinculada
// (via pessoaId); gorjeta média é RECALCULADA dia a dia (calcularDivisaoDia)
// sobre os últimos 3 meses — igual ao extrato do portal do empregado.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Admissao, Cargo, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "../gorjetas/calc";
import { getActiveSplitVersion } from "../gorjetas/splitRules";
import { fmtAnoMes } from "../../core/utils/date";

export type RemuneracaoPuxada = {
  salario: number | null;      // R$/mês, da admissão vinculada (null se não achou)
  gorjetaMedia: number | null; // média mensal dos meses com gorjeta (null se nenhum)
  mesesUsados: number;         // quantos meses entraram na média (0..3)
};

// Os 3 meses de calendário anteriores a (ano, mes) — o mês corrente é parcial
// e fica de fora.
function mesesAnteriores(ano: number, mes: number): { ano: number; mes: number }[] {
  const out: { ano: number; mes: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    let m = mes - i;
    let a = ano;
    while (m <= 0) { m += 12; a -= 1; }
    out.push({ ano: a, mes: m });
  }
  return out;
}

export async function puxarRemuneracao(
  rid: string,
  empregado: { id: string; pessoaId?: string | null },
  empregados: Empregado[],
  cargos: Cargo[],
  unidades: Unidade[],
  ano: number,
  mes: number,
): Promise<RemuneracaoPuxada> {
  const meses = mesesAnteriores(ano, mes);

  const [gSnap, svSnap] = await Promise.all([
    getDocs(query(collection(db, "gorjetas"), where("restaurantId", "==", rid))),
    getDocs(query(collection(db, "splitVersions"), where("restaurantId", "==", rid))),
  ]);
  const gorjetas = gSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gorjeta);
  const splitVersions = svSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as SplitVersion);

  // Uma escala por mês (doc escalas/{rid}_{YYYY-MM}).
  const escalaPorMes: Record<string, EscalaMes | null> = {};
  await Promise.all(
    meses.map(async ({ ano: a, mes: m }) => {
      const key = fmtAnoMes(a, m);
      const s = await getDoc(doc(db, "escalas", `${rid}_${key}`));
      escalaPorMes[key] = s.exists() ? ({ id: s.id, ...s.data() } as EscalaMes) : null;
    }),
  );

  // Soma a parte do empregado, mês a mês. Só conta o mês na média se ele teve
  // gorjeta (> 0) — evita que meses antes da contratação (total 0) puxem a
  // média pra baixo.
  const totaisPorMes: number[] = [];
  for (const { ano: a, mes: m } of meses) {
    const key = fmtAnoMes(a, m);
    const escala = escalaPorMes[key];
    let total = 0;
    for (const g of gorjetas) {
      if (!g.date?.startsWith(key)) continue;
      if (!g.valorBruto || g.semGorjeta) continue;
      const sv = getActiveSplitVersion(splitVersions, g.date);
      const taxRate = sv?.taxRate ?? g.taxRate ?? 0;
      const { itens } = calcularDivisaoDia(
        g.date,
        calcularValorLiquido(g.valorBruto, taxRate),
        empregados, cargos, escala, sv,
        g.unidadeId || null, unidades,
      );
      const meu = itens.find((it) => it.empregadoId === empregado.id);
      if (meu) total += meu.valor;
    }
    if (total > 0) totaisPorMes.push(total);
  }

  const gorjetaMedia = totaisPorMes.length
    ? Math.round((totaisPorMes.reduce((s, v) => s + v, 0) / totaisPorMes.length) * 100) / 100
    : null;

  // Salário: admissão vinculada mais recente com salário informado.
  let salario: number | null = null;
  if (empregado.pessoaId) {
    try {
      const aSnap = await getDocs(query(
        collection(db, "admissoes"),
        where("restaurantId", "==", rid),
        where("pessoaIdVinculada", "==", empregado.pessoaId),
      ));
      const comSalario = aSnap.docs
        .map((d) => d.data() as Admissao)
        .filter((a) => typeof a.salario === "number" && a.salario > 0);
      if (comSalario.length) salario = comSalario[comSalario.length - 1].salario ?? null;
    } catch { /* sem índice/permissão → deixa salário em branco */ }
  }

  return { salario, gorjetaMedia, mesesUsados: totaisPorMes.length };
}
