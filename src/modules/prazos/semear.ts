// Alimentador: semeia os prazos TRABALHISTAS de experiência (45/90 dias) a
// partir da conclusão de uma admissão. Prazos é dono — semeia UMA vez (id
// determinístico); se já existe, não mexe (correção de data depois é manual).
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Prazo, PrazoSubtipoTrab } from "../../core/types";
import { ANTECEDENCIA_PADRAO } from "./logic";

function addDias(ymd: string, n: number): string {
  const [a, m, d] = ymd.split("-").map(Number);
  const dt = new Date(a, (m || 1) - 1, d || 1, 12, 0, 0);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const EXPERIENCIAS: Array<{ subtipo: PrazoSubtipoTrab; dias: number; titulo: string }> = [
  { subtipo: "exp45", dias: 45, titulo: "Fim de experiência (45 dias)" },
  { subtipo: "exp90", dias: 90, titulo: "Fim de experiência (90 dias)" },
];

// dataAdmissao em "YYYY-MM-DD". Best-effort: nunca deve quebrar a conclusão da
// admissão (quem chama envolve em try/catch).
export async function semearPrazosExperiencia(p: {
  empregadoId: string; empregadoNome: string; restaurantId: string; dataAdmissao: string; criadoPor?: string | null;
}): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dataAdmissao)) return;
  for (const e of EXPERIENCIAS) {
    const id = `prazo_trab_${p.empregadoId}_${e.subtipo}`;
    const ref = doc(db, "prazos", id);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;                 // já semeado → Prazos é dono, não mexe
    const prazo: Prazo = {
      id,
      restaurantIds: [p.restaurantId],
      titulo: `${e.titulo} — ${p.empregadoNome}`,
      tipo: "trabalhista",
      vencimento: addDias(p.dataAdmissao, e.dias),
      antecedenciaDias: ANTECEDENCIA_PADRAO.trabalhista,
      recorrencia: null,
      exigeLaudo: false,
      permiteAgendamento: false,   // fim de experiência: só concluir
      status: "aberto",
      dados: { empregadoId: p.empregadoId, empregadoNome: p.empregadoNome, subtipoTrab: e.subtipo },
      origem: { modulo: "admissao", refId: p.empregadoId },
      historico: [],
      criadoEm: new Date().toISOString(),
      criadoPor: p.criadoPor ?? null,
    };
    await setDoc(ref, sanitizeForFirestore(prazo));
  }
}
