// Listener global de tarefas — montado no shell autenticado.
//
// Funções:
//   1. Detecta quando uma tarefa nova é atribuída ao usuário (responsável OU
//      co-resp) e mostra toast in-app.
//   2. Auto-roda gerador de tarefas-lembrete 1× por dia (se master), usando
//      localStorage pra evitar rodar 2× no mesmo dia.
//
// Substituto do cron server-side enquanto não temos Firebase Admin liberado.

import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { gerarTarefasDoDia } from "./generator";
import type { Tarefa } from "../../core/types";

type Toast = {
  id: string;
  titulo: string;
  subtitulo?: string;
  cor?: string;
};

const KEY_ULTIMA_GERACAO = "tarefas_lastgen_ymd";
const KEY_TAREFAS_VISTAS = "tarefas_seen_ids";

export function ToastListener() {
  const { pessoa } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mounted = useRef(false);

  // Auto-rodar gerador de tarefas-lembrete 1× por dia (só master)
  useEffect(() => {
    if (!pessoa?.isMaster) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const ultima = localStorage.getItem(KEY_ULTIMA_GERACAO);
    if (ultima === hoje) return;
    (async () => {
      try {
        const r = await gerarTarefasDoDia({ id: pessoa.id, nome: pessoa.nome });
        localStorage.setItem(KEY_ULTIMA_GERACAO, hoje);
        const total = r.contasGeradas + r.manutencoesGeradas;
        if (total > 0) {
          pushToast({
            id: `gen-${Date.now()}`,
            titulo: `🔁 ${total} tarefa(s)-lembrete gerada(s)`,
            subtitulo: `${r.contasGeradas} conta(s) fixa(s), ${r.manutencoesGeradas} manutenção(ões)`,
            cor: "#10b981",
          });
        }
      } catch (e) {
        console.warn("[ToastListener] falha no auto-gerar:", e);
      }
    })();
    // pessoa.id pode mudar entre sessões; pessoa.nome também — mas só rodamos 1×/dia
  }, [pessoa?.isMaster, pessoa?.id, pessoa?.nome]);

  // Detectar tarefas novas atribuídas ao usuário
  useEffect(() => {
    if (!pessoa?.id) return;
    // Carrega o conjunto de IDs já "vistos" da sessão anterior pra não
    // notificar tarefas antigas no 1º load.
    let vistos: Set<string>;
    try {
      const s = localStorage.getItem(KEY_TAREFAS_VISTAS);
      vistos = new Set(s ? (JSON.parse(s) as string[]) : []);
    } catch {
      vistos = new Set();
    }
    let inicial = true;
    const qResp = query(collection(db, "tarefas"), where("responsavelId", "==", pessoa.id));
    const qCo = query(collection(db, "tarefas"), where("coResponsaveis", "array-contains", pessoa.id));

    function handle(snap: { docChanges: () => Array<{ type: string; doc: { id: string; data: () => Record<string, unknown> } }> }) {
      for (const ch of snap.docChanges()) {
        if (ch.type === "added") {
          const t = { id: ch.doc.id, ...ch.doc.data() } as Tarefa;
          if (vistos.has(t.id)) continue;
          vistos.add(t.id);
          // Não notifica no carregamento inicial
          if (inicial) continue;
          if (t.deletadoEm) continue;
          if (t.status === "concluida" || t.status === "cancelada") continue;
          if (t.criadoPor === pessoa?.id) continue; // não notifica suas próprias criações
          pushToast({
            id: `new-${t.id}`,
            titulo: "📋 Nova tarefa pra você",
            subtitulo: t.titulo,
            cor: t.corHerdada || "#6366f1",
          });
        }
      }
      // Persiste IDs vistos (truncado pra evitar storage gigante)
      const arr = Array.from(vistos);
      localStorage.setItem(KEY_TAREFAS_VISTAS, JSON.stringify(arr.slice(-500)));
    }

    const u1 = onSnapshot(qResp, handle);
    const u2 = onSnapshot(qCo, handle);

    // Marca que passou do 1º carregamento depois de um delay
    const t = setTimeout(() => { inicial = false; mounted.current = true; }, 1500);

    return () => { u1(); u2(); clearTimeout(t); };
  }, [pessoa?.id]);

  function pushToast(t: Toast) {
    setToasts(prev => [...prev, t]);
    // Auto-remove depois de 5s
    setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== t.id));
    }, 5000);
  }

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto p-3 rounded-xl bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-800 animate-in slide-in-from-bottom-2"
          style={{ borderLeftWidth: 4, borderLeftColor: t.cor || "#6366f1" }}
        >
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{t.titulo}</div>
          {t.subtitulo && <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{t.subtitulo}</div>}
        </div>
      ))}
    </div>
  );
}
