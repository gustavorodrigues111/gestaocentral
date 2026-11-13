// ════════════════════════════════════════════════════════════════════════════
//  Etiquetas emitidas: controle e baixa
//
//  Lista as etiquetas ATIVAS da unidade por vencimento (vencidas primeiro) e dá
//  baixa pote a pote: "Usada" (consumida) ou "Descartar" (com motivo, base do
//  relatório de desperdício). A baixa pode ser pela lista ou lendo o QR da
//  etiqueta. Histórico dos últimos 7 dias com opção de desfazer.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Trash2, ScanLine, Undo2, Search } from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { noAppSunmi, lerQrNativo, armarTeclaScan, armarCodigoScan } from "../../core/impressao/impressora";
import { ScannerModal } from "./ScannerModal";
import {
  type EtiquetaEmitida, type Faixa, MOTIVOS_DESCARTE, buscarPorToken, darBaixaEtiqueta, diasAteValidade,
  faixaDe, hojeSP, reativarEtiqueta, textoPrazo, tokenDoQr, ultimosDias,
} from "./etiquetasRepo";

type Usuario = { uid?: string | null; nome?: string | null };

const COR_FAIXA: Record<Faixa, string> = {
  vencida: "text-rose-600 dark:text-rose-400",
  hoje: "text-amber-600 dark:text-amber-400",
  amanha: "text-orange-600 dark:text-orange-400",
  semana: "text-gray-600 dark:text-gray-300",
  depois: "text-gray-400",
};

