// ════════════════════════════════════════════════════════════════════════════
//  Lote de solicitação de ajuste — RASCUNHO persistido.
//
//  Antes era state local da aba (sumia ao recarregar). Agora persiste em
//  /excecoesLoteRascunho/{rid}_{empregadoId} pra o líder poder montar lotes,
//  fechar a aba, e continuar depois — ou montar vários lotes em paralelo e
//  enviar tudo de uma vez.
//
//  Quando o líder envia o lote (WhatsApp/presencial), o doc é PRESERVADO —
//  marca `enviadoEm` (1ª vez) ou append em `reenvios` (envios subsequentes).
//  O box amarelo continua visível com botão "Reenviar" + log dos envios, e
//  só some quando o líder clica em "Cancelar" (limpar) ou quando todos os
//  apontamentos viram terminais (Sólides corrigido).
// ════════════════════════════════════════════════════════════════════════════

import {
  arrayRemove, arrayUnion, collection, deleteDoc, doc, onSnapshot, query, setDoc, where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../firebase/config";

const COL = "excecoesLoteRascunho";

export type LoteEnvioTipo = "whatsapp" | "presencial";

export type LoteEnvio = {
  em: string;            // ISO
  tipo: LoteEnvioTipo;
  por: string;           // pessoaId
  porNome?: string;
};

export type LoteRascunhoDoc = {
  id: string;                  // ${rid}_${empregadoId}
  restaurantId: string;
  empregadoId: string;
  apontamentoChaves: string[]; // formato "${empregadoId}_${date}_${ruleId}"
  atualizadoEm: string;        // ISO
  atualizadoPor: string;       // pessoaId
  atualizadoPorNome?: string;
  // 1º envio (whatsapp ou presencial). Preserva o lote: o box amarelo
  // continua visível com botão "Reenviar".
  enviadoEm?: string;
  enviadoTipo?: LoteEnvioTipo;
  enviadoPor?: string;
  enviadoPorNome?: string;
  // Envios subsequentes. Append-only via arrayUnion.
  reenvios?: LoteEnvio[];
};

export function loteDocId(rid: string, empregadoId: string): string {
  return `${rid}_${empregadoId}`;
}

// Adiciona UMA chave ao lote. Usa arrayUnion atômico do Firestore — múltiplos
// adds concorrentes em qualquer ordem produzem o mesmo array final.
// setDoc com merge:true cria o doc se não existir; senão só faz patch.
export async function adicionarAoLoteRascunhoFirestore(input: {
  restaurantId: string;
  empregadoId: string;
  apontamentoChave: string;
  por: { id: string; nome: string };
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  await setDoc(
    doc(db, COL, id),
    {
      id,
      restaurantId: input.restaurantId,
      empregadoId: input.empregadoId,
      apontamentoChaves: arrayUnion(input.apontamentoChave),
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: input.por.id,
      atualizadoPorNome: input.por.nome,
    },
    { merge: true },
  );
}

// Remove UMA chave do lote — arrayRemove atômico. Se o array ficar vazio,
// o doc continua existindo com apontamentoChaves: [] (UI trata como "sem
// lote"). Pra deletar de vez, usar limparLoteRascunho.
export async function removerDoLoteRascunhoFirestore(input: {
  restaurantId: string;
  empregadoId: string;
  apontamentoChave: string;
  por: { id: string; nome: string };
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  await setDoc(
    doc(db, COL, id),
    {
      apontamentoChaves: arrayRemove(input.apontamentoChave),
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: input.por.id,
      atualizadoPorNome: input.por.nome,
    },
    { merge: true },
  );
}

export async function limparLoteRascunho(input: {
  restaurantId: string;
  empregadoId: string;
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  try {
    await deleteDoc(doc(db, COL, id));
  } catch {
    // ignora: pode não existir
  }
}

// Registra um envio do lote. 1ª vez: seta `enviadoEm`/`enviadoTipo`/etc.
// Vezes seguintes: append em `reenvios[]` (arrayUnion idempotente por
// timestamp). NÃO mexe em apontamentoChaves — o lote continua visível.
export async function registrarEnvioLote(input: {
  restaurantId: string;
  empregadoId: string;
  tipo: LoteEnvioTipo;
  por: { id: string; nome: string };
  jaTinhaEnvio: boolean;   // chamado decide pelo doc atual
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  const agoraIso = new Date().toISOString();
  if (input.jaTinhaEnvio) {
    const entry: LoteEnvio = {
      em: agoraIso,
      tipo: input.tipo,
      por: input.por.id,
      porNome: input.por.nome,
    };
    await setDoc(
      doc(db, COL, id),
      {
        reenvios: arrayUnion(entry),
        atualizadoEm: agoraIso,
        atualizadoPor: input.por.id,
        atualizadoPorNome: input.por.nome,
      },
      { merge: true },
    );
  } else {
    await setDoc(
      doc(db, COL, id),
      {
        enviadoEm: agoraIso,
        enviadoTipo: input.tipo,
        enviadoPor: input.por.id,
        enviadoPorNome: input.por.nome,
        atualizadoEm: agoraIso,
        atualizadoPor: input.por.id,
        atualizadoPorNome: input.por.nome,
      },
      { merge: true },
    );
  }
}

// Listener real-time pra todos os lotes do restaurante. Custa O(empregados
// com lote aberto) — provavelmente ≤ 20. Não precisa de índice composto
// (1 filtro só: restaurantId).
export function ouvirLotesRascunhoDoRestaurante(
  restaurantId: string,
  cb: (docs: LoteRascunhoDoc[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, COL),
    where("restaurantId", "==", restaurantId),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LoteRascunhoDoc));
  });
}
