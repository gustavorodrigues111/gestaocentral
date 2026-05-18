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
