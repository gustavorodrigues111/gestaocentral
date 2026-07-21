// Lógica pura do módulo Prazos: resolver/renovar, classificar na agenda, travas.
import type { Prazo, PrazoTipo } from "../../core/types";
import { proximoVencimento } from "./recorrencia";

export const hojeYmd = (): string => new Date().toISOString().slice(0, 10);

// Antecedência padrão por tipo (dias antes do vencimento que o prazo "acende").
export const ANTECEDENCIA_PADRAO: Record<PrazoTipo, number> = { conta: 3, tecnico: 30, trabalhista: 15, avulso: 7 };

// Exige laudo e ainda não anexou → não pode resolver.
export function podeResolver(p: Pick<Prazo, "exigeLaudo" | "laudo">): boolean {
  return !p.exigeLaudo || !!p.laudo;
}

// Resolve ("Realizado"/"Pago"): arquiva a ocorrência atual no histórico e, se
// recorrente, AVANÇA o vencimento pro próximo (volta a "aberto"); senão fecha.
export function resolverPrazo(p: Prazo, ctx: { em: string; por?: string | null; porNome?: string | null }): Prazo {
  const ocorrencia = {
    vencimento: p.vencimento,
    resolvidoEm: ctx.em,
    resolvidoPor: ctx.por ?? null,
    resolvidoPorNome: ctx.porNome ?? null,
    agendamento: p.agendamento ?? null,
    laudo: p.laudo ?? null,
    valor: p.dados?.valor ?? null,
  };
  const historico = [...(p.historico || []), ocorrencia];
  if (p.recorrencia) {
    const prox = proximoVencimento(p.recorrencia, p.vencimento);
    return { ...p, historico, vencimento: prox || p.vencimento, status: "aberto", agendamento: null, laudo: null, precisaRevisao: false, revisaoMotivo: null };
  }
  return { ...p, historico, status: "resolvido" };
}

export type GrupoAgenda = "vencido" | "semana" | "proximo" | "futuro";

// Onde o prazo cai na agenda, dado "hoje". Só considera prazos abertos/agendados.
export function grupoAgenda(p: Pick<Prazo, "vencimento" | "antecedenciaDias" | "tipo">, hoje: string): GrupoAgenda {
  const dias = diasAte(hoje, p.vencimento);
  if (dias < 0) return "vencido";
  if (dias <= 7) return "semana";
  const antec = p.antecedenciaDias ?? ANTECEDENCIA_PADRAO[p.tipo];
  if (dias <= antec) return "proximo";
  return "futuro";
}

// Dias de `de` até `ate` (inteiro; negativo se `ate` já passou).
export function diasAte(de: string, ate: string): number {
  const a = new Date(de + "T12:00:00").getTime();
  const b = new Date(ate + "T12:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

// Prazo está "no radar" (deve aparecer/avisar)? Vencido OU dentro da antecedência.
export function noRadar(p: Pick<Prazo, "vencimento" | "antecedenciaDias" | "tipo" | "status">, hoje: string): boolean {
  if (p.status === "resolvido") return false;
  const dias = diasAte(hoje, p.vencimento);
  const antec = p.antecedenciaDias ?? ANTECEDENCIA_PADRAO[p.tipo];
  return dias <= antec;
}
