// Modal disparado pelo botão "🪑 Cliente chegou" no card de uma reserva.
// Recepção/hostess registra:
//   1. Em qual mesa o cliente sentou (filtrada pelo salão da reserva)
//   2. Opcionalmente uma nota — vai pro log do cliente (ex: "gostou da
//      mesa do canto", "alérgico a camarão (não mencionou no form)")
//
// Ao salvar:
//   - Atualiza /reservas/{id}: status="chegou", mesaId, mesaNomeSnapshot, chegouEm
//   - Atualiza /clientes/{cid}: ultimaVisita
//   - Cria /notasCliente se texto não-vazio
//
// Mesas sem salaoId (legado) entram em "Outras mesas" se o salão da
// reserva não tem mesas próprias — não trava a operação.

import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { criarNotaCliente } from "./notasCliente";
import type { Mesa, Reserva, Salao } from "../../core/types";

type Props = {
  reserva: Reserva;
  mesas: Mesa[];                       // todas as mesas do restaurante
  saloes: Salao[];
  reservasDoDia: Reserva[];            // pra detectar mesas ocupadas no slot
  onClose: () => void;
};

export function ChegouModal({ reserva, mesas, saloes, reservasDoDia, onClose }: Props) {
  const { pessoa: me } = useAuth();

  const [mesaId, setMesaId] = useState<string>(reserva.mesaId || "");
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Mesas que outras reservas já estão usando no mesmo slot (ignorando a
  // própria reserva e canceladas/no-show). Pra não confundir, exibe como
  // ocupadas mas permite forçar — hostess decide na hora.
  const mesasOcupadasNoSlot = useMemo(() => {
    const s = new Set<string>();
    for (const r of reservasDoDia) {
      if (r.id === reserva.id) continue;
      if (r.status === "cancelada" || r.status === "no_show") continue;
      if (r.horario !== reserva.horario) continue;
      if (r.mesaId) s.add(r.mesaId);
    }
    return s;
  }, [reservasDoDia, reserva.id, reserva.horario]);

  // Agrupa mesas POR salão pra exibir todas. Cliente reservou um salão
  // específico mas, se chegou e tem espaço em outro, hostess pode sentar
  // em qualquer mesa — todas precisam aparecer aqui (nada de accordion
  // escondendo outros salões).
  //
  // Ordem de exibição: salão da reserva primeiro (destacado), depois os
  // outros pela ordem do cadastro. Mesas sem salaoId (legado) por último,
  // em accordion (caso raro).
  const gruposPorSalao = useMemo(() => {
    const ativas = mesas.filter(m => m.ativa);
    ativas.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));

    const porSalao = new Map<string, Mesa[]>();
    const semSalao: Mesa[] = [];
    for (const m of ativas) {
      if (!m.salaoId) {
        semSalao.push(m);
        continue;
      }
      const arr = porSalao.get(m.salaoId) || [];
      arr.push(m);
      porSalao.set(m.salaoId, arr);
    }

    // Ordena salões: o da reserva primeiro, depois pela ordem do cadastro
    const saloesOrdenados = [...saloes].sort((a, b) => {
      const aEhDaReserva = a.id === reserva.salaoId ? 0 : 1;
      const bEhDaReserva = b.id === reserva.salaoId ? 0 : 1;
      if (aEhDaReserva !== bEhDaReserva) return aEhDaReserva - bEhDaReserva;
      return (a.ordem ?? 999) - (b.ordem ?? 999);
    });

    const grupos: { salao: Salao; ehDaReserva: boolean; mesas: Mesa[] }[] = [];
    for (const s of saloesOrdenados) {
      const list = porSalao.get(s.id) || [];
      if (list.length === 0) continue;
      grupos.push({ salao: s, ehDaReserva: s.id === reserva.salaoId, mesas: list });
    }
    return { grupos, semSalao };
  }, [mesas, saloes, reserva.salaoId]);

  async function salvar() {
    if (!me) return;
    if (!mesaId) {
      setErro("Escolhe a mesa onde o cliente sentou.");
      return;
    }
    const mesa = mesas.find(m => m.id === mesaId);
    if (!mesa) {
      setErro("Mesa não encontrada.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const now = new Date().toISOString();
      const patch: Partial<Reserva> = {
        status: "chegou",
        mesaId: mesa.id,
        mesaNomeSnapshot: mesa.nome,
        chegouEm: now,
        atualizadoEm: now,
      };
      await updateDoc(doc(db, "reservas", reserva.id), sanitizeForFirestore(patch));

      // Atualiza ultimaVisita do cliente
      if (reserva.clienteId) {
        try {
          await updateDoc(doc(db, "clientes", reserva.clienteId), {
            ultimaVisita: reserva.data,
            atualizadoEm: now,
          });
        } catch (e) { console.error("[chegou] update cliente:", e); }
      }

      // Cria nota se texto não-vazio
      if (nota.trim() && reserva.clienteId) {
        await criarNotaCliente({
          restaurantId: reserva.restaurantId,
          clienteId: reserva.clienteId,
          reservaId: reserva.id,
          texto: nota,
          criadoPor: me.id,
          criadoPorNome: me.nome,
        });
      }

      onClose();
    } catch (e) {
      console.error("[chegou] save falhou:", e);
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  function renderMesa(m: Mesa) {
    const ativo = mesaId === m.id;
    const ocupada = mesasOcupadasNoSlot.has(m.id);
    const capacidadeOk = m.capacidade >= (reserva.pessoas || 1);
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => setMesaId(m.id)}
        className={`relative px-3 py-2 rounded-lg border text-left transition-colors ${
          ativo
            ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
            : ocupada
              ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 text-gray-500"
              : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 hover:border-indigo-300"
        }`}
      >
        <div className="font-bold">{m.nome}</div>
        <div className="text-[11px] opacity-70 flex items-center gap-2">
          <span>{m.capacidade} pax</span>
          {ocupada && <span className="text-rose-600">· ocupada</span>}
          {!capacidadeOk && !ocupada && <span className="text-amber-600">· pequena pra {reserva.pessoas} pax</span>}
        </div>
      </button>
    );
  }

  const semMesasNoSistema =
    gruposPorSalao.grupos.length === 0 && gruposPorSalao.semSalao.length === 0;

  return (
    <Modal title={`🪑 Cliente chegou — ${reserva.clienteNomeSnapshot || "Reserva"}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {/* Resumo da reserva */}
        <div className="text-xs rounded-lg p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
          ⏰ {reserva.horario} · 👥 {reserva.pessoas} pessoa(s)
          {reserva.salaoNomeSnapshot && <> · 🏛️ {reserva.salaoNomeSnapshot}</>}
        </div>

        {/* Escolha de mesa */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            Em que mesa sentou? *
          </label>
          {semMesasNoSistema ? (
            <div className="text-sm rounded-lg p-3 bg-amber-50 border border-amber-200 text-amber-800">
              Nenhuma mesa cadastrada ainda. Vá em <strong>Configurações → Mesas</strong> pra cadastrar.
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
              {gruposPorSalao.grupos.map(({ salao, ehDaReserva, mesas: list }) => (
                <div key={salao.id}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-gray-600 dark:text-gray-400">
                      🏛️ {salao.nome}
                    </div>
                    {ehDaReserva && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        ★ salão da reserva
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                    {list.map(renderMesa)}
                  </div>
                </div>
              ))}
              {gruposPorSalao.semSalao.length > 0 && (
                <details>
                  <summary className="text-[10px] uppercase tracking-wider text-gray-500 cursor-pointer hover:text-gray-700">
                    ▼ Sem salão atribuído ({gruposPorSalao.semSalao.length})
                  </summary>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mt-1.5">
                    {gruposPorSalao.semSalao.map(renderMesa)}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Nota opcional */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Nota (opcional) — vai pro histórico do cliente
          </label>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            placeholder='ex: "pediu mesa do canto, gostou muito", "alérgico a camarão"'
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
          />
          {nota.trim() && !reserva.clienteId && (
            <p className="text-[11px] text-amber-600 mt-1">
              ⚠ Reserva sem cliente vinculado — a nota não vai poder ser salva.
            </p>
          )}
        </div>

        {erro && <div className="text-sm text-rose-600">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !mesaId}>
            {salvando ? "Salvando..." : "Marcar como chegou"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
