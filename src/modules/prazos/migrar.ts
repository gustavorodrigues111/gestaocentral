// Fase 2.x — puxa pro módulo Prazos os itens que hoje vivem nos módulos antigos
// (manutenções, exames, uniformes/EPIs) pra a gente poder aposentá-los sem
// perder alertas. Idempotente: id determinístico e NÃO sobrescreve o que já
// existe (Prazos é dono). Rodar por empresa, sob demanda ("Puxar existentes").
import { collection, getDocs, getDoc, doc, setDoc, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Prazo, PrazoRecorrencia, PrazoSubtipoTrab, Manutencao, ExameEmpregado, EntregaUniforme, ContaFixa, Empregado } from "../../core/types";
import { MANUTENCAO_TIPO_LABEL, CONTA_FIXA_CATEGORIA_LABEL } from "../../core/types";
import { ANTECEDENCIA_PADRAO } from "./logic";

async function criarSeNovo(prazo: Prazo): Promise<boolean> {
  const ref = doc(db, "prazos", prazo.id);
  if ((await getDoc(ref)).exists()) return false;   // já existe → não mexe
  await setDoc(ref, sanitizeForFirestore(prazo));
  return true;
}
const nowIso = () => new Date().toISOString();

// Periodicidade de manutenção → recorrência do prazo (45_dias/custom = manual).
function recorrenciaManut(m: Manutencao): PrazoRecorrencia | null {
  const diaDoMes = Number((m.proximoVencimento || "").slice(8, 10)) || 1;
  switch (m.periodicidade) {
    case "trimestral": return { unidade: "mes", intervalo: 3, modo: "dia_absoluto", diaDoMes };
    case "semestral": return { unidade: "mes", intervalo: 6, modo: "dia_absoluto", diaDoMes };
    case "anual": return { unidade: "ano", intervalo: 1 };
    case "bianual": return { unidade: "ano", intervalo: 2 };
    case "trianual": return { unidade: "ano", intervalo: 3 };
    default: return null;
  }
}

// Último dia de um mês (0-based) — clampa diaDoMes em meses curtos.
function ultimoDiaMes(ano: number, mes0: number): number { return new Date(ano, mes0 + 1, 0).getDate(); }
const ymdDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ContaFixaRecorrencia → PrazoRecorrencia (o prazo recorrente "anda" no Realizado).
function recorrenciaConta(c: ContaFixa): PrazoRecorrencia | null {
  const diaDoMes = Math.min(Math.max(1, c.diaDoMes || 1), 31);
  switch (c.recorrencia) {
    case "mensal": return { unidade: "mes", intervalo: 1, modo: "dia_absoluto", diaDoMes };
    case "trimestral": return { unidade: "mes", intervalo: 3, modo: "dia_absoluto", diaDoMes };
    case "semestral": return { unidade: "mes", intervalo: 6, modo: "dia_absoluto", diaDoMes };
    case "anual": return { unidade: "ano", intervalo: 1 };
    case "semanal": return { unidade: "semana", intervalo: 1, diasSemana: [c.diaDaSemana ?? 1] };
    default: return null;
  }
}

// Próxima ocorrência (>= hoje) da conta, pra ser o vencimento inicial do prazo.
function proximaDataConta(c: ContaFixa): string {
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  if (c.recorrencia === "semanal") {
    const alvo = c.diaDaSemana ?? 1; const d = new Date(hoje);
    for (let i = 0; i < 7 && d.getDay() !== alvo; i++) d.setDate(d.getDate() + 1);
    return ymdDe(d);
  }
  if (c.recorrencia === "anual") {
    const mes0 = Math.min(Math.max(0, (c.mesDoAno ?? 1) - 1), 11);
    let ano = hoje.getFullYear();
    const mk = (y: number) => new Date(y, mes0, Math.min(Math.max(1, c.diaDoMes || 1), ultimoDiaMes(y, mes0)), 12, 0, 0);
    let d = mk(ano); if (d.getTime() < hoje.getTime()) d = mk(++ano);
    return ymdDe(d);
  }
  // mensal/trimestral/semestral → próxima ocorrência do diaDoMes a partir de hoje.
  const mk = (y: number, m0: number) => new Date(y, m0, Math.min(Math.max(1, c.diaDoMes || 1), ultimoDiaMes(y, m0)), 12, 0, 0);
  let d = mk(hoje.getFullYear(), hoje.getMonth());
  if (d.getTime() < hoje.getTime()) { const m0 = hoje.getMonth() + 1; d = mk(hoje.getFullYear() + Math.floor(m0 / 12), m0 % 12); }
  return ymdDe(d);
}