const fmtData = (ymd: string) => ymd.split("-").reverse().slice(0, 2).join("/");
const fmtDataHora = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function EtiquetasEmitidas({ rid, ativas, locais, usuario, podeOperar }: {
  rid: string; ativas: EtiquetaEmitida[]; locais: { id: string; nome: string }[]; usuario: Usuario; podeOperar: boolean;
}) {
  const [visao, setVisao] = useState<"ativas" | "historico">("ativas");
  const [buscando, setBuscando] = useState(false);
  const [localFiltro, setLocalFiltro] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<EtiquetaEmitida | null>(null);
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState("");
  const [historico, setHistorico] = useState<EtiquetaEmitida[]>([]);
  const hoje = hojeSP();

  // Histórico só é consultado quando aberto (baixas dos últimos 7 dias).
  useEffect(() => {
    if (visao !== "historico" || !rid) return;
    return onSnapshot(
      query(collection(db, "etiquetas"), where("restaurantId", "==", rid), where("baixaDia", "in", ultimosDias(7))),
      (s) => setHistorico(s.docs.map((d) => ({ id: d.id, ...d.data() }) as EtiquetaEmitida)
        .sort((a, b) => (b.baixaTs || "").localeCompare(a.baixaTs || ""))),
      () => setHistorico([]),
    );
  }, [visao, rid]);

  const termo = busca.trim().toLowerCase();
  // Seções por urgência; "até 7 dias" e "depois" viram uma só: Próximos dias.
  const secoes = useMemo(() => {
    const grupos: Record<"vencida" | "hoje" | "amanha" | "proximos", { e: EtiquetaEmitida; dias: number }[]> = { vencida: [], hoje: [], amanha: [], proximos: [] };
    for (const e of ativas) {
      if (localFiltro && e.localId !== localFiltro) continue;
      if (termo && !e.produtoNome.toLowerCase().includes(termo) && !e.lote.toLowerCase().includes(termo)) continue;
      const dias = diasAteValidade(e.validade, hoje);
      const f = faixaDe(dias);
      grupos[f === "semana" || f === "depois" ? "proximos" : f].push({ e, dias });
    }
    for (const g of Object.values(grupos)) g.sort((a, b) => a.e.validade.localeCompare(b.e.validade) || a.e.produtoNome.localeCompare(b.e.produtoNome));
    return ([
      ["vencida", "Vencidas", "text-rose-600 dark:text-rose-400"],
      ["hoje", "Vencem hoje", "text-amber-600 dark:text-amber-400"],
      ["amanha", "Amanhã", "text-orange-600 dark:text-orange-400"],
      ["proximos", "Próximos dias", "text-gray-500 dark:text-gray-400"],
    ] as const).map(([k, titulo, cor]) => ({ k, titulo, cor, itens: grupos[k] })).filter((x) => x.itens.length > 0);
  }, [ativas, hoje, termo, localFiltro]);

  async function aoLer(code: string) {
    setScan(false); setMsg("");
    const token = tokenDoQr(code);
    if (!token) { setMsg("Esse QR não é de uma etiqueta de validade."); return; }
    const local = ativas.find((e) => e.qrToken === token);
    if (local) { setAberta(local); return; }
    try {
      const achada = await buscarPorToken(rid, token);
      if (achada) setAberta(achada); else setMsg("Etiqueta não encontrada nesta unidade.");
    } catch { setMsg("Não consegui consultar a etiqueta. Verifique a conexão."); }
  }

  async function lerQr() {
    if (noAppSunmi()) {
      const v = await lerQrNativo();
      if (v) { void aoLer(v); return; }
    }
    setScan(true);
  }

  // Botão físico abre o leitor por câmera; o leitor a laser manda o código pronto.
  const lerQrRef = useRef(lerQr);
  lerQrRef.current = lerQr;
  const aoLerRef = useRef(aoLer);
  aoLerRef.current = aoLer;
  useEffect(() => {
    if (!noAppSunmi()) return;
    const d1 = armarTeclaScan(() => void lerQrRef.current());
    const d2 = armarCodigoScan((c) => void aoLerRef.current(c));
    return () => { d1(); d2(); };
  }, []);

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão para dar baixa em etiquetas.</div>;

  const link = "text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200";

  return (
    <div className="space-y-4 max-w-2xl">
      <button type="button" onClick={() => void lerQr()}
        className="w-full h-14 rounded-xl bg-indigo-600 text-white text-base font-semibold inline-flex items-center justify-center gap-2 active:bg-indigo-700">
        <ScanLine size={20} /> Ler QR da etiqueta
      </button>
      {msg && <div className="text-sm text-amber-700 dark:text-amber-300">{msg}</div>}

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {visao === "ativas" ? `${ativas.length} ${ativas.length === 1 ? "etiqueta ativa" : "etiquetas ativas"}` : "Baixas dos últimos 7 dias"}
        </span>
        <div className="flex items-center gap-4">
          {visao === "ativas" && <button type="button" className={link} onClick={() => { setBuscando(!buscando); setBusca(""); }}><Search size={16} className="inline align-[-3px]" /> Buscar</button>}
          <button type="button" className={link} onClick={() => setVisao(visao === "ativas" ? "historico" : "ativas")}>
            {visao === "ativas" ? "Baixadas" : "Voltar às ativas"}
          </button>
        </div>
      </div>
      {visao === "ativas" && locais.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
          {[{ id: "", nome: "Todos" }, ...locais].map((l) => (
            <button key={l.id || "todos"} type="button" onClick={() => setLocalFiltro(l.id)}
              className={`shrink-0 h-9 px-3.5 rounded-full text-sm ${localFiltro === l.id ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`}>
              {l.nome}
            </button>
          ))}
        </div>
      )}
      {buscando && visao === "ativas" && (
        <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto ou lote"
          className="w-full h-11 px-3 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
      )}

      {visao === "ativas" ? (
        secoes.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">{ativas.length === 0 ? "Nenhuma etiqueta ativa." : "Nada encontrado."}</p>
        ) : secoes.map((sec) => (
          <section key={sec.k}>
            <h3 className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${sec.cor}`}>{sec.titulo} · {sec.itens.length}</h3>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {sec.itens.map(({ e, dias }) => (
                <button key={e.id} type="button" onClick={() => setAberta(e)}
                  className="w-full flex items-center justify-between gap-3 py-3 text-left active:bg-gray-50 dark:active:bg-gray-800/50">
                  <div className="min-w-0">
                    <div className="text-[15px] text-gray-900 dark:text-gray-100 truncate">{e.produtoNome}</div>
                    <div className="text-xs text-gray-400 truncate">{!localFiltro && e.localNome ? `${e.localNome} · ` : ""}{e.conservacaoLabel} · {fmtData(e.validade)}</div>
                  </div>
                  <span className={`text-xs whitespace-nowrap ${sec.k === "proximos" ? "text-gray-400" : sec.cor}`}>{textoPrazo(dias)}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      ) : historico.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">Nenhuma baixa nos últimos 7 dias.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {historico.map((e) => (
            <button key={e.id} type="button" onClick={() => setAberta(e)} className="w-full flex items-center justify-between gap-3 py-3 text-left">
              <div className="min-w-0">
                <div className="text-[15px] text-gray-900 dark:text-gray-100 truncate">{e.produtoNome}</div>
                <div className="text-xs text-gray-400 truncate">{fmtDataHora(e.baixaTs)} · {e.baixaPorNome || "sem nome"}{e.status === "descartada" ? ` · ${e.baixaMotivo || "Outro"}` : ""}</div>
              </div>
              <span className={`text-xs whitespace-nowrap ${e.status === "consumida" ? "text-emerald-600" : "text-rose-500"}`}>
                {e.status === "consumida" ? "Usada" : "Descarte"}
              </span>
            </button>
          ))}
        </div>
      )}

      {aberta && <BaixaEtiquetaModal etiqueta={aberta} usuario={usuario} onClose={() => setAberta(null)} />}
      {scan && <ScannerModal titulo="Ler QR da etiqueta" placeholder="et_…" onDetect={(c) => void aoLer(c)} onClose={() => setScan(false)} />}
    </div>
  );
}

/** Resumo para o Painel: quantas etiquetas venceram, vencem hoje e amanhã. */
export function ResumoEtiquetas({ ativas, onAbrir }: { ativas: EtiquetaEmitida[]; onAbrir: () => void }) {
  const hoje = hojeSP();
  const c = { vencida: 0, hoje: 0, amanha: 0 };
  for (const e of ativas) {
    const f = faixaDe(diasAteValidade(e.validade, hoje));
    if (f === "vencida" || f === "hoje" || f === "amanha") c[f]++;
  }
  const itens: [string, number, string][] = [
    ["Vencidas", c.vencida, "text-rose-600 dark:text-rose-400"],
    ["Vencem hoje", c.hoje, "text-amber-600 dark:text-amber-400"],
    ["Amanhã", c.amanha, "text-orange-600 dark:text-orange-400"],
    ["Ativas", ativas.length, "text-gray-900 dark:text-gray-100"],
  ];
  return (
    <button type="button" onClick={onAbrir}
      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:border-indigo-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Etiquetas da cozinha</span>
        <span className="text-xs text-indigo-600 dark:text-indigo-400">Dar baixa →</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {itens.map(([l, n, cls]) => (
          <div key={l}><div className={`text-2xl font-bold tabular-nums ${n > 0 ? cls : "text-gray-300 dark:text-gray-600"}`}>{n}</div><div className="text-[11px] text-gray-500">{l}</div></div>
        ))}
      </div>
    </button>
  );
}


/** Ficha da etiqueta com as ações de baixa. Usada na lista e após ler o QR. */
export function BaixaEtiquetaModal({ etiqueta: e, usuario, onClose }: { etiqueta: EtiquetaEmitida; usuario: Usuario; onClose: () => void }) {
  const dias = diasAteValidade(e.validade, hojeSP());
  const f = faixaDe(dias);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState<string>(f === "vencida" ? "Vencida" : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function baixar(status: "consumida" | "descartada") {
    setSalvando(true); setErro("");
    try { await darBaixaEtiqueta(e.id, status, usuario, motivo); onClose(); }
    catch { setErro("Não consegui registrar a baixa. Tente de novo."); }
    finally { setSalvando(false); }
  }

  const linha = (rotulo: string, valor: ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-gray-500">{rotulo}</span><span className="text-right text-gray-900 dark:text-gray-100">{valor}</span></div>
  );

  return (
    <Modal title={e.produtoNome} onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3">
        {e.status === "ativa" ? (
          <div className={`text-sm font-semibold ${COR_FAIXA[f]}`}>{textoPrazo(dias)}</div>
        ) : (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-200">
            Já baixada: {e.status === "consumida" ? "usada" : `descartada (${e.baixaMotivo || "Outro"})`} em {fmtDataHora(e.baixaTs)} por {e.baixaPorNome || "—"}.
          </div>
        )}
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {e.localNome && linha("Local", e.localNome)}
          {linha("Conservação", `${e.conservacaoLabel} · ${e.diasValidade} ${e.diasValidade === 1 ? "dia" : "dias"}`)}
          {linha("Validade", fmtData(e.validade) + "/" + e.validade.slice(0, 4))}
          {linha("Manipulado", fmtDataHora(e.impressaoTs))}
          {linha("Responsável", e.manipuladorNome || "—")}
          {linha("Lote", `${e.lote}${e.totalCopias > 1 ? ` · etiqueta ${e.copia} de ${e.totalCopias}` : ""}`)}
        </div>

        {erro && <div className="text-sm text-rose-600">{erro}</div>}

        {e.status !== "ativa" ? (
          <button type="button" onClick={() => void reativarEtiqueta(e.id).then(onClose)}
            className="w-full h-12 rounded-xl border border-gray-300 dark:border-gray-700 text-sm font-medium inline-flex items-center justify-center gap-2"><Undo2 size={16} /> Desfazer baixa</button>
        ) : !descartando ? (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" disabled={salvando} onClick={() => void baixar("consumida")}
              className="h-14 rounded-xl bg-emerald-600 text-white font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"><Check size={18} /> Usada</button>
            <button type="button" disabled={salvando} onClick={() => setDescartando(true)}
              className="h-14 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-600 font-semibold inline-flex items-center justify-center gap-2"><Trash2 size={17} /> Descartar</button>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <div className="text-xs text-gray-500">Motivo do descarte</div>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS_DESCARTE.map((m) => (
                <button key={m} type="button" onClick={() => setMotivo(m)}
                  className={`h-10 px-3 rounded-xl border text-sm ${motivo === m ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200"}`}>{m}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDescartando(false)} className="h-12 rounded-xl border border-gray-300 dark:border-gray-700 text-sm font-medium">Voltar</button>
              <button type="button" disabled={!motivo || salvando} onClick={() => void baixar("descartada")}
                className="h-12 rounded-xl bg-rose-600 text-white text-sm font-semibold disabled:opacity-50">Confirmar descarte</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
