import { useEffect, useState } from "react";

// Drop-in pro useState de "aba ativa" que PERSISTE no localStorage — ao
// recarregar a página, o módulo volta pra MESMA aba em que estava, em vez de
// resetar pra primeira. Uso idêntico ao useState:
//
//   const [tab, setTab] = useTabPersistida<MinhaTab>("compras", "lista");
//
// `chave` deve ser ÚNICA por módulo (normalmente o nome da pasta do módulo).
// `validas` (opcional) descarta um valor salvo que não exista mais (ex.: aba
// removida numa versão nova), caindo no inicial.
export function useTabPersistida<T extends string>(chave: string, inicial: T, validas?: readonly T[]) {
  const storageKey = `aba:${chave}`;
  const [tab, setTab] = useState<T>(() => {
    try {
      const v = localStorage.getItem(storageKey) as T | null;
      if (v && (!validas || validas.includes(v))) return v;
    } catch { /* navegação privada / storage bloqueado */ }
    return inicial;
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, tab); } catch { /* idem */ }
  }, [storageKey, tab]);
  return [tab, setTab] as const;
}
