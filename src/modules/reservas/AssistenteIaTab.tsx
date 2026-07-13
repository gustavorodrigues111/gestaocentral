// Config do Assistente de IA no WhatsApp (concierge por restaurante).
// Vive em /assistenteWhatsapp/{rid}. Alimenta a IA que atende no WhatsApp:
// diretrizes (do/don't), conhecimento (horário/endereço/links), qual número
// Evolution atende e se o restaurante usa reservas do planejamento.app ou Getin.
//
// Esta é a Fase 1 (config). A ligação da IA no webhook do WhatsApp vem depois.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { AssistenteWhatsappConfig, WhatsappNumero } from "../../core/types";

type Props = { restaurantId: string; podeConfig: boolean; pessoaId: string };

const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
const lbl = "text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1";
const ta = inp + " leading-relaxed";

export function AssistenteIaTab({ restaurantId, podeConfig, pessoaId }: Props) {
  const { pessoa: me } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [erro, setErro] = useState("");
  const [numeros, setNumeros] = useState<WhatsappNumero[]>([]);

  const [ativo, setAtivo] = useState(false);
  const [numeroInstancia, setNumeroInstancia] = useState<string>("");
  const [diretrizes, setDiretrizes] = useState("");
  const [horario, setHorario] = useState("");
  const [endereco, setEndereco] = useState("");
  const [linkSite, setLinkSite] = useState("");
  const [linkCardapio, setLinkCardapio] = useState("");
  const [infoExtra, setInfoExtra] = useState("");
  const [sistemaReservas, setSistemaReservas] = useState<"planejamento" | "getin">("planejamento");
  const [linkGetin, setLinkGetin] = useState("");
  const [confirmacaoAtiva, setConfirmacaoAtiva] = useState(true);

  // Números Evolution disponíveis pra este restaurante (ou sem empresa definida).
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappNumeros"), (snap) => {
      const todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WhatsappNumero);
      setNumeros(todos.filter((n) => n.ativo !== false && (!n.restaurantIds?.length || n.restaurantIds.includes(restaurantId))));
    }, () => setNumeros([]));
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
          setHorario(c.horarioFuncionamento || "");
          setEndereco(c.endereco || "");
          setLinkSite(c.linkSite || "");
          setLinkCardapio(c.linkCardapio || "");
          setInfoExtra(c.infoExtra || "");
          setSistemaReservas(c.sistemaReservas || "planejamento");
          setLinkGetin(c.linkGetin || "");
          setConfirmacaoAtiva(c.confirmacaoAtiva !== false);
        }
      } catch (e) {
        console.error("[assistente-ia] load falhou:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantId]);

  const numeroSelecionadoInvalido = useMemo(
    () => ativo && !numeroInstancia,
    [ativo, numeroInstancia],
  );

  async function salvar() {
    if (!me) { setErro("Sessão inválida"); return; }
    setErro(""); setOkMsg("");
    if (ativo && !numeroInstancia) { setErro("Escolha qual número do WhatsApp vai atender."); return; }
    if (sistemaReservas === "getin" && !linkGetin.trim()) { setErro("Informe o link do Getin (é por onde o cliente reserva)."); return; }
    setSaving(true);
    try {
      const data: AssistenteWhatsappConfig = {
        id: restaurantId,
        restaurantId,
        ativo,
        numeroInstancia: numeroInstancia || null,
        diretrizes: diretrizes.trim() || undefined,
        horarioFuncionamento: horario.trim() || undefined,
        endereco: endereco.trim() || undefined,
        linkSite: linkSite.trim() || undefined,
        linkCardapio: linkCardapio.trim() || undefined,
        infoExtra: infoExtra.trim() || undefined,
        sistemaReservas,
        linkGetin: sistemaReservas === "getin" ? (linkGetin.trim() || null) : null,
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

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 text-xs text-indigo-800 dark:text-indigo-200">
        🤖 A IA atende no WhatsApp usando <b>só</b> as informações e diretrizes cadastradas aqui. Quando não souber ou for algo fora do escopo, ela encaminha pra um humano — nunca inventa.
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
            className={`${inp} ${numeroSelecionadoInvalido ? "border-rose-400" : ""}`}>
            <option value="">— escolher número —</option>
            {numeros.map((n) => <option key={n.id} value={n.id}>{n.nome}{n.descricao ? ` · ${n.descricao}` : ""}</option>)}
          </select>
          {numeros.length === 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Nenhum número do Evolution vinculado a este restaurante. Cadastre/associe um no módulo WhatsApp.</p>
          )}
        </div>
      </section>

      {/* Reservas: planejamento x getin */}
      <section className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4">
        <label className={lbl}>Sistema de reservas deste restaurante</label>
        <div className="flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800/60 max-w-sm">
          {([["planejamento", "planejamento.app"], ["getin", "Getin"]] as const).map(([v, l]) => (
            <button key={v} type="button" disabled={disabled} onClick={() => setSistemaReservas(v)}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors ${sistemaReservas === v ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>{l}</button>
          ))}
        </div>
        {sistemaReservas === "planejamento" ? (
          <p className="text-[11px] text-gray-500">A IA vai poder consultar disponibilidade e criar a reserva pelo WhatsApp (fase 2). Por ora, confirma/cancela reservas.</p>
        ) : (
          <div>
            <p className="text-[11px] text-gray-500 mb-1">A IA não cria reserva — manda o link do Getin e se oferece pra tirar dúvidas.</p>
            <Input label="Link do Getin *" value={linkGetin} disabled={disabled} onChange={(e) => setLinkGetin(e.target.value)} placeholder="https://reservas.getinapp.com.br/..." />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm mt-1">
          <input type="checkbox" checked={confirmacaoAtiva} disabled={disabled} onChange={(e) => setConfirmacaoAtiva(e.target.checked)} />
          <span>Confirmar reservas pelo WhatsApp (a IA pergunta e atualiza o status)</span>
        </label>
      </section>

      {/* Diretrizes */}
      <section className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4">
        <label className={lbl}>Diretrizes da IA (o que ela pode e não pode fazer)</label>
        <textarea value={diretrizes} disabled={disabled} onChange={(e) => setDiretrizes(e.target.value)} rows={6} className={ta}
          placeholder={"Ex.:\n- Seja simpático e trate por você.\n- Nunca prometa desconto nem cortesia.\n- Não fale de preço de prato; mande o link do cardápio.\n- Não confirme evento fechado; encaminhe pra equipe.\n- Se perguntarem sobre trabalho/vaga, mande o link /vagas."} />
        <p className="text-[11px] text-gray-400">Regras livres. A IA sempre segue estas diretrizes; no que fugir delas, encaminha pra um humano.</p>
      </section>

      {/* Conhecimento */}
      <section className="space-y-3 border-t border-gray-200 dark:border-gray-800 pt-4">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Informações que a IA pode responder</div>
        <div>
          <label className={lbl}>Horário de funcionamento</label>
          <textarea value={horario} disabled={disabled} onChange={(e) => setHorario(e.target.value)} rows={2} className={ta} placeholder="Ex.: Terça a domingo, 12h às 23h. Segunda fechado." />
        </div>
        <Input label="Endereço" value={endereco} disabled={disabled} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro, cidade" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Link do site" value={linkSite} disabled={disabled} onChange={(e) => setLinkSite(e.target.value)} placeholder="https://..." />
          <Input label="Link do cardápio" value={linkCardapio} disabled={disabled} onChange={(e) => setLinkCardapio(e.target.value)} placeholder="https://.../cardapio" />
        </div>
        <div>
          <label className={lbl}>Outras informações (políticas, estacionamento, pet, criança…)</label>
          <textarea value={infoExtra} disabled={disabled} onChange={(e) => setInfoExtra(e.target.value)} rows={4} className={ta}
            placeholder={"Ex.:\n- Aceitamos pet na área externa.\n- Estacionamento com manobrista, R$ 25.\n- Espaço kids aos domingos."} />
        </div>
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
