// ════════════════════════════════════════════════════════════════════════════
//  Fila central de impressão de etiquetas (igual Comandas)
//
//  Uma etiqueta emitida de QUALQUER dispositivo (celular, tablet, outro PC) é
//  gravada aqui como um "pedido de impressão". O app do caixa (Electron), que
//  fica ligado com a impressora de etiqueta USB, escuta a fila e imprime sozinho
//  na impressora dele — sem diálogo, sem depender do dispositivo que emitiu.
//
//  O pedido guarda só os DADOS da etiqueta (não a imagem): o caixa re-desenha a
//  etiqueta no tamanho da bobina DELE e imprime. Assim o doc fica pequeno e o
//  formato físico é o configurado no caixa.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { desenharEtiqueta, larguraPx, type Bobina } from "../../core/impressao/etiquetaTermica";
import { imprimirEtiquetas, noAppEtiqueta } from "../../core/impressao/impressora";
import { blocosValidade } from "./etiquetaValidade";
import { urlEtiqueta } from "./etiquetasRepo";

const COL = "etiquetaFila";
// Não imprime pedidos antigos: se o caixa ficou fora do ar e volta, não despeja
// um monte de etiquetas velhas. Pedido com mais de 15 min vira "expirado".
const FRESCOR_MS = 15 * 60 * 1000;

// Dimensões por id de bobina (mesma lista da UI).
const DIM: Record<string, Bobina> = {
  "58x40": { larguraMm: 58, alturaMm: 40 }, "55x55": { larguraMm: 55, alturaMm: 55 },
  "58x60": { larguraMm: 58, alturaMm: 60 }, "60x40": { larguraMm: 60, alturaMm: 40 },
  "60x60": { larguraMm: 60, alturaMm: 60 }, "100x50": { larguraMm: 100, alturaMm: 50 },
  "100x100": { larguraMm: 100, alturaMm: 100 },
};

export type EtiquetaFilaJob = {
  restaurantId: string;
  produtoNome: string; metodoLabel: string; dias: number;
  manipulacaoIso: string; validadeYmd: string; responsavel: string;
  lote: string; empresa: string; cnpj?: string | null; qrTokens: string[];
  criadoPorUid?: string | null; criadoPorNome?: string | null;
};

type FilaDoc = {
  id: string; status?: string; criadoEm?: string;
  produtoNome?: string; metodoLabel?: string; dias?: number;
  manipulacaoIso?: string; validadeYmd?: string; responsavel?: string;
  lote?: string; empresa?: string; cnpj?: string | null; qrTokens?: string[];
};

function deviceId(): string {
  try {
    let id = localStorage.getItem("etiq_device_id");
    if (!id) { id = "dev_" + Math.random().toString(36).slice(2, 10); localStorage.setItem("etiq_device_id", id); }
    return id;
  } catch { return "dev_anon"; }
}

/** Grava o pedido de impressão para o caixa imprimir (fila central). */
export async function enfileirarEtiqueta(job: EtiquetaFilaJob): Promise<void> {
  await addDoc(collection(db, COL), {
    ...job, cnpj: job.cnpj ?? null, criadoPorUid: job.criadoPorUid ?? null, criadoPorNome: job.criadoPorNome ?? null,
    status: "pendente", criadoEm: new Date().toISOString(), dispositivo: deviceId(),
  });
}

function bobinaDoCaixa(): Bobina {
  let id = "58x40";
  try { id = localStorage.getItem("etiq_bobina") || "58x40"; } catch { /* sem storage */ }
  return DIM[id] || DIM["58x40"];
}

async function imprimirJob(j: FilaDoc): Promise<{ ok: boolean; erro?: string }> {
  try {
    const bobina = bobinaDoCaixa();
    const largura = larguraPx(bobina, false);
    const manipulacao = new Date(j.manipulacaoIso || Date.now());
    const validade = new Date(String(j.validadeYmd || "") + "T12:00:00");
    const tokens = Array.isArray(j.qrTokens) && j.qrTokens.length ? j.qrTokens : [""];
    const canvases = await Promise.all(tokens.map((tk) => desenharEtiqueta(blocosValidade({
      produto: j.produtoNome || "", metodo: j.metodoLabel || "", dias: Number(j.dias) || 0,
      manipulacao, validade, responsavel: j.responsavel || "", lote: j.lote || "",
      empresa: j.empresa || "", cnpj: j.cnpj || null, qr: tk ? urlEtiqueta(tk) : "https://planejamento.app/e/-",
    }), bobina, largura)));
    const r = await imprimirEtiquetas(canvases, bobina, "etiqueta-local");
    return { ok: r.ok, erro: r.erro };
  } catch (e) { return { ok: false, erro: String((e as Error)?.message || e) }; }
}

