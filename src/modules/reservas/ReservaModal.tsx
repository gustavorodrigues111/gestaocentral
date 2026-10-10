import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Phone, Search, Tag, Users, TriangleAlert, FileText, CalendarHeart, Pencil } from "lucide-react";
import { addDoc, collection, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd, fmtBR } from "../../core/utils/date";
import { RESERVA_STATUS_LUCIDE, RESERVA_STATUS_LABEL } from "../../core/types";
import type { Cliente, Mesa, Reserva, ReservaStatus, ReservaEvento, ReservaPagamento } from "../../core/types";
import { reservaMesaIds } from "../../core/reservas/mesas";
import { centralUpload } from "../../core/google/driveCentral";
import { ClienteModal } from "./ClienteModal";

const parseR = (s: string) => { const n = parseFloat((s || "").replace(/[R$\s.]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const fmtCents = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FORMAS_PG = ["pix", "dinheiro", "debito", "credito", "transferencia", "outro"];
const FORMA_PG_LABEL: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", debito: "Cartão débito", credito: "Cartão crédito", transferencia: "Transferência", outro: "Outro" };

type Props = {
  reserva: Reserva | null;
  defaultData?: string;          // pré-preenchimento
  clientes: Cliente[];
  mesas: Mesa[];
  reservasMesmoDia: Reserva[];   // pra detectar conflito de mesa/horário
  restaurantId: string;
  evento?: ReservaEvento | null; // se setado, é reserva de evento (com pagamento)
  startReadOnly?: boolean;       // abre só visualizando (lápis pra editar)
  onClose: () => void;
};

const STATUSES: ReservaStatus[] = ["pendente", "confirmada", "chegou", "no_show", "cancelada"];

// Tela de VISUALIZAÇÃO da reserva (read-only, sem caixas de formulário).
function ResumoReserva({ clienteNome, clienteTelefone, data, horario, pessoas, mesas, status, eventoNome, ocasiao, observacoes, pagamento }: {
  clienteNome: string; clienteTelefone?: string; data: string; horario: string; pessoas: number; mesas: string[]; status: ReservaStatus;
  eventoNome?: string; ocasiao?: string; observacoes?: string;
  pagamento?: { pago: boolean; forma?: string; valor?: number; comprovanteUrl?: string };
}) {
  const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const Campo = ({ label, children }: { label: string; children: ReactNode }) => (
    <div><div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div><div className="text-sm text-gray-800 dark:text-gray-100">{children}</div></div>
  );
  const Ic = RESERVA_STATUS_LUCIDE[status];
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-[16px] text-gray-900 dark:text-gray-100 truncate">{clienteNome || "—"}</div>
          {clienteTelefone && <div className="text-xs text-gray-500 inline-flex items-center gap-1 mt-0.5"><Phone size={11} /> {clienteTelefone}</div>}
        </div>
        <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 inline-flex items-center gap-1"><Ic size={12} /> {RESERVA_STATUS_LABEL[status]}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 p-3">
        <Campo label="Data"><span className="tabular-nums">{fmtBR(data)}</span></Campo>
        <Campo label="Horário"><span className="tabular-nums">{horario}</span></Campo>
        <Campo label="Pessoas">{pessoas}</Campo>
        {mesas.length > 0 && <Campo label={mesas.length > 1 ? "Mesas" : "Mesa"}>{mesas.join(", ")}</Campo>}
        {eventoNome && <Campo label="Evento">{eventoNome}</Campo>}
        {ocasiao && <Campo label="Ocasião">{ocasiao}</Campo>}
      </div>
      {observacoes && <Campo label="Observações">{observacoes}</Campo>}
      {pagamento && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Pagamento</div>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {pagamento.pago
              ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Pago</span>
              : <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Pendente</span>}
            {pagamento.valor != null && <span className="font-semibold tabular-nums">{fmtR(pagamento.valor)}</span>}
            {pagamento.forma && <span className="text-gray-400">· {pagamento.forma}</span>}
          </div>
          {pagamento.comprovanteUrl && <a href={pagamento.comprovanteUrl} target="_blank" rel="noreferrer" className="text-[12px] text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 mt-1.5"><FileText size={12} /> ver comprovante</a>}
        </div>
      )}
    </div>
  );
}

export function ReservaModal({ reserva, defaultData, clientes, mesas, reservasMesmoDia, restaurantId, evento, startReadOnly, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !reserva;
  const evId = evento?.id ?? reserva?.eventoId ?? null;
  const [editing, setEditing] = useState(isNew ? true : !startReadOnly);

  const [data, setData] = useState(reserva?.data || defaultData || evento?.dataInicio || todayYmd());
  const [horario, setHorario] = useState(reserva?.horario || evento?.horarioPadrao || "20:00");
  const [pessoas, setPessoas] = useState(String(reserva?.pessoas || 2));
  // Pagamento (eventos)
  const pagIni = reserva?.pagamento;
  const [pago, setPago] = useState(!!pagIni?.pago);
  const [formaPg, setFormaPg] = useState(pagIni?.forma || "pix");
  const [valorPg, setValorPg] = useState(pagIni?.valor != null ? fmtCents(Math.round(pagIni.valor * 100)) : "");
  const [compFile, setCompFile] = useState<File | null>(null);
  const valorTocado = useRef(pagIni?.valor != null);
  // Cliente
  const [clienteId, setClienteId] = useState<string | null>(reserva?.clienteId ?? null);
  const [clienteNome, setClienteNome] = useState(reserva?.clienteNomeSnapshot || "");
  const [clienteTelefone, setClienteTelefone] = useState(reserva?.clienteTelefoneSnapshot || "");
  const [showSearch, setShowSearch] = useState(false);
  const [searchCliente, setSearchCliente] = useState("");
  const [novoClienteOpen, setNovoClienteOpen] = useState(false);
  // Mesa(s) — pode unir várias numa reserva (ex: 15+16+17 pra um grupo)
  const [mesaIds, setMesaIds] = useState<string[]>(() => reservaMesaIds(reserva));
  // Outros
  const [observacoes, setObservacoes] = useState(reserva?.observacoes || "");
  // Evento: a "ocasião" é o próprio nome do evento (campo fica oculto).
  const [ocasiao, setOcasiao] = useState(reserva?.ocasiao || (evId ? (evento?.nome || "") : ""));
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

  // Mesas OCUPADAS por outras reservas ativas em janela de ±2h do horário.
  // Essas ficam bloqueadas pra seleção (não dá pra unir uma mesa já em uso).
  const mesasOcupadas = useMemo(() => {
    const s = new Set<string>();
    if (!horario) return s;
    const [h, m] = horario.split(":").map(Number);
    const inicio = h * 60 + m - 120; // 2h antes
    const fim = h * 60 + m + 120;    // 2h depois
    for (const r of reservasMesmoDia) {
      if (r.id === reserva?.id) continue;
      if (r.status === "cancelada" || r.status === "no_show") continue;
      const [rh, rm] = (r.horario || "00:00").split(":").map(Number);
      const rmin = rh * 60 + rm;
      if (rmin < inicio || rmin > fim) continue;
      for (const id of reservaMesaIds(r)) s.add(id);
    }
    return s;
  }, [horario, reservasMesmoDia, reserva?.id]);

  function toggleMesa(id: string) {
    if (mesasOcupadas.has(id) && !mesaIds.includes(id)) return; // bloqueada
    setMesaIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  const pessoasNum = parseInt(pessoas, 10) || 0;
  // Total sugerido do evento = pessoas × valor por pessoa (até o usuário editar).
  useEffect(() => {
    if (!evId || valorTocado.current) return;
    const vpp = evento?.valorPorPessoa;
    if (vpp && pessoasNum > 0) setValorPg(fmtCents(Math.round(pessoasNum * vpp * 100)));
  }, [evId, evento, pessoasNum]);
  // Mesas selecionadas, na ordem de seleção; capacidade é a SOMA delas.
  const mesasSel = useMemo(
    () => mesaIds.map(id => mesas.find(m => m.id === id)).filter((m): m is Mesa => !!m),
    [mesaIds, mesas],
  );
  const capacidadeTotal = mesasSel.reduce((s, m) => s + (m.capacidade || 0), 0);
  const capacidadeOk = mesaIds.length === 0 || capacidadeTotal >= pessoasNum;

  // Mesas ativas, ordenadas por setor/nome
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
      const nomesMesas = mesasSel.map(m => m.nome);

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

      // Pagamento do evento (sobe comprovante pra pasta central do evento).
      let pagamento: ReservaPagamento | undefined;
      if (evId) {
        let cId = pagIni?.comprovanteDriveId, cUrl = pagIni?.comprovanteUrl, cNome = pagIni?.comprovanteNome;
        if (compFile) {
          if (!evento?.pastaDriveId) { setErr("Configure a pasta do Drive do evento antes de anexar o comprovante."); setSaving(false); return; }
          const ext = (compFile.name.split(".").pop() || "bin").toLowerCase();
          const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
          const nomeArq = `${safe(clienteNome || "reserva")}_${data}.${ext}`;
          const up = await centralUpload(evento.pastaDriveId, new File([compFile], nomeArq, { type: compFile.type }));
          cId = up.id; cUrl = up.webViewLink || cUrl; cNome = nomeArq;
        }
        pagamento = {
          pago, forma: formaPg, valor: parseR(valorPg) || undefined,
          comprovanteDriveId: cId, comprovanteUrl: cUrl, comprovanteNome: cNome,
          pagoEm: pago ? (pagIni?.pagoEm || now) : undefined, registradoPor: me.id,
        };
      }

      // Doc principal (sem PII) — read pode ser público (contagem disponibilidade)
      const payloadReserva: Omit<Reserva, "id"> = {
        restaurantId,
        data,
        horario,
        clienteId: clienteId || null,
        eventoId: evId || null,
        pessoas: pessoasNum,
        mesaId: mesasSel[0]?.id ?? null,          // legado: 1ª mesa
        mesaNomeSnapshot: mesasSel[0]?.nome,       // legado: nome da 1ª
        mesaIds: mesaIds.length ? mesaIds : null,
        mesasNomesSnapshot: nomesMesas.length ? nomesMesas : undefined,
        status,
        confirmadaEm: confirmadaEm ?? null,
        chegouEm: chegouEm ?? null,
        canceladaEm: canceladaEm ?? null,
        motivoCancelamento: status === "cancelada" ? (motivoCancel.trim() || undefined) : reserva?.motivoCancelamento,
        registradoEm: reserva?.registradoEm || now,
        registradoPor: reserva?.registradoPor || me.id,
        atualizadoEm: now,
      };
      // PII separada (auth-only read)
      const piiPayload = {
        restaurantId,
        clienteNomeSnapshot: clienteNome.trim(),
        clienteTelefoneSnapshot: clienteTelefone.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
        ocasiao: ocasiao.trim() || undefined,
        ...(pagamento ? { pagamento } : {}),
        registradoEm: reserva?.registradoEm || now,
      };

      let docId: string;
      if (isNew) {
        const newRef = await addDoc(collection(db, "reservas"), sanitizeForFirestore(payloadReserva));
        docId = newRef.id;
      } else {
        docId = reserva.id;
        await updateDoc(doc(db, "reservas", reserva.id), sanitizeForFirestore(payloadReserva));
      }
      // Sempre upsert da PII no mesmo ID
      await setDoc(doc(db, "reservasPII", docId), sanitizeForFirestore(piiPayload), { merge: true });

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
      <Modal
        title={isNew ? "+ Nova reserva" : `${editing ? "Editar reserva" : "Reserva"} — ${reserva?.clienteNomeSnapshot}`}
        onClose={onClose}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-3">
          {!editing && (
            <div className="flex justify-end -mt-1">
              <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 hover:border-indigo-300 dark:hover:border-indigo-700 inline-flex items-center gap-1.5 transition-colors"><Pencil size={13} /> Editar</button>
            </div>
          )}
          {!editing && <ResumoReserva
            clienteNome={clienteNome} clienteTelefone={clienteTelefone} data={data} horario={horario}
            pessoas={pessoasNum} mesas={mesasSel.map((m) => m.nome)} status={status}
            eventoNome={evId ? (evento?.nome || reserva?.ocasiao) : undefined} ocasiao={evId ? undefined : ocasiao}
            observacoes={observacoes}
            pagamento={evId ? { pago, forma: formaPg, valor: parseR(valorPg) || undefined, comprovanteUrl: pagIni?.comprovanteUrl } : undefined}
          />}
          {editing && (
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
                  {clienteTelefone && <div className="text-xs text-indigo-700 dark:text-indigo-400 truncate inline-flex items-center gap-1"><Phone size={11} /> {clienteTelefone}</div>}
                </div>
                <Button variant="secondary" size="sm" onClick={limparCliente}>↻ Trocar</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 flex-wrap">
                  <Input
                    value={clienteNome}
                    onChange={(e) => setClienteNome(e.target.value)}
                    placeholder="Nome do cliente (digite ou busque)"
                    onFocus={() => setShowSearch(true)}
                    className="flex-1 min-w-[160px]"
                  />
                  <Button variant="secondary" onClick={() => setShowSearch(s => !s)}><span className="inline-flex items-center gap-1.5"><Search size={15} /> Buscar</span></Button>
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
                          {c.telefone && <><Phone size={11} className="inline align-[-1px]" /> {c.telefone}</>}
                          {c.tags && c.tags.length > 0 && <> · <Tag size={11} className="inline align-[-1px]" /> {c.tags.join(", ")}</>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Data + horário + pessoas */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Input label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} className="col-span-2 sm:col-span-1" />
            <Input label="Horário *" type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
            <Input label="Pessoas *" type="number" min={1} value={pessoas} onChange={(e) => setPessoas(e.target.value)} />
          </div>

          {/* Mesa(s) — pode unir várias numa reserva */}
          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                Mesa(s) <span className="font-normal text-gray-400">— toque pra unir várias</span>
              </label>
              {mesaIds.length > 0 && (
                <span className="text-[11px] text-gray-500">
                  {mesaIds.length} mesa(s) · capacidade <Users size={12} className="inline align-[-2px]" /> {capacidadeTotal}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {mesasOrdenadas.map(m => {
                const sel = mesaIds.includes(m.id);
                const ocupada = mesasOcupadas.has(m.id) && !sel;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMesa(m.id)}
                    disabled={ocupada}
                    title={ocupada ? "Mesa já reservada nesse horário" : m.setor || undefined}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                      sel
                        ? "border-indigo-500 bg-indigo-600 text-white font-semibold"
                        : ocupada
                          ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 text-gray-400 line-through cursor-not-allowed"
                          : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400"
                    }`}
                  >
                    {m.nome} · <Users size={12} className="inline align-[-2px]" />{m.capacidade}{ocupada ? " · ocupada" : ""}
                  </button>
                );
              })}
              {mesasOrdenadas.length === 0 && (
                <span className="text-xs text-gray-400">Nenhuma mesa cadastrada. Configure em Mesas.</span>
              )}
            </div>
            {mesaIds.length === 0 && (
              <div className="text-[11px] text-gray-400 mt-1">Sem mesa designada — pode confirmar na chegada.</div>
            )}
            {!capacidadeOk && (
              <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                <TriangleAlert size={13} className="inline align-[-2px] mr-1" />Capacidade somada das mesas ({capacidadeTotal}) é menor que a reserva de {pessoasNum} pessoa(s). Dá pra criar mesmo assim.
              </div>
            )}
          </div>

          {/* Ocasião + observações — ocasião some em reserva de evento (usa o nome do evento) */}
          {!evId && (
            <Input
              label="Ocasião"
              value={ocasiao}
              onChange={(e) => setOcasiao(e.target.value)}
              placeholder="ex: Aniversário, Almoço de negócios"
            />
          )}
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

          {/* Pagamento (reserva de evento) */}
          {evId && (
            <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
              <div className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2 inline-flex items-center gap-1.5"><CalendarHeart size={13} className="text-indigo-500" /> Pagamento {evento?.nome ? <>· <span className="text-indigo-600 dark:text-indigo-300 normal-case">{evento.nome}</span></> : null}</div>
              <label className="flex items-center gap-2 mb-2 text-sm font-semibold">
                <input type="checkbox" checked={pago} onChange={(e) => setPago(e.target.checked)} className="accent-emerald-600" />
                {pago ? "Pago ✓" : "Ainda não pago"}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Forma de pagamento</label>
                  <select value={formaPg} onChange={(e) => setFormaPg(e.target.value)} className="w-full mt-1 h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                    {FORMAS_PG.map((f) => <option key={f} value={f}>{FORMA_PG_LABEL[f]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Valor{evento?.valorPorPessoa ? ` (sugerido: ${pessoasNum}× R$ ${fmtCents(Math.round(evento.valorPorPessoa * 100))})` : ""}</label>
                  <div className="relative mt-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">R$</span>
                    <input value={valorPg} onChange={(e) => { valorTocado.current = true; const d = e.target.value.replace(/\D/g, ""); setValorPg(d ? fmtCents(parseInt(d, 10)) : ""); }} inputMode="numeric" placeholder="0,00" className="w-full h-10 pl-8 pr-2 text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Comprovante</label>
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setCompFile(e.target.files?.[0] || null)} className="block w-full text-[12px] mt-1" />
                {compFile && <div className="text-[11px] text-gray-600 dark:text-gray-300 mt-1 inline-flex items-center gap-1"><FileText size={12} /> {compFile.name}</div>}
                {!compFile && pagIni?.comprovanteUrl && <a href={pagIni.comprovanteUrl} target="_blank" rel="noreferrer" className="text-[12px] text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 mt-1"><FileText size={12} /> ver comprovante atual</a>}
                {!evento?.pastaDriveId && <div className="text-[11px] text-amber-600 mt-1">Evento sem pasta do Drive — configure na aba Eventos pra anexar comprovante.</div>}
              </div>
            </div>
          )}

          {/* Status */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">Status</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
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
                  {(() => { const Ic = RESERVA_STATUS_LUCIDE[s]; return <span className="inline-flex items-center gap-1"><Ic size={12} /> {RESERVA_STATUS_LABEL[s]}</span>; })()}
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
          </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
            {editing ? (
              <>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button onClick={salvar} disabled={saving}>
                  {saving ? "Salvando..." : isNew ? "Criar reserva" : "Salvar"}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={onClose}>Fechar</Button>
            )}
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
