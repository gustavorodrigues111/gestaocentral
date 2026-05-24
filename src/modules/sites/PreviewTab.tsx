// Preview do site público dentro do admin — via iframe pra isolar
// estilos. Tem botão pra abrir em nova aba e seletor de viewport
// (desktop/mobile) pra testar responsividade.

import { useState } from "react";
import { useSiteConfig } from "./useSiteConfig";

type Props = {
  rid: string;
  nomeRestaurante: string;
};

type Viewport = "desktop" | "mobile";

export function PreviewTab({ rid, nomeRestaurante }: Props) {
  const { config, loading, erro } = useSiteConfig(rid, nomeRestaurante);
  const [viewport, setViewport] = useState<Viewport>("desktop");

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold mb-1">⚠ Regras Firestore não publicadas</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (!config) return <div className="text-sm text-gray-500">Sem configuração — vai na aba Geral.</div>;

  const url = `/site/${config.slug}`;
  const naoPublicado = !config.publicado;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">URL:</span>
          <code className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-xs">
            {window.location.origin}{url}
          </code>
          <a href={url} target="_blank" rel="noreferrer"
             className="text-xs text-indigo-600 hover:underline">
            abrir ↗
          </a>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewport("desktop")}
            className={`px-3 py-1 text-xs rounded ${viewport === "desktop" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}
          >
            🖥️ Desktop
          </button>
          <button
            onClick={() => setViewport("mobile")}
            className={`px-3 py-1 text-xs rounded ${viewport === "mobile" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}
          >
            📱 Mobile
          </button>
        </div>
      </div>

      {naoPublicado && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
          ⚠ Site está marcado como <strong>não publicado</strong>. O preview aqui mostra como ele
          ficará, mas a URL pública vai retornar "em manutenção" pra qualquer um que tentar
          abrir. Marca como publicado na aba Geral quando estiver pronto.
        </div>
      )}

      <div className="rounded-xl border-2 border-gray-300 dark:border-gray-700 overflow-hidden bg-gray-100 dark:bg-gray-900">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          </div>
          <span className="font-mono ml-2">{url}</span>
        </div>
        <div style={{
          display: "flex", justifyContent: "center",
          background: "#e5e7eb",
          padding: viewport === "mobile" ? "20px" : 0,
        }}>
          <iframe
            // Força reload com timestamp pra refletir mudanças no siteConfig
            key={config.updatedAt}
            src={url}
            title="Preview do site"
            style={{
              width: viewport === "mobile" ? 390 : "100%",
              height: "75vh",
              border: "none",
              backgroundColor: "#ffffff",
              boxShadow: viewport === "mobile" ? "0 4px 16px rgba(0,0,0,0.15)" : "none",
              borderRadius: viewport === "mobile" ? 12 : 0,
            }}
          />
        </div>
      </div>

      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Mudanças nas outras abas refletem aqui em segundos (precisa salvar primeiro).
      </p>
    </div>
  );
}
