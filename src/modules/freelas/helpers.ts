import type { Empregado, FreelaShift, Pessoa } from "../../core/types";

export function onlyDigits(s: string | undefined | null): string {
  return (s || "").replace(/\D/g, "");
}

// Calcula horas totais decimais a partir de entrada/saída/intervalo.
// Aceita saída no dia seguinte (overnight) — se "saida" < "entrada" considera +24h.
// Retorna horas com 2 casas decimais.
export function calcHoras(entrada?: string, saida?: string, intervalo?: number): number {
  if (!entrada || !saida) return 0;
  const [hi, mi] = entrada.split(":").map((x) => parseInt(x, 10));
  const [ho, mo] = saida.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hi) || Number.isNaN(mi) || Number.isNaN(ho) || Number.isNaN(mo)) return 0;
  let inicio = hi * 60 + mi;
  let fim = ho * 60 + mo;
  if (fim < inicio) fim += 24 * 60;
  const minutos = Math.max(0, fim - inicio - (intervalo || 0));
  return Math.round((minutos / 60) * 100) / 100;
}

export function calcTotal(
  valorTipo: "hora" | "diaria" | undefined,
  valorUnit: number | undefined,
  horas: number,
): number {
  const v = Number(valorUnit) || 0;
  if (!v) return 0;
  if (valorTipo === "diaria") return Math.round(v * 100) / 100;
  return Math.round(v * horas * 100) / 100;
}

export const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function fmtHoras(h: number): string {
  if (!h) return "0:00";
  const horas = Math.floor(h);
  const mins = Math.round((h - horas) * 60);
  return `${horas}:${String(mins).padStart(2, "0")}`;
}

// Nome legível pra exibir no card do shift
export function nomeDoShift(s: FreelaShift): string {
  return s.nomeSnapshot || "(sem nome)";
}

// Empregado existente que cobre turno extra OU pessoa freela cadastrada.
// "tipo" diferencia pro UI mostrar badge.
export type FreelaCandidato = {
  tipo: "empregado" | "freela";
  id: string;                  // empregadoId OU pessoaId
  nome: string;
  cpf?: string;
  pix?: string;
  whatsapp?: string;
};

export function listarCandidatos(
  empregados: Empregado[],
  pessoas: Pessoa[],
  restaurantId: string,
): FreelaCandidato[] {
  const cands: FreelaCandidato[] = [];
  // Empregados ativos do restaurante (cobrindo turno extra como freela)
  for (const e of empregados) {
    if (!e.estaAtivo) continue;
    if (e.restaurantId !== restaurantId) continue;
    cands.push({
      tipo: "empregado",
      id: e.id,
      nome: e.nome,
      cpf: e.cpf || undefined,
    });
  }
  // Pessoas do restaurante com cadastro completo de freela (CPF + PIX + WhatsApp)
  // Pessoa só aparece se NÃO é empregado já listado acima (evita duplicar pelo CPF)
  const cpfsEmpregados = new Set(
    empregados.filter((e) => e.cpf).map((e) => onlyDigits(e.cpf)),
  );
  for (const p of pessoas) {
    if (!p.restaurantIds.includes(restaurantId)) continue;
    if (!p.ativa) continue;
    if (p.cpf && cpfsEmpregados.has(onlyDigits(p.cpf))) continue;
    if (!p.pix) continue; // só candidato a freela se tem PIX cadastrado
    cands.push({
      tipo: "freela",
      id: p.id,
      nome: p.nome,
      cpf: p.cpf || undefined,
      pix: p.pix,
      whatsapp: p.whatsapp,
    });
  }
  cands.sort((a, b) => a.nome.localeCompare(b.nome));
  return cands;
}

// Gera próximo número de lote: "LOTE-YYYY-MM-XXX" (XXX = sequencial do mês)
export function proximoNumeroLote(pagamentosExistentes: { numero?: string }[], hoje = new Date()): string {
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const prefix = `LOTE-${ano}-${mes}`;
  let max = 0;
  for (const p of pagamentosExistentes) {
    if (!p.numero || !p.numero.startsWith(prefix)) continue;
    const n = parseInt(p.numero.split("-").pop() || "0", 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

// Retorna info histórica da pessoa pra exibir como dica na precificação.
// "anteriores" = shifts confirmados (fechamento) ou pagos, da mesma pessoa,
// excluindo o turno atual. "ultimoValor" e "ultimoTipo" vêm do mais recente.
export function historicoDaPessoa(
  shiftAtual: FreelaShift,
  todosShifts: FreelaShift[],
): { anteriores: number; ultimoValor?: number; ultimoTipo?: "hora" | "diaria"; ultimoTotal?: number } {
  const mesmaPessoa = (a: FreelaShift, b: FreelaShift) =>
    (a.pessoaId && a.pessoaId === b.pessoaId) ||
    (a.empregadoId && a.empregadoId === b.empregadoId) ||
    (a.cpfSnapshot && a.cpfSnapshot === b.cpfSnapshot && !!a.cpfSnapshot);

  const candidatos = todosShifts.filter(
    (s) =>
      s.id !== shiftAtual.id &&
      mesmaPessoa(s, shiftAtual) &&
      (s.status === "fechamento" || s.status === "pago"),
  );
  candidatos.sort((a, b) =>
    (b.confirmadoEm || b.pagoEm || b.lancadoEm || "").localeCompare(
      a.confirmadoEm || a.pagoEm || a.lancadoEm || "",
    ),
  );
  const ultimo = candidatos[0];
  return {
    anteriores: candidatos.length,
    ultimoValor: ultimo?.valorUnit,
    ultimoTipo: ultimo?.valorTipo,
    ultimoTotal: ultimo?.totalCalc,
  };
}

// Identifica qual "rótulo" um valor representa dado o config:
// "base" | "pleno" | "outro" | null (sem valor).
export function rotulaValor(
  valor: number | undefined,
  tipo: "hora" | "diaria" | undefined,
  config: { baseHora?: number; plenoHora?: number; baseDiaria?: number; plenoDiaria?: number } | null,
): "base" | "pleno" | "outro" | null {
  if (!valor || !tipo || !config) return valor ? "outro" : null;
  if (tipo === "hora") {
    if (config.baseHora  && Math.abs(valor - config.baseHora)  < 0.01) return "base";
    if (config.plenoHora && Math.abs(valor - config.plenoHora) < 0.01) return "pleno";
  } else {
    if (config.baseDiaria  && Math.abs(valor - config.baseDiaria)  < 0.01) return "base";
    if (config.plenoDiaria && Math.abs(valor - config.plenoDiaria) < 0.01) return "pleno";
  }
  return "outro";
}

export function resolverPixWhats(
  cand: FreelaCandidato,
  pessoas: Pessoa[],
): { pix?: string; whatsapp?: string } {
  if (cand.tipo === "freela") {
    return { pix: cand.pix, whatsapp: cand.whatsapp };
  }
  // Empregado: tenta achar a pessoa correspondente pelo CPF
  if (!cand.cpf) return {};
  const cpfD = onlyDigits(cand.cpf);
  const p = pessoas.find((x) => x.cpf && onlyDigits(x.cpf) === cpfD);
  return p ? { pix: p.pix, whatsapp: p.whatsapp } : {};
}