function contaFixaParaPrazo(c: ContaFixa, por?: string | null): Prazo | null {
  if (!c.restaurantIds?.length) return null;
  return {
    id: `prazo_mig_conta_${c.id}`,
    restaurantIds: c.restaurantIds,
    titulo: `${c.nome}${c.fornecedor ? ` — ${c.fornecedor}` : ""}`,
    tipo: "conta",
    vencimento: proximaDataConta(c),
    responsavelId: c.responsavelPadraoId || null,
    responsavelNome: c.responsavelPadraoNome || null,
    antecedenciaDias: c.diasAntecedencia ?? 3,
    recorrencia: recorrenciaConta(c),
    exigeLaudo: false,
    permiteAgendamento: false,   // conta você paga/conclui, não agenda
    status: "aberto",
    dados: { valor: c.valorEstimado, pix: c.pix, categoria: CONTA_FIXA_CATEGORIA_LABEL[c.categoria] },
    origem: { modulo: "contasFixas", refId: c.id },
    historico: [],
    criadoEm: nowIso(), criadoPor: por ?? null,
  };
}

function manutencaoParaPrazo(m: Manutencao, rid: string, por?: string | null): Prazo | null {
  if (!m.proximoVencimento) return null;
  return {
    id: `prazo_mig_manut_${m.id}`,
    restaurantIds: [rid],
    titulo: `${MANUTENCAO_TIPO_LABEL[m.tipo] || m.tipo}${m.fornecedor ? ` — ${m.fornecedor}` : ""}`,
    tipo: "tecnico",
    vencimento: m.proximoVencimento,
    responsavelId: m.responsavelPadraoId || null,
    responsavelNome: m.responsavelPadraoNome || null,
    antecedenciaDias: m.diasAntecedencia ?? 30,
    recorrencia: recorrenciaManut(m),
    exigeLaudo: !!m.obrigatorio,
    permiteAgendamento: true,    // vistoria/manutenção técnica agenda data de execução
    status: "aberto",
    dados: { fornecedor: m.fornecedor },
    origem: { modulo: "manutencoes", refId: m.id },
    historico: [],
    criadoEm: nowIso(), criadoPor: por ?? null,
  };
}

function exameParaPrazo(e: ExameEmpregado, rid: string, por?: string | null): Prazo | null {
  if (!e.ativo || !e.proximoVencimento) return null;
  return {
    id: `prazo_mig_exame_${e.id}`,
    restaurantIds: [rid],
    titulo: `Exame: ${e.tipoNomeSnapshot} — ${e.empregadoNomeSnapshot}`,
    tipo: "trabalhista",
    vencimento: e.proximoVencimento,
    antecedenciaDias: e.diasAntecedencia ?? 15,
    recorrencia: null,
    exigeLaudo: false,
    permiteAgendamento: false,   // exame/trabalhista: só concluir
    status: "aberto",
    dados: { empregadoId: e.empregadoId, empregadoNome: e.empregadoNomeSnapshot, subtipoTrab: "exame" },
    origem: { modulo: "exames", refId: e.id },
    historico: [],
    criadoEm: nowIso(), criadoPor: por ?? null,
  };
}

