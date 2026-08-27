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
import { reservaMesaIds } from "../../core/reservas/mesas";
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

  const [mesaIds, setMesaIds] = useState<string[]>(() => reservaMesaIds(reserva));
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function toggleMesa(id: string) {
    setMesaIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  // Mesas que outras reservas já estão usando no mesmo slot (ignorando a
  // própria reserva e canceladas/no-show). Pra não confundir, exibe como
  // ocupadas mas permite forçar — hostess decide na hora.
  const mesasOcupadasNoSlot = useMemo(() => {
    const s = new Set<string>();
    for (const r of reservasDoDia) {
      if (r.id === reserva.id) continue;
      if (r.status === "cancelada" || r.status === "no_show") continue;
      if (r.horario !== reserva.horario) continue;
      for (const id of reservaMesaIds(r)) s.add(id);
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
    if (mesaIds.length === 0) {
      setErro("Escolhe a(s) mesa(s) onde o cliente sentou.");
      return;
    }
    const mesasSel = mesaIds.map(id => mesas.find(m => m.id === id)).filter((m): m is Mesa => !!m);
    if (mesasSel.length === 0) {
      setErro("Mesa não encontrada.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const now = new Date().toISOString();
      const patch: Partial<Reserva> = {
        status: "chegou",
        mesaId: mesasSel[0].id,               // legado: 1ª mesa
        mesaNomeSnapshot: mesasSel[0].nome,   // legado: nome da 1ª
        mesaIds: mesaIds,
        mesasNomesSnapshot: mesasSel.map(m => m.nome),
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

  const pax = reserva.pessoas || 1;

  // Status visual de cada mesa pra reserva atual:
  //   "ideal"     — capacidade exata
  //   "ok"        — capacidade maior (cabe sobrando)
  //   "pequena"   — não cabe a reserva (mostra mas em cinza)
  //   "ocupada"   — outra reserva tá usando no mesmo slot
  function statusMesa(m: Mesa): "ideal" | "ok" | "pequena" | "ocupada" {
    if (mesasOcupadasNoSlot.has(m.id)) return "ocupada";
    if (m.capacidade === pax) return "ideal";
    if (m.capacidade > pax) return "ok";
    return "pequena";
  }

  function renderMesa(m: Mesa) {
    const ativo = mesaIds.includes(m.id);
    const status = statusMesa(m);
    const bloqueada = status === "ocupada" && !ativo;
    // Estilos por status — visual de "tile" de mesa, número grande e cap pequena.
    let containerCls = "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 hover:border-indigo-400";
    let badge = "";
    let badgeCls = "";
    if (ativo) {
      containerCls = "bg-indigo-600 border-indigo-600 text-white shadow-md";
    } else if (status === "ocupada") {
      containerCls = "bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 text-gray-400 line-through";
      badge = "ocupada";
      badgeCls = "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
    } else if (status === "ideal") {
      containerCls = "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 hover:border-emerald-500";
      badge = "ideal";
      badgeCls = "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200";
    } else if (status === "pequena") {
      containerCls = "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800 text-gray-500 opacity-70 hover:opacity-100";
      badge = "pequena";
      badgeCls = "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    }
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => toggleMesa(m.id)}
        disabled={bloqueada}
        className={`relative aspect-[5/4] flex flex-col items-center justify-center rounded-xl border-2 transition-all ${containerCls} ${bloqueada ? "cursor-not-allowed" : ""}`}
        title={bloqueada ? "Mesa já reservada nesse horário" : `Mesa ${m.nome} · ${m.capacidade} pax`}
      >
        <div className="text-2xl font-bold leading-none">{m.nome}</div>
        <div className={`text-[11px] mt-1 ${ativo ? "opacity-90" : "opacity-70"}`}>
          {m.capacidade} pax
        </div>
        {badge && !ativo && (
          <span className={`absolute -top-1.5 -right-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeCls}`}>
            {badge}
          </span>
        )}
      </button>
    );
  }

  // Ordena dentro do salão: ideais → ok → pequenas → ocupadas, todas
  // mantendo ordem do cadastro como desempate.
  function ordenarMesasPorAdequacao(list: Mesa[]): Mesa[] {
    const peso = (m: Mesa) => {
      const s = statusMesa(m);
      if (s === "ideal") return 0;
      if (s === "ok") return 1;
      if (s === "pequena") return 2;
      return 3; // ocupada
    };
    return [...list].sort((a, b) => {
      const pa = peso(a), pb = peso(b);
      if (pa !== pb) return pa - pb;
      return (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome);
    });
  }

  const semMesasNoSistema =
    gruposPorSalao.grupos.length === 0 && gruposPorSalao.semSalao.length === 0;

  const mesasSelecionadas = mesaIds.map(id => mesas.find(m => m.id === id)).filter((m): m is Mesa => !!m);
  const capacidadeSel = mesasSelecionadas.reduce((s, m) => s + (m.capacidade || 0), 0);

  return (
    <Modal title={`🪑 Cliente chegou — ${reserva.clienteNomeSnapshot || "Reserva"}`} onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        {/* Resumo da reserva — chips horizontais */}
        <div className="flex flex-wrap gap-2 text-sm">
          <Chip>⏰ {reserva.horario}</Chip>
          <Chip>👥 {reserva.pessoas} {reserva.pessoas === 1 ? "pessoa" : "pessoas"}</Chip>
          {reserva.salaoNomeSnapshot && <Chip>🏛️ {reserva.salaoNomeSnapshot}</Chip>}
          {mesasSelecionadas.length > 0 && (
            <Chip cor="indigo">
              ✓ {mesasSelecionadas.length > 1 ? "Mesas" : "Mesa"} {mesasSelecionadas.map(m => m.nome).join(" + ")}
              {mesasSelecionadas.length > 1 && <> · 👥 {capacidadeSel}</>}
            </Chip>
          )}
        </div>

        {/* Grid de mesas */}
        {semMesasNoSistema ? (
          <div className="text-sm rounded-lg p-4 bg-amber-50 border border-amber-200 text-amber-800">
            <strong>Nenhuma mesa cadastrada ainda.</strong>
            <br />
            Vá em <strong>Configurações → Mesas</strong> e use "⚡ Adicionar várias" pra cadastrar.
          </div>
        ) : (
          <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
            {gruposPorSalao.grupos.map(({ salao, ehDaReserva, mesas: list }) => (
              <div key={salao.id}>
                <div className="flex items-center gap-2 mb-2 sticky top-0 bg-white dark:bg-gray-950 py-1 z-10">
                  <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
                    🏛️ {salao.nome}
                  </div>
                  {ehDaReserva && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      ★ salão da reserva
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">
                    ({list.length} {list.length === 1 ? "mesa" : "mesas"})
                  </span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {ordenarMesasPorAdequacao(list).map(renderMesa)}
                </div>
              </div>
            ))}
            {gruposPorSalao.semSalao.length > 0 && (
              <details>
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 mb-2">
                  ▼ Sem salão atribuído ({gruposPorSalao.semSalao.length})
                </summary>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {ordenarMesasPorAdequacao(gruposPorSalao.semSalao).map(renderMesa)}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Legenda visual */}
        {!semMesasNoSistema && (
          <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-200 dark:bg-emerald-900/60"></span> ideal ({pax} pax)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-white dark:bg-gray-900 border border-gray-300"></span> cabe
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-100 dark:bg-gray-800 border border-gray-300"></span> menor que reserva
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-100 dark:bg-rose-900/40"></span> ocupada no slot
            </span>
          </div>
        )}

        {/* Nota opcional */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            📝 Nota (opcional) — vai pro histórico do cliente
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
          <Button onClick={salvar} disabled={salvando || mesaIds.length === 0}>
            {salvando ? "Salvando..." : "Marcar como chegou"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Chip horizontal — usado no resumo da reserva no topo do modal
function Chip({ children, cor = "gray" }: { children: React.ReactNode; cor?: "gray" | "indigo" }) {
  const cls = cor === "indigo"
    ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900"
    : "bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}
