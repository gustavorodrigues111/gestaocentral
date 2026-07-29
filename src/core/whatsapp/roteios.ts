// Roteamento do "Falar pelo WhatsApp": mapa (restaurante × papel) → número.
// Cada papel corresponde a um tipo de interlocutor; o número usado pra falar com
// ele é configurado por restaurante em WhatsApp › Configuração. Ao clicar em
// "Falar pelo WhatsApp" num módulo, resolve o número do papel e abre o inbox
// interno já no número certo + conversa com o telefone da pessoa.
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";

export type PapelWhatsapp = "empregados" | "reservas" | "eventos" | "fornecedores" | "vendas";

export const PAPEIS_WHATSAPP: { id: PapelWhatsapp; label: string; icon: string; desc: string }[] = [
  { id: "empregados",   label: "Empregados / DP",     icon: "👥", desc: "Admissão, Demissão, Pessoas, Ponto, Escala" },
  { id: "reservas",     label: "Clientes — Reservas", icon: "🍽️", desc: "Reservas + CRM" },
  { id: "eventos",      label: "Clientes — Eventos",  icon: "🎉", desc: "Leads e clientes de eventos" },
  { id: "fornecedores", label: "Fornecedores",        icon: "📦", desc: "Compras" },
  { id: "vendas",       label: "Cobrança / Vendas",   icon: "🧾", desc: "Vendas e cobranças" },
];
export const PAPEL_WHATSAPP_LABEL: Record<PapelWhatsapp, string> =
  Object.fromEntries(PAPEIS_WHATSAPP.map((p) => [p.id, p.label])) as Record<PapelWhatsapp, string>;

// Doc /whatsappRoteios/{restaurantId} = { [papel]: numeroId }
export type WhatsappRoteio = Partial<Record<PapelWhatsapp, string>>;

// Hook: devolve `abrir(rid, papel, telefone, nome?)`. Resolve o número do papel
// e navega pro inbox interno. Sem número configurado → avisa (não abre wa.me).
export function useAbrirWhatsapp() {
  const navigate = useNavigate();
  return async function abrir(rid: string, papel: PapelWhatsapp, telefone: string, nome?: string): Promise<boolean> {
    const fone = (telefone || "").replace(/\D/g, "");
    if (!fone) { alert("Essa pessoa não tem número de WhatsApp cadastrado."); return false; }
    let numeroId: string | undefined;
    try {
      const s = await getDoc(doc(db, "whatsappRoteios", rid));
      numeroId = s.exists() ? (s.data() as WhatsappRoteio)[papel] : undefined;
    } catch { /* segue pro aviso */ }
    if (!numeroId) {
      alert(`Nenhum número de WhatsApp configurado para "${PAPEL_WHATSAPP_LABEL[papel]}" neste restaurante.\n\nConfigure em WhatsApp › Configuração › Números por papel.`);
      return false;
    }
    const qs = new URLSearchParams({ numero: numeroId, to: fone });
    if (nome) qs.set("nome", nome);
    navigate(`/r/${rid}/whatsapp?${qs.toString()}`);
    return true;
  };
}
