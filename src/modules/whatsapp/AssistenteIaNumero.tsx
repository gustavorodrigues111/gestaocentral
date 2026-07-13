// Config do Assistente de IA por NÚMERO do WhatsApp. Vive dentro do card de
// configuração do número (aba Configuração do módulo WhatsApp), junto do bot de
// triagem. Config em /assistenteWhatsapp/{numeroId}.
//
// Conhecimento = o SITE do restaurante escolhido (sitesConfig/{rid}). Endereço,
// horário, cardápio e sistema de reservas NÃO se redigitam aqui — a IA lê de lá.
import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { AssistenteWhatsappConfig, SiteConfig, WhatsappNumero } from "../../core/types";

const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
const lbl = "text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1";
const ta = inp + " leading-relaxed";
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtEndereco(s: SiteConfig | null): string {
  const e = s?.endereco;
  if (!e || !e.rua) return "";
  const l1 = [e.rua, e.numero].filter(Boolean).join(", ");
  const l2 = [e.bairro, e.cidade && e.uf ? `${e.cidade}/${e.uf}` : e.cidade].filter(Boolean).join(" · ");
  return [l1, l2].filter(Boolean).join(" — ");
}
function fmtHorarios(s: SiteConfig | null): { dia: string; texto: string; fechado: boolean }[] {
  const hs = s?.horarios || [];
  if (!hs.length) return [];
  return [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const h = hs.find((x) => x.dia === d);
    if (!h || h.fechado || !(h.turnos || []).length) return { dia: DIAS[d], texto: "fechado", fechado: true };
    return { dia: DIAS[d], texto: h.turnos.map((t) => `${t.abre}–${t.fecha}`).join(", "), fechado: false };
  });
}
function cardapioInfo(s: SiteConfig | null): string {
  if (!s) return "";
  if (s.cardapioModo === "editor") return "no site (cardápio digital)";
  if (s.cardapioPdfPtUrl) return "PDF publicado no site";
  return "";
}
function reservasInfo(s: SiteConfig | null): { texto: string; alerta: boolean } {
  if (!s) return { texto: "—", alerta: false };
  if (s.reservasModo === "externo") return { texto: `Externo (Getin): ${s.reservasUrlExterna || "sem link ⚠️"}`, alerta: !s.reservasUrlExterna };
  return { texto: "planejamento.app — IA poderá criar reserva (fase 2)", alerta: false };
}

