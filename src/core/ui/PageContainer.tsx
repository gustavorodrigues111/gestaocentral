import type { ReactNode } from "react";

// Container padrão de conteúdo de um módulo. A largura EXTERNA (a moldura
// única, elástica com o menu) é do <main> no AppShell — todos os módulos
// ficam na mesma largura. Aqui controlamos só a largura INTERNA do conteúdo:
//
//   variant="wide" (padrão) → preenche a moldura (tabelas, listas, kanban,
//                              dashboards). É o certo pra maioria das telas.
//   variant="form"          → coluna estreita centralizada (~672px), pra
//                              formulários/telas de leitura não esticarem.
//
// Uso: troque o `<div className="max-w-2xl ...">` avulso de cada página por
// <PageContainer variant="form"> (ou "wide"). Nada de max-w solto por tela.
type Props = {
  variant?: "wide" | "form";
  className?: string;
  children: ReactNode;
};

export function PageContainer({ variant = "wide", className, children }: Props) {
  const inner = variant === "form" ? "max-w-2xl mx-auto" : "max-w-none";
  return <div className={`w-full ${inner} ${className ?? ""}`}>{children}</div>;
}
