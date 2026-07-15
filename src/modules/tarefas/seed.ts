// Seed dos 12 projetos do esqueleto + alguns subprojetos-chave.
// Idempotente: usa IDs fixos. Rodar 2× não duplica nem sobrescreve dados
// editados (só cria o que ainda não existe).
//
// Chamado pela TarefasPage no primeiro acesso, OU manualmente pelo admin
// (botão "🌱 Recriar estrutura inicial").

import { collection, getDocs, query, setDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { TarefaProjeto, TarefaSubprojeto } from "../../core/types";

// IDs fixos pra idempotência — same input, same output.
const PROJETOS: Array<Omit<TarefaProjeto, "criadoEm" | "atualizadoEm" | "criadoPor">> = [
  { id: "proj-pessoas-rot",   nome: "Pessoas — Rotinas",   emoji: "👥", cor: "#fbbf24", dono: "system", visibilidade: "privado",  tipo: "rotina",  ordem: 1,  ativo: true },
  { id: "proj-pessoas-dem",   nome: "Pessoas — Demandas",  emoji: "👥", cor: "#fbbf24", dono: "system", visibilidade: "privado",  tipo: "demanda", ordem: 2,  ativo: true },
  { id: "proj-financ-rot",    nome: "Financeiro — Rotinas",emoji: "💰", cor: "#10b981", dono: "system", visibilidade: "privado", tipo: "rotina",  ordem: 3,  ativo: true },
  { id: "proj-financ-dem",    nome: "Financeiro — Demandas",emoji: "💰", cor: "#10b981", dono: "system", visibilidade: "privado", tipo: "demanda", ordem: 4,  ativo: true },
  { id: "proj-diretoria-rot", nome: "Diretoria — Rotinas", emoji: "🎩", cor: "#8b5cf6", dono: "system", visibilidade: "privado", tipo: "rotina",  ordem: 5,  ativo: true },
  { id: "proj-diretoria-dem", nome: "Diretoria — Demandas",emoji: "🎩", cor: "#8b5cf6", dono: "system", visibilidade: "privado", tipo: "demanda", ordem: 6,  ativo: true },
  { id: "proj-eventos",       nome: "Eventos",             emoji: "🎉", cor: "#ec4899", dono: "system", visibilidade: "escritorio",tipo: "misto",   ordem: 7,  ativo: true },
  { id: "proj-operacao-rot",  nome: "Operação — Rotinas",  emoji: "🍳", cor: "#f97316", dono: "system", visibilidade: "privado", tipo: "rotina",  ordem: 8,  ativo: true },
  { id: "proj-operacao-dem",  nome: "Operação — Demandas", emoji: "🍳", cor: "#f97316", dono: "system", visibilidade: "privado", tipo: "demanda", ordem: 9,  ativo: true },
  { id: "proj-prazos",        nome: "Prazos de Licenças, Certificados e Manutenções", emoji: "📅", cor: "#f97316", dono: "system", visibilidade: "escritorio", tipo: "rotina", ordem: 10, ativo: true },
  { id: "proj-temporarios",   nome: "Projetos Temporários",emoji: "🛠️", cor: "#3b82f6", dono: "system", visibilidade: "escritorio",tipo: "misto",   ordem: 11, ativo: true },
  // "proj-pessoal" (Caixa Pessoal) foi removido — sua função é coberta pelo
  // Banco de Ideias (qualquer um registra) + integração com Tarefas (puxar pra virar tarefa).
];

const SUBPROJETOS: Array<Omit<TarefaSubprojeto, "criadoEm" | "atualizadoEm" | "criadoPor">> = [
  // Pessoas - Rotinas
  { id: "sub-pessoas-admissao",      projetoId: "proj-pessoas-rot", nome: "Admissão", auto: true, gatilho: "Nova admissão no kanban de processos", campos: "Empresa · Cargo · Data de admissão", pastaDriveTemplate: "[Empresa]/Pessoas/Empregados Ativos/[Nome]", ordem: 1, ativo: true },
  { id: "sub-pessoas-demissao",      projetoId: "proj-pessoas-rot", nome: "Demissão", auto: true, gatilho: "Início de processo de desligamento", campos: "Empresa(s) · Iniciativa · Aviso prévio", pastaDriveTemplate: "[Empresa]/Pessoas/Empregados Desligados/[Nome]", ordem: 2, ativo: true },
  { id: "sub-pessoas-alteracoes",    projetoId: "proj-pessoas-rot", nome: "Alterações Contratuais", auto: true, gatilho: "Promoção / mudança de cargo / aditivo", campos: "Empresa · Tipo · Vigência", ordem: 3, ativo: true },
  { id: "sub-pessoas-ferias",        projetoId: "proj-pessoas-rot", nome: "Férias", auto: true, gatilho: "Férias programadas", campos: "Empresa(s) · Período · Dias · Compra de dias?", ordem: 4, ativo: true },
  // Removidos: "Prazos de Experiência (45/90)" e "Prazos do Empregado" — viraram
  // prazos trabalhistas DERIVADOS ao vivo, mostrados em Gestor › Prazos › Trabalhistas.
  { id: "sub-pessoas-disciplinares", projetoId: "proj-pessoas-rot", nome: "Disciplinares", auto: true, gatilho: "Registro de advertência/suspensão", campos: "Empresa · Tipo · Motivo", ordem: 7, ativo: true },
  { id: "sub-pessoas-licencas",      projetoId: "proj-pessoas-rot", nome: "Licenças", auto: true, gatilho: "Início de licença (atestado/parto/INSS)", campos: "Empresa · Tipo · Período", ordem: 8, ativo: true },
  { id: "sub-pessoas-folha",         projetoId: "proj-pessoas-rot", nome: "Folha de Pagamento (Adiantamento + Salário)", auto: true, gatilho: "Recorrente — Adiantamento (dia 20) + Salário (5º dia útil)", campos: "Empresa(s) · Mês/Ano · Tipo (adiantamento/salário)", ordem: 9, ativo: true },
  // Pessoas - Demandas
  { id: "sub-pessoas-portal",        projetoId: "proj-pessoas-dem", nome: "Demandas de Empregados (futuro)", auto: true, gatilho: "Empregado abre demanda pelo portal", campos: "Empregado · Categoria · Restaurante · Urgência", ordem: 1, ativo: true },
  { id: "sub-pessoas-internas",      projetoId: "proj-pessoas-dem", nome: "Demandas Internas DP", auto: false, ordem: 2, ativo: true },
  // Financeiro - Rotinas
  // Removido: "Contas Fixas Mensais" — virou prazo DERIVADO em Prazos › Contas.
  { id: "sub-financ-fechamento",     projetoId: "proj-financ-rot",  nome: "Fechamento Financeiro Mensal", auto: true, gatilho: "Início de cada mês (recorrência)", campos: "Mês/Ano · Restaurantes envolvidos", ordem: 2, ativo: true },
  { id: "sub-financ-caixas",         projetoId: "proj-financ-rot",  nome: "Fechamento de Caixas", auto: true, gatilho: "Toda segunda-feira", campos: "Restaurante · Semana", ordem: 3, ativo: true },
  { id: "sub-financ-guias",          projetoId: "proj-financ-rot",  nome: "Guias de Imposto", auto: false, campos: "Empresa · Tipo · Mês competência", ordem: 4, ativo: true },
  // Financeiro - Demandas
  { id: "sub-financ-pedidos",        projetoId: "proj-financ-dem",  nome: "Pedidos de Pagamento Específicos", auto: false, campos: "Solicitante · Empresa · Valor · Categoria", ordem: 1, ativo: true },
  { id: "sub-financ-internas",       projetoId: "proj-financ-dem",  nome: "Demandas Internas Financeiro", auto: false, ordem: 2, ativo: true },
  // Diretoria - Rotinas
  { id: "sub-dir-plan",              projetoId: "proj-diretoria-rot", nome: "Planejamento Administrativo Mensal", auto: true, gatilho: "Recorrente — 1 tarefa-pai por mês com checklist de planejamento", campos: "Mês/Ano", ordem: 1, ativo: true },
  { id: "sub-dir-reunioes",          projetoId: "proj-diretoria-rot", nome: "Reuniões com Pauta", auto: false, gatilho: "Reunião agendada — pauta = subtarefas", campos: "Tipo · Participantes · Data", ordem: 2, ativo: true },
  { id: "sub-dir-indicadores",       projetoId: "proj-diretoria-rot", nome: "Indicadores e Acompanhamento", auto: false, campos: "Mês/Ano", ordem: 3, ativo: true },
  // Diretoria - Demandas
  { id: "sub-dir-gustavo",           projetoId: "proj-diretoria-dem", nome: "Gustavo — Demandas", auto: false, ordem: 1, ativo: true },
  { id: "sub-dir-outras",            projetoId: "proj-diretoria-dem", nome: "Diretoria — Demandas", auto: false, ordem: 2, ativo: true },
  // Eventos
  { id: "sub-eventos-captacao",      projetoId: "proj-eventos", nome: "Captação & Divulgação", auto: false, campos: "Restaurante · Origem do lead", ordem: 1, ativo: true },
  { id: "sub-eventos-lobozo",        projetoId: "proj-eventos", nome: "Lobozó", auto: true, gatilho: "Cada evento captado no Lobozó", campos: "Data · Nº convidados · Cliente · Valor", ordem: 2, ativo: true },
  { id: "sub-eventos-pubabar",       projetoId: "proj-eventos", nome: "Pubabar", auto: true, gatilho: "Cada evento captado no Pubabar", campos: "Data · Nº convidados · Cliente · Valor", ordem: 3, ativo: true },
  { id: "sub-eventos-sororoca",      projetoId: "proj-eventos", nome: "Sororoca", auto: true, gatilho: "Cada evento captado no Sororoca", campos: "Data · Nº convidados · Cliente · Valor", ordem: 4, ativo: true },
  // Operação - Rotinas
  { id: "sub-ops-lobozo",            projetoId: "proj-operacao-rot", nome: "Lobozó", auto: true, gatilho: "Tarefas recorrentes do líder do Lobozó", campos: "Semana", ordem: 1, ativo: true },
  { id: "sub-ops-pubabar",           projetoId: "proj-operacao-rot", nome: "Pubabar", auto: true, gatilho: "Tarefas recorrentes do líder do Pubabar", campos: "Semana", ordem: 2, ativo: true },
  { id: "sub-ops-sororoca",          projetoId: "proj-operacao-rot", nome: "Sororoca", auto: true, gatilho: "Tarefas recorrentes do líder do Sororoca", campos: "Semana", ordem: 3, ativo: true },
  { id: "sub-ops-quibebe",           projetoId: "proj-operacao-rot", nome: "Quibebe", auto: true, gatilho: "Tarefas recorrentes do líder do Quibebe", campos: "Semana", ordem: 4, ativo: true },
  // Operação - Demandas
  { id: "sub-opsd-lobozo",           projetoId: "proj-operacao-dem", nome: "Lobozó", auto: false, ordem: 1, ativo: true },
  { id: "sub-opsd-pubabar",          projetoId: "proj-operacao-dem", nome: "Pubabar", auto: false, ordem: 2, ativo: true },
  { id: "sub-opsd-sororoca",         projetoId: "proj-operacao-dem", nome: "Sororoca", auto: false, ordem: 3, ativo: true },
  { id: "sub-opsd-quibebe",          projetoId: "proj-operacao-dem", nome: "Quibebe", auto: false, ordem: 4, ativo: true },
  // Prazos
  { id: "sub-prazos-licencas",       projetoId: "proj-prazos", nome: "Licenças e Certificados", auto: true, gatilho: "Gerado pelo cadastro de Manutenções (categorias: bombeiros/sanitária/CMVS)", campos: "Empresa · Tipo · Vencimento", ordem: 1, ativo: true },
  { id: "sub-prazos-manutencoes",    projetoId: "proj-prazos", nome: "Manutenções", auto: true, gatilho: "Gerado pelo cadastro de Manutenções (filtros, potabilidade, dedetização, etc)", campos: "Empresa · Equipamento · Periodicidade", ordem: 2, ativo: true },
  // Projetos Temporários
  { id: "sub-temp-reformas",         projetoId: "proj-temporarios", nome: "Reformas / Obras", auto: false, campos: "Restaurante · Início · Fim previsto · Orçamento", ordem: 1, ativo: true },
  { id: "sub-temp-implantacoes",     projetoId: "proj-temporarios", nome: "Implantações (sistemas novos)", auto: false, campos: "Ferramenta · Restaurante", ordem: 2, ativo: true },
  { id: "sub-temp-outros",           projetoId: "proj-temporarios", nome: "Outros", auto: false, ordem: 3, ativo: true },
  // Caixa Pessoal — sem subprojetos por padrão (cada usuário cria o seu)
];

/**
 * Roda o seed. Idempotente — só cria docs que ainda não existem.
 * Retorna { criados, existentes }.
 */
export async function seedProjetosIniciais(pessoaId: string): Promise<{ criados: number; existentes: number }> {
  const now = new Date().toISOString();
  let criados = 0;
  let existentes = 0;

  // Conferir existência via getDocs filtrado por id (poderíamos checar 1 por 1
  // com getDoc, mas batch é mais barato em rodadas frias).
  const projSnap = await getDocs(query(collection(db, "tarefaProjetos")));
  const existProj = new Set(projSnap.docs.map(d => d.id));
  for (const p of PROJETOS) {
    if (existProj.has(p.id)) { existentes++; continue; }
    await setDoc(doc(db, "tarefaProjetos", p.id), sanitizeForFirestore({
      ...p, criadoEm: now, criadoPor: pessoaId, atualizadoEm: now,
    }));
    criados++;
  }

  const subSnap = await getDocs(query(collection(db, "tarefaSubprojetos")));
  const existSub = new Set(subSnap.docs.map(d => d.id));
  for (const s of SUBPROJETOS) {
    if (existSub.has(s.id)) { existentes++; continue; }
    await setDoc(doc(db, "tarefaSubprojetos", s.id), sanitizeForFirestore({
      ...s, criadoEm: now, criadoPor: pessoaId, atualizadoEm: now,
    }));
    criados++;
  }

  return { criados, existentes };
}
