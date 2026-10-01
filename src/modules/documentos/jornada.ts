// Monta o texto da JORNADA a partir do horário cadastrado (Record<dia 0..6,
// {active,in,out,break}>) — mesmo shape de Admissao.horariosCadastrados e de
// Empregado.workSchedules[].days. Agrupa dias consecutivos iguais e calcula as
// horas semanais. É o que vai nos contratos como "horário de trabalho".
// Compartilhado entre a aba "Contratos de trabalho" e a Fábrica de documentos.
const DIAS_NOME = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

type DiaHorario = { active?: boolean; in?: string; out?: string; break?: number };

export function jornadaTexto(hc?: Record<string, DiaHorario> | null): string {
  if (!hc) return "";
  type D = { d: number; in: string; out: string; brk: number };
  const dias: D[] = [];
  let horas = 0;
  for (let d = 0; d <= 6; d++) {
    const h = hc[String(d)] || hc[d as unknown as string];
    if (!h || !h.active || !h.in || !h.out) continue;
    const brk = Number(h.break) || 0;
    dias.push({ d, in: h.in, out: h.out, brk });
    const [ih, im] = h.in.split(":").map(Number);
    const [oh, om] = h.out.split(":").map(Number);
    let min = (oh * 60 + om) - (ih * 60 + im); if (min < 0) min += 24 * 60; min -= brk;
    horas += Math.max(0, min) / 60;
  }
  if (dias.length === 0) return "";
  const grupos: { di: number; df: number; in: string; out: string; brk: number }[] = [];
  for (const dd of dias) {
    const g = grupos[grupos.length - 1];
    if (g && dd.d === g.df + 1 && dd.in === g.in && dd.out === g.out && dd.brk === g.brk) g.df = dd.d;
    else grupos.push({ di: dd.d, df: dd.d, in: dd.in, out: dd.out, brk: dd.brk });
  }
  const intervTxt = (m: number) => m <= 0 ? "" : (m % 60 === 0 ? `${m / 60} hora${m / 60 > 1 ? "s" : ""}` : `${m} minutos`);
  const partes = grupos.map(g => {
    const faixa = g.di === g.df ? DIAS_NOME[g.di] : `de ${DIAS_NOME[g.di]} a ${DIAS_NOME[g.df]}`;
    const it = intervTxt(g.brk);
    return `${faixa}, das ${g.in} às ${g.out}${it ? `, com ${it} de intervalo para refeição e descanso` : ""}`;
  });
  const ativos = new Set(dias.map(d => d.d));
  const folgas = [0, 1, 2, 3, 4, 5, 6].filter(d => !ativos.has(d));
  const folgaTxt = folgas.length ? `, com descanso semanal remunerado ${folgas.length === 1 ? `no ${DIAS_NOME[folgas[0]]}` : `nos dias de ${folgas.map(f => DIAS_NOME[f]).join(", ")}`}` : "";
  const horasStr = Number.isInteger(horas) ? String(horas) : horas.toFixed(1).replace(".", ",");
  const t = `${partes.join("; ")}, perfazendo ${horasStr} horas semanais${folgaTxt}.`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Dado um Empregado.workSchedules[], escolhe a escala vigente (mais recente por
// validFrom até hoje; senão a mais recente) e devolve o texto da jornada.
export function jornadaDoEmpregado(workSchedules: Array<{ validFrom?: string; days?: Record<string, DiaHorario> }> | undefined): string {
  if (!workSchedules || workSchedules.length === 0) return "";
  const hoje = new Date().toISOString().slice(0, 10);
  const ordenado = [...workSchedules].sort((a, b) => (b.validFrom || "").localeCompare(a.validFrom || ""));
  const vigente = ordenado.find(w => (w.validFrom || "") <= hoje) || ordenado[0];
  return jornadaTexto(vigente?.days || null);
}
