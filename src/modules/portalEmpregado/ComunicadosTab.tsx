import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd } from "../../core/utils/date";
import type { Cargo, Comunicado, ComunicadoLeitura, Empregado } from "../../core/types";

const PRIORIDADE_INFO = {
  info:    { label: "Info",    icon: "ℹ️", cls: "border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800" },
  aviso:   { label: "Aviso",   icon: "⚠️", cls: "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800" },
  urgente: { label: "Urgente", icon: "🚨", cls: "border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800" },
};

type Props = {
  empregado: Empregado;
  cargo: Cargo | null;
  restaurantId: string;
};

export function ComunicadosTab({ empregado, cargo, restaurantId }: Props) {
  const { pessoa } = useAuth();
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [leituras, setLeituras] = useState<ComunicadoLeitura[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "comunicados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Comunicado);
      list.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
      setComunicados(list);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    if (!pessoa?.id) return;
    const q = query(
      collection(db, "comunicadosLeituras"),
      where("restaurantId", "==", restaurantId),
      where("pessoaId", "==", pessoa.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      setLeituras(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ComunicadoLeitura));
    });
    return () => unsub();
  }, [restaurantId, pessoa?.id]);

  const idsLidos = useMemo(() => new Set(leituras.map(l => l.comunicadoId)), [leituras]);

  // Filtra: só ativos + não expirados + destinatários incluem este empregado
  const today = todayYmd();
  const visiveis = useMemo(() => {
    return comunicados.filter(c => {
      if (!c.ativo) return false;
      if (c.validoAte && c.validoAte < today) return false;
      // Destinatários
      const dest = c.destinatarios;
      if (dest.tipo === "todos") return true;
      if (dest.tipo === "areas") {
        return cargo ? dest.areas.includes(cargo.area) : false;
      }
      if (dest.tipo === "empregados") {
        return dest.empregadoIds.includes(empregado.id);
      }
      return false;
    });
  }, [comunicados, cargo, empregado.id, today]);

  const naoLidos = visiveis.filter(c => !idsLidos.has(c.id)).length;

  // Marca como lido
  async function marcarComoLido(c: Comunicado) {
    if (!pessoa?.id) return;
    if (idsLidos.has(c.id)) return;
    const id = `${c.id}_${pessoa.id}`;
    const ref = doc(db, "comunicadosLeituras", id);
    const exists = await getDoc(ref);
    if (exists.exists()) return;
    const data: ComunicadoLeitura = {
      id,
      comunicadoId: c.id,
      pessoaId: pessoa.id,
      restaurantId,
      lidoEm: new Date().toISOString(),
    };
    await setDoc(ref, sanitizeForFirestore(data));
  }

  return (
    <div className="space-y-3">
      {naoLidos > 0 && (
        <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 px-3 py-2 text-sm text-indigo-800 dark:text-indigo-300">
          📨 Você tem <strong>{naoLidos}</strong> comunicado{naoLidos > 1 ? "s" : ""} não lido{naoLidos > 1 ? "s" : ""}.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : visiveis.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📣</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum comunicado ativo</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visiveis.map(c => {
            const lido = idsLidos.has(c.id);
            const prio = PRIORIDADE_INFO[c.prioridade];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => marcarComoLido(c)}
                className={`w-full text-left rounded-xl border p-4 transition-all ${prio.cls} ${
                  !lido ? "ring-2 ring-indigo-300 dark:ring-indigo-700" : "opacity-80"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{prio.icon}</span>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{c.titulo}</h3>
                    {!lido && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-600 text-white font-bold">
                        Novo
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-500">
                    {c.criadoEm && new Date(c.criadoEm).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{c.corpo}</p>
                {c.validoAte && (
                  <div className="text-[10px] text-gray-500 mt-2">
                    Válido até {new Date(c.validoAte + "T12:00:00").toLocaleDateString("pt-BR")}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
