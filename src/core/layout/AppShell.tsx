import { type ReactNode, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { applyPendingChanges } from "../audit/pendingChangesJob";

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
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onToggleSidebar={() => setSidebarOpen(s => !s)} />
        <main className="flex-1 overflow-auto p-6">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