// Soma N dias a uma data YYYY-MM-DD.
function addDiasYmd(ymd: string, n: number): string {
  const [a, m, d] = ymd.split("-").map(Number);
  const dt = new Date(a, (m || 1) - 1, d || 1, 12, 0, 0);
  dt.setDate(dt.getDate() + n);
  return ymdDe(dt);
}

const EXPERIENCIAS_MIG: Array<{ subtipo: PrazoSubtipoTrab; dias: number; titulo: string }> = [
  { subtipo: "exp45", dias: 45, titulo: "Fim de experiência (45 dias)" },
  { subtipo: "exp90", dias: 90, titulo: "Fim de experiência (90 dias)" },
];

// Prazos de fim de experiência (45/90) de um empregado ativo — só os A VENCER
// (vencimento >= hoje). IDs iguais aos do hook de admissão (idempotente).
function experienciaParaPrazos(emp: Empregado, hoje: string, por?: string | null): Prazo[] {
  const adm = emp.admissaoAtual;
  if (!emp.estaAtivo || !adm || !/^\d{4}-\d{2}-\d{2}$/.test(adm)) return [];
  const out: Prazo[] = [];
  for (const e of EXPERIENCIAS_MIG) {
    const vencimento = addDiasYmd(adm, e.dias);
    if (vencimento < hoje) continue;   // já passou → não puxa (só a vencer correntes)
    out.push({
      id: `prazo_trab_${emp.id}_${e.subtipo}`,
      restaurantIds: [emp.restaurantId],
      titulo: `${e.titulo} — ${emp.nome}`,
      tipo: "trabalhista",
      vencimento,
      antecedenciaDias: ANTECEDENCIA_PADRAO.trabalhista,
      recorrencia: null,
      exigeLaudo: false,
      permiteAgendamento: false,   // fim de experiência: só concluir
      status: "aberto",
      dados: { empregadoId: emp.id, empregadoNome: emp.nome, subtipoTrab: e.subtipo },
      origem: { modulo: "admissao", refId: emp.id },
      historico: [],
      criadoEm: nowIso(), criadoPor: por ?? null,
    });
  }
  return out;
}

function uniformeParaPrazos(u: EntregaUniforme, rid: string, por?: string | null): Prazo[] {
  const nome = u.candidatoSnapshot?.nome || "";
  return (u.itens || []).map((it, idx) => ({ it, idx })).filter(({ it }) => !!it.validadeAte).map(({ it, idx }) => ({
    id: `prazo_mig_unif_${u.id}_${idx}`,
    restaurantIds: [rid],
    titulo: `Validade de ${it.nome}${it.caEpi ? ` (CA ${it.caEpi})` : ""} — ${nome}`,
    tipo: "trabalhista" as const,
    vencimento: it.validadeAte!,
    antecedenciaDias: 15,
    recorrencia: null,
    exigeLaudo: false,
    permiteAgendamento: false,   // uniforme/trabalhista: só concluir
    status: "aberto" as const,
    dados: { empregadoId: u.empregadoId, empregadoNome: nome, subtipoTrab: "uniforme" as const },
    origem: { modulo: "uniformes", refId: u.id },
    historico: [],
    criadoEm: nowIso(), criadoPor: por ?? null,
  }));
}

// ── Hooks ongoing: chamados quando um exame/uniforme é CRIADO nos módulos que
//    ficam (Exames/Uniformes), pra o prazo nascer automático. Create-if-new
//    (não sobrescreve). Best-effort — quem chama envolve em try/catch. ──
export async function semearPrazoExame(e: ExameEmpregado, por?: string | null): Promise<void> {
  const p = exameParaPrazo(e, e.restaurantId, por);
  if (p) await criarSeNovo(p);
}

