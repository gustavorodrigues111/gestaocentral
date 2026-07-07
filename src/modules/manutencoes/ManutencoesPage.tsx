// Manutenções & Licenças. Duas abas:
//  📅 Visualização — dia a dia: apontamentos (status do ciclo, agendar, subir
//     laudo pro Drive, concluir e renovar prazo).
//  📝 Cadastro — config feita uma vez: tipo, fornecedor, endereço(s) que cobre,
//     periodicidade, antecedência, obrigatório + pasta-raiz dos laudos no Drive.
// Cada item amarra a 1+ ENDEREÇOS (N:N). Escopo por empresa (rid da rota).

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, orderBy, where, setDoc, updateDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { centralEnsureFolder } from "../../core/google/driveCentral";
import { uploadFileToFolder } from "../../core/google/driveShared";
import type { Manutencao, ManutencaoTipo, ManutencaoPeriodicidade, ManutencaoLaudo, Endereco } from "../../core/types";
import { MANUTENCAO_TIPO_LABEL, MANUTENCAO_PERIODICIDADE_LABEL, MANUTENCAO_PERIODICIDADE_DIAS, MANUTENCAO_STATUS_LABEL } from "../../core/types";

const TIPOS_FLEXIVEIS = new Set<ManutencaoTipo>(["filtros_agua", "ar_condicionado", "estofado"]);
const STATUS_COR: Record<string, string> = {
  pendente: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  agendado: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  aguardando_laudo: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

export function ManutencoesPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants, activeRestaurant } = useRestaurant();
  const [manutencoes, setManutencoes] = useState<Manutencao[]>([]);
  const [enderecos, setEnderecos] = useState<Endereco[]>([]);
  const [aba, setAba] = useState<"visualizacao" | "cadastro">("visualizacao");
  const [editando, setEditando] = useState<Manutencao | null>(null);
  const [apontando, setApontando] = useState<Manutencao | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    const u = onSnapshot(query(collection(db, "manutencoes"), orderBy("proximoVencimento")),
      snap => setManutencoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Manutencao).filter(m => !m.deletadoEm)));
    return () => u();
  }, []);

  const ridsKey = restaurants.map(r => r.id).join(",");
  useEffect(() => {
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    if (!rids.length) { setEnderecos([]); return; }
    const u = onSnapshot(query(collection(db, "enderecos"), where("restaurantId", "in", rids)),
      snap => setEnderecos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Endereco)), () => setEnderecos([]));
    return () => u();
  }, [ridsKey]);

  const endById = useMemo(() => Object.fromEntries(enderecos.map(e => [e.id, e])), [enderecos]);
  const nomeRest = (r: string) => restaurants.find(x => x.id === r)?.nome || r;
  const rotuloEnderecos = (m: Manutencao) => {
    const ids = m.enderecoIds || [];
    if (ids.length) return ids.map(id => endById[id]?.apelido || "endereço?").join(" · ");
    return (m.restaurantIds || []).map(nomeRest).join(", ");
  };

  if (!pessoa) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  const daEmpresa = manutencoes.filter(m => (m.restaurantIds || []).includes(rid || "") || (m.enderecoIds || []).some(eid => endById[eid]?.restaurantId === rid));
  const vencidas = daEmpresa.filter(m => m.proximoVencimento < hoje).length;
  const endsDaEmpresa = enderecos.filter(e => e.restaurantId === rid);

  const tab = (v: "visualizacao" | "cadastro", label: string) => (
    <button type="button" onClick={() => setAba(v)}
      className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${aba === v ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{label}</button>
  );

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-500">{daEmpresa.length} item{daEmpresa.length === 1 ? "" : "s"}{vencidas > 0 && <span className="text-rose-600 font-medium"> · {vencidas} vencido{vencidas === 1 ? "" : "s"}</span>}</div>
        <Button onClick={() => setCriando(true)}>+ Nova Manutenção</Button>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {tab("visualizacao", "📅 Visualização")}{tab("cadastro", "📝 Cadastro")}
      </nav>

      {enderecos.length === 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          ⚠️ Nenhum endereço cadastrado. Cadastre em <b>Configurações → 📍 Endereços</b> pra amarrar os itens por endereço.
        </div>
      )}

      {aba === "cadastro" && rid && (
        <PastaRaizConfig rid={rid} folderId={activeRestaurant?.manutencoesDriveFolderId} folderNome={activeRestaurant?.manutencoesDriveFolderNome} />
      )}

      {daEmpresa.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📅</div>
          <p>Nenhuma manutenção cadastrada nesta empresa.</p>
          <p className="text-sm mt-1">Vá em <b>📝 Cadastro</b> pra criar filtros, potabilidade, dedetização, CLCB, certificados, etc.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {daEmpresa.map(m => {
            const atrasada = m.proximoVencimento < hoje;
            const proxima = !atrasada && m.proximoVencimento <= addDias(hoje, m.diasAntecedencia || 30);
            const st = m.statusCiclo || "pendente";
            return (
              <div key={m.id} onClick={() => aba === "visualizacao" ? setApontando(m) : setEditando(m)}
                className={`p-3 rounded-xl border cursor-pointer hover:shadow-md transition-shadow ${atrasada ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" : proxima ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 flex-wrap">
                      {MANUTENCAO_TIPO_LABEL[m.tipo]}
                      {m.fornecedor && <span className="text-gray-500 dark:text-gray-400 font-normal">· {m.fornecedor}</span>}
                      {aba === "visualizacao" && st !== "pendente" && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COR[st]}`}>{MANUTENCAO_STATUS_LABEL[st]}{st === "agendado" && m.agendadoPara ? ` ${fmtBR(m.agendadoPara)}` : ""}</span>}
                      {aba === "cadastro" && m.obrigatorio === false && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">flexível</span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {MANUTENCAO_PERIODICIDADE_LABEL[m.periodicidade]}{` · próx. vencimento: ${fmtBR(m.proximoVencimento)}`}{atrasada && " · ⚠️ VENCIDA"}{proxima && " · ⏰ próximo"}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">📍 {rotuloEnderecos(m) || "—"}</div>
                  </div>
                  {(m.laudos?.length ?? 0) > 0 && <span className="text-xs text-gray-400 shrink-0">📎 {m.laudos!.length}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(criando || editando) && (
        <ManutencaoForm manutencao={editando} onClose={() => { setCriando(false); setEditando(null); }}
          restaurants={restaurants.map(r => ({ id: r.id, nome: r.nome }))} enderecos={enderecos} pessoaId={pessoa.id} />
      )}
      {apontando && (
        <ApontamentoModal manutencao={apontando} onClose={() => setApontando(null)}
          endsDaEmpresa={endsDaEmpresa} rootFolderId={activeRestaurant?.manutencoesDriveFolderId} pessoaId={pessoa.id} />
      )}
    </div>
  );
}

// ─── Pasta-raiz dos laudos (Drive), por empresa ──────────────────────────────
function PastaRaizConfig({ rid, folderId, folderNome }: { rid: string; folderId?: string; folderNome?: string }) {
  const [busy, setBusy] = useState(false);
  async function escolher() {
    setBusy(true);
    try {
      const pasta = await pickDriveFolder("Pasta-raiz dos laudos de manutenção");
      if (pasta) await updateDoc(doc(db, "restaurants", rid), { manutencoesDriveFolderId: pasta.id, manutencoesDriveFolderNome: pasta.name });
    } catch (e) { alert("Erro ao escolher pasta: " + (e instanceof Error ? e.message : "?")); }
    finally { setBusy(false); }
  }
  return (
    <div className="mb-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">🗂️ Pasta dos laudos (Google Drive)</div>
      <p className="text-xs text-gray-500 mt-0.5 mb-2">Os laudos subidos na Visualização vão pra <b>endereço → tipo</b> dentro desta pasta.</p>
      <div className="flex items-center gap-2 flex-wrap">
        {folderId ? (
          <a href={`https://drive.google.com/drive/folders/${folderId}`} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">📁 {folderNome || "pasta configurada"}</a>
        ) : <span className="text-xs text-amber-600">Nenhuma pasta configurada.</span>}
        <Button size="sm" variant="secondary" onClick={() => void escolher()} disabled={busy}>{busy ? "…" : folderId ? "Trocar pasta" : "Escolher pasta"}</Button>
      </div>
    </div>
  );
}

// ─── Apontamento (Visualização) ──────────────────────────────────────────────
function ApontamentoModal({ manutencao, onClose, endsDaEmpresa, rootFolderId, pessoaId }: {
  manutencao: Manutencao; onClose: () => void; endsDaEmpresa: Endereco[]; rootFolderId?: string; pessoaId: string;
}) {
  const [m, setM] = useState<Manutencao>(manutencao);
  const [subindo, setSubindo] = useState(false);
  const endsDoItem = endsDaEmpresa.filter(e => (m.enderecoIds || []).includes(e.id));
  const [endSel, setEndSel] = useState<string>(endsDoItem[0]?.id || "");
  const laudos = [...(m.laudos || [])].sort((a, b) => (b.enviadoEm || "").localeCompare(a.enviadoEm || ""));

  async function patch(p: Partial<Manutencao>) {
    const novo = { ...m, ...p, atualizadoEm: new Date().toISOString() };
    setM(novo);
    await updateDoc(doc(db, "manutencoes", m.id), sanitizeForFirestore(p));
  }
  async function concluir() {
    if (!confirm("Marcar como concluído e renovar o prazo pela periodicidade?")) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const dias = MANUTENCAO_PERIODICIDADE_DIAS[m.periodicidade] || m.periodicidadeCustomDias || 180;
    await patch({ ultimaExecucao: hoje, proximoVencimento: addDias(hoje, dias), statusCiclo: "pendente", agendadoPara: null });
    onClose();
  }
  async function subirLaudo(file: File) {
    if (!rootFolderId) { alert("Configure a pasta-raiz do Drive na aba 📝 Cadastro primeiro."); return; }
    const endId = endSel || endsDoItem[0]?.id;
    const end = endsDaEmpresa.find(e => e.id === endId);
    if (!end) { alert("Escolha o endereço do laudo."); return; }
    setSubindo(true);
    try {
      const endFolder = await centralEnsureFolder(rootFolderId, end.apelido);
      const tipoFolder = await centralEnsureFolder(endFolder, MANUTENCAO_TIPO_LABEL[m.tipo]);
      const dataStr = new Date().toISOString().slice(0, 10);
      const renomeado = new File([file], `${dataStr} - ${end.apelido} - ${file.name}`, { type: file.type });
      const up = await uploadFileToFolder(tipoFolder, renomeado);
      const laudo: ManutencaoLaudo = { id: `ld-${Date.now()}`, nome: renomeado.name, driveId: up.id, url: up.webViewLink, enderecoId: endId, enviadoEm: new Date().toISOString(), enviadoPor: pessoaId };
      await patch({ laudos: [...(m.laudos || []), laudo], statusCiclo: "aguardando_laudo" });
    } catch (e) { alert("Erro ao subir laudo: " + (e instanceof Error ? e.message : "?")); }
    finally { setSubindo(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{MANUTENCAO_TIPO_LABEL[m.tipo]}{m.fornecedor && <span className="text-gray-500 font-normal"> · {m.fornecedor}</span>}</h2>
        <p className="text-xs text-gray-500 mb-4">📍 {endsDoItem.map(e => e.apelido).join(" · ") || "—"} · próx. vencimento {fmtBR(m.proximoVencimento)}</p>

        <div className="space-y-4">
          {/* Status do ciclo */}
          <div>
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Status</div>
            <div className="flex flex-wrap gap-1.5">
              {(["pendente", "agendado", "aguardando_laudo"] as const).map(s => (
                <button key={s} type="button" onClick={() => void patch({ statusCiclo: s, ...(s !== "agendado" ? { agendadoPara: null } : {}) })}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border ${(m.statusCiclo || "pendente") === s ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{MANUTENCAO_STATUS_LABEL[s]}</button>
              ))}
            </div>
            {m.statusCiclo === "agendado" && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-xs text-gray-500">Agendado para:</span>
                <input type="date" value={m.agendadoPara || ""} onChange={(e) => void patch({ agendadoPara: e.target.value })} className="px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
              </div>
            )}
          </div>

          {/* Laudos */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Laudos ({laudos.length})</div>
              <div className="flex items-center gap-1.5">
                {endsDoItem.length > 1 && (
                  <select value={endSel} onChange={(e) => setEndSel(e.target.value)} className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 px-1.5 py-1">
                    {endsDoItem.map(e => <option key={e.id} value={e.id}>{e.apelido}</option>)}
                  </select>
                )}
                <label className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer ${subindo ? "opacity-50" : "border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"}`}>
                  {subindo ? "Enviando…" : "📎 Subir laudo"}
                  <input type="file" className="hidden" disabled={subindo} onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirLaudo(f); e.currentTarget.value = ""; }} />
                </label>
              </div>
            </div>
            {laudos.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Nenhum laudo ainda. Recebeu? Clique em “Subir laudo”.</p>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {laudos.map(l => (
                  <a key={l.id} href={l.url || "#"} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <span className="min-w-0 truncate text-indigo-600 dark:text-indigo-400">📄 {l.nome}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{fmtBR((l.enviadoEm || "").slice(0, 10))}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <Button onClick={() => void concluir()} className="w-full">✓ Concluído — renovar prazo</Button>
        </div>

        <div className="flex justify-end mt-4"><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
      </div>
    </div>
  );
}

// ─── Cadastro (config) ───────────────────────────────────────────────────────
function ManutencaoForm({ manutencao, onClose, restaurants, enderecos, pessoaId }: {
  manutencao: Manutencao | null; onClose: () => void; restaurants: { id: string; nome: string }[]; enderecos: Endereco[]; pessoaId: string;
}) {
  const [f, setF] = useState<Partial<Manutencao>>(manutencao ? { ...manutencao } : {
    tipo: "filtros_agua", restaurantIds: [], enderecoIds: [], obrigatorio: true,
    periodicidade: "semestral", proximoVencimento: addDias(new Date().toISOString().slice(0, 10), 180),
    diasAntecedencia: 30, responsavelPadraoId: pessoaId, projetoId: "proj-prazos", subprojetoId: "sub-prazos-manutencoes", ativo: true,
  });
  const selIds = f.enderecoIds || [];
  const toggleEnd = (id: string) => setF(p => { const cur = p.enderecoIds || []; return { ...p, enderecoIds: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }; });
  const porEmpresa = restaurants.map(r => ({ r, ends: enderecos.filter(e => e.restaurantId === r.id && (e.ativo !== false || selIds.includes(e.id))) })).filter(g => g.ends.length);

  async function salvar() {
    if (!f.tipo || !f.proximoVencimento) { alert("Tipo e próximo vencimento são obrigatórios"); return; }
    const now = new Date().toISOString();
    const id = manutencao?.id || `mt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const endIds = f.enderecoIds || [];
    const rids = [...new Set(endIds.map(eid => enderecos.find(e => e.id === eid)?.restaurantId).filter(Boolean) as string[])];
    const data: Manutencao = {
      id, tipo: f.tipo, fornecedor: f.fornecedor, descricao: f.descricao,
      restaurantIds: rids.length ? rids : (f.restaurantIds || []), enderecoIds: endIds, obrigatorio: f.obrigatorio ?? true,
      statusCiclo: f.statusCiclo, agendadoPara: f.agendadoPara, laudos: f.laudos,
      periodicidade: f.periodicidade || "semestral", periodicidadeCustomDias: f.periodicidadeCustomDias,
      proximoVencimento: f.proximoVencimento, ultimaExecucao: f.ultimaExecucao, diasAntecedencia: f.diasAntecedencia ?? 30,
      responsavelPadraoId: f.responsavelPadraoId || pessoaId, responsavelPadraoNome: f.responsavelPadraoNome,
      projetoId: f.projetoId || "proj-prazos", subprojetoId: f.subprojetoId || "sub-prazos-manutencoes",
      pastaDrive: f.pastaDrive, observacoes: f.observacoes, ultimaGeracaoChave: f.ultimaGeracaoChave,
      ativo: f.ativo ?? true, deletadoEm: f.deletadoEm, deletadoPor: f.deletadoPor,
      criadoEm: manutencao?.criadoEm || now, criadoPor: manutencao?.criadoPor || pessoaId, atualizadoEm: now,
    };
    await setDoc(doc(db, "manutencoes", id), sanitizeForFirestore(data));
    onClose();
  }
  async function excluir() {
    if (!manutencao) return;
    if (!confirm(`Excluir essa manutenção? Vai pra lixeira.`)) return;
    await setDoc(doc(db, "manutencoes", manutencao.id), sanitizeForFirestore({ ...manutencao, deletadoEm: new Date().toISOString(), deletadoPor: pessoaId }));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{manutencao ? "Editar cadastro" : "Nova Manutenção"}</h2>
        <div className="space-y-3">
          <Field label="Tipo *">
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as ManutencaoTipo, obrigatorio: !TIPOS_FLEXIVEIS.has(e.target.value as ManutencaoTipo) })} className="mt-input">
              {(Object.keys(MANUTENCAO_TIPO_LABEL) as ManutencaoTipo[]).map(t => <option key={t} value={t}>{MANUTENCAO_TIPO_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Fornecedor"><input value={f.fornecedor || ""} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} className="mt-input" placeholder="Ex: OrangeBio, Passare, Heavy Cleaning" /></Field>
          <Field label="Endereço(s) * — o item cobre estes locais">
            {porEmpresa.length === 0 ? <p className="text-xs text-amber-600">Cadastre endereços em Configurações → 📍 Endereços.</p> : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {porEmpresa.map(({ r, ends }) => (
                  <div key={r.id}>
                    <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{r.nome}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                      {ends.map(e => <label key={e.id} className={`flex items-center gap-1 text-xs ${e.ativo === false ? "opacity-60" : ""}`}><input type="checkbox" checked={selIds.includes(e.id)} onChange={() => toggleEnd(e.id)} />{e.apelido}{e.ativo === false ? " (inativo)" : ""}</label>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={f.obrigatorio ?? true} onChange={(e) => setF({ ...f, obrigatorio: e.target.checked })} />Obrigatório (gera laudo / prazo rígido)</label>
          <Field label="Periodicidade *">
            <select value={f.periodicidade} onChange={(e) => setF({ ...f, periodicidade: e.target.value as ManutencaoPeriodicidade })} className="mt-input">
              {(Object.keys(MANUTENCAO_PERIODICIDADE_LABEL) as ManutencaoPeriodicidade[]).map(p => <option key={p} value={p}>{MANUTENCAO_PERIODICIDADE_LABEL[p]}</option>)}
            </select>
          </Field>
          {f.periodicidade === "custom" && <Field label="Dias customizados"><input type="number" min="1" value={f.periodicidadeCustomDias || ""} onChange={(e) => setF({ ...f, periodicidadeCustomDias: parseInt(e.target.value) || 0 })} className="mt-input" /></Field>}
          <Field label="Próximo vencimento *"><input type="date" value={f.proximoVencimento || ""} onChange={(e) => setF({ ...f, proximoVencimento: e.target.value })} className="mt-input" /></Field>
          <Field label="Dias de antecedência do lembrete"><input type="number" min="0" max="120" value={f.diasAntecedencia ?? 30} onChange={(e) => setF({ ...f, diasAntecedencia: parseInt(e.target.value) || 0 })} className="mt-input" /></Field>
          <Field label="Observações"><textarea value={f.observacoes || ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} className="mt-input" rows={2} /></Field>
        </div>
        <style>{`.mt-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .mt-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex gap-2 justify-between mt-5">
          {manutencao ? <Button variant="ghost" onClick={excluir}>🗑️ Excluir</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose} variant="ghost">Cancelar</Button><Button onClick={salvar}>{manutencao ? "Salvar" : "Criar"}</Button></div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>{children}</label>;
}
function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00"); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10);
}
