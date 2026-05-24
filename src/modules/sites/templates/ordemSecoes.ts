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
// Ordem padrão das seções. IMPORTANTE: os PARES do desktop (configurados no
// template como [reservas+laje/eventos] e [horario+contato]) precisam ficar
// consecutivos aqui pro pareamento detectar. Se você reordenar, considere
// manter laje→reservas (ou reservas→eventos) juntos e horario→contato juntos.
export const ORDEM_PADRAO: SecaoId[] = [
  "historia",
  "cardapio",
  "laje",       // par com reservas no desktop (quando hasLaje+hasEventos)
  "reservas",   // par com laje OU com eventos (next item filtrado)
  "eventos",    // entra como par de reservas quando !hasLaje
  "delivery",
  "horario",    // par com contato no desktop
  "contato",
  "trabalhe",   // final — depois de horário/contato (recrutamento é footer)
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