// Ciclo do exame AVANÇOU (deu baixa → novo proximoVencimento). Ao contrário do
// semear (create-if-new), este SINCRONIZA: avança o vencimento do prazo já
// existente e o reabre, sem apagar histórico/laudo do doc. Cria se ainda não
// existe (exame antigo, anterior ao hook). Best-effort — chamador usa try/catch.
export async function sincronizarPrazoExame(e: ExameEmpregado, por?: string | null): Promise<void> {
  const p = exameParaPrazo(e, e.restaurantId, por);
  if (!p) return;   // inativo ou sem próximo vencimento → nada a sincronizar
  const ref = doc(db, "prazos", p.id);
  if (!(await getDoc(ref)).exists()) { await setDoc(ref, sanitizeForFirestore(p)); return; }
  await setDoc(ref, sanitizeForFirestore({
    vencimento: p.vencimento,
    status: "aberto",
    agendamento: null,
    titulo: p.titulo,
    antecedenciaDias: p.antecedenciaDias,
    atualizadoEm: nowIso(),
  }), { merge: true });
}
export async function semearPrazosUniforme(u: EntregaUniforme, por?: string | null): Promise<void> {
  for (const p of uniformeParaPrazos(u, u.restaurantId, por)) await criarSeNovo(p);
}

// Puxa contas fixas + manutenções + exames + uniformes + experiências (45/90) da
// empresa ativa. Retorna quantos criou.
export async function migrarExistentesParaPrazos(rid: string, por?: string | null): Promise<{ criados: number; porTipo: Record<string, number> }> {
  const porTipo = { conta: 0, manutencao: 0, exame: 0, uniforme: 0, experiencia: 0 };
  const agora = new Date(); agora.setHours(12, 0, 0, 0);
  const hojeStr = ymdDe(agora);

  const contas = (await getDocs(query(collection(db, "contasFixas"), where("restaurantIds", "array-contains", rid)))).docs
    .map((d) => ({ id: d.id, ...d.data() }) as ContaFixa)
    .filter((c) => !c.deletadoEm && c.ativo !== false);
  for (const c of contas) { const p = contaFixaParaPrazo(c, por); if (p && (await criarSeNovo(p))) porTipo.conta++; }

  const manuts = (await getDocs(query(collection(db, "manutencoes"), where("restaurantIds", "array-contains", rid)))).docs
    .map((d) => ({ id: d.id, ...d.data() }) as Manutencao & { deletadoEm?: string | null; ativo?: boolean })
    .filter((m) => !m.deletadoEm && m.ativo !== false);
  for (const m of manuts) { const p = manutencaoParaPrazo(m, rid, por); if (p && (await criarSeNovo(p))) porTipo.manutencao++; }

  const exames = (await getDocs(query(collection(db, "examesEmpregado"), where("restaurantId", "==", rid)))).docs
    .map((d) => ({ id: d.id, ...d.data() }) as ExameEmpregado);
  for (const e of exames) { const p = exameParaPrazo(e, rid, por); if (p && (await criarSeNovo(p))) porTipo.exame++; }

  const unifs = (await getDocs(query(collection(db, "entregasUniforme"), where("restaurantId", "==", rid)))).docs
    .map((d) => ({ id: d.id, ...d.data() }) as EntregaUniforme & { deletadoEm?: string | null });
  for (const u of unifs) { if ((u as { deletadoEm?: string | null }).deletadoEm) continue; for (const p of uniformeParaPrazos(u, rid, por)) { if (await criarSeNovo(p)) porTipo.uniforme++; } }

  const emps = (await getDocs(query(collection(db, "empregados"), where("restaurantId", "==", rid)))).docs
    .map((d) => ({ id: d.id, ...d.data() }) as Empregado);
  for (const emp of emps) { for (const p of experienciaParaPrazos(emp, hojeStr, por)) { if (await criarSeNovo(p)) porTipo.experiencia++; } }

  return { criados: porTipo.conta + porTipo.manutencao + porTipo.exame + porTipo.uniforme + porTipo.experiencia, porTipo };
}
