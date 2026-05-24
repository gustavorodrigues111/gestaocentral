// Validações compartilhadas pelo módulo Eventos.
//
// WhatsApp: formato internacional (E.164-ish) — permite "+" inicial,
// espaços, parênteses, traços. Aceita 8-15 dígitos depois da limpeza.
// Email: regex padrão.
// CNPJ: 14 dígitos.

export function validarEmail(s: string): boolean {
  if (!s) return false;
  // Regex simples — não é RFC completo, mas filtra erros óbvios.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function validarWhatsAppInternacional(s: string): boolean {
  if (!s) return false;
  // Limpa: tira tudo que não é dígito ou "+"
  const limpo = s.replace(/[^\d+]/g, "");
  // Aceita "+" inicial opcional
  const semMais = limpo.startsWith("+") ? limpo.slice(1) : limpo;
  // E.164: 8 a 15 dígitos (cobre todos os países)
  return /^\d{8,15}$/.test(semMais);
}

export function limparCNPJ(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export function validarCNPJ(s: string): boolean {
  const c = limparCNPJ(s);
  if (c.length !== 14) return false;
  // Rejeita CNPJs com todos os dígitos iguais
  if (/^(\d)\1+$/.test(c)) return false;
  // Cálculo dos dígitos verificadores (algoritmo padrão)
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  function calc(base: string, pesos: number[]): number {
    const soma = pesos.reduce((acc, p, i) => acc + p * parseInt(base[i] || "0", 10), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }
  const dv1 = calc(c.slice(0, 12), pesos1);
  const dv2 = calc(c.slice(0, 13), pesos2);
  return dv1 === parseInt(c[12], 10) && dv2 === parseInt(c[13], 10);
}

export type CNPJInfo = {
  razaoSocial: string;
  nomeFantasia?: string;
  email?: string;
  telefone?: string;
};

// Busca dados públicos de CNPJ via BrasilAPI (grátis, sem auth).
// Retorna null em caso de erro / não encontrado.
export async function buscarCNPJ(cnpj: string): Promise<CNPJInfo | null> {
  const c = limparCNPJ(cnpj);
  if (c.length !== 14) return null;
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`);
    if (!r.ok) return null;
    const data = await r.json();
    return {
      razaoSocial: data.razao_social || data.nome_fantasia || "",
      nomeFantasia: data.nome_fantasia || undefined,
      email: data.email || undefined,
      telefone: data.ddd_telefone_1 || undefined,
    };
  } catch {
    return null;
  }
}

// Deriva slot (almoço/jantar/dia_inteiro) a partir do horário.
// Regra: início ≤ 16h → almoço. Início ≥ 17h → jantar. Cruza ambos → dia_inteiro.
export function slotDoHorario(horaInicio: string, horaFim: string): "almoco" | "jantar" | "dia_inteiro" {
  const hi = parseHora(horaInicio);
  const hf = parseHora(horaFim);
  if (hi == null || hf == null) return "jantar";
  if (hi <= 11 && hf >= 18) return "dia_inteiro";
  if (hi < 17) return "almoco";
  return "jantar";
}

function parseHora(s: string): number | null {
  if (!s) return null;
  const [hh, mm] = s.split(":").map(n => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh + mm / 60;
}

// Duração em horas (com 1 casa) entre horaInicio e horaFim. Considera virada
// de meia-noite (se horaFim < horaInicio, soma 24h).
export function duracaoHoras(horaInicio: string, horaFim: string): number {
  const hi = parseHora(horaInicio);
  const hf = parseHora(horaFim);
  if (hi == null || hf == null) return 0;
  const delta = hf >= hi ? hf - hi : hf + 24 - hi;
  return Math.round(delta * 10) / 10;
}

export const OCASIAO_LABEL = {
  aniversario: "Aniversário",
  corporativo: "Evento corporativo",
  encontro_amigos: "Encontro de amigos",
  outros: "Outros",
} as const;

export const MODELO_LABEL = {
  locacao_consumo_livre: "Locação do espaço (comanda individual, consumo livre)",
  pacote_por_pessoa: "Pacote fechado por pessoa (comidas e/ou bebidas)",
} as const;

export const ESCOPO_PACOTE_LABEL = {
  somente_comidas: "Somente comidas",
  comidas_bebidas_nao_alcoolicas: "Comidas + bebidas não alcoólicas",
  comidas_bebidas_alcoolicas: "Comidas + bebidas alcoólicas e não alcoólicas",
  outro: "Outro (descrever)",
} as const;
