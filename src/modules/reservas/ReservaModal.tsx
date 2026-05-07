import { useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd } from "../../core/utils/date";
import { RESERVA_STATUS_ICON, RESERVA_STATUS_LABEL } from "../../core/types";
import type { Cliente, Mesa, Reserva, ReservaStatus } from "../../core/types";
import { ClienteModal } from "./ClienteModal";

type Props = {
  reserva: Reserva | null;
  defaultData?: string;          // pré-preenchimento
  clientes: Cliente[];
  mesas: Mesa[];
  reservasMesmoDia: Reserva[];   // pra detectar conflito de mesa/horário
  restaurantId: string;
  onClose: () => void;
};

const STATUSES: ReservaStatus[] = ["pendente", "confirmada", "chegou", "no_show", "cancelada"];

export function ReservaModal({ reserva, defaultData, clientes, mesas, reservasMesmoDia, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !reserva;

  const [data, setData] = useState(reserva?.data || defaultData || todayYmd());
  const [horario, setHorario] = useState(reserva?.horario || "20:00");
  const [pessoas, setPessoas] = useState(String(reserva?.pessoas || 2));
  // Cliente
  const [clienteId, setClienteId] = useState<string | null>(reserva?.clienteId ?? null);
  const [clienteNome, setClienteNome] = useState(reserva?.clienteNomeSnapshot || "");
  const [clienteTelefone, setClienteTelefone] = useState(reserva?.clienteTelefoneSnapshot || "");
  const [showSearch, setShowSearch] = useState(false);
  const [searchCliente, setSearchCliente] = useState("");
  const [novoClienteOpen, setNovoClienteOpen] = useState(false);
  // Mesa
  const [mesaId, setMesaId] = useState<string | null>(reserva?.mesaId ?? null);
  // Outros
  const [observacoes, setObservacoes] = useState(reserva?.observacoes || "");
  const [ocasiao, setOcasiao] = useState(reserva?.ocasiao || "");
  const [status, setStatus] = useState<ReservaStatus>(reserva?.status || "pendente");
  const [motivoCancel, setMotivoCancel] = useState(reserva?.motivoCancelamento || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Sincroniza nome quando seleciona cliente da lista
  function selecionarCliente(c: Cliente) {
    setClienteId(c.id);
    setClienteNome(c.nome);
    setClienteTelefone(c.telefone || "");
    setShowSearch(false);
    setSearchCliente("");
  }

  function limparCliente() {
    setClienteId(null);
  }

  // Sugestões de busca
  const clientesFiltered = useMemo(() => {
    if (!searchCliente.trim()) return clientes.slice(0, 50);
    const s = searchCliente.toLowerCase();
    return clientes.filter(c =>
      c.nome.toLowerCase().includes(s) ||
      (c.telefone || "").toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s)
    ).slice(0, 50);
  }, [clientes, searchCliente]);

  // Detecta conflito de mesa: outra reserva ATIVA na mesma mesa em janela de ±2h
  const conflitoMesa = useMemo(() => {
    if (!mesaId || !horario) return null;
    const [h, m] = horario.split(":").map(Number);
    const inicio = h * 60 + m - 120; // 2h antes
    const fim = h * 60 + m + 120;    // 2h depois
    return reservasMesmoDia.find(r => {
      if (r.id === reserva?.id) return false;
      if (r.mesaId !== mesaId) return false;
      if (r.status === "cancelada" || r.status === "no_show") return false;
      const [rh, rm] = (r.horario || "00:00").split(":").map(Number);
      const rmin = rh * 60 + rm;
      return rmin >= inicio && rmin <= fim;
    });
  }, [mesaId, horario, reservasMesmoDia, reserva?.id]);

  // Mesa selecionada — checa capacidade
  const mesaSel = mesas.find(m => m.id === mesaId);
  const pessoasNum = parseInt(pessoas, 10) || 0;
  const capacidadeOk = !mesaSel || mesaSel.capacidade >= pessoasNum;

  // Mesas ativas com capacidade suficiente, ordenadas
  const mesasOrdenadas = useMemo(() => {
    return [...mesas]
      .filter(m => m.ativa)
      .sort((a, b) => (a.setor || "").localeCompare(b.setor || "") || a.nome.localeCompare(b.nome));
  }, [mesas]);

  async function salvar() {
    if (!clienteNome.trim()) { setErr("Cliente obrigatório (escolha cadastrado ou digite nome)"); return; }
    if (!data) { setErr("Data obrigatória"); return; }
    if (!horario) { setErr("Horário obrigatório"); return; }
    if (pessoasNum <= 0) { setErr("Quantidade de pessoas inválida"); return; }
    if (!me) return;

    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const mesaSnapshot = mesaSel ? mesaSel.nome : undefined;

      // Detecta mudança de status pra timestamp
      const statusMudou = reserva?.status !== status;
      const confirmadaEm =
        statusMudou && status === "confirmada" ? now :
        reserva?.confirmadaEm;
      const chegouEm =
        statusMudou && status === "chegou" ? now :
        reserva?.chegouEm;
      const canceladaEm =
        statusMudou && status === "cancelada" ? now :
        reserva?.canceladaEm;

      const payload: Omit<Reserva, "id"> = {
        restaurantId,
        data,
        horario,
        clienteId: clienteId || null,
        clienteNomeSnapshot: clienteNome.trim(),
        clienteTelefoneSnapshot: clienteTelefone.trim() || undefined,
        pessoas: pessoasNum,
        mesaId: mesaId || null,
        mesaNomeSnapshot: mesaSnapshot,
        observacoes: observacoes.trim() || undefined,
        ocasiao: ocasiao.trim() || undefined,
        status,
        confirmadaEm: confirmadaEm ?? null,
        chegouEm: chegouEm ?? null,
        canceladaEm: canceladaEm ?? null,
        motivoCancelamento: status === "cancelada" ? (motivoCancel.trim() || undefined) : reserva?.motivoCancelamento,
        registradoEm: reserva?.registradoEm || now,
        registradoPor: reserva?.registradoPor || me.id,
        atualizadoEm: now,
      };

      if (isNew) {
        await addDoc(collection(db, "reservas"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "reservas", reserva.id), sanitizeForFirestore(payload));
      }

      // Se vinculou a um cliente cadastrado, atualiza stats dele (best-effort)
      if (clienteId) {
        const dadosCliente = clientes.find(c => c.id === clienteId);
        if (dadosCliente) {
          const ultimaVisita = status === "chegou" && (!dadosCliente.ultimaVisita || data > dadosCliente.ultimaVisita)
            ? data
            : dadosCliente.ultimaVisita;
          // best-effort — recálculo principal acontece na ClientesTab
          await updateDoc(doc(db, "clientes", clienteId), sanitizeForFirestore({
            atualizadoEm: now,
            ultimaVisita: ultimaVisita ?? null,
          }));
        }
      }

      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal title={isNew ? "+ Nova reserva" : `Editar reserva — ${reserva?.clienteNomeSnapshot}`} onClose={onClose} maxWidth="max-w-2xl">
        <div className="space-y-3">
          {/* Cliente */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
              Cliente *
            </label>
            {clienteId ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-indigo-900 dark:text-indigo-200 truncate">{clienteNome}</div>
                  {clienteTelefone && <div className="text-xs text-indigo-700 dark:text-indigo-400 truncate">📞 {clienteTelefone}</div>}
                </div>
                <Button variant="secondary" size="sm" onClick={limparCliente}>↻ Trocar</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={clienteNome}
                    onChange={(e) => setClienteNome(e.target.value)}
                    placeholder="Nome do cliente (digite ou busque)"
                    onFocus={() => setShowSearch(true)}
                    className="flex-1"
                  />
                  <Button variant="secondary" onClick={() => setShowSearch(s => !s)}>🔍 Buscar</Button>
                  <Button variant="secondary" onClick={() => setNovoClienteOpen(true)}>+ Novo</Button>
                </div>
                {!clienteId && (
                  <Input
                    value={clienteTelefone}
                    onChange={(e) => setClienteTelefone(e.target.value)}
                    placeholder="Telefone (opcional)"
                  />
                )}
                {showSearch && (
                  <div className="border border-gray-200 dark:border-gray-800 rounded-lg max-h-[200px] overflow-y-auto bg-white dark:bg-gray-900">
                    <Input
                      autoFocus
                      value={searchCliente}
                      onChange={(e) => setSearchCliente(e.target.value)}
                      placeholder="Buscar cadastrado por nome / telefone..."
                      className="m-2 sticky top-0"
                    />
                    {clientesFiltered.length === 0 ? (
                      <div className="p-3 text-center text-xs text-gray-500">Nenhum cadastrado.</div>
                    ) : clientesFiltered.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selecionarCliente(c)}
                        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                      >
                        <div className="text-sm font-medium">{c.nome}</div>
                        <div className="text-[11px] text-gray-500">
                          {c.telefone && <>📞 {c.telefone}</>}
                          {c.tags && c.tags.length > 0 && <> · 🏷️ {c.tags.join(", ")}</>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Data + horário + pessoas */}
          <div className="grid grid-cols-3 gap-3">
            <Input label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            <Input label="Horário *" type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
            <Input label="Pessoas *" type="number" min={1} value={pessoas} onChange={(e) => setPessoas(e.target.value)} />
          </div>

          {/* Mesa */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Mesa</label>
            <select
              value={mesaId || ""}
              onChange={(e) => setMesaId(e.target.value || null)}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <option value="">— sem mesa designada —</option>
              {mesasOrdenadas.map(m => (
                <option key={m.id} value={m.id}>
                  {m.setor ? `[${m.setor}] ` : ""}{m.nome} · 👥 {m.capacidade}
                </option>
              ))}
            </select>
            {!capacidadeOk && (
              <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                ⚠ Mesa "{mesaSel?.nome}" tem capacidade {mesaSel?.capacidade}, mas a reserva é pra {pessoasNum} pessoa(s).
              </div>
            )}
            {conflitoMesa && (
              <div className="text-xs text-rose-700 dark:text-rose-400 mt-1">
                ⚠ Conflito: já existe outra reserva nessa mesa às <strong>{conflitoMesa.horario}</strong> ({conflitoMesa.clienteNomeSnapshot}).
              </div>
            )}
          </div>

          {/* Ocasião + observações */}
          <Input
            label="Ocasião"
            value={ocasiao}
            onChange={(e) => setOcasiao(e.target.value)}
            placeholder="ex: Aniversário, Almoço de negócios"
          />
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observações</label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              placeholder="ex: alergia a frutos do mar, preferência por mesa próxima da janela..."
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
            />
          </div>

          {/* Status */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">Status</label>
            <div className="grid grid-cols-5 gap-2">
              {STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                    status === s
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                      : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}
                >
                  {RESERVA_STATUS_ICON[s]} {RESERVA_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {status === "cancelada" && (
              <Input
                label="Motivo do cancelamento"
                value={motivoCancel}
                onChange={(e) => setMotivoCancel(e.target.value)}
                placeholder="ex: cliente avisou que não vem"
                className="mt-2"
              />
            )}
          </div>

          {err && <div className="text-sm text-rose-600">{err}</div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving ? "Salvando..." : isNew ? "Criar reserva" : "Salvar"}
            </Button>
          </div>
        </div>
      </Modal>

      {novoClienteOpen && (
        <ClienteModal
          cliente={null}
          restaurantId={restaurantId}
          onClose={() => setNovoClienteOpen(false)}
          onCreated={(id, nome) => {
            setClienteId(id);
            setClienteNome(nome);
            setShowSearch(false);
          }}
        />
      )}
    </>
  );
}
