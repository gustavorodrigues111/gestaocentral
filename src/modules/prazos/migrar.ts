// Fase 2.x — puxa pro módulo Prazos os itens que hoje vivem nos módulos antigos
// (manutenções, exames, uniformes/EPIs) pra a gente poder aposentá-los sem
// perder alertas. Idempotente: id determinístico e NÃO sobrescreve o que já
// existe (Prazos é dono). Rodar por empresa, sob demanda ("Puxar existentes").
import { collection, getDocs, getDoc, doc, setDoc, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Prazo, PrazoRecorrencia, Manutencao, ExameEmpregado, EntregaUniforme } from "../../core/types";
import { MANUTENCAO_TIPO_LABEL } from "../../core/types";

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
    status: "aberto",
    dados: { empregadoId: e.empregadoId, empregadoNome: e.empregadoNomeSnapshot, subtipoTrab: "exame" },
    origem: { modulo: "exames", refId: e.id },
    historico: [],
    criadoEm: nowIso(), criadoPor: por ?? null,
  };
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
    status: "aberto" as const,
    dados: { empregadoId: u.empregadoId, empregadoNome: nome, subtipoTrab: "uniforme" as const },
    origem: { modulo: "uniformes", refId: u.id },
    historico: [],
    criadoEm: nowIso(), criadoPor: por ?? null,
  }));
}

// Puxa manutenções + exames + uniformes da empresa ativa. Retorna quantos criou.
export async function migrarExistentesParaPrazos(rid: string, por?: string | null): Promise<{ criados: number; porTipo: Record<string, number> }> {
  const porTipo = { manutencao: 0, exame: 0, uniforme: 0 };

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

  return { criados: porTipo.manutencao + porTipo.exame + porTipo.uniforme, porTipo };
}
