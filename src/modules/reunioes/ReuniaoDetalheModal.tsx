import { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { logAudit } from "../../core/audit/versionedChange";
import { todayYmd } from "../../core/utils/date";
import { REUNIAO_TIPO_LABEL } from "../../core/types";
import type { AcaoReuniao, AcaoStatus, Cargo, Empregado, EventoTrilha, Ideia, Ocorrencia, PautaItem, Reuniao } from "../../core/types";
import { PuxarIdeiaOcorrenciaModal } from "../_shared/PuxarIdeiaOcorrenciaModal";

type Props = {
  reuniao: Reuniao;
  restaurantId: string;
  podeConfig: boolean;
  onClose: () => void;
};

type Tab = "pauta" | "ata" | "acoes";

export function ReuniaoDetalheModal({ reuniao, restaurantId, podeConfig, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [tab, setTab] = useState<Tab>("pauta");
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Form states (sincronizados com a reuniao real-time)
  const [novoTopico, setNovoTopico] = useState("");
  const [ataDraft, setAtaDraft] = useState(reuniao.ata || "");
  const [novaAcaoDesc, setNovaAcaoDesc] = useState("");
  const [novaAcaoResp, setNovaAcaoResp] = useState<string>("");
  const [novaAcaoPrazo, setNovaAcaoPrazo] = useState<string>("");
  const [puxarAberto, setPuxarAberto] = useState(false);
  const [gerarTipo, setGerarTipo] = useState<"ideia" | "ocorrencia" | null>(null);
  const [geradosIdeias, setGeradosIdeias] = useState<Ideia[]>([]);
  const [geradosOcorrencias, setGeradosOcorrencias] = useState<Ocorrencia[]>([]);
  const [virarTarefaAcao, setVirarTarefaAcao] = useState<AcaoReuniao | null>(null);
  const [virarTarefaPauta, setVirarTarefaPauta] = useState<PautaItem | null>(null);

  // Ideias e ocorrências geradas NESTA reunião (lookup pra exibir na ata)
  useEffect(() => {
    const qi = query(collection(db, "ideias"), where("reuniaoIdOrigem", "==", reuniao.id));
    const u1 = onSnapshot(qi, snap => {
      setGeradosIdeias(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Ideia));
    });
    const qo = query(collection(db, "ocorrencias"), where("reuniaoIdOrigem", "==", reuniao.id));
    const u2 = onSnapshot(qo, snap => {
      setGeradosOcorrencias(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Ocorrencia));
    });
    return () => { u1(); u2(); };
  }, [reuniao.id]);

  useEffect(() => {
    setAtaDraft(reuniao.ata || "");
  }, [reuniao.id, reuniao.ata]);

  useEffect(() => {
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [restaurantId]);

  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const empMap = Object.fromEntries(empregados.map(e => [e.id, e]));

  async function patchReuniao(patch: Partial<Reuniao>) {
    setSaving(true);
    setErr("");
    try {
      await updateDoc(doc(db, "reunioes", reuniao.id), sanitizeForFirestore({
        ...patch,
        atualizadoEm: new Date().toISOString(),
      }));
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  // ── Pauta ────────────────────────────────────────────────────────────────
  async function adicionarTopico() {
    const t = novoTopico.trim();
    if (!t) return;
    const novo: PautaItem = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      titulo: t,
      ordem: (reuniao.pauta?.length || 0) + 1,
      discutido: false,
    };
    await patchReuniao({ pauta: [...(reuniao.pauta || []), novo] });
    setNovoTopico("");
  }
  async function removerTopico(id: string) {
    if (!confirm("Remover esse tópico?")) return;
    const item = reuniao.pauta?.find(p => p.id === id);
    await patchReuniao({ pauta: (reuniao.pauta || []).filter(p => p.id !== id) });
    // Se topic veio de uma ideia, libera a ideia
    if (item?.ideiaId) {
      try {
        await updateDoc(doc(db, "ideias", item.ideiaId), {
          status: "aberta",
          reuniaoId: null,
          atualizadoEm: new Date().toISOString(),
        });
      } catch (e) { console.error(e); }
    }
  }
  async function toggleDiscutido(id: string) {
    const novaPauta = (reuniao.pauta || []).map(p => p.id === id ? { ...p, discutido: !p.discutido } : p);
    await patchReuniao({ pauta: novaPauta });
  }
  async function setNotaTopico(id: string, notas: string) {
    const novaPauta = (reuniao.pauta || []).map(p => p.id === id ? { ...p, notas } : p);
    await patchReuniao({ pauta: novaPauta });
  }

  // Puxa uma ideia ou ocorrência ABERTA pra dentro da pauta dessa reunião.
  async function puxarParaPauta(item: { tipo: "ideia" | "ocorrencia"; id: string; titulo: string; descricao?: string }) {
    const novo: PautaItem = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      titulo: item.titulo,
      descricao: item.descricao,
      ordem: (reuniao.pauta?.length || 0) + 1,
      discutido: false,
      ideiaId: item.tipo === "ideia" ? item.id : null,
      ocorrenciaId: item.tipo === "ocorrencia" ? item.id : null,
    };
    await patchReuniao({ pauta: [...(reuniao.pauta || []), novo] });

    // Atualiza o status do item de origem pra "em discussão" / "em apuração"
    try {
      const col = item.tipo === "ideia" ? "ideias" : "ocorrencias";
      const novoStatus = item.tipo === "ideia" ? "em_discussao" : "em_apuracao";
      await updateDoc(doc(db, col, item.id), {
        status: novoStatus,
        reuniaoId: reuniao.id,
        atualizadoEm: new Date().toISOString(),
        atualizadaEm: new Date().toISOString(),
      });
    } catch (e) { console.error("[reuniao] não consegui marcar item como em discussão:", e); }
    setPuxarAberto(false);
  }

  // ── Gerar ideia/ocorrência durante a reunião ──────────────────────────────
  async function criarGerado(titulo: string, descricao: string, tipo: "ideia" | "ocorrencia", grav?: "elogio" | "leve" | "media" | "grave") {
    if (!titulo.trim() || !me) return;
    const now = new Date().toISOString();
    if (tipo === "ideia") {
      await addDoc(collection(db, "ideias"), sanitizeForFirestore({
        restaurantId,
        titulo: titulo.trim(),
        descricao: descricao.trim() || undefined,
        status: "gerada_reuniao",
        reuniaoIdOrigem: reuniao.id,
        criadoEm: now,
        criadoPor: me.id,
        criadoPorNome: me.nome,
        atualizadoEm: now,
      }));
    } else {
      await addDoc(collection(db, "ocorrencias"), sanitizeForFirestore({
        restaurantId,
        data: reuniao.data || todayYmd(),
        titulo: titulo.trim(),
        descricao: descricao.trim() || "(gerada em reunião)",
        gravidade: grav || "leve",
        status: "gerada_reuniao",
        empregadosEnvolvidos: [],
        reuniaoIdOrigem: reuniao.id,
        criadaEm: now,
        criadaPor: me.id,
        criadaPorNome: me.nome,
        atualizadaEm: now,
      }));
    }
    setGerarTipo(null);
  }

  // ── Ata ──────────────────────────────────────────────────────────────────
  async function salvarAta() {
    await patchReuniao({ ata: ataDraft });
  }

  // Marca como realizada — fecha tópicos pendentes da pauta ligados ao Banco de Ideias
  async function marcarRealizada() {
    if (!confirm("Marcar essa reunião como realizada? As ideias linkadas viram 'Discutidas'.")) return;
    if (!me) return;
    setSaving(true);
    setErr("");
    try {
      // 1. Atualiza reunião
      await updateDoc(doc(db, "reunioes", reuniao.id), sanitizeForFirestore({
        status: "realizada",
        atualizadoEm: new Date().toISOString(),
      }));

      // 2. Atualiza ideias linkadas → discutida
      const idsLinkadas = (reuniao.pauta || []).map(p => p.ideiaId).filter((x): x is string => !!x);
      for (const ideiaId of idsLinkadas) {
        try {
          await updateDoc(doc(db, "ideias", ideiaId), {
            status: "discutida",
            atualizadoEm: new Date().toISOString(),
          });
        } catch (e) { console.error(e); }
      }

      await logAudit({
        entityType: "restaurant",
        entityId: restaurantId,
        restaurantId,
        acao: "alterado",
        diff: { reuniaoStatus: { antes: reuniao.status, depois: "realizada" } },
        motivo: `Reunião realizada: ${reuniao.titulo}`,
        registradoPor: me.id,
      });
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function cancelarReuniao() {
    if (!confirm("Cancelar essa reunião? Ideias linkadas voltam pra 'Aberta'.")) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "reunioes", reuniao.id), {
        status: "cancelada",
        atualizadoEm: new Date().toISOString(),
      });
      const idsLinkadas = (reuniao.pauta || []).map(p => p.ideiaId).filter((x): x is string => !!x);
      for (const ideiaId of idsLinkadas) {
        try {
          await updateDoc(doc(db, "ideias", ideiaId), {
            status: "aberta",
            reuniaoId: null,
            atualizadoEm: new Date().toISOString(),
          });
        } catch (e) { console.error(e); }
      }
    } finally {
      setSaving(false);
    }
  }

  async function reabrirComoPlanejada() {
    if (!confirm("Voltar essa reunião pra 'Planejada'?")) return;
    await patchReuniao({ status: "planejada" });
  }

  // ── Ações ────────────────────────────────────────────────────────────────
  async function adicionarAcao() {
    const desc = novaAcaoDesc.trim();
    if (!desc) return;
    const respEmp = novaAcaoResp ? empMap[novaAcaoResp] : null;
    const nova: AcaoReuniao = {
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      descricao: desc,
      responsavelEmpregadoId: respEmp?.id || null,
      responsavelNome: respEmp?.nome,
      prazo: novaAcaoPrazo || null,
      status: "pendente",
    };
    await patchReuniao({ acoes: [...(reuniao.acoes || []), nova] });
    setNovaAcaoDesc("");
    setNovaAcaoResp("");
    setNovaAcaoPrazo("");
  }
  async function setAcaoStatus(id: string, status: AcaoStatus) {
    const novaList = (reuniao.acoes || []).map(a =>
      a.id === id
        ? { ...a, status, concluidoEm: status === "feito" ? new Date().toISOString() : null }
        : a
    );
    await patchReuniao({ acoes: novaList });
  }
  async function removerAcao(id: string) {
    if (!confirm("Remover essa ação?")) return;
    await patchReuniao({ acoes: (reuniao.acoes || []).filter(a => a.id !== id) });
  }

  // Cria evento de Trilha pra empregado a partir de uma ação concluída
  async function virarEventoTrilha(a: AcaoReuniao) {
    if (!a.responsavelEmpregadoId) {
      alert("Essa ação não tem responsável-empregado definido.");
      return;
    }
    if (!me) return;
    if (!confirm(`Registrar essa ação como evento de trilha do ${a.responsavelNome || "empregado"}?`)) return;
    try {
      const evento: Omit<EventoTrilha, "id"> = {
        restaurantId,
        empregadoId: a.responsavelEmpregadoId,
        tipo: a.status === "feito" ? "treinamento" : "outro",
        data: a.concluidoEm ? a.concluidoEm.slice(0, 10) : todayYmd(),
        titulo: a.descricao,
        descricao: `Ação da reunião: ${reuniao.titulo}`,
        fonte: "manual",
        registradoEm: new Date().toISOString(),
        registradoPor: me.id,
      };
      await addDoc(collection(db, "eventosTrilha"), sanitizeForFirestore(evento));
      alert("Evento adicionado à trilha do empregado.");
    } catch (e) {
      console.error(e);
      alert("Erro ao adicionar evento.");
    }
  }

  // Empregados ativos por área
  const empregadosOrdenados = [...empregados]
    .filter(e => e.estaAtivo)
    .sort((a, b) => {
      const ca = cargoMap[a.cargoId];
      const cb = cargoMap[b.cargoId];
      const areaA = ca?.area || "ZZ";
      const areaB = cb?.area || "ZZ";
      if (areaA !== areaB) return areaA.localeCompare(areaB);
      return a.nome.localeCompare(b.nome);
    });

  const isPlanejada = reuniao.status === "planejada";
  const isRealizada = reuniao.status === "realizada";
  const isCancelada = reuniao.status === "cancelada";
  const aoVivo = !!reuniao.iniciadaEm && isPlanejada;

  async function iniciarReuniao() {
    if (!me) return;
    await patchReuniao({
      iniciadaEm: new Date().toISOString(),
      iniciadaPor: me.id,
    });
    setTab("pauta"); // reunião ao vivo gira em torno da pauta
  }

  return (
    <Modal
      title={`${reuniao.titulo} — ${REUNIAO_TIPO_LABEL[reuniao.tipo]}`}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-3">
        {/* Cabeçalho */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <span>📅 {new Date(reuniao.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
            {reuniao.horario && <span>⏰ {reuniao.horario}</span>}
            {reuniao.local && <span>📍 {reuniao.local}</span>}
            <span>·</span>
            <span>👥 {reuniao.participantes?.length || 0} participantes</span>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Status: <span className="font-medium">{reuniao.status}</span>
          </div>

          {aoVivo && (
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Reunião em andamento
              </span>
              {reuniao.iniciadaEm && (
                <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  desde {new Date(reuniao.iniciadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          )}

          {podeConfig && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {isPlanejada && !aoVivo && (
                <Button size="sm" onClick={iniciarReuniao} disabled={saving}>▶️ Iniciar reunião</Button>
              )}
              {isPlanejada && (
                <>
                  <Button size="sm" onClick={marcarRealizada} disabled={saving}>
                    {aoVivo ? "🛑 Finalizar reunião" : "✓ Marcar como realizada"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={cancelarReuniao} disabled={saving}>✕ Cancelar reunião</Button>
                </>
              )}
              {(isRealizada || isCancelada) && (
                <Button variant="secondary" size="sm" onClick={reabrirComoPlanejada} disabled={saving}>↻ Voltar pra planejada</Button>
              )}
            </div>
          )}
        </div>

        {/* Tabs — Ata e Ações só aparecem se há conteúdo legado.
            Modelo novo: tudo gira em torno da pauta. Notas de cada item =
            ata implícita. Tarefas saem direto do item virando "📋 Virar tarefa". */}
        <div className="flex border-b border-gray-200 dark:border-gray-800">
          {([
            ["pauta", `📋 Pauta (${reuniao.pauta?.length || 0})`, true],
            ["ata",   "📝 Ata",                                    !!reuniao.ata],
            ["acoes", `📌 Ações (${(reuniao.acoes || []).filter(a => a.status === "pendente").length} pend.)`, (reuniao.acoes || []).length > 0],
          ] as const).filter(([_, __, mostrar]) => mostrar).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === id
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab: Pauta */}
        {tab === "pauta" && (
          <div className="space-y-2">
            {(reuniao.pauta || []).length === 0 && (
              <div className="text-sm text-gray-500 italic">Sem tópicos. Adicione abaixo ou leve ideias do Banco de Ideias.</div>
            )}
            {(reuniao.pauta || []).map((t) => (
              <div
                key={t.id}
                className={`border rounded-lg p-3 ${
                  t.discutido
                    ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                  <div className="flex items-start gap-2 flex-1">
                    {podeConfig && (
                      <input
                        type="checkbox"
                        checked={t.discutido}
                        onChange={() => toggleDiscutido(t.id)}
                        className="mt-1"
                      />
                    )}
                    <div className="flex-1">
                      <div className={`font-medium ${t.discutido ? "line-through text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>
                        {t.titulo}
                      </div>
                      {t.descricao && <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{t.descricao}</div>}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {t.ideiaId && <span className="text-[10px] text-indigo-600 dark:text-indigo-400">💡 Veio do Banco de Ideias</span>}
                        {t.ocorrenciaId && <span className="text-[10px] text-rose-600 dark:text-rose-400">🚨 Veio das Ocorrências</span>}
                        {t.tarefaIdGerada && <span className="text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded">✓ Virou tarefa</span>}
                      </div>
                    </div>
                  </div>
                  {podeConfig && (
                    <div className="flex gap-1 flex-wrap">
                      {!t.tarefaIdGerada && (
                        <Button variant="secondary" size="sm" onClick={() => setVirarTarefaPauta(t)}>📋 Virar tarefa</Button>
                      )}
                      <Button variant="danger" size="sm" onClick={() => removerTopico(t.id)}>×</Button>
                    </div>
                  )}
                </div>
                {podeConfig && (
                  <textarea
                    value={t.notas || ""}
                    onChange={(e) => setNotaTopico(t.id, e.target.value)}
                    rows={2}
                    placeholder="Notas / decisões desse tópico (vira a ata)..."
                    className="w-full mt-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
                  />
                )}
                {!podeConfig && t.notas && (
                  <div className="text-xs text-gray-700 dark:text-gray-300 mt-1 italic whitespace-pre-wrap">{t.notas}</div>
                )}
              </div>
            ))}

            {podeConfig && (
              <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                <div className="flex gap-2">
                  <Input
                    value={novoTopico}
                    onChange={(e) => setNovoTopico(e.target.value)}
                    placeholder="+ Novo tópico de pauta"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarTopico(); } }}
                    className="flex-1"
                  />
                  <Button onClick={adicionarTopico} disabled={!novoTopico.trim()}>Adicionar</Button>
                </div>
                <button
                  type="button"
                  onClick={() => setPuxarAberto(true)}
                  className="w-full text-xs px-3 py-2 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                >
                  📋 Puxar de Banco de Ideias / Ocorrências
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab: Ata */}
        {tab === "ata" && (
          <div className="space-y-3">
            <textarea
              value={ataDraft}
              onChange={(e) => setAtaDraft(e.target.value)}
              disabled={!podeConfig}
              rows={10}
              placeholder="Resumo do que foi tratado, decisões importantes, contextos..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
            />
            {podeConfig && (
              <div className="flex justify-end">
                <Button onClick={salvarAta} disabled={saving}>{saving ? "Salvando..." : "Salvar ata"}</Button>
              </div>
            )}

            {/* Ideias e Ocorrências geradas NESTA reunião */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-800">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                Gerado nesta reunião
              </h4>
              {geradosIdeias.length === 0 && geradosOcorrencias.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                  Use os botões abaixo pra registrar ideias e ocorrências que surgiram durante a reunião.
                  Elas viram cards no Kanban dos respectivos módulos com a marca "🗣️ De reunião".
                </p>
              ) : (
                <div className="space-y-1 mb-3">
                  {geradosIdeias.map(i => (
                    <div key={i.id} className="text-xs flex items-center gap-2 px-2 py-1.5 rounded bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                      <span>💡</span>
                      <span className="flex-1 font-medium">{i.titulo}</span>
                      <span className="text-[10px] uppercase tracking-wider text-purple-600 dark:text-purple-400">{i.status === "puxada_tarefa" ? "virou tarefa" : "ideia"}</span>
                    </div>
                  ))}
                  {geradosOcorrencias.map(o => (
                    <div key={o.id} className="text-xs flex items-center gap-2 px-2 py-1.5 rounded bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
                      <span>🚨</span>
                      <span className="flex-1 font-medium">{o.titulo}</span>
                      <span className="text-[10px] uppercase tracking-wider text-rose-600 dark:text-rose-400">{o.gravidade}</span>
                    </div>
                  ))}
                </div>
              )}
              {podeConfig && (
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setGerarTipo("ideia")}
                    className="text-xs px-3 py-1.5 rounded-md bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
                  >
                    💡 + Ideia gerada
                  </button>
                  <button
                    type="button"
                    onClick={() => setGerarTipo("ocorrencia")}
                    className="text-xs px-3 py-1.5 rounded-md bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
                  >
                    🚨 + Ocorrência gerada
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Ações */}
        {tab === "acoes" && (
          <div className="space-y-2">
            {(reuniao.acoes || []).length === 0 && (
              <div className="text-sm text-gray-500 italic">Sem ações registradas. Adicione abaixo o que ficou de pendente.</div>
            )}
            {(reuniao.acoes || []).map((a) => {
              const stCls = a.status === "feito"
                ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
                : a.status === "cancelado"
                  ? "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 opacity-60"
                  : "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800";
              return (
                <div key={a.id} className={`border rounded-lg p-3 ${stCls}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex-1">
                      <div className={`font-medium text-gray-900 dark:text-gray-100 ${a.status === "cancelado" ? "line-through" : ""}`}>
                        {a.descricao}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        {a.responsavelNome && <span>👤 {a.responsavelNome}</span>}
                        {a.prazo && <span>📅 {new Date(a.prazo + "T12:00:00").toLocaleDateString("pt-BR")}</span>}
                        <span className="font-medium">
                          {a.status === "pendente" ? "⏳ Pendente" : a.status === "feito" ? "✓ Feito" : "✕ Cancelado"}
                        </span>
                      </div>
                    </div>
                    {podeConfig && (
                      <div className="flex gap-1 flex-wrap">
                        {a.status !== "feito" && <Button variant="secondary" size="sm" onClick={() => setAcaoStatus(a.id, "feito")}>✓ Feito</Button>}
                        {a.status !== "pendente" && <Button variant="secondary" size="sm" onClick={() => setAcaoStatus(a.id, "pendente")}>↻ Reabrir</Button>}
                        {a.status !== "cancelado" && <Button variant="secondary" size="sm" onClick={() => setAcaoStatus(a.id, "cancelado")}>✕</Button>}
                        {!a.tarefaIdGerada && (
                          <Button variant="secondary" size="sm" onClick={() => setVirarTarefaAcao(a)}>📋 Virar tarefa</Button>
                        )}
                        {a.responsavelEmpregadoId && <Button variant="secondary" size="sm" onClick={() => virarEventoTrilha(a)}>🎯 Trilha</Button>}
                        <Button variant="danger" size="sm" onClick={() => removerAcao(a.id)}>×</Button>
                      </div>
                    )}
                  </div>
                  {a.tarefaIdGerada && (
                    <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded">
                      ✓ Virou tarefa no Gestor de Tarefas
                    </div>
                  )}
                </div>
              );
            })}

            {podeConfig && (
              <div className="border-t border-gray-200 dark:border-gray-800 pt-3 mt-2 space-y-2">
                <Input
                  value={novaAcaoDesc}
                  onChange={(e) => setNovaAcaoDesc(e.target.value)}
                  placeholder="+ Nova ação"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={novaAcaoResp}
                    onChange={(e) => setNovaAcaoResp(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  >
                    <option value="">Sem responsável</option>
                    {empregadosOrdenados.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.nome} ({cargoMap[e.cargoId]?.area || "?"})
                      </option>
                    ))}
                  </select>
                  <Input
                    type="date"
                    value={novaAcaoPrazo}
                    onChange={(e) => setNovaAcaoPrazo(e.target.value)}
                    placeholder="Prazo"
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={adicionarAcao} disabled={!novaAcaoDesc.trim()}>+ Adicionar ação</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
      {puxarAberto && (
        <PuxarIdeiaOcorrenciaModal
          restaurantId={restaurantId}
          pessoaIdAtual={me?.id}
          titulo="Puxar pra pauta desta reunião"
          onClose={() => setPuxarAberto(false)}
          onEscolher={puxarParaPauta}
        />
      )}
      {gerarTipo && (
        <GerarRegistroModal
          tipo={gerarTipo}
          onClose={() => setGerarTipo(null)}
          onCriar={criarGerado}
        />
      )}
      {virarTarefaAcao && me && (
        <VirarTarefaModal
          tituloInicial={virarTarefaAcao.descricao}
          descricaoInicial={`Ação registrada na reunião "${reuniao.titulo}" em ${new Date(reuniao.data + "T12:00:00").toLocaleDateString("pt-BR")}.${virarTarefaAcao.observacao ? `\n\n${virarTarefaAcao.observacao}` : ""}`}
          prazoInicial={virarTarefaAcao.prazo || ""}
          responsavelEmpregadoId={virarTarefaAcao.responsavelEmpregadoId || null}
          reuniao={reuniao}
          restaurantId={restaurantId}
          empregados={empregados}
          autor={{ id: me.id, nome: me.nome }}
          onClose={() => setVirarTarefaAcao(null)}
          onCriada={async (tarefaId) => {
            const novasAcoes = (reuniao.acoes || []).map(a =>
              a.id === virarTarefaAcao.id ? { ...a, tarefaIdGerada: tarefaId } : a
            );
            await patchReuniao({ acoes: novasAcoes });
            setVirarTarefaAcao(null);
          }}
        />
      )}
      {virarTarefaPauta && me && (
        <VirarTarefaModal
          tituloInicial={virarTarefaPauta.titulo}
          descricaoInicial={
            `Tópico da reunião "${reuniao.titulo}" em ${new Date(reuniao.data + "T12:00:00").toLocaleDateString("pt-BR")}.` +
            (virarTarefaPauta.descricao ? `\n\n${virarTarefaPauta.descricao}` : "") +
            (virarTarefaPauta.notas ? `\n\nNotas/decisões:\n${virarTarefaPauta.notas}` : "")
          }
          prazoInicial=""
          responsavelEmpregadoId={null}
          reuniao={reuniao}
          restaurantId={restaurantId}
          empregados={empregados}
          autor={{ id: me.id, nome: me.nome }}
          onClose={() => setVirarTarefaPauta(null)}
          onCriada={async (tarefaId) => {
            const novaPauta = (reuniao.pauta || []).map(p =>
              p.id === virarTarefaPauta.id ? { ...p, tarefaIdGerada: tarefaId, discutido: true } : p
            );
            await patchReuniao({ pauta: novaPauta });
            setVirarTarefaPauta(null);
          }}
        />
      )}
    </Modal>
  );
}

// Mini-modal pra gerar Ideia/Ocorrência dentro de uma reunião
function GerarRegistroModal({ tipo, onClose, onCriar }: {
  tipo: "ideia" | "ocorrencia";
  onClose: () => void;
  onCriar: (titulo: string, descricao: string, tipo: "ideia" | "ocorrencia", grav?: "elogio" | "leve" | "media" | "grave") => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [grav, setGrav] = useState<"elogio" | "leve" | "media" | "grave">("leve");

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-3 text-gray-900 dark:text-gray-100">
          {tipo === "ideia" ? "💡 Ideia gerada na reunião" : "🚨 Ocorrência gerada na reunião"}
        </h3>
        <div className="space-y-3">
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título"
            autoFocus
          />
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={3}
            placeholder="Descrição (opcional)"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
          />
          {tipo === "ocorrencia" && (
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Gravidade</label>
              <select
                value={grav}
                onChange={(e) => setGrav(e.target.value as "elogio" | "leve" | "media" | "grave")}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <option value="elogio">🌟 Elogio</option>
                <option value="leve">ℹ️ Leve</option>
                <option value="media">⚠️ Média</option>
                <option value="grave">🚨 Grave</option>
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => onCriar(titulo, descricao, tipo, grav)}
            disabled={!titulo.trim()}
          >
            Registrar
          </Button>
        </div>
      </div>
    </div>
  );
}

// Mini-modal genérico pra virar um item de pauta OU ação em Tarefa formal
function VirarTarefaModal({ tituloInicial, descricaoInicial, prazoInicial, responsavelEmpregadoId, reuniao, restaurantId, empregados, autor, onClose, onCriada }: {
  tituloInicial: string;
  descricaoInicial: string;
  prazoInicial: string;
  responsavelEmpregadoId: string | null;
  reuniao: Reuniao;
  restaurantId: string;
  empregados: Empregado[];
  autor: { id: string; nome: string };
  onClose: () => void;
  onCriada: (tarefaId: string) => Promise<void>;
}) {
  const [titulo, setTitulo] = useState(tituloInicial);
  const [descricao, setDescricao] = useState(descricaoInicial);
  const [prazo, setPrazo] = useState(prazoInicial);
  const [projetos, setProjetos] = useState<Array<{ id: string; nome: string; emoji?: string; cor?: string }>>([]);
  const [subprojetos, setSubprojetos] = useState<Array<{ id: string; nome: string; projetoId: string }>>([]);
  const [pessoas, setPessoas] = useState<Array<{ id: string; nome: string }>>([]);
  const [projetoId, setProjetoId] = useState("");
  const [subprojetoId, setSubprojetoId] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "tarefaProjetos"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome: string; emoji?: string; cor?: string; deletadoEm?: string });
      setProjetos(list.filter(p => !p.deletadoEm));
    });
    const u2 = onSnapshot(collection(db, "tarefaSubprojetos"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome: string; projetoId: string; deletadoEm?: string });
      setSubprojetos(list.filter(s => !s.deletadoEm));
    });
    const u3 = onSnapshot(collection(db, "pessoas"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoas(list);
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  // Pré-seleciona responsável pela pessoa vinculada ao empregado da ação (se houver)
  useEffect(() => {
    if (responsavelId || !responsavelEmpregadoId) return;
    const emp = empregados.find(e => e.id === responsavelEmpregadoId);
    if (emp && emp.pessoaId) {
      const p = pessoas.find(x => x.id === emp.pessoaId);
      if (p) setResponsavelId(p.id);
    }
  }, [pessoas, empregados, responsavelId, responsavelEmpregadoId]);

  // Pré-seleciona "Projetos Temporários" se existir, senão o 1º projeto
  useEffect(() => {
    if (projetoId || projetos.length === 0) return;
    const temp = projetos.find(p => p.id === "proj-temporarios") || projetos[0];
    setProjetoId(temp.id);
  }, [projetos, projetoId]);

  // Atualiza subprojeto quando muda o projeto
  const subsDoProjeto = subprojetos.filter(s => s.projetoId === projetoId);
  useEffect(() => {
    if (subsDoProjeto.length > 0 && !subsDoProjeto.find(s => s.id === subprojetoId)) {
      setSubprojetoId(subsDoProjeto[0].id);
    }
  }, [projetoId, subprojetoId, subsDoProjeto]);

  async function salvar() {
    if (!titulo.trim()) { setErr("Título obrigatório"); return; }
    if (!projetoId || !subprojetoId) { setErr("Escolha projeto e subprojeto"); return; }
    if (!responsavelId) { setErr("Escolha o responsável"); return; }
    setSalvando(true);
    setErr("");
    try {
      const { criarTarefa } = await import("../tarefas/repository");
      const respNome = pessoas.find(p => p.id === responsavelId)?.nome || "";
      const proj = projetos.find(p => p.id === projetoId);
      const tarefaId = await criarTarefa({
        projetoId, subprojetoId,
        titulo: titulo.trim(),
        descricao: descricao.trim() || undefined,
        responsavelId,
        responsavelNome: respNome,
        coResponsaveis: [],
        restaurantIds: [restaurantId],
        prazo: prazo || null,
        status: "a_fazer",
        prioridade: "normal",
        origem: "reuniao",
        origemRefId: reuniao.id,
        origemRefLabel: `Reunião: ${reuniao.titulo}`,
        corHerdada: proj?.cor,
        criadoPor: autor.id,
        criadoPorNome: autor.nome,
      });
      await onCriada(tarefaId);
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-3 text-gray-900 dark:text-gray-100">📋 Virar em Tarefa</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Título *</label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Descrição</label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Projeto *</label>
              <select
                value={projetoId}
                onChange={(e) => setProjetoId(e.target.value)}
                className="w-full mt-1 px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                {projetos.map(p => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Subprojeto *</label>
              <select
                value={subprojetoId}
                onChange={(e) => setSubprojetoId(e.target.value)}
                className="w-full mt-1 px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                {subsDoProjeto.map(s => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Responsável *</label>
              <select
                value={responsavelId}
                onChange={(e) => setResponsavelId(e.target.value)}
                className="w-full mt-1 px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <option value="">— escolha —</option>
                {pessoas.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Prazo</label>
              <Input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Criando..." : "Criar tarefa"}
          </Button>
        </div>
      </div>
    </div>
  );
}
