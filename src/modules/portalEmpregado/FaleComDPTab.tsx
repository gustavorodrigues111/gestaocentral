// ════════════════════════════════════════════════════════════════════════════
//  Fale com DP — aba do Portal do Empregado
//
//  Fluxo: escolhe categoria → escolhe identificar-se ou anônimo → lê o aviso
//  de uso respeitoso → escreve e envia. Mensagem vai pra coleção
//  faleDpMensagens; quem tem portalEmpregado.receberFaleDp recebe na Central
//  de Avisos.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { enviarFaleDp } from "../faleDp/repository";
import type { Cargo, Empregado, FaleDpCategoria } from "../../core/types";
import {
  FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE, FALE_DP_AVISO_USO,
} from "../../core/types";

const CATEGORIAS: FaleDpCategoria[] = ["elogio", "reclamacao", "denuncia", "outros"];

export function FaleComDPTab({
  empregado, cargo, restaurantId,
}: {
  empregado: Empregado;
  cargo: Cargo | null;
  restaurantId: string;
}) {
  const { pessoa } = useAuth();
  const [categoria, setCategoria] = useState<FaleDpCategoria | null>(null);
  const [anonimo, setAnonimo] = useState<boolean | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [erro, setErro] = useState("");

  function reset() {
    setCategoria(null); setAnonimo(null); setTexto(""); setEnviada(false); setErro("");
  }

  async function enviar() {
    if (!categoria || anonimo === null || !texto.trim()) return;
    setEnviando(true); setErro("");
    try {
      await enviarFaleDp({
        restaurantId,
        categoria,
        anonimo,
        texto,
        // Identidade só vai quando NÃO é anônimo.
        autorId: anonimo ? null : (pessoa?.id || empregado.pessoaId || empregado.id),
        autorNome: anonimo ? null : (pessoa?.nome || (empregado as { nome?: string }).nome || null),
        cargoNome: anonimo ? null : (cargo?.nome || null),
      });
      setEnviada(true);
    } catch (e) {
      console.error(e);
      setErro("Não consegui enviar agora. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviada) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">Mensagem enviada</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {anonimo
            ? "Enviada de forma anônima. Obrigado por usar o canal com responsabilidade."
            : "Recebida pela gestão. Obrigado pelo retorno."}
        </p>
        <div className="mt-5">
          <Button variant="secondary" onClick={reset}>Enviar outra mensagem</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">🗣️ Fale com o DP</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Um canal direto pra falar com a gestão. Escolha o tipo, decida se quer
          se identificar e mande sua mensagem.
        </p>
      </div>

      {/* Passo 1 — categoria */}
      <div className="mb-5">
        <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
          1. Sobre o que é?
        </label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIAS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoria(c)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${
                categoria === c
                  ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 dark:border-indigo-600 text-indigo-800 dark:text-indigo-200 font-medium"
                  : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              <span>{FALE_DP_CATEGORIA_ICONE[c]}</span>
              <span>{FALE_DP_CATEGORIA_LABEL[c]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Passo 2 — identificação */}
      {categoria && (
        <div className="mb-5">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            2. Como quer enviar?
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAnonimo(false)}
              className={`px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                anonimo === false
                  ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200 font-medium"
                  : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              🙋 Me identificar
            </button>
            <button
              type="button"
              onClick={() => setAnonimo(true)}
              className={`px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                anonimo === true
                  ? "bg-gray-100 dark:bg-gray-800 border-gray-400 dark:border-gray-600 text-gray-900 dark:text-gray-100 font-medium"
                  : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              🕶️ Anônimo
            </button>
          </div>
        </div>
      )}

      {/* Passo 3 — aviso de uso + mensagem */}
      {categoria && anonimo !== null && (
        <div className="mb-5">
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 p-3 mb-3">
            <p className="text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
              {FALE_DP_AVISO_USO}
            </p>
          </div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            3. Sua mensagem
          </label>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Escreva aqui…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
          />
          <div className="text-[11px] text-gray-400 mt-1 text-right">{texto.length}/2000</div>

          {erro && <p className="text-sm text-rose-600 dark:text-rose-400 mt-2">{erro}</p>}

          <div className="mt-3 flex justify-end">
            <Button onClick={enviar} disabled={!texto.trim() || enviando}>
              {enviando ? "Enviando…" : anonimo ? "Enviar anônimo" : "Enviar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
