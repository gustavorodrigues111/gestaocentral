// Config da CONFIRMAÇÃO AUTOMÁTICA de reservas (por restaurante).
// Vive em /configReservas/{rid}.confirmacaoAuto. Um cron (api/reservas-confirmacao)
// manda o template de confirmação sozinho (X horas antes OU num horário fixo),
// pelo WhatsApp interno, e (Fase 2) a IA lê a resposta e confirma/escala.
import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { ConfiguracaoReservas, ConfirmacaoAutoConfig } from "../../core/types";

type Props = { restaurantId: string; podeConfig: boolean };

const PADRAO: ConfirmacaoAutoConfig = {
  ativo: false, gatilho: "horas_antes", horasAntes: 2, horarioFixo: "10:00",
  janelaInicio: "09:00", janelaFim: "21:00", origens: [],
  textoAgradece: "Perfeito, {primeiro_nome}! Sua reserva está confirmada. Te esperamos {data} às {hora} 🙌",
  textoNegativo: "Tudo bem, {primeiro_nome}, obrigado por avisar! Qualquer coisa é só chamar. 🙏",
};

const ORIGENS: Array<{ id: "getin" | "interno" | "publico"; label: string }> = [
  { id: "getin", label: "Do GetIn" },
  { id: "interno", label: "Criadas no app" },
  { id: "publico", label: "Do site" },
];

export function ConfirmacaoAutoTab({ restaurantId, podeConfig }: Props) {
  const { pessoa: me } = useAuth();
  const [cfg, setCfg] = useState<ConfirmacaoAutoConfig>(PADRAO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "configReservas", restaurantId));
        const c = snap.exists() ? (snap.data() as ConfiguracaoReservas).confirmacaoAuto : undefined;
        setCfg({ ...PADRAO, ...(c || {}) });
      } catch (e) { console.error("[confirmacaoAuto] load:", e); }
      finally { setLoading(false); }
    })();
  }, [restaurantId]);

  const up = <K extends keyof ConfirmacaoAutoConfig>(k: K, v: ConfirmacaoAutoConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const toggleOrigem = (id: "getin" | "interno" | "publico") => {
    const atuais = cfg.origens || [];
    up("origens", atuais.includes(id) ? atuais.filter((o) => o !== id) : [...atuais, id]);
  };

  async function salvar() {
    if (!me) return;
    setErro(""); setOkMsg(""); setSaving(true);
    try {
      const now = new Date().toISOString();
      await setDoc(doc(db, "configReservas", restaurantId),
        sanitizeForFirestore({ id: restaurantId, restaurantId, confirmacaoAuto: cfg, atualizadoEm: now, atualizadoPor: me.id }),
        { merge: true });
      setOkMsg("✓ Configuração salva"); setTimeout(() => setOkMsg(""), 3000);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando…</div>;

  const inputCls = "px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60";

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">🤖 Confirmação automática</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          O sistema manda sozinho o pedido de confirmação (usa o texto da aba <strong>Mensagem de confirmação</strong>) pelo
          WhatsApp interno. A resposta cai no inbox e, com a IA ligada (em breve), a reserva é confirmada automaticamente
          quando o cliente diz que vem.
        </p>
      </div>

      {/* Liga/desliga */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={cfg.ativo} disabled={!podeConfig} onChange={(e) => up("ativo", e.target.checked)} className="w-4 h-4" />
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Ativar confirmação automática</span>
      </label>

      <div className={cfg.ativo ? "space-y-5" : "space-y-5 opacity-50 pointer-events-none"}>
        {/* Gatilho */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">Quando enviar</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 flex-wrap text-sm">
              <input type="radio" name="gatilho" checked={cfg.gatilho === "horas_antes"} disabled={!podeConfig} onChange={() => up("gatilho", "horas_antes")} />
              <span>Enviar</span>
              <input type="number" min={1} max={72} value={cfg.horasAntes ?? 2} disabled={!podeConfig || cfg.gatilho !== "horas_antes"}
                onChange={(e) => up("horasAntes", Math.max(1, Number(e.target.value) || 1))} className={`${inputCls} w-16`} />
              <span>horas antes de cada reserva</span>
            </label>
            <label className="flex items-center gap-2 flex-wrap text-sm">
              <input type="radio" name="gatilho" checked={cfg.gatilho === "horario_fixo"} disabled={!podeConfig} onChange={() => up("gatilho", "horario_fixo")} />
              <span>Enviar todo dia às</span>
              <input type="time" value={cfg.horarioFixo || "10:00"} disabled={!podeConfig || cfg.gatilho !== "horario_fixo"}
                onChange={(e) => up("horarioFixo", e.target.value)} className={inputCls} />
              <span>pras reservas daquele dia</span>
            </label>
          </div>
        </div>

        {/* Janela diurna */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">Só dispara entre</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md">
            <label className="flex items-center gap-2 text-sm"><span className="w-8 text-gray-500">das</span>
              <input type="time" value={cfg.janelaInicio || "09:00"} disabled={!podeConfig} onChange={(e) => up("janelaInicio", e.target.value)} className={inputCls} /></label>
            <label className="flex items-center gap-2 text-sm"><span className="w-8 text-gray-500">até</span>
              <input type="time" value={cfg.janelaFim || "21:00"} disabled={!podeConfig} onChange={(e) => up("janelaFim", e.target.value)} className={inputCls} /></label>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Se o horário de envio cair fora dessa janela (ex.: de madrugada), segura pro próximo horário válido.</p>
        </div>

        {/* Origens */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">Quais reservas recebem</label>
          <div className="flex gap-2 flex-wrap">
            {ORIGENS.map((o) => {
              const marcado = (cfg.origens || []).length === 0 || (cfg.origens || []).includes(o.id);
              return (
                <button key={o.id} type="button" disabled={!podeConfig} onClick={() => toggleOrigem(o.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${marcado
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900"
                    : "text-gray-500 border-gray-300 dark:border-gray-700"}`}>
                  {marcado ? "✓ " : ""}{o.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Nenhuma marcada = todas. Só reservas ainda <strong>pendentes</strong> recebem.</p>
        </div>

        {/* Respostas automáticas (Fase 2 — IA) */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">Respostas automáticas da IA <span className="normal-case font-normal text-gray-400">(usadas quando a IA estiver ligada)</span></div>
          <div>
            <label className="text-[12px] text-gray-500 block mb-1">Quando o cliente CONFIRMA (positivo)</label>
            <textarea value={cfg.textoAgradece || ""} disabled={!podeConfig} onChange={(e) => up("textoAgradece", e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y disabled:opacity-60" />
          </div>
          <div>
            <label className="text-[12px] text-gray-500 block mb-1">Quando o cliente diz que NÃO vai (a reserva fica pendente pra um humano revisar)</label>
            <textarea value={cfg.textoNegativo || ""} disabled={!podeConfig} onChange={(e) => up("textoNegativo", e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y disabled:opacity-60" />
          </div>
        </div>
      </div>

      {erro && <div className="text-sm text-rose-600">{erro}</div>}
      {okMsg && <div className="text-sm text-emerald-600 font-semibold">{okMsg}</div>}

      {podeConfig && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar configuração"}</Button>
        </div>
      )}
    </div>
  );
}
