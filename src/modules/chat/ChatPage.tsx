// ════════════════════════════════════════════════════════════════════════════
//  Chat — Página principal (stub C1)
//
//  Em C1 (esta fase) é só placeholder pra que o módulo seja navegável e o
//  schema/rules entrem em produção sem UI quebrada.
//
//  Em C2 (próxima fase) vira o layout completo:
//   - Coluna esquerda: lista de conversas (filtro por linha, busca)
//   - Coluna direita: painel da conversa selecionada (timeline + compositor)
//   - Modal "Nova conversa" pra iniciar direta ou grupo
//
//  Em C3 entra a UI de admin (linhas WhatsApp + contatos externos).
//  Em C4 entra o adapter do gateway WhatsApp.
//  Em C5 migra Comunicados + Fale com DP pra dentro daqui.
// ════════════════════════════════════════════════════════════════════════════

export function ChatPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 p-4 mb-6">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">
          🚧 Em desenvolvimento (Fase C1 de 5)
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Schema e permissões já no lugar. Próximas fases:
        </p>
        <ul className="list-disc list-inside text-xs text-amber-800 dark:text-amber-300 mt-2 space-y-0.5">
          <li>C2: UI de chat interno (conversas, mensagens, compositor)</li>
          <li>C3: Admin de Linhas WhatsApp + Contatos Externos</li>
          <li>C4: Integração com gateway WhatsApp (Evolution / UAZAPI)</li>
          <li>C5: Migrar Comunicados + Fale com DP pra cá</li>
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          Coleções criadas:
        </p>
        <ul className="text-xs font-mono text-gray-700 dark:text-gray-300 mt-2 space-y-1">
          <li>/conversations</li>
          <li>/chatMessages</li>
          <li>/contatosExternos</li>
          <li>/linhasWhatsapp</li>
        </ul>
      </div>
    </div>
  );
}
