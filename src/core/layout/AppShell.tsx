import { type ReactNode, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { applyPendingChanges } from "../audit/pendingChangesJob";
import { ImpersonationBanner } from "../auth/ImpersonationBanner";
import { ToastListener } from "../../modules/tarefas/ToastListener";

export function AppShell({ children }: { children?: ReactNode }) {
  // Sidebar aberta por default no desktop, recolhida no mobile.
  // O Home/Início no mobile já tem os ícones de atalho — o menu lateral
  // gigante atrapalha mais do que ajuda na primeira impressão.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  // Roda 1x ao montar — aplica mudanças que estavam agendadas pra hoje ou antes
  useEffect(() => {
    applyPendingChanges().catch(e => console.error("pendingChanges falhou:", e));
  }, []);

  return (
    // h-screen + overflow-hidden no shell — fixa a altura na viewport. A
    // sidebar (overflow-y-auto interno) e o <main> (overflow-auto) ganham
    // scrolls independentes. Sem isso, conteúdo longo empurrava a página
    // inteira pra baixo e a sidebar acompanhava — perdia a referência
    // de menu fixo. Em telas curtas a sidebar mesmo rola interna.
    //
    // ImpersonationBanner fica no TOPO ABSOLUTO do shell (acima de
    // sidebar + header), pra não sobrepor a navegação quando master tá
    // visualizando como outra pessoa. Sidebar abre ABAIXO dele.
    <div className="h-screen overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-950">
      <ImpersonationBanner />
      <div className="flex-1 flex min-h-0">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Header onToggleSidebar={() => setSidebarOpen(s => !s)} />
          <main className="flex-1 overflow-auto p-6">
            {children || <Outlet />}
          </main>
        </div>
      </div>
      {/* Toast listener global pra novas tarefas + auto-geração lazy 1×/dia */}
      <ToastListener />
    </div>
  );
}