export type FilaStatus = { ativo: boolean; pendentes: number; imprimindo: boolean; ultimoErro: string | null; ultimoOkEm: string | null };

/**
 * No app do caixa (Electron com a ponte de etiqueta), escuta a fila e imprime
 * cada pedido pendente na impressora de etiqueta do caixa. Fora do caixa (sem a
 * ponte), o hook não imprime — o dispositivo só enfileira. Retorna o estado da
 * fila pra mostrar um indicador no caixa (pendentes, imprimindo, erro).
 */
export function useFilaEtiquetasCaixa(rid: string | null | undefined): FilaStatus {
  const ativo = typeof window !== "undefined" && noAppEtiqueta();
  const [status, setStatus] = useState<FilaStatus>({ ativo, pendentes: 0, imprimindo: false, ultimoErro: null, ultimoOkEm: null });
  const processando = useRef(false);
  useEffect(() => {
    if (!rid || !ativo) { setStatus((s) => ({ ...s, ativo })); return; }
    // Query por um campo só (sempre indexado) e filtra status no cliente — evita
    // depender de índice composto, que falharia calado e nada imprimiria.
    const qy = query(collection(db, COL), where("restaurantId", "==", rid));
    const un = onSnapshot(qy, (snap) => {
      const pend = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FilaDoc, "id">) })).filter((j) => j.status === "pendente");
      setStatus((s) => ({ ...s, ativo: true, pendentes: pend.length }));
      void processar(pend);
    }, (e) => { console.error("[fila-etiquetas] erro ao ouvir a fila:", e); setStatus((s) => ({ ...s, ultimoErro: String((e as Error)?.message || e) })); });
    return () => un();

    async function processar(jobs: FilaDoc[]) {
      if (processando.current) return;          // uma rodada por vez (evita corrida local)
      processando.current = true;
      setStatus((s) => ({ ...s, imprimindo: true }));
      try {
        for (const j of jobs.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)))) {
          const velho = Date.now() - new Date(j.criadoEm || 0).getTime() > FRESCOR_MS;
          // Reivindica o pedido de forma atômica (pendente → imprimindo). Se outro
          // caixa já pegou, ou expirou, pula.
          let meu = false;
          try {
            await runTransaction(db, async (tx) => {
              const ref = doc(db, COL, j.id);
              const s = await tx.get(ref);
              if (!s.exists() || s.data()?.status !== "pendente") { meu = false; return; }
              if (velho) { tx.update(ref, { status: "expirado", motivo: "Pedido antigo — caixa estava fora do ar.", resolvidoEm: new Date().toISOString() }); meu = false; return; }
              tx.update(ref, { status: "imprimindo", claimedBy: deviceId(), claimedAt: new Date().toISOString() });
              meu = true;
            });
          } catch (e) { console.error("[fila-etiquetas] claim falhou:", e); meu = false; }
          if (!meu) continue;
          const res = await imprimirJob(j);
          if (res.ok) setStatus((s) => ({ ...s, ultimoErro: null, ultimoOkEm: new Date().toISOString() }));
          else { console.error("[fila-etiquetas] impressão falhou:", res.erro); setStatus((s) => ({ ...s, ultimoErro: res.erro || "Falha na impressão." })); }
          try {
            await runTransaction(db, async (tx) => {
              const ref = doc(db, COL, j.id);
              tx.update(ref, res.ok
                ? { status: "impresso", impressoEm: new Date().toISOString(), impressoPor: deviceId() }
                : { status: "erro", motivo: res.erro || "Falha na impressão.", resolvidoEm: new Date().toISOString() });
            });
          } catch { /* status não gravou: o próximo snapshot reavalia */ }
        }
      } finally { processando.current = false; setStatus((s) => ({ ...s, imprimindo: false })); }
    }
  }, [rid, ativo]);
  return status;
}
