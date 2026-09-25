// Ativos por empregado — controle de itens ÚNICOS entregues sob responsabilidade
// (cartão corporativo, celular, notebook, moto, veículo, crachá). Entrega, status
// (ativo/devolvido/bloqueado) e devolução. Diferente de Uniformes/EPI (estoque).
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { PageContainer } from "../../core/ui/PageContainer";
import { CreditCard, Smartphone, Laptop, Bike, Car, IdCard, Package, Plus, Search, Lock, Pencil, Trash2, Undo2, Ban, CircleCheck, FileText } from "lucide-react";
import type { Ativo, AtivoTipo, AtivoStatus, Empregado, Pessoa } from "../../core/types";
import { ATIVO_TIPO_LABEL, ATIVO_IDENT_LABEL, ATIVO_STATUS_LABEL } from "../../core/types";
import { DOCS, GeradorModal } from "../documentos/DocumentosPage";

// Tipo de ativo → modelo de termo na Fábrica de Documentos (cartão/outro ainda não têm).
const TIPO_DOC: Partial<Record<AtivoTipo, string>> = {
  celular: "termo-responsabilidade-celular",
  veiculo: "termo-responsabilidade-veiculo",
  moto: "termo-responsabilidade-motocicleta",
  notebook: "termo-responsabilidade-equipamento",
  cracha: "termo-entrega-cracha",
};
type EmpresaCfgLite = { campos: Record<string, string>; habilitados: string[] | null; termoMap: Record<string, string> };

const TIPO_ICON: Record<AtivoTipo, React.ComponentType<{ size?: number; className?: string }>> = {
  cartao: CreditCard, celular: Smartphone, notebook: Laptop, moto: Bike, veiculo: Car, cracha: IdCard, outro: Package,
};
const TIPOS: AtivoTipo[] = ["cartao", "celular", "notebook", "moto", "veiculo", "cracha", "outro"];
// Campos extras por tipo (além de nome/identificador).
const EXTRA: Record<AtivoTipo, { key: string; label: string }[]> = {
  cartao: [{ key: "bandeira", label: "Bandeira / emissor" }, { key: "limite", label: "Limite (R$)" }],
  moto: [{ key: "modelo", label: "Modelo / ano" }],
  veiculo: [{ key: "modelo", label: "Modelo / ano" }],
  celular: [{ key: "modelo", label: "Modelo" }],
  notebook: [{ key: "modelo", label: "Modelo" }],
  cracha: [], outro: [],
};
const STATUS_CLS: Record<AtivoStatus, string> = {
  ativo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  devolvido: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  bloqueado: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};
const fmtDia = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

