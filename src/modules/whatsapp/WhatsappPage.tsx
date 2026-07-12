// Módulo WhatsApp — atendimento pelos NÚMEROS CONECTADOS (device-link/Evolution).
// Abas: 💬 Chat (inbox das conversas) e ⚙️ Configuração (gestão dos números:
// criar, QR, conectar/reconectar, status, atribuir usuários, regras).
// O "WhatsApp do sistema" (API oficial, disparos) fica na Central de Avisos.
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { WhatsappInboxPage, NumerosManager, TagsManager } from "./WhatsappInboxPage";

export function WhatsappPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const isMaster = !!pessoa?.isMaster;
  const { can, loading } = useCanAcao(rid || "");
  const podeVer = isMaster || can("whatsapp", "ver") || can("whatsapp", "responder");
  const podeConfig = isMaster || can("whatsapp", "configurar");
  const [aba, setAba] = useState<"chat" | "config">("chat");
  // Cada clique na aba Chat manda o inbox voltar pra lista de conversas.
  const [voltarLista, setVoltarLista] = useState(0);

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;
  if (!podeVer && !podeConfig) return <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">Você não tem acesso ao WhatsApp.</div>;

  const abaEfetiva = aba === "config" && !podeConfig ? "chat" : aba;

  const tabBtn = (v: "chat" | "config", label: string) => (
    <button type="button" onClick={() => { setAba(v); if (v === "chat") setVoltarLista(n => n + 1); }}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${abaEfetiva === v ? "border-emerald-500 text-emerald-600 dark:text-emerald-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{label}</button>
  );

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {podeVer && tabBtn("chat", "💬 Chat")}
        {podeConfig && tabBtn("config", "⚙️ Configuração")}
      </div>

      {/* Mantém o inbox montado ao trocar de aba pra não perder a conversa aberta. */}
      {podeVer && <div className={abaEfetiva === "chat" ? "" : "hidden"}><WhatsappInboxPage modo="conversas" voltarListaSignal={voltarLista} /></div>}
      {podeConfig && abaEfetiva === "config" && (
        <div className="space-y-4">
          <NumerosManager />
          <TagsManager />
        </div>
      )}
    </div>
  );
}
