// Textos default por template. Usados pra pré-preencher a seção
// "Textos das seções" no admin — usuário edita a partir do default,
// não a partir de campo vazio.

import type { SiteConfig } from "../../../core/types";

export type TextosDefaults = NonNullable<SiteConfig["textos"]>;

// Defaults do template "Personalizado" — texto-modelo inspirado no Lobozó
// (caipira refinado). Usado como ponto de partida; cada restaurante edita
// no admin pra refletir sua própria copy.
const DEFAULTS_PERSONALIZADO: TextosDefaults = {
  heroTitulo: "Cozinha caipira,\nfeita com tempo.",
  heroSubtitulo: "Um laboratório gastronômico no coração da Vila Madalena.",
  heroCtaLabel: "Faça sua reserva",
  historiaTitulo: "A nossa história",
  cardapioTitulo: "Cardápio",
  horarioTitulo: "Horário de funcionamento",
  horarioProximosAvisosLabel: "Próximos avisos",
  lajeTitulo: "Eventos na Laje",
  lajeTexto: "Nosso rooftop recebe eventos privados para até 45 pessoas. Aniversários, encontros corporativos, jantares fechados — montamos cada celebração com você.",
  lajeCtaLabel: "Solicitar proposta",
  eventosTitulo: "Eventos privados",
  eventosTexto: "Reservamos o espaço para sua celebração. Conta pra gente o que tem em mente — voltamos com uma proposta sob medida.",
  eventosCtaLabel: "Solicitar proposta",
  reservasTitulo: "Reservas",
  reservasTexto: "Recebemos com e sem reserva. Pra grupos a partir de 6 pessoas, recomendamos reservar.",
  reservasCtaLabel: "Reservar mesa",
  deliveryTitulo: "Peça pra casa",
  deliveryTexto: "Não pode vir? A gente entrega. Escolha sua plataforma preferida.",
  trabalheTitulo: "Venha trabalhar com a gente",
  trabalheTexto: "Sempre buscando gente boa pra somar no time.",
  trabalheCtaLabel: "Enviar candidatura",
  contatoTitulo: "Como chegar",
  rodapeDireitos: "Todos os direitos reservados.",
};

// Único template ativo hoje — defaults sempre são os do Personalizado.
// templateId continua sendo recebido pra compatibilidade com chamadas
// existentes (e pra abrir caminho a múltiplos templates no futuro).
export function defaultTextosByTemplate(
  _templateId: SiteConfig["templateId"],
): TextosDefaults {
  return DEFAULTS_PERSONALIZADO;
}
