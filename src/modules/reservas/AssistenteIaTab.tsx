// Config do Assistente de IA no WhatsApp (concierge por restaurante).
// Vive em /assistenteWhatsapp/{rid}.
//
// Fonte de conhecimento = o SITE (sitesConfig/{rid}). Endereço, horário,
// cardápio e sistema de reservas NÃO se redigitam aqui — a IA lê do site.
// Aqui só se configura: liga/desliga, número que atende, diretrizes (do/don't)
// e infos extras que não estão no site.
import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { AssistenteWhatsappConfig, SiteConfig, WhatsappNumero } from "../../core/types";

type Props = { restaurantId: string; podeConfig: boolean; pessoaId: string };

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
function reservasInfo(s: SiteConfig | null): { texto: string; getin: boolean } {
  if (!s) return { texto: "—", getin: false };
  if (s.reservasModo === "externo") return { texto: `Externo (Getin): ${s.reservasUrlExterna || "sem link ⚠️"}`, getin: true };
  return { texto: "planejamento.app — a IA poderá consultar disponibilidade e criar reserva (fase 2)", getin: false };
}

export function AssistenteIaTab({ restaurantId, podeConfig, pessoaId }: Props) {
  const { pessoa: me } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [erro, setErro] = useState("");
  const [numeros, setNumeros] = useState<WhatsappNumero[]>([]);
  const [site, setSite] = useState<SiteConfig | null>(null);

  const [ativo, setAtivo] = useState(false);
  const [numeroInstancia, setNumeroInstancia] = useState<string>("");
  const [diretrizes, setDiretrizes] = useState("");
  const [infoExtra, setInfoExtra] = useState("");
  const [confirmacaoAtiva, setConfirmacaoAtiva] = useState(true);

  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappNumeros"), (snap) => {
      const todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WhatsappNumero);
      setNumeros(todos.filter((n) => n.ativo !== false && (!n.restaurantIds?.length || n.restaurantIds.includes(restaurantId))));
    }, () => setNumeros([]));
    return () => u();
  }, [restaurantId]);

  useEffect(() => {
    const u = onSnapshot(doc(db, "sitesConfig", restaurantId), (snap) => {
      setSite(snap.exists() ? ({ id: snap.id, ...snap.data() } as SiteConfig) : null);
    }, () => setSite(null));
    return () => u();
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "assistenteWhatsapp", restaurantId));
        if (snap.exists()) {
          const c = snap.data() as AssistenteWhatsappConfig;
          setAtivo(!!c.ativo);
          setNumeroInstancia(c.numeroInstancia || "");
          setDiretrizes(c.diretrizes || "");
          setInfoExtra(c.infoExtra || "");
          setConfirmacaoAtiva(c.confirmacaoAtiva !== false);
        }
      } catch (e) {
        console.error("[assistente-ia] load falhou:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantId]);

  async function salvar() {
    if (!me) { setErro("Sessão inválida"); return; }
    setErro(""); setOkMsg("");
    if (ativo && !numeroInstancia) { setErro("Escolha qual número do WhatsApp vai atender."); return; }
    setSaving(true);
    try {
      const data: AssistenteWhatsappConfig = {
        id: restaurantId,
        restaurantId,
        ativo,
        numeroInstancia: numeroInstancia || null,
        diretrizes: diretrizes.trim() || undefined,
        infoExtra: infoExtra.trim() || undefined,
        confirmacaoAtiva,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: pessoaId || me.id,
      };
      await setDoc(doc(db, "assistenteWhatsapp", restaurantId), sanitizeForFirestore(data), { merge: true });
      setOkMsg("Salvo ✓");
      setTimeout(() => setOkMsg(""), 2500);
    } catch (e) {
      setErro("Erro ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando…</div>;

  const disabled = !podeConfig;
  const endereco = fmtEndereco(site);
  const horarios = fmtHorarios(site);
  const cardapio = cardapioInfo(site);
  const reservas = reservasInfo(site);
  const temSite = !!site;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 text-xs text-indigo-800 dark:text-indigo-200">
        🤖 A IA atende no WhatsApp usando as informações do <b>seu site</b> + as diretrizes abaixo. Quando não souber ou for fora do escopo, encaminha pra um humano — nunca inventa.
      </div>

      {/* Liga/desliga + número */}
      <section className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ativo} disabled={disabled} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="font-medium">Assistente de IA ativo no WhatsApp</span>
        </label>
        <div>
          <label className={lbl}>Número que atende</label>
          <select value={numeroInstancia} disabled={disabled} onChange={(e) => setNumeroInstancia(e.target.value)}
            className={`${inp} ${ativo && !numeroInstancia ? "border-rose-400" : ""}`}>
            <option value="">— escolher número —</option>
            {numeros.map((n) => <option key={n.id} value={n.id}>{n.nome}{n.descricao ? ` · ${n.descricao}` : ""}</option>)}
          </select>
          {numeros.length === 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Nenhum número do Evolution vinculado a este restaurante. Cadastre/associe um no módulo WhatsApp.</p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmacaoAtiva} disabled={disabled} onChange={(e) => setConfirmacaoAtiva(e.target.checked)} />
          <span>Confirmar reservas pelo WhatsApp (a IA pergunta e atualiza o status)</span>
        </label>
      </section>

      {/* O que a IA já sabe pelo site (read-only) */}
      <section className="border-t border-gray-200 dark:border-gray-800 pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">O que a IA sabe pelo site</div>
          <a href={`/site/${restaurantId}`} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">ver site ↗</a>
        </div>
        {!temSite ? (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
            ⚠️ Este restaurante ainda não tem site configurado. A IA não terá endereço, horário nem cardápio pra responder até você montar o site (módulo Sites). Enquanto isso, use as “informações extras” abaixo.
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
            <LinhaInfo rotulo="📍 Endereço" valor={endereco || "—"} />
            <div className="px-3 py-2">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">🕒 Horário de funcionamento</div>
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
            <LinhaInfo rotulo="📖 Cardápio" valor={cardapio || "não publicado ⚠️"} />
            <LinhaInfo rotulo="📞 Telefone" valor={site?.telefone || "—"} />
            <LinhaInfo rotulo="🗓️ Reservas" valor={reservas.texto} alerta={reservas.getin && !site?.reservasUrlExterna} />
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-1.5">Pra mudar endereço, horário ou cardápio, edite no módulo <b>Sites</b> — a IA sempre usa a versão de lá.</p>
      </section>

      {/* Diretrizes */}
      <section className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4">
        <label className={lbl}>Diretrizes da IA (o que ela pode e não pode fazer)</label>
        <textarea value={diretrizes} disabled={disabled} onChange={(e) => setDiretrizes(e.target.value)} rows={6} className={ta}
          placeholder={"Ex.:\n- Seja simpático e trate por você.\n- Nunca prometa desconto nem cortesia.\n- Não fale preço de prato; mande o link do cardápio.\n- Não confirme evento fechado; encaminhe pra equipe.\n- Se perguntarem de vaga, mande o link /vagas."} />
        <p className="text-[11px] text-gray-400">Regras livres. A IA sempre segue estas diretrizes; no que fugir delas, encaminha pra um humano.</p>
      </section>

      {/* Infos extras (não estão no site) */}
      <section className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4">
        <label className={lbl}>Informações extras (o que a IA precisa saber e não está no site)</label>
        <textarea value={infoExtra} disabled={disabled} onChange={(e) => setInfoExtra(e.target.value)} rows={4} className={ta}
          placeholder={"Ex.:\n- Aceitamos pet na área externa.\n- Estacionamento com manobrista, R$ 25.\n- Espaço kids aos domingos."} />
      </section>

      {erro && <div className="text-sm text-rose-600">{erro}</div>}
      {podeConfig && (
        <div className="flex items-center gap-3 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          {okMsg && <span className="text-sm text-emerald-600">{okMsg}</span>}
        </div>
      )}
    </div>
  );
}

function LinhaInfo({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="px-3 py-2 flex justify-between gap-3">
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 shrink-0">{rotulo}</span>
      <span className={`text-right ${alerta ? "text-amber-600 dark:text-amber-400" : "text-gray-700 dark:text-gray-300"}`}>{valor}</span>
    </div>
  );
}
