import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Cliente, Reserva } from "../../core/types";
import { ClienteModal } from "./ClienteModal";
import { ClienteHistoricoModal } from "./ClienteHistoricoModal";
import { phoneKey, upsertClienteLookup } from "./clienteLookup";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
  // Capabilities granulares (sistema novo). Opcionais — caller pode não
  // passar, e a tab cai no comportamento legado baseado em podeConfig.
  podeEditarCliente?: boolean;
  podeExcluirCliente?: boolean;
  podeMesclar?: boolean;
};

export function ClientesTab({ restaurantId, podeConfig, podeEditarCliente, podeExcluirCliente, podeMesclar }: Props) {
  // Backward compat: se capabilities granulares não vieram, herda do
  // podeConfig legado. Quando a Rodada 3+ migrar callers pra sempre passar
  // explicitamente, podemos remover esse fallback.
  const canEditar = podeEditarCliente ?? podeConfig;
  const canMesclar = podeMesclar ?? podeConfig;
  // Mantém refs vivas durante refactor — uso real em Rodada 3
  void canEditar; void canMesclar;
  const { pessoa } = useAuth();
  // Exclusão hard de cliente é restrita ao master — apaga referência em
  // /reservas, /notasCliente e /clientesPublicLookup. Pra LGPD (cliente
  // solicita exclusão dos próprios dados), o fluxo correto é via
  // /r/excluir-dados/:rid → /solicitacoesExclusao, que admin processa
  // formalmente. Pra dedupes, usa o banner "Mesclar".
  // Prop podeExcluirCliente (sistema novo de perfis) tem priority; fallback
  // pra isMaster pra retrocompat de callers que ainda não passam o prop.
  const podeExcluirClienteEfetivo = podeExcluirCliente ?? !!pessoa?.isMaster;
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filtroTag, setFiltroTag] = useState<string>("");
  const [editing, setEditing] = useState<Cliente | "new" | null>(null);
  const [verHistorico, setVerHistorico] = useState<Cliente | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "clientes"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cliente);
      list.sort((a, b) => a.nome.localeCompare(b.nome));
      setClientes(list);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(collection(db, "reservas"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setReservas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Reserva));
    });
    return () => unsub();
  }, [restaurantId]);

  // Recalcula stats por cliente baseado nas reservas (caso o snapshot tenha defasado)
  const statsPorCliente = useMemo(() => {
    const m: Record<string, { total: number; compareceu: number; noShow: number; ultima: string | null }> = {};
    for (const r of reservas) {
      if (!r.clienteId) continue;
      if (!m[r.clienteId]) m[r.clienteId] = { total: 0, compareceu: 0, noShow: 0, ultima: null };
      m[r.clienteId].total++;
      if (r.status === "chegou") {
        m[r.clienteId].compareceu++;
        if (!m[r.clienteId].ultima || r.data > m[r.clienteId].ultima!) {
          m[r.clienteId].ultima = r.data;
        }
      } else if (r.status === "no_show") {
        m[r.clienteId].noShow++;
      }
    }
    return m;
  }, [reservas]);

  // Tags disponíveis (todas as únicas)
  const tagsDisponiveis = useMemo(() => {
    const s = new Set<string>();
    clientes.forEach(c => (c.tags || []).forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [clientes]);

  // Grupos de duplicados — mesmo telefone (normalizado pra últimos 11 dígitos).
  // Pode acontecer quando: (a) reservas públicas anteriores ao lookup
  // determinístico criaram clientes redundantes; (b) admin cadastrou
  // manualmente um cliente que já existia. Mostramos banner pra mesclar.
  const grupoDuplicados = useMemo(() => {
    const m = new Map<string, Cliente[]>();
    for (const c of clientes) {
      const k = phoneKey(c.telefone);
      if (!k) continue;
      const arr = m.get(k) || [];
      arr.push(c);
      m.set(k, arr);
    }
    return Array.from(m.values()).filter(g => g.length > 1);
  }, [clientes]);

  const [mesclando, setMesclando] = useState<string | null>(null); // phoneKey em curso

  // Mescla um grupo de clientes em um só. Mantém o mais antigo (winner),
  // repointa todas as reservas dos outros pra ele, atualiza o lookup
  // público pra apontar pro winner, e deleta os perdedores.
  //
  // Campos opcionais (email, aniversario, restricoes, tags) são herdados
  // dos perdedores SÓ se o winner não tinha — não sobrescreve dados
  // curados pelo admin.
  async function mesclarGrupo(grupo: Cliente[]) {
    if (grupo.length < 2) return;
    // Mais antigo fica. Se criadoEm faltar, vai pro fim (string vazia).
    const ordenados = [...grupo].sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    const winner = ordenados[0]!;
    const perdedores = ordenados.slice(1);
    const nomesPerdedores = perdedores.map(c => c.nome).join(", ");
    if (!confirm(
      `Mesclar ${grupo.length} registros em "${winner.nome}"?\n\n` +
      `Mantém: ${winner.nome}\n` +
      `Some: ${nomesPerdedores}\n\n` +
      `As reservas dos registros que somem passam pro principal — histórico fica todo junto.`
    )) return;

    const key = phoneKey(winner.telefone);
    setMesclando(key);
    try {
      const now = new Date().toISOString();

      // 1) Merge de campos opcionais — winner só herda o que está vazio
      const camposHerdados: Partial<Cliente> = {};
      for (const p of perdedores) {
        if (!winner.email && p.email) camposHerdados.email = p.email;
        if (!winner.aniversario && p.aniversario) camposHerdados.aniversario = p.aniversario;
        if (!winner.restricoesAlimentares && p.restricoesAlimentares) {
          camposHerdados.restricoesAlimentares = p.restricoesAlimentares;
        }
        if (!winner.observacoes && p.observacoes) camposHerdados.observacoes = p.observacoes;
        // Tags: union
        const tagsExistentes = new Set(winner.tags || []);
        (p.tags || []).forEach(t => tagsExistentes.add(t));
        if (tagsExistentes.size > (winner.tags?.length || 0)) {
          camposHerdados.tags = Array.from(tagsExistentes);
        }
      }
      if (Object.keys(camposHerdados).length > 0) {
        await updateDoc(
          doc(db, "clientes", winner.id),
          sanitizeForFirestore({ ...camposHerdados, atualizadoEm: now }),
        );
      }

      // 2) Repointa reservas dos perdedores pro winner
      const reservasParaMigrar = reservas.filter(r =>
        perdedores.some(p => p.id === r.clienteId)
      );
      await Promise.all(reservasParaMigrar.map(r =>
        updateDoc(doc(db, "reservas", r.id), {
          clienteId: winner.id,
          atualizadoEm: now,
        })
      ));

      // 3) Atualiza o lookup público pra apontar pro winner. Próxima
      // reserva pública desse telefone cai direto no winner.
      await upsertClienteLookup({
        restaurantId,
        telefone: winner.telefone,
        nome: winner.nome,
        email: winner.email || camposHerdados.email,
        clienteId: winner.id,
      });

      // 4) Deleta perdedores
      await Promise.all(perdedores.map(p => deleteDoc(doc(db, "clientes", p.id))));
    } catch (e) {
      console.error("[clientes] merge falhou:", e);
      alert("Erro ao mesclar — tenta de novo.");
    } finally {
      setMesclando(null);
    }
  }

  const filtered = useMemo(() => {
    return clientes.filter(c => {
      if (filtroTag && !(c.tags || []).includes(filtroTag)) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (
          !c.nome.toLowerCase().includes(s) &&
          !(c.telefone || "").toLowerCase().includes(s) &&
          !(c.email || "").toLowerCase().includes(s)
        ) return false;
      }
      return true;
    });
  }, [clientes, search, filtroTag]);

  async function excluir(c: Cliente) {
    if (!confirm(`Excluir cliente "${c.nome}"?\n\nReservas antigas dele preservam o nome em snapshot.`)) return;
    await deleteDoc(doc(db, "clientes", c.id));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {clientes.length} cliente(s) cadastrado(s)
        </div>
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Novo cliente</Button>
        )}
      </div>

      <Input
        placeholder="🔍 Buscar por nome, telefone, email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {tagsDisponiveis.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Tags:</span>
          <button
            type="button"
            onClick={() => setFiltroTag("")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              !filtroTag
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            Todas
          </button>
          {tagsDisponiveis.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setFiltroTag(t === filtroTag ? "" : t)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filtroTag === t
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              🏷️ {t}
            </button>
          ))}
        </div>
      )}

      {podeConfig && grupoDuplicados.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-3 space-y-2">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
            ⚠ {grupoDuplicados.length} {grupoDuplicados.length === 1 ? "grupo" : "grupos"} de clientes com telefone igual
          </div>
          <div className="text-xs text-amber-800 dark:text-amber-300">
            Mescla pra juntar o histórico de reservas num registro só.
          </div>
          <div className="space-y-1.5 pt-1">
            {grupoDuplicados.map(grupo => {
              const k = phoneKey(grupo[0]!.telefone);
              const emCurso = mesclando === k;
              return (
                <div
                  key={k}
                  className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900 rounded-lg p-2.5 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="text-xs text-gray-700 dark:text-gray-300 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      📞 {grupo[0]!.telefone}
                    </div>
                    <div className="text-gray-500 mt-0.5">
                      {grupo.map(c => c.nome).join(" · ")}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => mesclarGrupo(grupo)}
                    disabled={emCurso}
                  >
                    {emCurso ? "Mesclando..." : `🔀 Mesclar em 1`}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">👥</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search || filtroTag ? "Nenhum cliente encontrado" : "Sem clientes"}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(c => {
            const stats = statsPorCliente[c.id];
            const compareceu = stats?.compareceu ?? c.totalCompareceu ?? 0;
            const noShow = stats?.noShow ?? c.totalNoShow ?? 0;
            const ultima = stats?.ultima ?? c.ultimaVisita;
            const total = compareceu + noShow + (stats?.total || c.totalReservas || 0) - compareceu - noShow;
            // Aniversário hoje?
            let aniversarioHoje = false;
            if (c.aniversario) {
              const hoje = new Date();
              const mm = String(hoje.getMonth() + 1).padStart(2, "0");
              const dd = String(hoje.getDate()).padStart(2, "0");
              const aniv = c.aniversario.length === 5 ? c.aniversario : c.aniversario.slice(5); // pega MM-DD
              aniversarioHoje = aniv === `${mm}-${dd}`;
            }
            return (
              <div
                key={c.id}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100">{c.nome}</h3>
                      {aniversarioHoje && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
                          🎂 Hoje!
                        </span>
                      )}
                      {(c.tags || []).map(t => (
                        <span key={t} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {c.telefone && <span>📞 {c.telefone}</span>}
                      {c.email && <span>✉️ {c.email}</span>}
                      {c.aniversario && (
                        <span>🎂 {c.aniversario.length === 5 ? c.aniversario.split("-").reverse().join("/") : new Date(c.aniversario + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                      )}
                    </div>
                    {c.restricoesAlimentares && (
                      <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        ⚠ {c.restricoesAlimentares}
                      </div>
                    )}
                    {c.observacoes && (
                      <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 italic">{c.observacoes}</div>
                    )}
                    {/* Stats */}
                    <div className="text-[11px] text-gray-500 mt-1.5 flex gap-3 flex-wrap">
                      {compareceu > 0 && <span>🪑 {compareceu} visita(s)</span>}
                      {total > 0 && <span>📅 {total} reserva(s)</span>}
                      {noShow > 0 && <span className="text-rose-600">😶 {noShow} no-show</span>}
                      {ultima && <span>· última: {new Date(ultima + "T12:00:00").toLocaleDateString("pt-BR")}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <Button variant="secondary" size="sm" onClick={() => setVerHistorico(c)}>📊 Histórico</Button>
                    {podeConfig && (
                      <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>Editar</Button>
                    )}
                    {podeExcluirClienteEfetivo && (
                      <Button variant="danger" size="sm" onClick={() => excluir(c)} title="Exclusão hard (master ou perfil com permissão). Pra LGPD use o fluxo de solicitação de exclusão.">×</Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ClienteModal
          cliente={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}
      {verHistorico && (
        <ClienteHistoricoModal
          cliente={verHistorico}
          reservas={reservas.filter(r => r.clienteId === verHistorico.id)}
          onClose={() => setVerHistorico(null)}
        />
      )}
    </div>
  );
}
