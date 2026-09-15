// ════════════════════════════════════════════════════════════════════════════
//  Seed PROVISÓRIO — rotinas financeiras da Janaynna (migração do Asana).
//  Cria os PRAZOS (coleção prazos) e as TAREFAS (coleção tarefas) recorrentes,
//  cada um na sua área, com a Janaynna como responsável. Idempotente: usa
//  origemRefId/ids determinísticos e pula o que já existe. Depois de rodar uma
//  vez, o botão que chama isto é removido.
// ════════════════════════════════════════════════════════════════════════════
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Prazo, PrazoRecorrencia, Tarefa, TarefaProjeto, Restaurant, Pessoa } from "../../core/types";
import { criarTarefa } from "./repository";
import { proximoVencimento } from "../prazos/recorrencia";

const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);
const hojeBRT = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const ontem = () => { const [a, m, d] = hojeBRT().split("-").map(Number); return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10); };

// Recorrências (0=Dom..6=Sáb)
const mensalDia = (d: number): PrazoRecorrencia => ({ unidade: "mes", intervalo: 1, modo: "dia_absoluto", diaDoMes: d });
const mensalPrimeiroDiaUtil = (): PrazoRecorrencia => ({ unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: 1 });
const semanal = (dias: number[]): PrazoRecorrencia => ({ unidade: "semana", intervalo: 1, diasSemana: dias });

type Item = { nome: string; area: "Financeiro" | "Operação"; rec: PrazoRecorrencia; empresas: string[]; endereco?: string };

const PRAZOS: Item[] = [
  { nome: "Aluguel — Patizal 35 (Peixaria)", area: "Financeiro", rec: mensalDia(25), empresas: ["Sororoca"], endereco: "Patizal" },
  { nome: "Pagar VT e VR", area: "Financeiro", rec: mensalDia(30), empresas: ["Lobozó", "Sororoca", "Puba", "Quibebe"] },
  { nome: "Pagar ESTAFF (freelas pelo app)", area: "Financeiro", rec: semanal([3]), empresas: ["Escritório"] },
];

const TAREFAS: Item[] = [
  { nome: "Fechar pagamentos de freelancers", area: "Financeiro", rec: semanal([2]), empresas: ["Puba", "Lobozó", "Sororoca"] },
  { nome: "Baixar CF-es de entrada (WhatsApp)", area: "Financeiro", rec: mensalDia(28), empresas: ["Lobozó", "Sororoca", "Puba", "Quibebe"] },
  { nome: "Contagem de vinhos", area: "Operação", rec: mensalDia(28), empresas: ["Lobozó", "Sororoca", "Puba"] },
  { nome: "Enviar documentos contábeis/fiscais (Senador)", area: "Financeiro", rec: mensalPrimeiroDiaUtil(), empresas: ["Escritório"] },
  { nome: "Lançar DDAs da semana seguinte no banco", area: "Financeiro", rec: semanal([5]), empresas: ["Escritório"] },
  { nome: "Separar notas impressas do contas a pagar", area: "Financeiro", rec: semanal([4]), empresas: ["Escritório"] },
  { nome: "Contas a pagar da semana", area: "Financeiro", rec: semanal([1]), empresas: ["Escritório"] },
  { nome: "Conferir pagamentos (17h)", area: "Financeiro", rec: semanal([1, 2, 3, 4, 5]), empresas: ["Escritório"] },
  { nome: "Conferir fechamento de caixa", area: "Financeiro", rec: semanal([2, 3]), empresas: ["Escritório"] },
  { nome: "Receber romaneios de peixe (CEASA)", area: "Operação", rec: mensalPrimeiroDiaUtil(), empresas: ["Sororoca"] },
];

// Área → categoria de prazo (mesma taxonomia). Financeiro=conta, Operação=tecnico.
const AREA_TIPO: Record<Item["area"], Prazo["tipo"]> = { Financeiro: "conta", "Operação": "tecnico" };

export type SeedCtx = { restaurants: Restaurant[]; projetos: TarefaProjeto[]; pessoas: Pessoa[]; criadoPor: string; criadoPorNome: string };

