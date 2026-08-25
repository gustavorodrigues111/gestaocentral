// Documentos — fábrica de documentos trabalhistas do escritório.
// Escolhe o modelo (50 do acervo), puxa EMPRESA (dados trabalhistas por restaurante)
// e EMPREGADO (Pessoas), a DATA é de hoje, os campos específicos/textos livres são
// preenchidos, e o backend (/api/documento-preencher, python-docx) devolve o DOCX
// preenchido pra assinatura. PDF exato sai pela skill/LibreOffice (fase seguinte).

import { useEffect, useMemo, useState } from "react";
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
import CATALOGO from "./catalogo.json";
import MARCACOES_JSON from "./marcacoes.json";
import QUADROS_JSON from "./quadros.json";

type Campo = { token: string; rotulo: string; tipo: string; obrigatorio: boolean; origem: string; ajuda: string };
type TextoLivre = { campo: string; rotulo: string; apos: string };
type DocModelo = { id: string; titulo: string; categoria: string; quando_usar: string; observacoes: string; campos: Campo[]; texto_livre: TextoLivre[] };
type MarcOpcao = { valor: string; label: string; ancora: string };
type Marcacao = { campo: string; rotulo: string; opcoes: MarcOpcao[] };
type Quadro = { titulo: string; tabela: number; linha_inicial: number; col_inicial: number; max_linhas: number; podeAdicionar: boolean; colunas: string[] };
const DOCS = CATALOGO as DocModelo[];
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

