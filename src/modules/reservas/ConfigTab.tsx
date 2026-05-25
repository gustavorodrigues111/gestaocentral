// Tab "Configurações" do módulo Reservas — agrega salões, mesas e o
// template de mensagem de WhatsApp em sub-tabs. Reduz o ruído visual do
// nível superior (que ia ter 6+ tabs) e organiza por intenção: tudo aqui
// é setup, não operação do dia-a-dia.

import { useState } from "react";
import { SaloesTab } from "./SaloesTab";
import { MesasTab } from "./MesasTab";
import { TemplateConfirmacaoTab } from "./TemplateConfirmacaoTab";
import { EmailComprovanteTab } from "./EmailComprovanteTab";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
  pessoaId: string;
};

type SubTab = "saloes" | "mesas" | "template" | "email";

export function ConfigTab({ restaurantId, podeConfig, pessoaId }: Props) {
  const [sub, setSub] = useState<SubTab>("saloes");

  return (
    <div className="space-y-4">
      {/* Sub-tabs visuais — pills */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200 dark:border-gray-800 pb-2">
        <SubTabButton ativo={sub === "saloes"} onClick={() => setSub("saloes")}>
          🏛️ Salões
        </SubTabButton>
        <SubTabButton ativo={sub === "mesas"} onClick={() => setSub("mesas")}>
          🪑 Mesas
        </SubTabButton>
        <SubTabButton ativo={sub === "template"} onClick={() => setSub("template")}>
          📱 Mensagem de confirmação
        </SubTabButton>
        <SubTabButton ativo={sub === "email"} onClick={() => setSub("email")}>
          📧 Email de comprovante
        </SubTabButton>
      </div>

      {sub === "saloes" && (
        <SaloesTab restaurantId={restaurantId} podeConfig={podeConfig} pessoaId={pessoaId} />
      )}
      {sub === "mesas" && (
        <MesasTab restaurantId={restaurantId} podeConfig={podeConfig} />
      )}
      {sub === "template" && (
        <TemplateConfirmacaoTab restaurantId={restaurantId} podeConfig={podeConfig} />
      )}
      {sub === "email" && (
        <EmailComprovanteTab restaurantId={restaurantId} />
      )}
    </div>
  );
}

function SubTabButton({ ativo, onClick, children }: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
        ativo
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
      }`}
    >
      {children}
    </button>
  );
}