export function AssistenteIaNumero({ numero, restaurants }: { numero: WhatsappNumero; restaurants: { id: string; nome: string }[] }) {
  const { pessoa: me } = useAuth();
  const numeroId = numero.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [erro, setErro] = useState("");
  const [site, setSite] = useState<SiteConfig | null>(null);

  const rests = restaurants.filter((r) => (numero.restaurantIds || []).includes(r.id));

  const [ativo, setAtivo] = useState(false);
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [diretrizes, setDiretrizes] = useState("");
  const [infoExtra, setInfoExtra] = useState("");
  const [confirmacaoAtiva, setConfirmacaoAtiva] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "assistenteWhatsapp", numeroId));
        if (snap.exists()) {
          const c = snap.data() as AssistenteWhatsappConfig;
          setAtivo(!!c.ativo);
          setRestaurantId(c.restaurantId || (rests.length === 1 ? rests[0].id : ""));
          setDiretrizes(c.diretrizes || "");
          setInfoExtra(c.infoExtra || "");
          setConfirmacaoAtiva(c.confirmacaoAtiva !== false);
        } else if (rests.length === 1) {
          setRestaurantId(rests[0].id);
        }
      } catch (e) {
        console.error("[assistente-ia] load falhou:", e);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroId]);

  // Site do restaurante escolhido = base de conhecimento.
  useEffect(() => {
    if (!restaurantId) { setSite(null); return; }
    const u = onSnapshot(doc(db, "sitesConfig", restaurantId), (snap) => {
      setSite(snap.exists() ? ({ id: snap.id, ...snap.data() } as SiteConfig) : null);
    }, () => setSite(null));
    return () => u();
  }, [restaurantId]);

  async function salvar() {
    if (!me) { setErro("Sessão inválida"); return; }
    setErro(""); setOkMsg("");
    if (ativo && !restaurantId) { setErro("Escolha de qual restaurante a IA usa as informações (site)."); return; }
    setSaving(true);
    try {
      const data: AssistenteWhatsappConfig = {
        id: numeroId,
        numeroId,
        restaurantId: restaurantId || null,
        ativo,
        diretrizes: diretrizes.trim() || undefined,
        infoExtra: infoExtra.trim() || undefined,
        confirmacaoAtiva,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: me.id,
      };
      await setDoc(doc(db, "assistenteWhatsapp", numeroId), sanitizeForFirestore(data), { merge: true });
      setOkMsg("Salvo ✓");
      setTimeout(() => setOkMsg(""), 2500);
    } catch (e) {
      setErro("Erro ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-xs text-gray-400 py-2">Carregando assistente…</div>;

  const endereco = fmtEndereco(site);
  const horarios = fmtHorarios(site);
  const cardapio = cardapioInfo(site);
  const reservas = reservasInfo(site);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-500">
        🤖 A IA atende neste número usando as informações do <b>site</b> do restaurante + as diretrizes abaixo. No que não souber ou fugir do escopo, encaminha pra um humano.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        <span className="font-medium">IA atende neste número</span>
      </label>

      <div>
        <label className={lbl}>Restaurante (de qual site a IA tira as informações)</label>
        {rests.length === 0 ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">Este número não está vinculado a nenhum restaurante. Vincule um acima (em “Empresas”) pra a IA ter site/cardápio/horário.</p>
        ) : (
          <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} className={inp}>
            <option value="">— escolher —</option>
            {rests.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmacaoAtiva} onChange={(e) => setConfirmacaoAtiva(e.target.checked)} />
        <span>Confirmar reservas pelo WhatsApp (a IA pergunta e atualiza o status)</span>
      </label>

      {/* O que a IA sabe pelo site (read-only) */}
      {restaurantId && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">O que a IA sabe pelo site</div>
            <a href={`/site/${restaurantId}`} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">ver site ↗</a>
          </div>
          {!site ? (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
              ⚠️ Esse restaurante ainda não tem site configurado. A IA fica sem endereço/horário/cardápio até montar o site (módulo Sites). Use as “informações extras” abaixo enquanto isso.
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 text-xs">
              <Linha rotulo="📍 Endereço" valor={endereco || "—"} />
              <div className="px-3 py-2">
                <div className="font-semibold text-gray-600 dark:text-gray-400 mb-1">🕒 Horário</div>
                {horarios.length ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {horarios.map((h) => (
                      <div key={h.dia} className={`flex justify-between ${h.fechado ? "text-gray-400" : "text-gray-700 dark:text-gray-300"}`}>
                        <span className="font-medium">{h.dia}</span><span>{h.texto}</span>
                      </div>
                    ))}
                  </div>
                ) : <span className="text-gray-400">—</span>}
              </div>
              <Linha rotulo="📖 Cardápio" valor={cardapio || "não publicado ⚠️"} />
              <Linha rotulo="📞 Telefone" valor={site.telefone || "—"} />
              <Linha rotulo="🗓️ Reservas" valor={reservas.texto} alerta={reservas.alerta} />
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-1">Pra mudar endereço/horário/cardápio, edite no módulo <b>Sites</b>.</p>
        </div>
      )}

      <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-1.5">
        <label className={lbl}>Diretrizes da IA (o que pode e não pode fazer)</label>
        <textarea value={diretrizes} onChange={(e) => setDiretrizes(e.target.value)} rows={5} className={ta}
          placeholder={"Ex.:\n- Seja simpático, trate por você.\n- Nunca prometa desconto/cortesia.\n- Não fale preço de prato; mande o link do cardápio.\n- Se perguntarem de vaga, mande o link /vagas."} />
      </div>

      <div className="space-y-1.5">
        <label className={lbl}>Informações extras (o que não está no site)</label>
        <textarea value={infoExtra} onChange={(e) => setInfoExtra(e.target.value)} rows={3} className={ta}
          placeholder={"Ex.: aceita pet na área externa; estacionamento com manobrista R$25; espaço kids aos domingos."} />
      </div>

      {erro && <div className="text-xs text-rose-600">{erro}</div>}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void salvar()} disabled={saving}>{saving ? "Salvando…" : "💾 Salvar assistente"}</Button>
        {okMsg && <span className="text-xs text-emerald-600">{okMsg}</span>}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="px-3 py-2 flex justify-between gap-3">
      <span className="font-semibold text-gray-600 dark:text-gray-400 shrink-0">{rotulo}</span>
      <span className={`text-right ${alerta ? "text-amber-600 dark:text-amber-400" : "text-gray-700 dark:text-gray-300"}`}>{valor}</span>
    </div>
  );
}
