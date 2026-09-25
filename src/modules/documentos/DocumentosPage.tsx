// Documentos — fábrica de documentos trabalhistas do escritório.
// Escolhe o modelo (50 do acervo), puxa EMPRESA (dados trabalhistas por restaurante)
// e EMPREGADO (Pessoas), a DATA é de hoje, os campos específicos/textos livres são
// preenchidos, e o backend (/api/documento-preencher, python-docx) devolve o DOCX
// preenchido pra assinatura. PDF exato sai pela skill/LibreOffice (fase seguinte).

import { useEffect, useMemo, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { Settings, History, Files, TriangleAlert, CheckSquare, Check, ReceiptText, Plus, PenLine, FileText, Building2, CalendarDays, User, Pencil, UserRoundPlus, Sparkles, Loader2, X, type LucideIcon } from "lucide-react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where, doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import type { Pessoa, Empregado } from "../../core/types";
import { getTermosAssinaturaDefault } from "../../core/admissao/admissaoHelpers";
import { HistoricoDocumentos } from "./HistoricoDocumentos";
import { ConfigCargos } from "./ConfigCargos";
import { LoteModal } from "./LoteModal";
import CATALOGO from "./catalogo.json";
import MARCACOES_JSON from "./marcacoes.json";
import QUADROS_JSON from "./quadros.json";
import { PageContainer } from "../../core/ui/PageContainer";

type Campo = { token: string; rotulo: string; tipo: string; obrigatorio: boolean; origem: string; ajuda: string };
type TextoLivre = { campo: string; rotulo: string; apos: string };
type DocModelo = { id: string; titulo: string; categoria: string; quando_usar: string; observacoes: string; campos: Campo[]; texto_livre: TextoLivre[] };
type MarcOpcao = { valor: string; label: string; ancora: string };
type Marcacao = { campo: string; rotulo: string; opcoes: MarcOpcao[] };
type Quadro = { titulo: string; tabela: number; linha_inicial: number; col_inicial: number; max_linhas: number; podeAdicionar: boolean; colunas: string[] };
type EmpresaCfg = { campos: Record<string, string>; habilitados: string[] | null; termoMap: Record<string, string> };
export type { DocModelo };
export const DOCS = CATALOGO as DocModelo[];
const MARCACOES = MARCACOES_JSON as Record<string, Marcacao[]>;
const QUADROS = QUADROS_JSON as Record<string, Quadro[]>;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Dados trabalhistas por empresa (Firestore documentosEmpresas/{rid}).
// Essenciais aparecem na maioria dos documentos; os "de nicho" servem a UM
// documento cada (mostrados numa seção opcional, com a nota de onde entram).
type EmpresaCampo = { token: string; rotulo: string; nota?: string };
const EMPRESA_ESSENCIAIS: EmpresaCampo[] = [
  { token: "RAZAO_SOCIAL", rotulo: "Razão social" },
  { token: "CNPJ_EMPRESA", rotulo: "CNPJ" },
  { token: "ENDERECO_EMPRESA", rotulo: "Endereço completo" },
  { token: "CIDADE", rotulo: "Cidade (usada na data de assinatura)" },
];
const EMPRESA_ESPECIFICOS: EmpresaCampo[] = [
  { token: "EMAIL_EMPRESA", rotulo: "E-mail", nota: "só no termo de depósito em conta de terceiro" },
  { token: "NUMERO_CONTATO_EMPRESA", rotulo: "Telefone / WhatsApp", nota: "só no termo de conta bancária própria" },
  { token: "CEP_EMPRESA", rotulo: "CEP", nota: "só no contrato de autônomo" },
  { token: "BANCO", rotulo: "Banco", nota: "só na carta de encaminhamento pra conta salário" },
  { token: "AGENCIA_EMPRESA", rotulo: "Agência", nota: "idem — carta de conta salário" },
  { token: "CONTA_EMPRESA", rotulo: "Conta", nota: "idem — carta de conta salário" },
];

const ORIGEM_LABEL: Record<string, string> = { empresa: "Empresa", data: "Data (hoje)", empregado: "Empregado", especifico: "Específicos do documento" };
const ORIGEM_ICONE: Record<string, LucideIcon> = { empresa: Building2, data: CalendarDays, empregado: User, especifico: Pencil };
const ORIGEM_ORDEM = ["empregado", "especifico", "data", "empresa"];

// Resumo dos campos que o usuário PREENCHE num documento (empregado + específicos
// + opções + textos livres) e as tabelas. Empresa/data são automáticos (não listados).
function resumoCampos(d: DocModelo) {
  const marc = MARCACOES[d.id] || [];
  const quad = QUADROS[d.id] || [];
  const tl = d.texto_livre || [];
  const preenche = [
    ...d.campos.filter(c => c.origem === "empregado" || c.origem === "especifico").map(c => c.obrigatorio ? c.rotulo : c.rotulo + " (opc.)"),
    ...marc.map(m => m.rotulo),
    ...tl.map(t => t.rotulo),
  ];
  return { preenche, tabelas: quad.map(q => q.titulo) };
}

export function DocumentosPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();
  const { can, loading } = useCanAcao(rid || "");
  const master = !!pessoa?.isMaster;
  const podeGerar = master || can("documentos", "gerar");
  const podeConfig = master || can("documentos", "configEmpresas");

  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [empresas, setEmpresas] = useState<Record<string, EmpresaCfg>>({});
  const [busca, setBusca] = useState("");
  const [iaPergunta, setIaPergunta] = useState("");
  const [iaIds, setIaIds] = useState<string[] | null>(null);
  const [iaResposta, setIaResposta] = useState("");
  const [iaLoading, setIaLoading] = useState(false);
  const [iaErro, setIaErro] = useState("");
  const [sel, setSel] = useState<DocModelo | null>(null);
  const [loteAberto, setLoteAberto] = useState(false);
  const [areaSel, setAreaSel] = useState<string>("");
  const [modo, setModo] = useState<"catalogo" | "config">("catalogo");
  const [secao, setSecao] = useState<"outros" | "historico" | "cargos">("outros");
  const [empresaRid, setEmpresaRid] = useState(rid || "");

  useEffect(() => { if (rid) setEmpresaRid(rid); }, [rid]);
  useEffect(() => {
    if (!rid) return;
    const up = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)));
    const ue = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      snap => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado)));
    const uc = onSnapshot(collection(db, "documentosEmpresas"), snap => {
      const m: Record<string, EmpresaCfg> = {};
      snap.docs.forEach(d => { const data = d.data() as { campos?: Record<string, string>; habilitados?: string[] | null; termoMap?: Record<string, string> }; m[d.id] = { campos: data?.campos || {}, habilitados: data?.habilitados ?? null, termoMap: data?.termoMap || {} }; });
      setEmpresas(m);
    });
    return () => { up(); ue(); uc(); };
  }, [rid]);

  if (!pessoa) return null;
  if (loading) return <div className="max-w-5xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;
  if (!podeGerar && !podeConfig) return <div className="max-w-5xl mx-auto p-8 text-center text-gray-500">Você não tem permissão para acessar Documentos.</div>;

  // Documentos disponíveis pra empresa selecionada (habilitados null/ausente = todos).
  const habil = empresas[empresaRid]?.habilitados;
  const disponiveis = habil ? DOCS.filter(d => habil.includes(d.id)) : DOCS;
  const q = busca.trim().toLowerCase();
  const iaSet = iaIds ? new Set(iaIds) : null;
  const filtrados = disponiveis.filter(d => {
    if (iaSet && !iaSet.has(d.id)) return false;
    return !q || `${d.titulo} ${d.categoria} ${d.quando_usar}`.toLowerCase().includes(q);
  });
  // Documentos que dá pra gerar em lote (preenchem sozinhos: só empresa/empregado/data,
  // sem opções, tabelas ou textos redigidos).
  const docElegivelLote = (d: DocModelo) => !(MARCACOES[d.id]?.length) && !(QUADROS[d.id]?.length) && !(d.texto_livre?.length) && d.campos.every(c => ["empresa", "empregado", "data"].includes(c.origem));
  const docsElegiveisLote = disponiveis.filter(docElegivelLote);

  // Mestre-detalhe: áreas (categorias) à esquerda, documentos à direita.
  const ORDEM_AREAS = ["Admissão e contratos", "Termos de responsabilidade", "LGPD e diversos", "Benefícios", "Férias e jornada", "Disciplina", "Desligamento"];
  const categorias = [...new Set(disponiveis.map(d => d.categoria))]
    .sort((a, b) => { const ia = ORDEM_AREAS.indexOf(a), ib = ORDEM_AREAS.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  const areaAtual = (areaSel && filtrados.some(d => d.categoria === areaSel)) ? areaSel : (categorias.find(c => filtrados.some(d => d.categoria === c)) || categorias[0] || "");
  const docsDaArea = filtrados.filter(d => d.categoria === areaAtual);

  async function perguntarIA() {
    const p = iaPergunta.trim();
    if (!p) return;
    setIaLoading(true); setIaErro(""); setIaResposta("");
    try {
      const r = await fetch("/api/documentos-buscar-ia", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ pergunta: p, docs: disponiveis.map(d => ({ id: d.id, titulo: d.titulo, categoria: d.categoria, quando_usar: d.quando_usar, observacoes: d.observacoes })) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Falha ao consultar a IA.");
      setIaResposta(j.resposta || "");
      setIaIds(Array.isArray(j.ids) ? j.ids : []);
    } catch (e) { setIaErro(e instanceof Error ? e.message : "Erro"); }
    finally { setIaLoading(false); }
  }
  function limparIA() { setIaIds(null); setIaResposta(""); setIaPergunta(""); setIaErro(""); }

  if (modo === "config" && podeConfig) {
    return <ConfigView restaurants={restaurants} empresas={empresas} empresaRid={empresaRid}
      pessoaId={pessoa.id} pessoaNome={pessoa.nome} onVoltar={() => setModo("catalogo")} />;
  }

  return (
    <PageContainer>
      {podeConfig && (
        <header className="mb-4 flex items-start justify-end gap-3">
          <Button variant="secondary" onClick={() => setModo("config")}><span className="inline-flex items-center gap-1.5"><Settings size={14} /> Configurações</span></Button>
        </header>
      )}

      {/* Abas por tipo de documento */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {([["outros", "Documentos", Files], ["historico", "Histórico", History], ["cargos", "Cargos", Settings]] as const).map(([id, lb, Ico]) => (
          <button key={id} type="button" onClick={() => setSecao(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${secao === id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"}`}>
            <Ico size={15} /> {lb}
          </button>
        ))}
      </div>

      {secao === "cargos" && <ConfigCargos rid={rid || empresaRid || ""} />}

      {secao === "historico" && <HistoricoDocumentos rid={rid || empresaRid || ""} />}

      {secao === "outros" && (<>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar documento…"
          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
        {podeGerar && <Button variant="secondary" onClick={() => setLoteAberto(true)}><span className="inline-flex items-center gap-1.5"><Files size={14} /> Gerar em lote</span></Button>}
      </div>

      {/* Assistente IA — pergunte o que precisa e a lista filtra */}
      <div className="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-900/10 p-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="shrink-0 text-indigo-500" />
          <input value={iaPergunta} onChange={e => setIaPergunta(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void perguntarIA(); }}
            placeholder="Pergunte à IA: quais documentos usar na admissão? na advertência? na demissão sem justa causa?"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-gray-400 dark:text-gray-100" />
          <Button size="sm" onClick={() => void perguntarIA()} disabled={iaLoading || !iaPergunta.trim()}>
            <span className="inline-flex items-center gap-1.5">{iaLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {iaLoading ? "Pensando…" : "Perguntar"}</span>
          </Button>
        </div>
        {iaErro && <div className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{iaErro}</div>}
        {(iaResposta || iaIds) && !iaErro && (
          <div className="mt-2 flex items-start justify-between gap-2">
            <p className="text-[13px] text-gray-700 dark:text-gray-200 leading-snug">
              {iaResposta}
              {iaIds && <span className="text-gray-400"> {" "}· {iaIds.length} documento(s) filtrado(s).</span>}
            </p>
            <button type="button" onClick={limparIA} className="shrink-0 text-[11px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"><X size={12} /> limpar</button>
          </div>
        )}
      </div>

      {podeGerar ? (
        categorias.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nenhum documento disponível para esta empresa. {podeConfig ? "Habilite documentos em ⚙️ Configurações." : "Fale com quem configura o módulo."}</div>
        ) : (
          <div className="flex flex-col md:flex-row gap-4">
            {/* Áreas (mestre) */}
            <aside className="md:w-56 shrink-0">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Áreas</div>
              <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-1 -mx-1 px-1 md:mx-0 md:px-0">
                {categorias.map(cat => {
                  const n = filtrados.filter(d => d.categoria === cat).length;
                  const on = cat === areaAtual;
                  return (
                    <button key={cat} type="button" onClick={() => setAreaSel(cat)} disabled={n === 0}
                      className={`text-left whitespace-nowrap md:whitespace-normal rounded-lg border px-3 py-2 text-sm transition-colors shrink-0 md:shrink ${on ? "border-indigo-400 bg-indigo-50/70 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 font-semibold" : n === 0 ? "border-gray-200 dark:border-gray-800 text-gray-300 dark:text-gray-600 cursor-default" : "border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-indigo-300"}`}>
                      <span className="flex items-center justify-between gap-2">{cat} <span className="text-[11px] opacity-70 tabular-nums">{n}</span></span>
                    </button>
                  );
                })}
              </div>
            </aside>
            {/* Documentos da área (detalhe) */}
            <div className="flex-1 min-w-0 space-y-2">
              {docsDaArea.length === 0 ? (
                <div className="text-sm text-gray-400 py-10 text-center">Nenhum documento nesta área com o filtro atual.</div>
              ) : docsDaArea.map(d => {
                const rc = resumoCampos(d);
                return (
                  <button key={d.id} type="button" onClick={() => setSel(d)}
                    className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{d.titulo}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{d.quando_usar}</div>
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1"><PenLine size={12} /> preencher</span>
                    </div>
                    {(rc.preenche.length > 0 || rc.tabelas.length > 0) ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide mr-0.5 self-center">preenche:</span>
                        {rc.preenche.map((f, i) => <span key={i} className="text-[10.5px] rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5">{f}</span>)}
                        {rc.tabelas.map((f, i) => <span key={"t" + i} className="text-[10.5px] rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5">▤ {f}</span>)}
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-gray-400">Só dados de empresa/empregado (preenchidos automaticamente).</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Você pode configurar o módulo, mas não tem permissão para gerar documentos.</div>
      )}

      {sel && podeGerar && (
        <GeradorModal key={sel.id} doc={sel} rid={empresaRid || rid || ""} restaurants={restaurants} pessoas={pessoas} empregados={empregados}
          empresas={empresas} onClose={() => setSel(null)} />
      )}
      {loteAberto && podeGerar && (
        <LoteModal docsElegiveis={docsElegiveisLote} empresaData={empresas[empresaRid]?.campos || {}}
          empregados={empregados.filter(e => e.restaurantId === empresaRid)} pessoas={pessoas}
          empresaNome={restaurants.find(r => r.id === empresaRid)?.nome || ""} onClose={() => setLoteAberto(false)} />
      )}
      </>)}
    </PageContainer>
  );
}

// ─── Gerador de um documento ─────────────────────────────────────────────────
export function GeradorModal({ doc: modelo, rid, restaurants, pessoas, empregados, empresas, onClose, prefill, onGerado, hideEmpregado, subtitulo, prefillQuadros, empIdInicial }: {
  doc: DocModelo; rid: string; restaurants: { id: string; nome: string }[]; pessoas: Pessoa[]; empregados: Empregado[];
  empresas: Record<string, EmpresaCfg>; onClose: () => void;
  // Uso externo (ex.: Admissão): prefill de campos, empresa travada, empregado
  // oculto, e callback que recebe o DOCX gerado (em vez de baixar).
  prefill?: Record<string, string>; onGerado?: (blob: Blob, nome: string) => Promise<void> | void;
  lockEmpresa?: boolean; hideEmpregado?: boolean; subtitulo?: string;
  // Linhas de quadro pré-preenchidas (ex.: itens de uma entrega de uniforme/EPI),
  // por índice do quadro.
  prefillQuadros?: Record<number, string[][]>;
  // Empregado pré-selecionado (ex.: abrindo o termo a partir de um ativo).
  empIdInicial?: string;
}) {
  const [empresaRid] = useState(rid || restaurants[0]?.id || "");
  const [empId, setEmpId] = useState<string>(empIdInicial || "");
  const [buscaEmp, setBuscaEmp] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [livres, setLivres] = useState<Record<string, string>>({});
  const [marcado, setMarcado] = useState<Record<string, string>>({});
  const [linhasQ, setLinhasQ] = useState<Record<number, string[][]>>(() => prefillQuadros || {});
  const [assinaturas, setAssinaturas] = useState(false);
  const [testemunhas, setTestemunhas] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");
  const [faltando, setFaltando] = useState<string[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewAberto, setPreviewAberto] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const empsAtivos = useMemo(() => empregados.filter(e => e.restaurantId === empresaRid && e.estaAtivo !== false), [empregados, empresaRid]);
  const emp = empsAtivos.find(e => e.id === empId) || null;
  const pes = emp?.pessoaId ? pessoas.find(p => p.id === emp.pessoaId) : null;
  const empresaData = empresas[empresaRid]?.campos || {};
  const marcs = MARCACOES[modelo.id] || [];
  const faltamMarcacoes = marcs.some(g => !marcado[g.campo]);
  const quads = QUADROS[modelo.id] || [];
  const linhasDe = (qi: number, cols: number) => linhasQ[qi] || [Array(cols).fill("")];
  const setCel = (qi: number, ri: number, ci: number, v: string, cols: number) => setLinhasQ(s => {
    const cur = (s[qi] || [Array(cols).fill("")]).map(r => [...r]);
    cur[ri][ci] = v;
    return { ...s, [qi]: cur };
  });
  const addLinha = (qi: number, cols: number) => setLinhasQ(s => ({ ...s, [qi]: [...(s[qi] || [Array(cols).fill("")]), Array(cols).fill("")] }));
  const delLinha = (qi: number, ri: number) => setLinhasQ(s => ({ ...s, [qi]: (s[qi] || []).filter((_, i) => i !== ri) }));

  // Valores default por token (empresa → data → empregado). Recalcula quando muda
  // empresa/empregado; o usuário pode sobrescrever qualquer campo.
  const defaults = useMemo(() => {
    const h = new Date();
    const dia = String(h.getDate()), mes = MESES[h.getMonth()], ano2 = String(h.getFullYear()).slice(-2);
    const dataStr = fmtBR(h.toISOString());
    const nome = emp?.nome || pes?.nome || "";
    const cpf = emp?.cpf || pes?.cpf || "";
    const adm = emp?.admissaoAtual || emp?.periodos?.[(emp?.periodos?.length || 1) - 1]?.admissao || "";
    const d: Record<string, string> = {
      DIA: dia, DIA_1: dia, DIA_2: dia, MES: mes, MES_1: mes, MES_2: mes,
      ANO2: ano2, ANO2_1: ano2, ANO2_2: ano2, DATA: dataStr, CIDADE: empresaData.CIDADE || "",
      NOME_EMPREGADO: nome, CPF_EMPREGADO: cpf, DATA_ADMISSAO: adm ? fmtBR(adm) : "",
      ...empresaData,
      ...(prefill || {}),
    };
    return d;
  }, [empresaData, emp, pes, prefill]);

  useEffect(() => { setValues({}); setLivres({}); setFaltando(null); }, [empresaRid, empId]);

  const valDe = (token: string) => (values[token] ?? defaults[token] ?? "");
  const setVal = (token: string, v: string) => setValues(s => ({ ...s, [token]: v }));

  // Agrupa os campos por origem, na ordem definida.
  const grupos = useMemo(() => {
    const g: Record<string, Campo[]> = {};
    for (const c of modelo.campos) { (g[c.origem] = g[c.origem] || []).push(c); }
    return ORIGEM_ORDEM.filter(o => g[o]?.length).map(o => [o, g[o]] as [string, Campo[]]);
  }, [modelo]);

  // Monta os dados e chama o backend; devolve o .docx pronto (sem baixar).
  async function montarDocx(): Promise<{ blob: Blob; nomeArq: string; faltando: string[] }> {
    const dados: Record<string, unknown> = {};
    for (const c of modelo.campos) dados[c.token] = valDe(c.token);
    const _inserir = modelo.texto_livre.filter(t => (livres[t.campo] || "").trim()).map(t => ({ apos: t.apos, texto: (livres[t.campo] || "").trim() }));
    if (_inserir.length) dados._inserir = _inserir;
    const _marcar = marcs.map(g => g.opcoes.find(o => o.valor === marcado[g.campo])).filter(Boolean).map(o => ({ ancora: (o as MarcOpcao).ancora }));
    if (_marcar.length) dados._marcar = _marcar;
    const _tabela = quads.map((qd, qi) => ({
      tabela: qd.tabela, linha_inicial: qd.linha_inicial, col_inicial: qd.col_inicial,
      linhas: (linhasQ[qi] || []).map(r => r.map(v => (v || "").trim())).filter(r => r.some(v => v)),
    })).filter(x => x.linhas.length);
    if (_tabela.length) dados._tabela = _tabela;
    if (assinaturas) dados._assinaturas = { empregado: valDe("NOME_EMPREGADO"), empregadora: valDe("RAZAO_SOCIAL") };
    if (testemunhas) dados._testemunhas = true;

    const r = await fetch("/api/documento-preencher", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ modeloId: modelo.id, dados }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    const bin = atob(String(data.docxBase64 || ""));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const hoje = new Date();
    const stamp = `${hoje.getFullYear()}.${String(hoje.getMonth() + 1).padStart(2, "0")}.${String(hoje.getDate()).padStart(2, "0")}`;
    const nomeArq = `${stamp} ${modelo.titulo}${valDe("NOME_EMPREGADO") ? " - " + valDe("NOME_EMPREGADO") : ""}.docx`;
    return { blob, nomeArq, faltando: Array.isArray(data.faltando) ? data.faltando : [] };
  }

  async function gerar() {
    setErro(""); setGerando(true); setFaltando(null);
    try {
      const { blob, nomeArq, faltando } = await montarDocx();
      if (onGerado) {
        await onGerado(blob, nomeArq);   // uso externo (ex.: sobe pro Drive da Admissão)
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = nomeArq; document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
      setFaltando(faltando);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o documento.");
    } finally { setGerando(false); }
  }

  // Pré-visualiza o .docx preenchido renderizado no navegador (docx-preview).
  async function preview() {
    setErro(""); setPreviewLoading(true); setFaltando(null);
    try {
      const { blob, faltando } = await montarDocx();
      setFaltando(faltando);
      const el = previewRef.current;
      if (el) {
        el.innerHTML = "";
        await renderAsync(blob, el, undefined, { className: "docxpv", inWrapper: true, ignoreWidth: false, ignoreHeight: false });
      }
      setPreviewAberto(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao pré-visualizar.");
    } finally { setPreviewLoading(false); }
  }

  const inp = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100";
  const empresaIncompleta = !empresaData.RAZAO_SOCIAL;
  const empFiltrados = buscaEmp.trim() ? empsAtivos.filter(e => (e.nome || "").toLowerCase().includes(buscaEmp.trim().toLowerCase())) : empsAtivos.slice(0, 8);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{modelo.titulo}</h2>
            <div className="text-xs text-gray-500">{subtitulo || modelo.categoria}</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {modelo.observacoes && (
            <div className="text-[12px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2 leading-snug inline-flex items-start gap-1"><TriangleAlert size={13} className="shrink-0 mt-0.5" /> {modelo.observacoes}</div>
          )}

          {/* Empresa + empregado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Empresa</label>
              <div className={`${inp} mt-1 flex items-center gap-2`} title="A empresa segue o seletor do topo">
                <Building2 size={14} className="text-gray-400 shrink-0" />
                <span className="truncate">{restaurants.find(r => r.id === empresaRid)?.nome || "—"}</span>
              </div>
              {empresaIncompleta && <div className="text-[11px] text-rose-600 mt-1">Sem dados cadastrais — preencha em <span className="inline-flex items-center gap-0.5 align-middle"><Settings size={11} /> Configurações</span>.</div>}
            </div>
            <div className={hideEmpregado ? "hidden" : ""}>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Empregado</label>
              {emp ? (
                <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-sm">
                  <span className="flex-1 truncate">{emp.nome}</span>
                  <button type="button" onClick={() => { setEmpId(""); setBuscaEmp(""); }} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
              ) : (
                <>
                  <input value={buscaEmp} onChange={e => setBuscaEmp(e.target.value)} placeholder="Buscar por nome…" className={`${inp} mt-1`} />
                  {buscaEmp.trim() && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                      {empFiltrados.length === 0 ? <div className="px-3 py-2 text-xs text-gray-400">Nenhum empregado ativo.</div> :
                        empFiltrados.map(e => (
                          <button key={e.id} type="button" onClick={() => { setEmpId(e.id); setBuscaEmp(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{e.nome}</button>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Campos por origem */}
          {grupos.map(([origem, campos]) => (
            <div key={origem}>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 inline-flex items-center gap-1.5">{(() => { const Ic = ORIGEM_ICONE[origem]; return Ic ? <Ic size={12} /> : null; })()} {ORIGEM_LABEL[origem] || origem}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {campos.map(c => (
                  <div key={c.token} className={c.tipo === "textarea" ? "sm:col-span-2" : ""}>
                    <label className="text-[11px] text-gray-500">{c.rotulo}{c.obrigatorio ? " *" : ""}</label>
                    {c.tipo === "textarea"
                      ? <textarea value={valDe(c.token)} onChange={e => setVal(c.token, e.target.value)} placeholder={c.ajuda || ""} rows={2} className={`${inp} mt-0.5`} />
                      : <input value={valDe(c.token)} onChange={e => setVal(c.token, e.target.value)} placeholder={c.ajuda || ""} className={`${inp} mt-0.5`} />}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Opções (marcações do documento) */}
          {marcs.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 inline-flex items-center gap-1.5"><CheckSquare size={12} /> Opções do documento</div>
              <div className="space-y-3">
                {marcs.map(g => (
                  <div key={g.campo}>
                    <div className="text-[12px] font-medium text-gray-700 dark:text-gray-200 mb-1">{g.rotulo}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {g.opcoes.map(o => (
                        <label key={o.valor} className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                          <input type="radio" name={`${modelo.id}-${g.campo}`} checked={marcado[g.campo] === o.valor} onChange={() => setMarcado(s => ({ ...s, [g.campo]: o.valor }))} />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quadros repetíveis */}
          {quads.map((qd, qi) => {
            const cols = qd.colunas.length;
            const linhas = linhasDe(qi, cols);
            return (
              <div key={qi}>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 inline-flex items-center gap-1.5"><ReceiptText size={12} /> {qd.titulo}</div>
                <div className="overflow-x-auto">
                  <div className="space-y-1.5 min-w-[400px]">
                    <div className="flex gap-1.5">
                      {qd.colunas.map(c => <div key={c} className="flex-1 text-[10px] text-gray-400 px-1">{c}</div>)}
                      <div className="w-6" />
                    </div>
                    {linhas.map((linha, ri) => (
                      <div key={ri} className="flex gap-1.5 items-center">
                        {qd.colunas.map((_, ci) => (
                          <input key={ci} value={linha[ci] || ""} onChange={e => setCel(qi, ri, ci, e.target.value, cols)}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
                        ))}
                        <button type="button" onClick={() => delLinha(qi, ri)} className="w-6 shrink-0 text-gray-400 hover:text-rose-600 text-sm" title="Remover linha">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
                {linhas.length < qd.max_linhas && (
                  <button type="button" onClick={() => addLinha(qi, cols)} className="mt-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"><Plus size={12} /> adicionar linha</button>
                )}
              </div>
            );
          })}

          {/* Textos livres */}
          {modelo.texto_livre.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 inline-flex items-center gap-1.5"><PenLine size={12} /> Textos redigidos</div>
              <div className="space-y-2">
                {modelo.texto_livre.map(t => (
                  <div key={t.campo}>
                    <label className="text-[11px] text-gray-500">{t.rotulo}</label>
                    <textarea value={livres[t.campo] || ""} onChange={e => setLivres(s => ({ ...s, [t.campo]: e.target.value }))} rows={3}
                      placeholder="Descreva o fato com data, hora e local — objetivo, sem adjetivos." className={`${inp} mt-0.5`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acréscimos opcionais */}
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-200"><input type="checkbox" checked={assinaturas} onChange={e => setAssinaturas(e.target.checked)} /> Escrever os nomes nas assinaturas</label>
            <label className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-200"><input type="checkbox" checked={testemunhas} onChange={e => setTestemunhas(e.target.checked)} /> Bloco de testemunhas (recusa de assinatura)</label>
          </div>

          {faltando && (
            <div className={`text-[12px] rounded-lg px-3 py-2 ${faltando.length ? "text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20" : "text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/20"}`}>
              {faltando.length ? <span className="inline-flex items-center gap-1"><CheckSquare size={13} className="shrink-0" /> Documento gerado{onGerado ? "" : " e baixado"}. Campos em branco pra preencher à mão: <b>{faltando.join(", ")}</b>.</span> : <span className="inline-flex items-center gap-1"><CheckSquare size={13} className="shrink-0" /> Documento gerado{onGerado ? "" : " e baixado"} — nada ficou em branco.</span>}
            </div>
          )}
          {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}

          {/* Preview do documento preenchido (renderizado no navegador) */}
          <div className={previewAberto ? "block" : "hidden"}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide inline-flex items-center gap-1.5"><FileText size={12} /> Pré-visualização</div>
              <button type="button" onClick={() => setPreviewAberto(false)} className="text-[11px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"><X size={12} /> fechar preview</button>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/40 p-3 max-h-[55vh] overflow-auto">
              <div ref={previewRef} className="docxpv-host bg-white mx-auto shadow-sm" />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {faltamMarcacoes && <span className="text-[11px] text-amber-600">Escolha as opções do documento</span>}
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button variant="secondary" onClick={preview} disabled={previewLoading || gerando || faltamMarcacoes}>{previewLoading ? "Gerando preview…" : <span className="inline-flex items-center gap-1.5"><FileText size={14} /> Pré-visualizar</span>}</Button>
            <Button onClick={gerar} disabled={gerando || faltamMarcacoes}>{gerando ? "Gerando…" : <span className="inline-flex items-center gap-1.5"><FileText size={14} /> {onGerado ? "Gerar e salvar" : "Baixar (DOCX)"}</span>}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Configurações do módulo (por empresa) ───────────────────────────────────
// Dados cadastrais da empresa + quais documentos ficam disponíveis pra ela.
// É o hub: outros módulos (ex.: Admissão) consomem estes documentos.
function ConfigView({ restaurants, empresas, empresaRid, pessoaId, pessoaNome, onVoltar }: {
  restaurants: { id: string; nome: string; razaoSocial?: string; cnpj?: string; endereco?: string }[];
  empresas: Record<string, EmpresaCfg>; empresaRid: string;
  pessoaId: string; pessoaNome: string; onVoltar: () => void;
}) {
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [habil, setHabil] = useState<Set<string>>(new Set());
  const [termoMap, setTermoMap] = useState<Record<string, string>>({});
  const termos = getTermosAssinaturaDefault();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const inp = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100";

  // Carrega os dados da empresa selecionada (pré-preenche cadastrais do restaurante).
  useEffect(() => {
    const cfg = empresas[empresaRid];
    const rest = restaurants.find(r => r.id === empresaRid);
    setCampos({
      RAZAO_SOCIAL: cfg?.campos.RAZAO_SOCIAL || rest?.razaoSocial || "",
      CNPJ_EMPRESA: cfg?.campos.CNPJ_EMPRESA || rest?.cnpj || "",
      ENDERECO_EMPRESA: cfg?.campos.ENDERECO_EMPRESA || rest?.endereco || "",
      ...(cfg?.campos || {}),
    });
    setHabil(new Set(cfg?.habilitados ?? DOCS.map(d => d.id)));
    setTermoMap(cfg?.termoMap || {});
    setErro(""); setOkMsg("");
  }, [empresaRid, empresas, restaurants]);

  const toggle = (id: string) => setHabil(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const porCat = new Map<string, DocModelo[]>();
  for (const d of DOCS) { const a = porCat.get(d.categoria) || []; a.push(d); porCat.set(d.categoria, a); }
  const setCat = (lista: DocModelo[], on: boolean) => setHabil(s => { const n = new Set(s); lista.forEach(d => on ? n.add(d.id) : n.delete(d.id)); return n; });

  async function salvar() {
    setSalvando(true); setErro(""); setOkMsg("");
    try {
      await setDoc(doc(db, "documentosEmpresas", empresaRid), sanitizeForFirestore({
        rid: empresaRid, campos, habilitados: [...habil], termoMap,
        atualizadoEm: new Date().toISOString(), atualizadoPor: pessoaId, atualizadoPorNome: pessoaNome,
      }), { merge: true });
      setOkMsg("Configuração salva.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setSalvando(false); }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <header className="mb-4 flex items-center gap-2">
        <button type="button" onClick={onVoltar} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-sm">← Voltar</button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Settings size={20} className="text-gray-500 dark:text-gray-400" /> Configurações — Documentos</h1>
      </header>

      {/* Auditoria — dados cadastrais por empresa (todas de uma vez) */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-4">
        <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1 inline-flex items-center gap-1.5"><Building2 size={16} /> Auditoria — dados por empresa</h2>
        <p className="text-xs text-gray-500 mb-3">Confira num lugar só se cada empresa tem os dados que entram nos documentos. Clique numa linha pra editar.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200 dark:border-gray-800">
                <th className="text-left font-semibold py-1.5 pr-2">Empresa</th>
                <th className="text-center font-semibold py-1.5 px-2">Razão social</th>
                <th className="text-center font-semibold py-1.5 px-2">CNPJ</th>
                <th className="text-center font-semibold py-1.5 px-2">Endereço</th>
                <th className="text-right font-semibold py-1.5 pl-2">Documentos</th>
              </tr>
            </thead>
            <tbody>
              {restaurants.map(r => {
                const cfg = empresas[r.id];
                const val = (t: string, fb?: string) => (cfg?.campos?.[t] || fb || "").trim();
                const razao = val("RAZAO_SOCIAL", r.razaoSocial);
                const cnpj = val("CNPJ_EMPRESA", r.cnpj);
                const end = val("ENDERECO_EMPRESA", r.endereco);
                const nHab = cfg?.habilitados == null ? DOCS.length : cfg.habilitados.length;
                const Cel = ({ ok }: { ok: boolean }) => (
                  <td className="text-center px-2 py-1.5">
                    {ok ? <Check size={15} className="inline text-emerald-600 dark:text-emerald-400" /> : <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400 text-[11px] font-semibold"><TriangleAlert size={13} /> falta</span>}
                  </td>
                );
                const faltaAlgo = !razao || !cnpj || !end;
                return (
                  <tr key={r.id}
                    className={`border-b border-gray-100 dark:border-gray-800 ${empresaRid === r.id ? "bg-indigo-50/50 dark:bg-indigo-900/10" : ""}`}>
                    <td className="py-1.5 pr-2 font-medium text-gray-900 dark:text-gray-100">{r.nome} {empresaRid === r.id && <span className="ml-1 text-[10px] font-semibold text-indigo-500">· editando</span>} {faltaAlgo && <span className="ml-1 text-[10px] text-rose-500">●</span>}</td>
                    <Cel ok={!!razao} />
                    <Cel ok={!!cnpj} />
                    <Cel ok={!!end} />
                    <td className="text-right pl-2 py-1.5 tabular-nums text-gray-600 dark:text-gray-300">{nHab}<span className="text-gray-400">/{DOCS.length}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Documentos = quantos estão habilitados pra aparecer na lista de geração dessa empresa. Para configurar outra empresa, troque no seletor do topo.</p>
      </section>

      {/* Dados cadastrais */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-4">
        <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1 inline-flex items-center gap-1.5"><Building2 size={16} /> Dados cadastrais — {restaurants.find(r => r.id === empresaRid)?.nome || "empresa"}</h2>
        <p className="text-xs text-gray-500 mb-3">Usados no preenchimento dos documentos. Empresa definida pelo seletor do topo.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EMPRESA_ESSENCIAIS.map(({ token, rotulo }) => (
            <div key={token} className={token === "RAZAO_SOCIAL" || token === "ENDERECO_EMPRESA" ? "sm:col-span-2" : ""}>
              <label className="text-[11px] text-gray-500">{rotulo}</label>
              <input value={campos[token] || ""} onChange={e => setCampos(s => ({ ...s, [token]: e.target.value }))} className={`${inp} mt-0.5`} />
            </div>
          ))}
        </div>
        <details className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 mt-2">
          <summary className="text-xs font-medium text-gray-600 dark:text-gray-300 cursor-pointer">Campos opcionais — usados só em documentos específicos</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {EMPRESA_ESPECIFICOS.map(({ token, rotulo, nota }) => (
              <div key={token}>
                <label className="text-[11px] text-gray-500">{rotulo}{nota ? <span className="text-gray-400"> — {nota}</span> : null}</label>
                <input value={campos[token] || ""} onChange={e => setCampos(s => ({ ...s, [token]: e.target.value }))} className={`${inp} mt-0.5`} />
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* Documentos disponíveis */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><FileText size={16} /> Documentos disponíveis nesta empresa</h2>
          <div className="text-xs flex gap-2 shrink-0">
            <button type="button" onClick={() => setHabil(new Set(DOCS.map(d => d.id)))} className="text-indigo-600 dark:text-indigo-400 hover:underline">todos</button>
            <button type="button" onClick={() => setHabil(new Set())} className="text-gray-500 hover:underline">nenhum</button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">{habil.size} de {DOCS.length} habilitados. Só os marcados aparecem na lista pra gerar.</p>
        <div className="space-y-3">
          {[...porCat.entries()].map(([cat, lista]) => {
            const todosCat = lista.every(d => habil.has(d.id));
            return (
              <div key={cat}>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{cat}</div>
                  <button type="button" onClick={() => setCat(lista, !todosCat)} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">{todosCat ? "desmarcar" : "marcar"} categoria</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1">
                  {lista.map(d => (
                    <label key={d.id} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer py-0.5">
                      <input type="checkbox" checked={habil.has(d.id)} onChange={() => toggle(d.id)} />
                      <span className="truncate">{d.titulo}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Mapa: termos da Admissão → modelo de documento */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-4">
        <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1 inline-flex items-center gap-1.5"><UserRoundPlus size={16} /> Termos da Admissão → modelo</h2>
        <p className="text-xs text-gray-500 mb-3">Qual documento cada termo do "kit de assinatura" da Admissão usa. Assim a Admissão gera o termo já preenchido por este módulo.</p>
        <div className="space-y-2">
          {termos.map(t => (
            <div key={t.id} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
              <div className="text-sm text-gray-700 dark:text-gray-200">{t.nome}{t.obrigatorio ? " *" : ""}</div>
              <select value={termoMap[t.id] || ""} onChange={e => setTermoMap(s => ({ ...s, [t.id]: e.target.value }))} className={inp}>
                <option value="">— nenhum (segue manual) —</option>
                {[...porCat.entries()].map(([cat, lista]) => (
                  <optgroup key={cat} label={cat}>
                    {lista.map(d => <option key={d.id} value={d.id}>{d.titulo}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-gradient-to-t from-white dark:from-gray-950 to-transparent py-3">
        {okMsg && <span className="text-sm text-emerald-600">{okMsg}</span>}
        {erro && <span className="text-sm text-rose-600">{erro}</span>}
        <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar configuração"}</Button>
      </div>
    </div>
  );
}
