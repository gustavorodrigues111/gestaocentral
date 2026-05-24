// Editor da mensagem padrão de confirmação de reserva via WhatsApp.
//
// Vive em /configReservas/{rid}.templateConfirmacao. Quando admin clica
// "📱 Confirmar via WhatsApp" no card da reserva, o template é renderizado
// com os dados da reserva (nome, data, hora, pax, salão) e aberto no wa.me.

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import {
  DEFAULT_TEMPLATE_CONFIRMACAO,
  TEMPLATE_CONFIRMACAO_VARIAVEIS,
} from "../../core/types";
import type { ConfiguracaoReservas } from "../../core/types";
import { montarPreviewMensagem } from "./whatsappConfirmacao";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
};

export function TemplateConfirmacaoTab({ restaurantId, podeConfig }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restaurante = restaurants.find(r => r.id === restaurantId);
  const restauranteNome = restaurante?.nome || "Restaurante";

  const [template, setTemplate] = useState<string>("");
  const [templateOriginal, setTemplateOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [okMsg, setOkMsg] = useState("");
  let textareaRef: HTMLTextAreaElement | null = null;

  // Carrega config atual
  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "configReservas", restaurantId));
        const tpl = snap.exists()
          ? ((snap.data() as ConfiguracaoReservas).templateConfirmacao || "")
          : "";
        setTemplate(tpl);
        setTemplateOriginal(tpl);
      } catch (e) {
        console.error("[template] load falhou:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantId]);

  const efetivoUsado = template.trim() || DEFAULT_TEMPLATE_CONFIRMACAO;
  const preview = useMemo(
    () => montarPreviewMensagem(efetivoUsado, restauranteNome),
    [efetivoUsado, restauranteNome],
  );

  const dirty = template !== templateOriginal;

  async function salvar() {
    if (!me) return;
    setErro("");
    setOkMsg("");
    setSaving(true);
    try {
      const snap = await getDoc(doc(db, "configReservas", restaurantId));
      const now = new Date().toISOString();
      if (snap.exists()) {
        // Doc já existe — só atualiza os campos do template
        await setDoc(
          doc(db, "configReservas", restaurantId),
          sanitizeForFirestore({
            templateConfirmacao: template.trim() || undefined,
            atualizadoEm: now,
            atualizadoPor: me.id,
          }),
          { merge: true },
        );
      } else {
        // Cria doc novo com defaults nas outras props (admin ainda não
        // configurou janelas — campo opcional pro template não bloqueia)
        const payload: ConfiguracaoReservas = {
          id: restaurantId,
          restaurantId,
          janelas: [],
          duracaoSlotMin: 90,
          templateConfirmacao: template.trim() || undefined,
          atualizadoEm: now,
          atualizadoPor: me.id,
        };
        await setDoc(doc(db, "configReservas", restaurantId), sanitizeForFirestore(payload));
      }
      setTemplateOriginal(template);
      setOkMsg("✓ Template salvo");
      setTimeout(() => setOkMsg(""), 3000);
    } catch (e) {
      console.error("[template] save falhou:", e);
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function restaurarPadrao() {
    if (!confirm("Substituir pelo template padrão? Você ainda precisa clicar em Salvar pra aplicar.")) return;
    setTemplate(DEFAULT_TEMPLATE_CONFIRMACAO);
  }

  // Insere uma variável na posição atual do cursor do textarea
  function inserirVariavel(tag: string) {
    if (!textareaRef) {
      setTemplate(t => t + tag);
      return;
    }
    const start = textareaRef.selectionStart ?? template.length;
    const end = textareaRef.selectionEnd ?? template.length;
    const novo = template.slice(0, start) + tag + template.slice(end);
    setTemplate(novo);
    // Reposiciona cursor depois da tag inserida
    setTimeout(() => {
      if (!textareaRef) return;
      const pos = start + tag.length;
      textareaRef.focus();
      textareaRef.setSelectionRange(pos, pos);
    }, 0);
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
          📱 Mensagem de confirmação por WhatsApp
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Texto base que você manda pro cliente antes da reserva pra confirmar a presença.
          Quando você clica em <strong>"📱 Confirmar via WhatsApp"</strong> num card de reserva,
          o sistema substitui as variáveis pelos dados dela e abre o WhatsApp.
        </p>
      </div>

      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
          Variáveis disponíveis (clica pra inserir)
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {TEMPLATE_CONFIRMACAO_VARIAVEIS.map(v => (
            <button
              key={v.tag}
              type="button"
              onClick={() => podeConfig && inserirVariavel(v.tag)}
              disabled={!podeConfig}
              className="text-xs px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={v.desc}
            >
              {v.tag}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
          Texto do template
        </label>
        <textarea
          ref={(el) => { textareaRef = el; }}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={7}
          disabled={!podeConfig}
          placeholder={DEFAULT_TEMPLATE_CONFIRMACAO}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono resize-y disabled:opacity-60"
        />
        {!template.trim() && (
          <p className="text-[11px] text-gray-500 mt-1">
            ↑ Deixa em branco pra usar o template padrão (sugestão neutra).
          </p>
        )}
      </div>

      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
          Preview (com dados de exemplo)
        </label>
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-normal">
          {preview}
        </div>
      </div>

      {erro && <div className="text-sm text-rose-600">{erro}</div>}
      {okMsg && <div className="text-sm text-emerald-600 font-semibold">{okMsg}</div>}

      {podeConfig && (
        <div className="flex gap-2 flex-wrap pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button onClick={salvar} disabled={saving || !dirty}>
            {saving ? "Salvando..." : "Salvar template"}
          </Button>
          <Button variant="secondary" onClick={restaurarPadrao} disabled={saving}>
            ↺ Restaurar padrão
          </Button>
          {dirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400 self-center">
              Alterações não salvas
            </span>
          )}
        </div>
      )}
    </div>
  );
}
