// Helper pra resolver `prazoOffset` (string livre tipo "D+5", "D-3", "dia 20",
// "fim do mês") em data real (YYYY-MM-DD), baseado no prazo da tarefa-pai.
//
// Formatos aceitos:
//   "D+N"      → soma N dias à data base
//   "D-N"      → subtrai N dias
//   "D+0"      → mesma data base
//   "dia N"    → próximo dia N do mês (se já passou no mês da base, vai pro próximo)
//   "fim do mês" → último dia do mês da base
//   ""/undef   → null (sem prazo)
//
// Se o formato não bate, retorna null silenciosamente (não quebra).

export function resolverPrazoOffset(
  offset: string | undefined,
  prazoBase: string | null | undefined,
): string | null {
  if (!offset || !offset.trim()) return null;
  const base = prazoBase ? new Date(prazoBase + "T00:00:00") : new Date();
  const raw = offset.trim().toLowerCase();

  // D+N / D-N
  const matchD = raw.match(/^d([+-])(\d+)$/i);
  if (matchD) {
    const sign = matchD[1] === "+" ? 1 : -1;
    const n = parseInt(matchD[2]);
    const d = new Date(base);
    d.setDate(d.getDate() + sign * n);
    return d.toISOString().slice(0, 10);
  }

  // "dia N"
  const matchDia = raw.match(/^dia\s+(\d{1,2})$/);
  if (matchDia) {
    const targetDay = parseInt(matchDia[1]);
    if (targetDay >= 1 && targetDay <= 31) {
      const d = new Date(base.getFullYear(), base.getMonth(), targetDay);
      // Se data alvo já passou no mês base, vai pro próximo mês
      if (d < base) d.setMonth(d.getMonth() + 1);
      return d.toISOString().slice(0, 10);
    }
  }

  // "fim do mês" / "ultimo dia"
  if (raw === "fim do mês" || raw === "fim do mes" || raw === "ultimo dia") {
    const d = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

// Extrai pessoaIds mencionados num texto "@nome ...". Recebe lista de pessoas
// disponíveis pra resolver nome → id. Match case-insensitive, primeiro nome
// ou nome completo.
export function extrairMencoes(
  texto: string,
  pessoas: Array<{ id: string; nome: string }>,
): string[] {
  const out: string[] = [];
  // Captura @palavra ou @"nome com espaços"
  const re = /@([\wÀ-ſ]+(?:\s+[\wÀ-ſ]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const candidato = m[1].toLowerCase();
    const pessoa = pessoas.find(p => {
      const nome = p.nome.toLowerCase();
      return nome.startsWith(candidato) || nome.split(" ")[0] === candidato.split(" ")[0];
    });
    if (pessoa && !out.includes(pessoa.id)) out.push(pessoa.id);
  }
  return out;
}
