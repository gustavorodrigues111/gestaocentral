// ════════════════════════════════════════════════════════════════════════════
//  Novos contratos de trabalho — TRIAGEM (qual modelo) → DADOS → GERAR (DOCX via
//  /api/contrato-preencher, que roda a skill contratos-trabalho). PDF fica pra depois.
//
//  Escopo: SEMPRE a empresa atual selecionada no sistema (como os outros módulos).
//  Dados do empregado: puxados de um CANDIDATO da Admissão (dadosPreenchidos).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Admissao, Cargo } from "../../core/types";
import { authHeader } from "../../core/firebase/idToken";
import { gerarContratoDocx, baixarDocxBase64 } from "./contratoApi";
import type { DocCargo } from "./ConfigCargos";

type EmpresaCat = Record<string, { nome?: string; cnpj?: string; endereco?: string; cidade?: string; cct?: string }>;
type CargoCat = Record<string, { funcao?: string; cbo?: string; salario?: number; regime?: string; horario?: string; descricao?: string; gorjeta_texto?: string }>;
type Modelo = { id: string; descricao: string };

const norm = (s?: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function decidirModelo(t: { casa: string; ponto: string; vinculo: string }): { modelo: string; motivo: string } {
  if (t.vinculo === "autonomo") return { modelo: "contrato-autonomo", motivo: "Prestador sem subordinação (RPA)." };
  if (t.vinculo === "transitorio") return { modelo: "contrato-prazo-determinado", motivo: "Necessidade transitória (art. 443 §2º 'a')." };
  if (t.casa === "totalmente" && t.ponto === "nao") return { modelo: "contrato-atividade-externa", motivo: "Trabalho externo sem controle de jornada (art. 62, I)." };
  if (t.casa === "alguns" || t.casa === "totalmente") return { modelo: "contrato-hibrido", motivo: "Trabalha de casa em algum dia → híbrido (arts. 75-A a 75-F)." };
  return { modelo: "contrato-padrao", motivo: "CLT presencial com jornada/escala." };
}

const TRAP: Record<string, string> = {
  "contrato-autonomo": "Autônomo para garçom, cozinheiro ou função de escala é fraude de vínculo. Só use para quem não tem horário, uniforme e chefe.",
  "contrato-atividade-externa": "Art. 62 só vale para quem realmente não tem como controlar o horário. Quem bate ponto é teletrabalho por jornada, não art. 62.",
  "contrato-hibrido": "Híbrido tem que estar escrito, com ajuda de custo/equipamento previstos. Registrar como presencial e deixar em casa gera passivo.",
};

function Bloco({ icon, titulo, tag, tagCor, children }: { icon: string; titulo: string; tag?: string; tagCor?: "ok" | "ask"; children: React.ReactNode }) {
  const cor = tagCor === "ask"
    ? "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300"
    : "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300";
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{icon} {titulo}</span>
        {tag && <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${cor}`}>{tag}</span>}
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

// Monta RG e endereço a partir do dadosPreenchidos do candidato.
function dadosDoCandidato(a: Admissao) {
  const dp = (a.dadosPreenchidos || {}) as Record<string, string>;
  const g = (k: string) => (dp[k] || "").toString().trim();
  const rg = g("rg") ? `${g("rg")}${g("rg_orgao") ? " " + g("rg_orgao") : ""}${g("rg_uf") ? "/" + g("rg_uf") : ""}` : "";
  const end = [
    g("endereco_logradouro") ? `${g("endereco_logradouro")}${g("endereco_numero") ? ", nº " + g("endereco_numero") : ""}` : "",
    g("endereco_complemento"),
    g("endereco_bairro"),
    g("endereco_cidade") && g("endereco_estado") ? `${g("endereco_cidade")}/${g("endereco_estado")}` : g("endereco_cidade"),
    g("endereco_cep") ? `CEP ${g("endereco_cep")}` : "",
  ].filter(Boolean).join(", ");
  const cpf = (a.candidato?.cpf || "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return { nome: a.candidato?.nome || "", cpf, rg, endereco: end, email: a.candidato?.email || "", whatsapp: a.candidato?.whatsapp || "" };
}

// Monta o texto da JORNADA a partir do horário cadastrado na admissão
// (Record<dia 0..6, {active,in,out,break}>). Agrupa dias consecutivos iguais e
// calcula as horas semanais. É o que vai no contrato como "horário de trabalho".
const DIAS_NOME = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
function jornadaTexto(hc?: Record<string, { active?: boolean; in?: string; out?: string; break?: number }> | null): string {
  if (!hc) return "";
  type D = { d: number; in: string; out: string; brk: number };
  const dias: D[] = [];
  let horas = 0;
  for (let d = 0; d <= 6; d++) {
    const h = hc[String(d)] || hc[d as unknown as string];
    if (!h || !h.active || !h.in || !h.out) continue;
    const brk = Number(h.break) || 0;
    dias.push({ d, in: h.in, out: h.out, brk });
    const [ih, im] = h.in.split(":").map(Number);
    const [oh, om] = h.out.split(":").map(Number);
    let min = (oh * 60 + om) - (ih * 60 + im); if (min < 0) min += 24 * 60; min -= brk;
    horas += Math.max(0, min) / 60;
  }
  if (dias.length === 0) return "";
  const grupos: { di: number; df: number; in: string; out: string; brk: number }[] = [];
  for (const dd of dias) {
    const g = grupos[grupos.length - 1];
    if (g && dd.d === g.df + 1 && dd.in === g.in && dd.out === g.out && dd.brk === g.brk) g.df = dd.d;
    else grupos.push({ di: dd.d, df: dd.d, in: dd.in, out: dd.out, brk: dd.brk });
  }
  const intervTxt = (m: number) => m <= 0 ? "" : (m % 60 === 0 ? `${m / 60} hora${m / 60 > 1 ? "s" : ""}` : `${m} minutos`);
  const partes = grupos.map(g => {
    const faixa = g.di === g.df ? DIAS_NOME[g.di] : `de ${DIAS_NOME[g.di]} a ${DIAS_NOME[g.df]}`;
    const it = intervTxt(g.brk);
    return `${faixa}, das ${g.in} às ${g.out}${it ? `, com ${it} de intervalo para refeição e descanso` : ""}`;
  });
  const ativos = new Set(dias.map(d => d.d));
  const folgas = [0, 1, 2, 3, 4, 5, 6].filter(d => !ativos.has(d));
  const folgaTxt = folgas.length ? `, com descanso semanal remunerado ${folgas.length === 1 ? `no ${DIAS_NOME[folgas[0]]}` : `nos dias de ${folgas.map(f => DIAS_NOME[f]).join(", ")}`}` : "";
  const horasStr = Number.isInteger(horas) ? String(horas) : horas.toFixed(1).replace(".", ",");
  const t = `${partes.join("; ")}, perfazendo ${horasStr} horas semanais${folgaTxt}.`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function ContratosTrabalho({ rid, restaurants }: { rid: string; restaurants: { id: string; nome?: string }[] }) {
  const { pessoa: me } = useAuth();
  const [cat, setCat] = useState<{ modelos: Modelo[]; empresas: EmpresaCat; cargos: CargoCat } | null>(null);
  const [erroCat, setErroCat] = useState("");
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [cargosApp, setCargosApp] = useState<Cargo[]>([]);
  const [docCargos, setDocCargos] = useState<DocCargo[]>([]);
  const [cargoAdmId, setCargoAdmId] = useState("");   // cargoId vindo da admissão
  const [passo, setPasso] = useState<"triagem" | "dados">("triagem");

  const [tr, setTr] = useState({ casa: "", ponto: "", vinculo: "" });
  const decisao = tr.casa && tr.vinculo ? decidirModelo(tr) : null;
  const [modelo, setModelo] = useState("");

  const [cargoKey, setCargoKey] = useState("");
  const [salario, setSalario] = useState("");
  const [emp, setEmp] = useState({ nome: "", cpf: "", rg: "", endereco: "", email: "", whatsapp: "" });
  const [buscaAdm, setBuscaAdm] = useState("");
  const [admSelNome, setAdmSelNome] = useState("");
  const [horarioAdm, setHorarioAdm] = useState("");   // jornada montada da admissão
  const [dataInicio, setDataInicio] = useState("");
  const [cidade, setCidade] = useState("São Paulo");
  const [dataAssin, setDataAssin] = useState("");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/contrato-preencher", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ action: "listar" }) });
        const j = await r.json();
        if (!r.ok) { setErroCat(j.error || "Falha ao carregar catálogos."); return; }
        setCat({ modelos: j.modelos || [], empresas: j.empresas || {}, cargos: j.cargos || {} });
      } catch (e) { setErroCat(e instanceof Error ? e.message : "Erro de rede."); }
    })();
  }, []);

  // Admissões da EMPRESA ATUAL só.
  useEffect(() => {
    if (!rid) { setAdmissoes([]); return; }
    return onSnapshot(query(collection(db, "admissoes"), where("restaurantId", "==", rid)),
      s => setAdmissoes(s.docs.map(d => ({ id: d.id, ...d.data() }) as Admissao)), () => setAdmissoes([]));
  }, [rid]);

  // Cargos do app + configuração de contrato (documentosCargos) da empresa atual.
  useEffect(() => {
    if (!rid) { setCargosApp([]); return; }
    return onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      s => setCargosApp(s.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo)), () => setCargosApp([]));
  }, [rid]);
  useEffect(() => {
    if (!rid) { setDocCargos([]); return; }
    return onSnapshot(query(collection(db, "documentosCargos"), where("restaurantId", "==", rid)),
      s => setDocCargos(s.docs.map(d => ({ id: d.id, ...d.data() }) as DocCargo)), () => setDocCargos([]));
  }, [rid]);

  const cargosList = useMemo(() => Object.entries(cat?.cargos || {}).filter(([k]) => !k.startsWith("_")), [cat]);
  const cargoSel = cargoKey ? cat?.cargos?.[cargoKey] : null;

  // Cargo puxado da admissão + sua configuração de contrato.
  const cargoApp = useMemo(() => cargosApp.find(c => c.id === cargoAdmId) || null, [cargosApp, cargoAdmId]);
  const docCargo = useMemo(() => docCargos.find(d => d.cargoId === cargoAdmId) || null, [docCargos, cargoAdmId]);
  const docCargoOk = !!docCargo && !!(docCargo.cbo || (docCargo.descricao && docCargo.descricao.length));
  // Campos do cargo que, faltando, saem EM BRANCO no contrato (só atribuições —
  // o horário vem da admissão, não daqui).
  const docCargoFaltas = useMemo(() => {
    if (!docCargo) return [] as string[];
    const f: string[] = [];
    if (!(docCargo.descricao && docCargo.descricao.length)) f.push("atribuições");
    return f;
  }, [docCargo]);
  // Horário: vem da admissão. Só alerta se nem a admissão nem o cargo têm.
  const horarioFalta = !horarioAdm && !(docCargo?.horario && docCargo.horario.trim());
  const modeloDesc = (id: string) => cat?.modelos.find(m => m.id === id)?.descricao || id;
  const restNome = restaurants.find(r => r.id === rid)?.nome || "";

  // Empresa = a atual do sistema. Casa o restaurante com a chave do catálogo por nome.
  const empresaKey = useMemo(() => {
    if (!cat) return "";
    const rn = norm(restNome);
    if (!rn) return "";
    for (const [k, v] of Object.entries(cat.empresas)) {
      if (k.startsWith("_")) continue;
      const en = norm(v.nome);
      if (en && (en.includes(rn) || rn.includes(en))) return k;
      if (norm(k).replace(/ /g, "") === rn.replace(/ /g, "")) return k;
    }
    return "";
  }, [cat, restNome]);
  const empresaSel = empresaKey ? cat?.empresas?.[empresaKey] : null;

  const admSug = useMemo(() => {
    const s = buscaAdm.trim().toLowerCase();
    const base = [...admissoes].sort((a, b) => (b.iniciadoEm || "").localeCompare(a.iniciadoEm || ""));
    if (!s) return base.slice(0, 8);
    return base.filter(a => (a.candidato?.nome || "").toLowerCase().includes(s) || (a.candidato?.cpf || "").includes(s.replace(/\D/g, ""))).slice(0, 8);
  }, [buscaAdm, admissoes]);

  function puxarAdmissao(a: Admissao) {
    setEmp(dadosDoCandidato(a));
    setAdmSelNome(a.candidato?.nome || "");
    setCargoAdmId(a.cargoId || "");
    // Horário/jornada vem da ADMISSÃO (é onde a pessoa tem carga/horário reais).
    setHorarioAdm(jornadaTexto(a.horariosCadastrados as Record<string, { active?: boolean; in?: string; out?: string; break?: number }> | undefined));
    if (a.dataAdmissao) setDataInicio(a.dataAdmissao);
    // Salário: admissão > config do cargo.
    const dc = docCargos.find(d => d.cargoId === a.cargoId);
    if (a.salario) setSalario(String(a.salario));
    else if (dc?.salario) setSalario(String(dc.salario));
    setBuscaAdm("");
  }

  function irParaDados() { if (!decisao) return; setModelo(modelo || decisao.modelo); setPasso("dados"); }

  async function gerar() {
    setErro("");
    if (!modelo) { setErro("Escolha o modelo (triagem)."); return; }
    const ehAutonomo = modelo === "contrato-autonomo";
    if (!emp.nome.trim() || !emp.cpf.trim()) { setErro("Nome e CPF são obrigatórios."); return; }
    if (!empresaKey && !ehAutonomo) { setErro(`A empresa "${restNome}" não está no catálogo de contratos. Cadastre-a na skill antes de gerar.`); return; }
    setGerando(true);
    try {
      // Bloco cargo: config do app (documentosCargos) tem prioridade sobre o
      // catálogo bundled; o salário digitado sobrescreve tudo.
      const cargoBlock: Record<string, unknown> = docCargo ? {
        funcao: docCargo.funcao,
        ...(docCargo.cbo ? { cbo: docCargo.cbo } : {}),
        ...(docCargo.salario != null ? { salario: docCargo.salario } : {}),
        ...(docCargo.regime ? { regime: docCargo.regime } : {}),
        ...(docCargo.gorjeta_texto ? { gorjeta_texto: docCargo.gorjeta_texto } : {}),
        ...(docCargo.descricao?.length ? { descricao: docCargo.descricao } : {}),
        ...(docCargo.ajuda_custo_home_office != null ? { ajuda_custo_home_office: docCargo.ajuda_custo_home_office } : {}),
        ...(docCargo.presencial_dias_horarios ? { presencial_dias_horarios: docCargo.presencial_dias_horarios } : {}),
        ...(docCargo.home_office_dias_horarios ? { home_office_dias_horarios: docCargo.home_office_dias_horarios } : {}),
      } : {};
      // HORÁRIO: vem da ADMISSÃO (horariosCadastrados). O cargo só é fallback
      // se a admissão não tiver jornada preenchida.
      const horarioFinal = horarioAdm || docCargo?.horario;
      if (horarioFinal) cargoBlock.horario = horarioFinal;
      // Se não veio da config de cargo, ainda precisamos da função no bloco.
      if (!cargoBlock.funcao) { const fn = cargoApp?.nome; if (fn) cargoBlock.funcao = fn; }
      if (salario.trim()) cargoBlock.salario = Number(salario.replace(/[^\d]/g, ""));
      const dados: Record<string, unknown> = {
        empresaKey: empresaKey || undefined,
        cargoKey: cargoKey || undefined,
        empregado: { nome: emp.nome.trim(), cpf: emp.cpf.trim(), ...(emp.rg ? { rg: emp.rg.trim() } : {}), endereco: emp.endereco.trim(), ...(emp.email ? { email: emp.email.trim() } : {}), ...(emp.whatsapp ? { whatsapp: emp.whatsapp.trim() } : {}) },
        contrato: { ...(dataInicio ? { data_inicio: dataInicio } : {}), cidade: cidade.trim(), ...(dataAssin ? { data_assinatura: dataAssin } : {}) },
        ...(Object.keys(cargoBlock).length ? { cargo: cargoBlock } : {}),
      };
      const j = await gerarContratoDocx(modelo, dados);
      baixarDocxBase64(j.docxBase64, j.filename);
      // Histórico: salva o INPUT (regenera no re-download — não guarda arquivo).
      await addDoc(collection(db, "documentosGerados"), sanitizeForFirestore({
        restaurantId: rid, tipo: "contrato", modelo, modeloDesc: modeloDesc(modelo),
        empregadoNome: emp.nome.trim(), empregadoCpf: emp.cpf.trim(),
        empresaNome: empresaSel?.nome || restNome, filename: j.filename,
        dados, criadoEm: new Date().toISOString(),
        criadoPor: { id: me?.id || "", nome: me?.nome || "" },
      })).catch(() => {});
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro de rede."); }
    finally { setGerando(false); }
  }

  if (erroCat) return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{erroCat}</div>;
  if (!cat) return <div className="text-sm text-gray-400 py-10 text-center">Carregando modelos…</div>;

  const numContratos = cat.modelos.filter(m => m.id.startsWith("contrato")).length;

  const Pergunta = ({ n, label, val, set, opts }: { n: number; label: string; val: string; set: (v: string) => void; opts: [string, string][] }) => (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center gap-2.5">
        <span className="w-5 h-5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[11px] font-bold grid place-items-center flex-none">{n}</span>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3 pl-7">
        {opts.map(([v, lb]) => (
          <button key={v} type="button" onClick={() => set(v)}
            className={`text-[13px] px-3.5 py-1.5 rounded-lg border transition-colors ${val === v ? "border-indigo-500 bg-indigo-600 text-white font-medium" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-700"}`}>
            {lb}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl">
      <div className="flex items-stretch border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden mb-6 bg-white dark:bg-gray-900">
        {([["triagem", "1", "Triagem", "qual modelo"], ["dados", "2", "Dados e geração", "puxa, completa e baixa"]] as const).map(([id, n, lb, sub], i) => {
          const ativo = passo === id;
          return (
            <div key={id} className={`flex-1 px-4 py-2.5 flex items-center gap-2.5 ${i === 0 ? "border-r border-gray-200 dark:border-gray-800" : ""} ${ativo ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}>
              <span className={`w-6 h-6 rounded-md text-[11px] font-bold grid place-items-center flex-none ${ativo ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-400"}`}>{n}</span>
              <div className="min-w-0">
                <div className={`text-[13px] font-semibold ${ativo ? "text-indigo-700 dark:text-indigo-300" : "text-gray-500"}`}>{lb}</div>
                <div className="text-[11px] text-gray-400 truncate">{sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {passo === "triagem" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">Poucas perguntas escolhem o modelo certo entre os {numContratos} de contrato — com os avisos de armadilha embutidos.</p>
          <Pergunta n={1} label="A pessoa vai trabalhar de casa em algum dia?" val={tr.casa} set={v => setTr(s => ({ ...s, casa: v }))} opts={[["nao", "Não, presencial"], ["alguns", "Sim, alguns dias"], ["totalmente", "Totalmente em casa/rua"]]} />
          <Pergunta n={2} label="Tem controle de jornada (bate ponto)?" val={tr.ponto} set={v => setTr(s => ({ ...s, ponto: v }))} opts={[["sim", "Sim"], ["nao", "Não — por produção"]]} />
          <Pergunta n={3} label="Que tipo de vínculo?" val={tr.vinculo} set={v => setTr(s => ({ ...s, vinculo: v }))} opts={[["clt", "CLT permanente"], ["transitorio", "Necessidade transitória"], ["autonomo", "Prestador (RPA)"]]} />

          {decisao && (
            <div className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-5 mt-2">
              <div className="text-[11px] uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300 font-semibold">Modelo recomendado</div>
              <div className="font-bold text-xl text-indigo-900 dark:text-indigo-100 mt-0.5 leading-tight">{modeloDesc(modelo || decisao.modelo)}</div>
              <div className="text-[12.5px] text-gray-600 dark:text-gray-300 mt-1.5">{decisao.motivo} <span className="font-mono text-gray-400">· {modelo || decisao.modelo}</span></div>
              {TRAP[modelo || decisao.modelo] && (
                <div className="flex gap-2 items-start text-[12.5px] text-amber-900 dark:text-amber-200 bg-amber-100/70 dark:bg-amber-900/25 border border-amber-300 dark:border-amber-900/50 rounded-lg px-3 py-2.5 mt-3">
                  <span>⚠️</span><span>{TRAP[modelo || decisao.modelo]}</span>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <label className="text-[12px] text-gray-500">Trocar modelo:</label>
                <select value={modelo || decisao.modelo} onChange={e => setModelo(e.target.value)} className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
                  {cat.modelos.map(m => <option key={m.id} value={m.id}>{m.descricao}</option>)}
                </select>
                <Button onClick={irParaDados} className="ml-auto">Continuar →</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {passo === "dados" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 px-3.5 py-2">
            <div className="text-sm text-gray-700 dark:text-gray-200"><span className="text-gray-400">Modelo:</span> <strong>{modeloDesc(modelo)}</strong> <span className="font-mono text-[11px] text-gray-400">· {modelo}</span></div>
            <button type="button" onClick={() => setPasso("triagem")} className="text-xs text-indigo-600 hover:underline">← Trocar</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Bloco icon="🏢" titulo="Empresa" tag={empresaSel ? "atual do sistema" : undefined} tagCor="ok">
              {empresaSel ? (
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{empresaSel.nome}</div>
                  <div className="mt-1 space-y-1 text-[12px]">
                    {empresaSel.cnpj && <div className="flex justify-between gap-3"><span className="text-gray-400 font-mono text-[11px]">cnpj</span><span className="text-gray-700 dark:text-gray-200">{empresaSel.cnpj}</span></div>}
                    {empresaSel.cct && <div className="flex justify-between gap-3"><span className="text-gray-400 font-mono text-[11px]">cct</span><span className="text-gray-700 dark:text-gray-200 text-right">{empresaSel.cct}</span></div>}
                  </div>
                </div>
              ) : (
                <div className="text-[12.5px] text-amber-700 dark:text-amber-300">A empresa atual <strong>{restNome || "—"}</strong> não está no catálogo de contratos. Cadastre-a na skill (empresas.json) pra gerar por aqui.</div>
              )}
            </Bloco>

            <Bloco icon="💼" titulo="Cargo" tag={cargoAdmId ? (docCargoOk ? "da admissão · configurado" : "da admissão") : "do catálogo"} tagCor={cargoAdmId && !docCargoOk ? "ask" : "ok"}>
              {cargoAdmId ? (
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{docCargo?.funcao || cargoApp?.nome || "Cargo da admissão"}</div>
                  {docCargoOk ? (
                    <div className="mt-1 text-[12px] text-gray-600 dark:text-gray-300">
                      {docCargo?.cbo ? `CBO ${docCargo.cbo}` : ""}{docCargo?.salario ? ` · R$ ${docCargo.salario.toLocaleString("pt-BR")}` : ""}{docCargo?.regime ? ` · ${docCargo.regime}` : ""}
                    </div>
                  ) : (
                    <div className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-300">
                      Esse cargo ainda não tem dados de contrato (CBO, gorjeta média, atribuições). Configure na aba <strong>⚙️ Cargos p/ contrato</strong> — o contrato sai sem esses campos até lá.
                    </div>
                  )}
                  {docCargoOk && docCargoFaltas.length > 0 && (
                    <div className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-1.5">
                      ⚠ Falta preencher <strong>{docCargoFaltas.join(" e ")}</strong> deste cargo — o contrato sai com esse(s) campo(s) EM BRANCO. Preencha em <strong>⚙️ Cargos p/ contrato</strong>.
                    </div>
                  )}
                  {horarioAdm ? (
                    <div className="mt-1.5 text-[12px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800 rounded-lg px-2.5 py-1.5">
                      🕐 <strong>Horário (da admissão):</strong> {horarioAdm}
                    </div>
                  ) : horarioFalta ? (
                    <div className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-1.5">
                      ⚠ Essa admissão não tem <strong>horário de trabalho</strong> cadastrado — o contrato sai sem a jornada. Preencha os horários na <strong>Admissão</strong> desse candidato.
                    </div>
                  ) : null}
                  <input placeholder="Sobrescrever salário (opcional)" value={salario} onChange={e => setSalario(e.target.value)} className="mt-2 w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
              ) : (
                <div>
                  <p className="text-[11px] text-gray-400 mb-1.5">Puxe um candidato da admissão pra trazer o cargo, ou escolha do catálogo:</p>
                  <select value={cargoKey} onChange={e => setCargoKey(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                    <option value="">— escolher —</option>
                    {cargosList.map(([k, v]) => <option key={k} value={k}>{v.funcao || k}</option>)}
                  </select>
                  {cargoSel && (
                    <div className="mt-2 text-[12px] text-gray-600 dark:text-gray-300">
                      {cargoSel.cbo ? `CBO ${cargoSel.cbo}` : ""}{cargoSel.salario ? ` · R$ ${cargoSel.salario.toLocaleString("pt-BR")}` : ""}{cargoSel.regime ? ` · ${cargoSel.regime}` : ""}
                      <input placeholder="Sobrescrever salário (opcional)" value={salario} onChange={e => setSalario(e.target.value)} className="mt-2 w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                    </div>
                  )}
                </div>
              )}
            </Bloco>
          </div>

          <Bloco icon="🧑" titulo="Empregado" tag={admSelNome ? "puxado da admissão" : "da admissão"} tagCor={admSelNome ? "ok" : "ask"}>
            <div className="flex justify-end mb-2">
              <div className="relative">
                <input value={buscaAdm} onChange={e => setBuscaAdm(e.target.value)} onFocus={() => setBuscaAdm(b => b)} placeholder="🔎 puxar candidato da admissão…"
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-64" />
                {(buscaAdm.trim() ? admSug.length > 0 : false) && (
                  <div className="absolute right-0 z-10 mt-1 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {admSug.map(a => (
                      <button key={a.id} type="button" onClick={() => puxarAdmissao(a)}
                        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <div className="text-sm">{a.candidato?.nome}</div>
                        <div className="text-[11px] text-gray-400">{a.candidato?.cpf ? a.candidato.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : ""}{a.dadosPreenchidos && Object.keys(a.dadosPreenchidos).length ? " · dados preenchidos ✓" : " · sem dados ainda"}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {admissoes.length === 0 && <p className="text-[11px] text-amber-600 mb-2">Nenhuma admissão nesta empresa ainda — preencha os dados manualmente abaixo.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Nome completo *" value={emp.nome} onChange={e => setEmp(p => ({ ...p, nome: e.target.value }))} />
              <Input label="CPF *" value={emp.cpf} onChange={e => setEmp(p => ({ ...p, cpf: e.target.value }))} />
              <Input label="RG" value={emp.rg} onChange={e => setEmp(p => ({ ...p, rg: e.target.value }))} />
              <Input label="E-mail (assinatura)" value={emp.email} onChange={e => setEmp(p => ({ ...p, email: e.target.value }))} />
              <Input label="WhatsApp" value={emp.whatsapp} onChange={e => setEmp(p => ({ ...p, whatsapp: e.target.value }))} />
              <Input label="Endereço completo (c/ CEP)" value={emp.endereco} onChange={e => setEmp(p => ({ ...p, endereco: e.target.value }))} className="sm:col-span-1" />
            </div>
          </Bloco>

          <Bloco icon="📝" titulo="Contrato" tag="confirmar" tagCor="ask">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Início" type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
              <Input label="Cidade" value={cidade} onChange={e => setCidade(e.target.value)} />
              <Input label="Assinatura" type="date" value={dataAssin} onChange={e => setDataAssin(e.target.value)} />
            </div>
            <p className="text-[11px] text-gray-400 mt-2.5">Experiência 45+45 e pagamento no 5º dia útil são o padrão do script. Plano de saúde não se aplica (cláusula removida automaticamente).</p>
          </Bloco>

          {erro && <div className="text-sm text-rose-600">{erro}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => void gerar()} disabled={gerando}>{gerando ? "Gerando…" : "📄 Gerar contrato (DOCX)"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
