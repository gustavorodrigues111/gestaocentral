// Geração da mensagem de WhatsApp pra confirmação de reserva.
//
// Admin clica em "📱 Confirmar via WhatsApp" no card da reserva → abre
// wa.me com a mensagem template substituída pelos dados da reserva.
// Depois admin marca manualmente "Cliente confirmou" ou "Desmarcou".

import { DEFAULT_TEMPLATE_CONFIRMACAO } from "../../core/types";
import type { Reserva, Salao } from "../../core/types";

type Contexto = {
  reserva: Reserva;
  restauranteNome: string;
  salao?: Salao | null;
  template?: string;          // do /configReservas; cai pro default se vazio
};

// Substitui as variáveis {primeiro_nome}, {nome}, {restaurante}, {data},
// {hora}, {pax}, {salao} no template pelos valores da reserva.
//
// Data sai como dd/mm (sem ano, mais natural). Para reservas em ano
// diferente do atual, inclui o ano.
export function montarMensagemConfirmacao(ctx: Contexto): string {
  const tpl = ctx.template?.trim() || DEFAULT_TEMPLATE_CONFIRMACAO;
  const nome = ctx.reserva.clienteNomeSnapshot || "";
  const primeiroNome = nome.split(/\s+/)[0] || nome;
  const data = formatarDataExibicao(ctx.reserva.data);
  const hora = ctx.reserva.horario || "";
  const pax = String(ctx.reserva.pessoas || "");
  const salao = ctx.salao?.nome || ctx.reserva.salaoNomeSnapshot || "";

  return tpl
    .replace(/\{primeiro_nome\}/g, primeiroNome)
    .replace(/\{nome\}/g, nome)
    .replace(/\{restaurante\}/g, ctx.restauranteNome)
    .replace(/\{data\}/g, data)
    .replace(/\{hora\}/g, hora)
    .replace(/\{pax\}/g, pax)
    .replace(/\{salao\}/g, salao);
}

// Preview no editor de template — usa dados mock pra mostrar como vai
// ficar a mensagem renderizada.
export function montarPreviewMensagem(template: string, restauranteNome: string): string {
  return template
    .replace(/\{primeiro_nome\}/g, "Maria")
    .replace(/\{nome\}/g, "Maria Silva")
    .replace(/\{restaurante\}/g, restauranteNome || "Restaurante")
    .replace(/\{data\}/g, "domingo (25/05)")
    .replace(/\{hora\}/g, "19:30")
    .replace(/\{pax\}/g, "4")
    .replace(/\{salao\}/g, "Salão Principal");
}

// Monta o link wa.me com a mensagem url-encoded. Telefone vem em qualquer
// formato — extrai só dígitos. Se o número não tiver código de país,
// assume Brasil (55).
export function montarLinkWhatsapp(telefone: string | undefined | null, mensagem: string): string | null {
  if (!telefone) return null;
  let digitos = telefone.replace(/\D/g, "");
  if (!digitos) return null;
  // Sem código de país → assume BR (55)
  if (digitos.length === 10 || digitos.length === 11) {
    digitos = `55${digitos}`;
  }
  const texto = encodeURIComponent(mensagem);
  return `https://wa.me/${digitos}?text=${texto}`;
}

// Formata data YYYY-MM-DD pra exibição na mensagem.
// Hoje, 24/05/2026 → "domingo (24/05)" (sempre com dia da semana — vibe
// natural). Se for ano diferente do atual, inclui o ano.
function formatarDataExibicao(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  const hoje = new Date();
  const diasSemana = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dow = diasSemana[d.getDay()];
  const ano = d.getFullYear() === hoje.getFullYear() ? "" : `/${d.getFullYear()}`;
  return `${dow} (${dia}/${mes}${ano})`;
}
