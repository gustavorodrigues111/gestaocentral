// Badge de notificação pra tabs — número vermelho pequeno que sinaliza
// itens que precisam de atenção (novos, pendentes, não-lidos).
// Não renderiza nada quando count === 0 pra não poluir.
export function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center justify-center ml-1.5 text-[10px] font-bold leading-none px-1.5 min-w-[18px] h-[18px] rounded-full bg-rose-600 text-white"
      aria-label={`${count} novos`}
      title={`${count} item${count === 1 ? "" : "s"} aguardando atenção`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
