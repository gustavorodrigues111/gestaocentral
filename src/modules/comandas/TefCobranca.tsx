// Tela de cobrança no cartão via Smart TEF: cria a cobrança, a maquininha pede
// o cartão, e a gente fica consultando o status até aprovar/recusar.
// Mostra o JSON cru (recolhível) pra calibrar os campos no 1º teste real.
import { useEffect, useRef, useState } from "react";
import { X, CreditCard, Loader2, Check, TriangleAlert } from "lucide-react";
import { tefCriar, tefStatus, tefCancelar, lerTef, type TefLeitura } from "./tefClient";

const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const uid = () => { try { return crypto.randomUUID(); } catch { return "t" + Date.now() + Math.random().toString(36).slice(2); } };

type Fase = "escolher" | "processando" | "aprovado" | "recusado" | "erro";

export function TefCobranca({ valor, serialPos, cpf, nome, onAprovado, onFechar }: {
  valor: number; serialPos?: string; cpf?: string; nome?: string;
  onAprovado: (info: { valor: number; forma: string; nsu?: string; autorizacao?: string; bandeira?: string }) => void;
  onFechar: () => void;
}) {
  const [fase, setFase] = useState<Fase>("escolher");
  const [tipo, setTipo] = useState("CREDIT");   // enum do Smart TEF: CREDIT | DEBIT | PIX | VOUCHER | OTHERS
  const [parcelas, setParcelas] = useState(1);
  const [erro, setErro] = useState("");
  const [leitura, setLeitura] = useState<TefLeitura | null>(null);
  const [criarRaw, setCriarRaw] = useState<unknown>(null);   // resposta do create (pra calibrar o identificador)
  const [mostrarRaw, setMostrarRaw] = useState(false);
  const idRef = useRef<string>("");
  const pararRef = useRef(false);

  useEffect(() => () => { pararRef.current = true; }, []);

  async function cobrar() {
    setErro(""); setFase("processando");
    const chargeId = uid();
    idRef.current = chargeId;
    try {
      const resp = await tefCriar({ value: valor, payment_type: tipo, charge_id: chargeId, serial_pos: serialPos, installments: parcelas, cpf, nome });
      setCriarRaw(resp.data);
      const l0 = lerTef(resp); setLeitura(l0);
      if (l0.identifier) idRef.current = l0.identifier;
      if (!resp.ok && !l0.identifier) { setErro(l0.mensagem || `Falha ao criar a cobrança (HTTP ${resp.httpStatus}).`); setFase("erro"); return; }
      void pollar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao iniciar a cobrança."); setFase("erro"); }
  }

  async function pollar() {
    pararRef.current = false;
    const inicio = Date.now();
    while (!pararRef.current && Date.now() - inicio < 150_000) {
      await new Promise((r) => setTimeout(r, 2500));
      if (pararRef.current) return;
      try {
        const resp = await tefStatus(idRef.current);
        const l = lerTef(resp); setLeitura(l);
        if (l.aprovado) { setFase("aprovado"); onAprovado({ valor, forma: rotuloForma(tipo), nsu: l.nsu, autorizacao: l.autorizacao, bandeira: l.bandeira }); return; }
        if (l.recusado) { setErro(l.mensagem || "Pagamento recusado/cancelado."); setFase("recusado"); return; }
      } catch { /* continua tentando */ }
    }
    if (!pararRef.current) { setErro("Tempo esgotado esperando o pagamento."); setFase("erro"); }
  }

  async function cancelar() {
    pararRef.current = true;
    if (idRef.current) { try { await tefCancelar(idRef.current); } catch { /* ignore */ } }
    onFechar();
  }

  const rotuloForma = (t: string) => t === "DEBIT" ? "Cartão (Débito)" : t === "PIX" ? "Pix (TEF)" : t === "VOUCHER" ? "Voucher" : "Cartão (Crédito)";

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={fase === "processando" ? undefined : onFechar}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><CreditCard size={16} className="text-indigo-500" /> Cartão (TEF)</div>
          {fase !== "processando" && <button onClick={onFechar} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>}
        </div>

        <div className="text-center mb-3">
          <div className="text-[10px] uppercase font-bold text-gray-400">Valor</div>
          <div className="text-3xl font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">{fmtR(valor)}</div>
        </div>

        {fase === "escolher" && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[{ v: "CREDIT", l: "Crédito" }, { v: "DEBIT", l: "Débito" }, { v: "PIX", l: "Pix" }].map((o) => (
                <button key={o.v} onClick={() => setTipo(o.v)} className={`h-11 rounded-xl border-2 font-bold text-sm ${tipo === o.v ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{o.l}</button>
              ))}
            </div>
            {tipo === "CREDIT" && (
              <div className="flex items-center justify-center gap-2 text-sm mb-3">
                <span className="text-gray-500">Parcelas</span>
                <input type="number" min={1} max={12} value={parcelas} onChange={(e) => setParcelas(Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)))} className="w-16 h-9 px-2 text-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
              </div>
            )}
            <button onClick={() => void cobrar()} className="w-full h-12 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center justify-center gap-2"><CreditCard size={18} /> Cobrar na maquininha</button>
          </>
        )}

        {fase === "processando" && (
          <div className="text-center py-3">
            <Loader2 size={40} className="mx-auto text-indigo-500 animate-spin mb-2" />
            <div className="font-semibold text-gray-900 dark:text-gray-100">Aguardando o cartão na maquininha…</div>
            <div className="text-[12px] text-gray-500 mt-0.5">Peça pro cliente passar/aproximar o cartão na Laranjinha. {leitura?.status ? `(status: ${leitura.status})` : ""}</div>
            <button onClick={() => void cancelar()} className="mt-4 h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Cancelar cobrança</button>
          </div>
        )}

        {fase === "aprovado" && (
          <div className="text-center py-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 grid place-items-center mb-2"><Check size={30} className="text-emerald-600 dark:text-emerald-300" /></div>
            <div className="font-bold text-emerald-700 dark:text-emerald-300">Pagamento aprovado!</div>
            <div className="text-[12px] text-gray-500 mt-1">{leitura?.bandeira ? `${leitura.bandeira} · ` : ""}{leitura?.nsu ? `NSU ${leitura.nsu}` : ""}{leitura?.autorizacao ? ` · Aut ${leitura.autorizacao}` : ""}</div>
            <button onClick={onFechar} className="mt-4 w-full h-11 rounded-xl bg-emerald-600 text-white font-bold">Pronto</button>
          </div>
        )}

        {(fase === "recusado" || fase === "erro") && (
          <div className="text-center py-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/40 grid place-items-center mb-2"><TriangleAlert size={28} className="text-rose-600 dark:text-rose-300" /></div>
            <div className="font-bold text-rose-700 dark:text-rose-300">{fase === "recusado" ? "Não aprovado" : "Deu problema"}</div>
            <div className="text-[12px] text-gray-500 mt-1 break-words">{erro}</div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setFase("escolher")} className="flex-1 h-11 rounded-xl border border-gray-300 dark:border-gray-700 font-semibold">Tentar de novo</button>
              <button onClick={onFechar} className="flex-1 h-11 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-semibold">Fechar</button>
            </div>
          </div>
        )}

        {/* Debug (calibração) — mostra a resposta do CREATE e a do STATUS */}
        {(criarRaw || leitura) && (
          <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            <button onClick={() => setMostrarRaw((v) => !v)} className="text-[11px] text-gray-400">{mostrarRaw ? "ocultar" : "ver"} resposta da API</button>
            {mostrarRaw && (
              <div className="space-y-1.5 mt-1">
                {criarRaw != null && <div><div className="text-[10px] font-bold text-gray-400">CREATE (id do pagamento):</div><pre className="text-[10px] bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 overflow-auto max-h-36 text-gray-600 dark:text-gray-300">{JSON.stringify(criarRaw, null, 2)}</pre></div>}
                {leitura && <div><div className="text-[10px] font-bold text-gray-400">STATUS (última consulta):</div><pre className="text-[10px] bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 overflow-auto max-h-36 text-gray-600 dark:text-gray-300">{JSON.stringify(leitura.raw, null, 2)}</pre></div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
