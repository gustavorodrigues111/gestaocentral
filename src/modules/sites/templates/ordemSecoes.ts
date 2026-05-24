// Identificadores das seções reordenáveis (entre hero e footer).
// Hero e Footer são sempre primeira/última, não entram aqui.

export type SecaoId =
  | "historia"
  | "cardapio"
  | "horario"
  | "laje"
  | "eventos"
  | "reservas"
  | "delivery"
  | "trabalhe"
  | "contato";

export const SECAO_LABEL: Record<SecaoId, string> = {
  historia: "História",
  cardapio: "Cardápio",
  horario: "Horário",
  laje: "Eventos na Laje",
  eventos: "Eventos (genérico)",
  reservas: "Reservas",
  delivery: "Delivery",
  trabalhe: "Trabalhe conosco",
  contato: "Contato",
};

// Ordem padrão (mesma sequência que o template Personalizado já tinha)
export const ORDEM_PADRAO: SecaoId[] = [
  "historia",
  "cardapio",
  "horario",
  "laje",
  "eventos",
  "reservas",
  "delivery",
  "trabalhe",
  "contato",
];

// Sanitiza o array salvo no Firestore — remove IDs inválidos, adiciona
// os que faltam no fim. Garante que toda seção sempre aparece em algum
// lugar do site (ou é escondida pela flag features, mas a ordem está lá).
export function normalizarOrdem(salvo: string[] | undefined): SecaoId[] {
  const ids = (salvo || []).filter((s): s is SecaoId =>
    ORDEM_PADRAO.includes(s as SecaoId)
  );
  // Adiciona ids faltantes no fim
  for (const id of ORDEM_PADRAO) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
