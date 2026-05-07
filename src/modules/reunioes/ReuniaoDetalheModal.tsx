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
import type { AcaoReuniao, AcaoStatus, Cargo, Empregado, EventoTrilha, PautaItem, Reuniao } from "../../core/types";

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

          {podeConfig && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {isPlanejada && (
                <>
                  <Button size="sm" onClick={marcarRealizada} disabled={saving}>✓ Marcar como realizada</Button>
                  <Button variant="secondary" size="sm" onClick={cancelarReuniao} disabled={saving}>✕ Cancelar reunião</Button>
                </>
              )}
              {(isRealizada || isCancelada) && (
                <Button variant="secondary" size="sm" onClick={reabrirComoPlanejada} disabled={saving}>↻ Voltar pra planejada</Button>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-800">
          {([
            ["pauta", `📋 Pauta (${reuniao.pauta?.length || 0})`],
            ["ata",   "📝 Ata"],
            ["acoes", `📌 Ações (${(reuniao.acoes || []).filter(a => a.status === "pendente").length} pend.)`],
          ] as const).map(([id, label]) => (
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
                      {t.ideiaId && <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5">💡 Veio do Banco de Ideias</div>}
                    </div>
                  </div>
                  {podeConfig && (
                    <Button variant="danger" size="sm" onClick={() => removerTopico(t.id)}>×</Button>
                  )}
                </div>
                {podeConfig && (
                  <textarea
                    value={t.notas || ""}
                    onChange={(e) => setNotaTopico(t.id, e.target.value)}
                    rows={2}
                    placeholder="Notas / decisões desse tópico..."
                    className="w-full mt-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
                  />
                )}
                {!podeConfig && t.notas && (
                  <div className="text-xs text-gray-700 dark:text-gray-300 mt-1 italic whitespace-pre-wrap">{t.notas}</div>
                )}
              </div>
            ))}

            {podeConfig && (
              <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                <Input
                  value={novoTopico}
                  onChange={(e) => setNovoTopico(e.target.value)}
                  placeholder="+ Novo tópico de pauta"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarTopico(); } }}
                  className="flex-1"
                />
                <Button onClick={adicionarTopico} disabled={!novoTopico.trim()}>Adicionar</Button>
              </div>
            )}
          </div>
        )}

        {/* Tab: Ata */}
        {tab === "ata" && (
          <div className="space-y-2">
            <textarea
              value={ataDraft}
              onChange={(e) => setAtaDraft(e.target.value)}
              disabled={!podeConfig}
              rows={12}
              placeholder="Resumo do que foi tratado, decisões importantes, contextos..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
            />
            {podeConfig && (
              <div className="flex justify-end">
                <Button onClick={salvarAta} disabled={saving}>{saving ? "Salvando..." : "Salvar ata"}</Button>
              </div>
            )}
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
                        {a.responsavelEmpregadoId && <Button variant="secondary" size="sm" onClick={() => virarEventoTrilha(a)}>🎯 Trilha</Button>}
                        <Button variant="danger" size="sm" onClick={() => removerAcao(a.id)}>×</Button>
                      </div>
                    )}
                  </div>
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
    </Modal>
  );
}