export async function semearRotinasJanaynna(ctx: SeedCtx): Promise<{ prazos: number; tarefas: number; avisos: string[] }> {
  const avisos: string[] = [];
  const jana = ctx.pessoas.find((p) => norm(p.nome).includes("janaynna")) || ctx.pessoas.find((p) => norm(p.nome).startsWith("janay"));
  if (!jana) return { prazos: 0, tarefas: 0, avisos: ["Não encontrei a pessoa 'Janaynna' no cadastro — cancele e confira o nome."] };
  const respId = jana.id, respNome = jana.nome;

  const restId = (nome: string): string | null => {
    const r = ctx.restaurants.find((x) => norm(x.nome).includes(norm(nome)));
    if (!r) avisos.push(`Empresa não encontrada: "${nome}" (item ficou sem essa empresa).`);
    return r?.id || null;
  };
  const empresasIds = (nomes: string[]) => [...new Set(nomes.map(restId).filter((x): x is string => !!x))];
  const projId = (area: string): string | null => {
    const p = ctx.projetos.find((x) => norm(x.nome) === norm(area)) || ctx.projetos.find((x) => norm(x.nome).includes(norm(area)));
    return p?.id || null;
  };

  // Primeira ocorrência ≥ hoje.
  const primeira = (rec: PrazoRecorrencia) => proximoVencimento(rec, ontem()) || hojeBRT();
  const now = new Date().toISOString();
  let nP = 0, nT = 0;

  // ── PRAZOS ──
  for (const it of PRAZOS) {
    const id = `seed_jana_${slug(it.nome)}`;
    const ref = doc(db, "prazos", id);
    if ((await getDoc(ref)).exists()) continue;   // idempotente
    const restaurantIds = empresasIds(it.empresas);
    // Endereço (só o aluguel): busca por apelido na empresa dona.
    let enderecoId: string | null = null;
    if (it.endereco && restaurantIds[0]) {
      const snap = await getDocs(query(collection(db, "enderecos"), where("restaurantId", "==", restaurantIds[0])));
      const e = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; apelido?: string; ativo?: boolean }).find((x) => x.ativo !== false && norm(x.apelido || "").includes(norm(it.endereco!)));
      enderecoId = e?.id || null;
      if (!enderecoId) avisos.push(`Endereço "${it.endereco}" não achado — vincule à mão no aluguel.`);
    }
    const prazo: Prazo = {
      id,
      restaurantIds: restaurantIds.length ? restaurantIds : (restId(it.empresas[0]) ? [restId(it.empresas[0])!] : []),
      titulo: it.nome,
      tipo: AREA_TIPO[it.area],
      vencimento: primeira(it.rec),
      antecedenciaDias: 3,
      recorrencia: it.rec,
      responsavelId: respId,
      responsavelNome: respNome,
      status: "aberto",
      exigeLaudo: false,
      permiteAgendamento: false,
      enderecoId,
      origem: { modulo: "seed_rotinas_janaynna", refId: id },
      criadoEm: now,
      criadoPor: ctx.criadoPor,
    };
    await setDoc(ref, sanitizeForFirestore(prazo));
    nP++;
  }

  // ── TAREFAS ──
  for (const it of TAREFAS) {
    const refId = `seed_jana_${slug(it.nome)}`;
    // idempotente: pula se já existe tarefa com este origemRefId
    const existe = await getDocs(query(collection(db, "tarefas"), where("origemRefId", "==", refId)));
    if (!existe.empty) continue;
    const pjId = projId(it.area);
    if (!pjId) { avisos.push(`Área/projeto "${it.area}" não encontrado — "${it.nome}" não foi criada.`); continue; }
    const t: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
      titulo: it.nome,
      projetoId: pjId,
      subprojetoId: "",
      responsavelId: respId,
      responsavelNome: respNome,
      restaurantIds: empresasIds(it.empresas),
      prazo: primeira(it.rec),
      status: "a_fazer",
      prioridade: "normal",
      recorrencia: it.rec,
      origem: "recorrencia",
      origemRefId: refId,
      origemRefLabel: "Rotina Financeiro (Janaynna)",
      criadoPor: ctx.criadoPor,
      criadoPorNome: ctx.criadoPorNome,
    };
    await criarTarefa(t);
    nT++;
  }

  return { prazos: nP, tarefas: nT, avisos };
}
