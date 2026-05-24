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

// Defaults genéricos — usado pelo template default
const DEFAULTS_GENERICO: TextosDefaults = {
  heroTitulo: "Bem-vindo",
  heroSubtitulo: "",
  heroCtaLabel: "Reservar",
  historiaTitulo: "Sobre",
  cardapioTitulo: "Cardápio",
  horarioTitulo: "Horário",
  horarioProximosAvisosLabel: "Próximos avisos",
  lajeTitulo: "Eventos",
  lajeTexto: "",
  lajeCtaLabel: "Solicitar proposta",
  eventosTitulo: "Eventos privados",
  eventosTexto: "",
  eventosCtaLabel: "Solicitar proposta",
  reservasTitulo: "Reservas",
  reservasTexto: "",
  reservasCtaLabel: "Reservar",
  deliveryTitulo: "Delivery",
  deliveryTexto: "",
  trabalheTitulo: "Trabalhe conosco",
  trabalheTexto: "",
  trabalheCtaLabel: "Enviar candidatura",
  contatoTitulo: "Como chegar",
  rodapeDireitos: "Todos os direitos reservados.",
};

export function defaultTextosByTemplate(templateId: SiteConfig["templateId"]): TextosDefaults {
  switch (templateId) {
    case "personalizado":
    case "lobozo":          // alias legado
      return DEFAULTS_PERSONALIZADO;
    default:
      return DEFAULTS_GENERICO;
  }
}