const ORIGEM_LABEL: Record<string, string> = { empresa: "🏢 Empresa", data: "📅 Data (hoje)", empregado: "🧑 Empregado", especifico: "✏️ Específicos do documento" };
const ORIGEM_ORDEM = ["empregado", "especifico", "data", "empresa"];

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
  const [empresas, setEmpresas] = useState<Record<string, Record<string, string>>>({});
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<DocModelo | null>(null);
  const [configEmpresa, setConfigEmpresa] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const up = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)));
    const ue = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      snap => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado)));
    const uc = onSnapshot(collection(db, "documentosEmpresas"), snap => {
      const m: Record<string, Record<string, string>> = {};
      snap.docs.forEach(d => { m[d.id] = (d.data() as { campos?: Record<string, string> })?.campos || {}; });
      setEmpresas(m);
    });
    return () => { up(); ue(); uc(); };
  }, [rid]);

  if (!pessoa) return null;
  if (loading) return <div className="max-w-5xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;
  if (!podeGerar && !podeConfig) return <div className="max-w-5xl mx-auto p-8 text-center text-gray-500">Você não tem permissão para acessar Documentos.</div>;

  const q = busca.trim().toLowerCase();
  const filtrados = DOCS.filter(d => !q || `${d.titulo} ${d.categoria} ${d.quando_usar}`.toLowerCase().includes(q));
  const porCategoria = new Map<string, DocModelo[]>();
  for (const d of filtrados) { const arr = porCategoria.get(d.categoria) || []; arr.push(d); porCategoria.set(d.categoria, arr); }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📄 Documentos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Modelos trabalhistas do escritório, preenchidos com os dados da empresa e do empregado. Saída em DOCX pra assinatura.</p>
        </div>
        {podeConfig && <Button variant="secondary" onClick={() => setConfigEmpresa(rid || restaurants[0]?.id || "")}>🏢 Dados das empresas</Button>}
      </header>

      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar documento…"
        className="w-full mb-4 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />

      {podeGerar ? (
        [...porCategoria.entries()].map(([cat, lista]) => (
          <div key={cat} className="mb-5">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{cat}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {lista.map(d => (
                <button key={d.id} type="button" onClick={() => setSel(d)}
                  className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{d.titulo}</div>
                  <div className="text-[11px] text-gray-400 line-clamp-2 mt-0.5">{d.quando_usar}</div>
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Você pode editar os dados das empresas, mas não tem permissão para gerar documentos.</div>
      )}

      {sel && podeGerar && (
        <GeradorModal key={sel.id} doc={sel} rid={rid || ""} restaurants={restaurants} pessoas={pessoas} empregados={empregados}
          empresas={empresas} onClose={() => setSel(null)} />
      )}
      {configEmpresa && podeConfig && (
        <EmpresaConfigModal rid={configEmpresa} restaurants={restaurants} atual={empresas[configEmpresa] || {}}
          pessoaId={pessoa.id} pessoaNome={pessoa.nome} onTrocar={setConfigEmpresa} onClose={() => setConfigEmpresa(null)} />
      )}
    </div>
  );
}

// ─── Gerador de um documento ─────────────────────────────────────────────────
function GeradorModal({ doc: modelo, rid, restaurants, pessoas, empregados, empresas, onClose }: {
  doc: DocModelo; rid: string; restaurants: { id: string; nome: string }[]; pessoas: Pessoa[]; empregados: Empregado[];
  empresas: Record<string, Record<string, string>>; onClose: () => void;
}) {
  const [empresaRid, setEmpresaRid] = useState(rid || restaurants[0]?.id || "");
  const [empId, setEmpId] = useState<string>("");
  const [buscaEmp, setBuscaEmp] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [livres, setLivres] = useState<Record<string, string>>({});
  const [marcado, setMarcado] = useState<Record<string, string>>({});
  const [linhasQ, setLinhasQ] = useState<Record<number, string[][]>>({});
  const [assinaturas, setAssinaturas] = useState(false);
  const [testemunhas, setTestemunhas] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");
  const [faltando, setFaltando] = useState<string[] | null>(null);

  const empsAtivos = useMemo(() => empregados.filter(e => e.restaurantId === empresaRid && e.estaAtivo !== false), [empregados, empresaRid]);
  const emp = empsAtivos.find(e => e.id === empId) || null;
  const pes = emp?.pessoaId ? pessoas.find(p => p.id === emp.pessoaId) : null;
  const empresaData = empresas[empresaRid] || {};
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
    };
    return d;
  }, [empresaData, emp, pes]);

  useEffect(() => { setValues({}); setLivres({}); setFaltando(null); }, [empresaRid, empId]);

  const valDe = (token: string) => (values[token] ?? defaults[token] ?? "");
  const setVal = (token: string, v: string) => setValues(s => ({ ...s, [token]: v }));

  // Agrupa os campos por origem, na ordem definida.
  const grupos = useMemo(() => {
    const g: Record<string, Campo[]> = {};
    for (const c of modelo.campos) { (g[c.origem] = g[c.origem] || []).push(c); }
    return ORIGEM_ORDEM.filter(o => g[o]?.length).map(o => [o, g[o]] as [string, Campo[]]);
  }, [modelo]);

  async function gerar() {
    setErro(""); setGerando(true); setFaltando(null);
    try {
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
      // Download do DOCX.
      const bin = atob(String(data.docxBase64 || ""));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const hoje = new Date();
      const stamp = `${hoje.getFullYear()}.${String(hoje.getMonth() + 1).padStart(2, "0")}.${String(hoje.getDate()).padStart(2, "0")}`;
      const nomeArq = `${stamp} ${modelo.titulo}${valDe("NOME_EMPREGADO") ? " - " + valDe("NOME_EMPREGADO") : ""}.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = nomeArq; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setFaltando(Array.isArray(data.faltando) ? data.faltando : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o documento.");
    } finally { setGerando(false); }
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
            <div className="text-xs text-gray-500">{modelo.categoria}</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {modelo.observacoes && (
            <div className="text-[12px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2 leading-snug">⚠️ {modelo.observacoes}</div>
          )}

          {/* Empresa + empregado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Empresa</label>
              <select value={empresaRid} onChange={e => setEmpresaRid(e.target.value)} className={`${inp} mt-1`}>
                {restaurants.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
              {empresaIncompleta && <div className="text-[11px] text-rose-600 mt-1">Sem dados trabalhistas — preencha em "🏢 Dados das empresas".</div>}
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
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{ORIGEM_LABEL[origem] || origem}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {campos.map(c => (
                  <div key={c.token}>
                    <label className="text-[11px] text-gray-500">{c.rotulo}{c.obrigatorio ? " *" : ""}</label>
                    <input value={valDe(c.token)} onChange={e => setVal(c.token, e.target.value)} placeholder={c.ajuda || ""} className={`${inp} mt-0.5`} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Opções (marcações do documento) */}
          {marcs.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">☑️ Opções do documento</div>
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
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">🧾 {qd.titulo}</div>
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
                  <button type="button" onClick={() => addLinha(qi, cols)} className="mt-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">➕ adicionar linha</button>
                )}
              </div>
            );
          })}

          {/* Textos livres */}
          {modelo.texto_livre.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">📝 Textos redigidos</div>
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
              {faltando.length ? <>✅ DOCX gerado. Campos deixados em branco pra preencher à mão: <b>{faltando.join(", ")}</b>.</> : "✅ DOCX gerado e baixado — nada ficou em branco."}
            </div>
          )}
          {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          <div className="flex items-center gap-2">
            {faltamMarcacoes && <span className="text-[11px] text-amber-600">Escolha as opções do documento</span>}
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button onClick={gerar} disabled={gerando || faltamMarcacoes}>{gerando ? "Gerando…" : "📄 Gerar documento (DOCX)"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Editor dos dados trabalhistas das empresas ──────────────────────────────
function EmpresaConfigModal({ rid, restaurants, atual, pessoaId, pessoaNome, onTrocar, onClose }: {
  rid: string; restaurants: { id: string; nome: string; razaoSocial?: string; cnpj?: string; endereco?: string }[];
  atual: Record<string, string>; pessoaId: string; pessoaNome: string; onTrocar: (rid: string) => void; onClose: () => void;
}) {
  const rest = restaurants.find(r => r.id === rid);
  // Pré-preenche do cadastro do restaurante o que der (razão, CNPJ, endereço).
  const seed: Record<string, string> = {
    RAZAO_SOCIAL: atual.RAZAO_SOCIAL || rest?.razaoSocial || "",
    CNPJ_EMPRESA: atual.CNPJ_EMPRESA || rest?.cnpj || "",
    ENDERECO_EMPRESA: atual.ENDERECO_EMPRESA || rest?.endereco || "",
    ...atual,
  };
  const [campos, setCampos] = useState<Record<string, string>>(seed);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const inp = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100";

  // Ao trocar de empresa, o componente é remontado (key=rid no pai) — mas garantimos.
  useEffect(() => { setCampos(seed); /* eslint-disable-next-line */ }, [rid]);

  async function salvar() {
    setSalvando(true); setErro("");
    try {
      await setDoc(doc(db, "documentosEmpresas", rid), sanitizeForFirestore({
        rid, campos, atualizadoEm: new Date().toISOString(), atualizadoPor: pessoaId, atualizadoPorNome: pessoaNome,
      }), { merge: true });
      onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">🏢 Dados trabalhistas da empresa</h2>
            <div className="text-xs text-gray-500">Usados no preenchimento dos documentos. Uma vez por empresa.</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <select value={rid} onChange={e => onTrocar(e.target.value)} className={inp}>
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EMPRESA_ESSENCIAIS.map(({ token, rotulo }) => (
              <div key={token} className={token === "RAZAO_SOCIAL" || token === "ENDERECO_EMPRESA" ? "sm:col-span-2" : ""}>
                <label className="text-[11px] text-gray-500">{rotulo}</label>
                <input value={campos[token] || ""} onChange={e => setCampos(s => ({ ...s, [token]: e.target.value }))} className={`${inp} mt-0.5`} />
              </div>
            ))}
          </div>

          <details className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
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
          {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        </div>
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>
    </div>
  );
}