export function AtivosPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();
  const master = !!me?.isMaster;
  const { can, loading } = useCanAcao(rid || "");
  const podeVer = master || can("ativos", "ver");
  const podeOperar = master || can("ativos", "registrar");
  const podeConfig = master || can("ativos", "configurar");

  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [empresas, setEmpresas] = useState<Record<string, EmpresaCfgLite>>({});
  const [fTipo, setFTipo] = useState<"todos" | AtivoTipo>("todos");
  const [fStatus, setFStatus] = useState<"abertos" | AtivoStatus | "todos">("abertos");
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState<Ativo | "novo" | null>(null);
  const [devolver, setDevolver] = useState<Ativo | null>(null);
  const [termo, setTermo] = useState<{ docId: string; empId: string } | null>(null);

  useEffect(() => {
    if (!rid) return;
    const ua = onSnapshot(query(collection(db, "ativos"), where("restaurantId", "==", rid)),
      snap => setAtivos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Ativo)), () => setAtivos([]));
    const ue = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      snap => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado)));
    const up = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)), () => setPessoas([]));
    const uc = onSnapshot(collection(db, "documentosEmpresas"), snap => {
      const m: Record<string, EmpresaCfgLite> = {};
      snap.docs.forEach(d => { const data = d.data() as { campos?: Record<string, string>; habilitados?: string[] | null; termoMap?: Record<string, string> }; m[d.id] = { campos: data?.campos || {}, habilitados: data?.habilitados ?? null, termoMap: data?.termoMap || {} }; });
      setEmpresas(m);
    }, () => setEmpresas({}));
    return () => { ua(); ue(); up(); uc(); };
  }, [rid]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ativos
      .filter(a => fTipo === "todos" || a.tipo === fTipo)
      .filter(a => fStatus === "todos" ? true : fStatus === "abertos" ? a.status !== "devolvido" : a.status === fStatus)
      .filter(a => !q || `${a.empregadoNomeSnapshot} ${a.nome || ""} ${a.identificador || ""} ${ATIVO_TIPO_LABEL[a.tipo]}`.toLowerCase().includes(q))
      .sort((a, b) => (a.empregadoNomeSnapshot || "").localeCompare(b.empregadoNomeSnapshot || "") || (b.entregueEm || "").localeCompare(a.entregueEm || ""));
  }, [ativos, fTipo, fStatus, busca]);

  const nAtivos = ativos.filter(a => a.status === "ativo").length;

  async function setStatus(a: Ativo, status: AtivoStatus, extra?: Partial<Ativo>) {
    const now = new Date().toISOString();
    const hist = [...(a.historico || []), { acao: status, em: now, porId: me?.id, porNome: me?.nome, detalhe: extra?.destinoDevolucao }];
    await updateDoc(doc(db, "ativos", a.id), sanitizeForFirestore({ status, atualizadoEm: now, historico: hist, ...extra }));
  }
  async function excluir(a: Ativo) {
    if (!window.confirm(`Excluir o registro de "${ATIVO_TIPO_LABEL[a.tipo]}" de ${a.empregadoNomeSnapshot}? Não dá pra desfazer.`)) return;
    await deleteDoc(doc(db, "ativos", a.id));
  }

  if (!me) return null;
  if (loading) return <PageContainer><div className="text-sm text-gray-400 p-6">Carregando…</div></PageContainer>;
  if (!podeVer) return (
    <PageContainer><div className="max-w-2xl mx-auto py-12 text-center"><div className="flex justify-center mb-3 text-gray-400"><Lock size={40} /></div><p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p></div></PageContainer>
  );

  return (
    <PageContainer>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><CreditCard size={20} className="text-indigo-500" /> Ativos por empregado</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Cartões, celulares, veículos e outros itens sob responsabilidade. {nAtivos} ativo(s) em uso.</p>
        </div>
        {podeOperar && <Button onClick={() => setForm("novo")}><span className="inline-flex items-center gap-1.5"><Plus size={15} /> Novo ativo</span></Button>}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por empregado, item, identificador…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
        </div>
        <select value={fTipo} onChange={e => setFTipo(e.target.value as typeof fTipo)} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="todos">Todos os tipos</option>
          {TIPOS.map(t => <option key={t} value={t}>{ATIVO_TIPO_LABEL[t]}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {([["abertos", "Em uso / bloqueados"], ["ativo", "Ativos"], ["bloqueado", "Bloqueados"], ["devolvido", "Devolvidos"], ["todos", "Todos"]] as const).map(([k, lb]) => (
          <button key={k} type="button" onClick={() => setFStatus(k)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${fStatus === k ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 font-semibold" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-indigo-300"}`}>{lb}</button>
        ))}
      </div>

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhum ativo {fStatus !== "todos" ? "com esse filtro" : "cadastrado"}. {podeOperar && "Clique em “Novo ativo” pra registrar uma entrega."}</div>
      ) : (
        <div className="space-y-2">
          {lista.map(a => {
            const Ico = TIPO_ICON[a.tipo];
            return (
              <div key={a.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="shrink-0 w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500"><Ico size={18} /></span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2 flex-wrap">
                        {a.empregadoNomeSnapshot}
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_CLS[a.status]}`}>{ATIVO_STATUS_LABEL[a.status]}</span>
                      </div>
                      <div className="text-[12px] text-gray-600 dark:text-gray-300 mt-0.5">
                        {ATIVO_TIPO_LABEL[a.tipo]}{a.nome ? ` · ${a.nome}` : ""}{a.identificador ? ` · ${ATIVO_IDENT_LABEL[a.tipo]}: ${a.identificador}` : ""}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {Object.entries(a.detalhes || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                        {(a.detalhes && Object.values(a.detalhes).some(Boolean)) ? " · " : ""}
                        entregue {fmtDia(a.entregueEm)}{a.entreguePorNome ? ` por ${a.entreguePorNome}` : ""}
                        {a.status === "devolvido" && a.devolvidoEm ? ` · devolvido ${fmtDia(a.devolvidoEm)}${a.destinoDevolucao ? ` (${a.destinoDevolucao})` : ""}` : ""}
                      </div>
                      {a.obs && <div className="text-[11px] text-gray-500 italic mt-0.5">{a.obs}</div>}
                    </div>
                  </div>
                  {podeOperar && (
                    <div className="flex items-center gap-1 shrink-0">
                      {TIPO_DOC[a.tipo] && <Button size="sm" variant="secondary" onClick={() => setTermo({ docId: TIPO_DOC[a.tipo]!, empId: a.empregadoId })}><span className="inline-flex items-center gap-1"><FileText size={13} /> Gerar termo</span></Button>}
                      {a.status !== "devolvido" && <Button size="sm" variant="secondary" onClick={() => setDevolver(a)}><span className="inline-flex items-center gap-1"><Undo2 size={13} /> Devolver</span></Button>}
                      {a.status === "ativo" && <button type="button" title="Bloquear" onClick={() => void setStatus(a, "bloqueado")} className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-gray-100 dark:hover:bg-gray-800"><Ban size={15} /></button>}
                      {a.status === "bloqueado" && <button type="button" title="Reativar" onClick={() => void setStatus(a, "ativo")} className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-gray-800"><CircleCheck size={15} /></button>}
                      <button type="button" title="Editar" onClick={() => setForm(a)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800"><Pencil size={15} /></button>
                      {podeConfig && <button type="button" title="Excluir" onClick={() => void excluir(a)} className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-gray-100 dark:hover:bg-gray-800"><Trash2 size={15} /></button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && podeOperar && (
        <AtivoFormModal atual={form === "novo" ? null : form} empregados={empregados} rid={rid || ""}
          meId={me.id} meNome={me.nome} onClose={() => setForm(null)} />
      )}
      {devolver && podeOperar && (
        <DevolverModal ativo={devolver} onConfirm={(destino) => { void setStatus(devolver, "devolvido", { devolvidoEm: new Date().toISOString(), devolvidoPorNome: me.nome, destinoDevolucao: destino }); setDevolver(null); }} onClose={() => setDevolver(null)} />
      )}
      {termo && (() => {
        const doc = DOCS.find(d => d.id === termo.docId);
        if (!doc) { return null; }
        return <GeradorModal doc={doc} rid={rid || ""} restaurants={restaurants} pessoas={pessoas} empregados={empregados}
          empresas={empresas} empIdInicial={termo.empId} subtitulo="Termo a partir do ativo" onClose={() => setTermo(null)} />;
      })()}
    </PageContainer>
  );
}

function AtivoFormModal({ atual, empregados, rid, meId, meNome, onClose }: {
  atual: Ativo | null; empregados: Empregado[]; rid: string; meId: string; meNome: string; onClose: () => void;
}) {
  const [tipo, setTipo] = useState<AtivoTipo>(atual?.tipo || "cartao");
  const [empId, setEmpId] = useState(atual?.empregadoId || "");
  const [buscaEmp, setBuscaEmp] = useState("");
  const [nome, setNome] = useState(atual?.nome || "");
  const [ident, setIdent] = useState(atual?.identificador || "");
  const [detalhes, setDetalhes] = useState<Record<string, string>>(atual?.detalhes || {});
  const [entregueEm, setEntregueEm] = useState((atual?.entregueEm || new Date().toISOString()).slice(0, 10));
  const [obs, setObs] = useState(atual?.obs || "");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  const empsAtivos = useMemo(() => empregados.filter(e => e.estaAtivo !== false).sort((a, b) => (a.nome || "").localeCompare(b.nome || "")), [empregados]);
  const emp = empsAtivos.find(e => e.id === empId) || null;
  const empFiltrados = buscaEmp.trim() ? empsAtivos.filter(e => (e.nome || "").toLowerCase().includes(buscaEmp.trim().toLowerCase())).slice(0, 8) : empsAtivos.slice(0, 8);
  const inp = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";

  async function salvar() {
    if (!empId) { setErro("Escolha o empregado."); return; }
    setSaving(true); setErro("");
    try {
      const now = new Date().toISOString();
      const empNome = emp?.nome || atual?.empregadoNomeSnapshot || "";
      const det = Object.fromEntries(Object.entries(detalhes).filter(([, v]) => (v || "").trim()));
      const base = {
        restaurantId: rid, tipo, nome: nome.trim() || undefined, identificador: ident.trim() || undefined,
        detalhes: Object.keys(det).length ? det : undefined,
        empregadoId: empId, empregadoNomeSnapshot: empNome,
        entregueEm: new Date(entregueEm + "T12:00:00").toISOString(), obs: obs.trim() || undefined, atualizadoEm: now,
      };
      if (atual) {
        await updateDoc(doc(db, "ativos", atual.id), sanitizeForFirestore(base));
      } else {
        await addDoc(collection(db, "ativos"), sanitizeForFirestore({
          ...base, status: "ativo", entreguePorId: meId, entreguePorNome: meNome, criadoEm: now,
          historico: [{ acao: "entregue", em: now, porId: meId, porNome: meNome }],
        }));
      }
      onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); setSaving(false); }
  }

  return (
    <Modal title={atual ? "Editar ativo" : "Novo ativo — registrar entrega"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Tipo</label>
          <select value={tipo} onChange={e => { setTipo(e.target.value as AtivoTipo); setDetalhes({}); }} className={`${inp} mt-1`}>
            {TIPOS.map(t => <option key={t} value={t}>{ATIVO_TIPO_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Empregado</label>
          {emp ? (
            <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-sm">
              <span className="flex-1 truncate">{emp.nome}</span>
              <button type="button" onClick={() => { setEmpId(""); setBuscaEmp(""); }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
          ) : (
            <>
              <input value={buscaEmp} onChange={e => setBuscaEmp(e.target.value)} placeholder="Buscar empregado…" className={`${inp} mt-1`} />
              {empFiltrados.length > 0 && (
                <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-40 overflow-auto">
                  {empFiltrados.map(e => <button key={e.id} type="button" onClick={() => setEmpId(e.id)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10">{e.nome}</button>)}
                </div>
              )}
            </>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-gray-500">Descrição (opcional)</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder={tipo === "cartao" ? "ex.: Visa Itaú — operação" : "ex.: modelo/uso"} className={`${inp} mt-0.5`} />
          </div>
          <div>
            <label className="text-[11px] text-gray-500">{ATIVO_IDENT_LABEL[tipo]}</label>
            <input value={ident} onChange={e => setIdent(e.target.value)} className={`${inp} mt-0.5`} />
          </div>
          {EXTRA[tipo].map(f => (
            <div key={f.key}>
              <label className="text-[11px] text-gray-500">{f.label}</label>
              <input value={detalhes[f.key] || ""} onChange={e => setDetalhes(s => ({ ...s, [f.key]: e.target.value }))} className={`${inp} mt-0.5`} />
            </div>
          ))}
          <div>
            <label className="text-[11px] text-gray-500">Data de entrega</label>
            <input type="date" value={entregueEm} onChange={e => setEntregueEm(e.target.value)} className={`${inp} mt-0.5`} />
          </div>
        </div>
        <div>
          <label className="text-[11px] text-gray-500">Observação (opcional)</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} className={`${inp} mt-0.5 resize-y`} />
        </div>
        {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={saving}>{saving ? "Salvando…" : (atual ? "Salvar" : "Registrar entrega")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function DevolverModal({ ativo, onConfirm, onClose }: { ativo: Ativo; onConfirm: (destino: string) => void; onClose: () => void }) {
  const [destino, setDestino] = useState("devolvido em bom estado");
  return (
    <Modal title="Registrar devolução" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">Devolução de <b>{ATIVO_TIPO_LABEL[ativo.tipo]}</b> de <b>{ativo.empregadoNomeSnapshot}</b>.</p>
        <div>
          <label className="text-[11px] text-gray-500">Situação da devolução</label>
          <select value={destino} onChange={e => setDestino(e.target.value)} className="w-full mt-0.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
            <option value="devolvido em bom estado">Devolvido em bom estado</option>
            <option value="devolvido com avaria">Devolvido com avaria</option>
            <option value="cancelado/bloqueado">Cancelado / bloqueado (cartão)</option>
            <option value="perdido">Perdido</option>
            <option value="roubado/furtado">Roubado / furtado</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm(destino)}><span className="inline-flex items-center gap-1.5"><Undo2 size={14} /> Confirmar devolução</span></Button>
        </div>
      </div>
    </Modal>
  );
}
