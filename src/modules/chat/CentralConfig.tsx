// Aba "Configurações" da Central de Avisos: canais dos avisos de sistema
// (in-app/email/WhatsApp por notificação, do restaurante ativo) + templates do
// WhatsApp. As TAGS de conversa ficam na caixa de entrada do WhatsApp, não aqui.
import type { Pessoa, ModuleId } from "../../core/types";
import { WhatsappTemplatesTab } from "../whatsapp/WhatsappTemplatesTab";
import { AvisosSistemaTab } from "../rotinas/AvisosSistemaTab";

function Secao({ titulo, desc, children }: { titulo: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h3 className="font-bold text-gray-900 dark:text-gray-100">{titulo}</h3>
      {desc && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">{desc}</p>}
      <div className={desc ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

export function CentralConfig({ rid, restauranteNome, pessoas, modulosAtivos, meId, podeConfig }: {
  rid: string; restauranteNome: string; pessoas: Pessoa[]; modulosAtivos: ModuleId[]; meId: string; podeConfig: boolean;
}) {
  return (
    <div className="space-y-5">
      <Secao titulo="🔔 Avisos do sistema — canais" desc={`Ligue/desligue in-app, email e WhatsApp de cada aviso, com destinatários, horário e dias. Configurando: ${restauranteNome}.`}>
        <AvisosSistemaTab rid={rid} pessoas={pessoas} modulosAtivos={modulosAtivos} meId={meId} podeGerenciar={podeConfig} />
      </Secao>

      <Secao titulo="💬 Templates do WhatsApp" desc="Modelos aprovados pela Meta usados nas mensagens proativas (fora da janela de 24h).">
        <WhatsappTemplatesTab podeConfig={podeConfig} />
      </Secao>
    </div>
  );
}
