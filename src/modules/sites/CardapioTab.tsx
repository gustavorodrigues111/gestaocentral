import { useState, useRef } from "react";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import type { SiteConfig } from "../../core/types";
import { useSiteConfig } from "./useSiteConfig";

type Props = {
  rid: string;
  nomeRestaurante: string;
  podeEditar: boolean;
};

const TAMANHO_MAX_MB = 20;

// Tab Cardápio: upload de PDFs PT + EN no Firebase Storage.
// Cada restaurante tem `cardapios/{rid}/pt.pdf` e `cardapios/{rid}/en.pdf`.
// URLs salvas em sitesConfig pra o site público linkar.
export function CardapioTab({ rid, nomeRestaurante, podeEditar }: Props) {
  const { pessoa: me } = useAuth();
  const { config, loading, erro, save } = useSiteConfig(rid, nomeRestaurante);

  if (loading || !config) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">⚠ Regras Firestore não publicadas</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) return <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">⚠ {erro}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 text-sm text-indigo-900 dark:text-indigo-200">
        <p className="font-semibold mb-1">📋 Cardápios em PDF</p>
        <p className="text-[13px] opacity-90">
          Suba 2 versões — português e inglês. O site público mostra o que você subiu aqui;
          atualizar o PDF atualiza o site na hora. Máx {TAMANHO_MAX_MB}MB cada.
        </p>
      </div>

      <CardapioCard
        rid={rid}
        idioma="pt"
        label="Português"
        bandeira="🇧🇷"
        url={config.cardapioPdfPtUrl}
        atualizadoEm={config.cardapioPdfPtAtualizadoEm}
        atualizadoPor={config.cardapioPdfPtAtualizadoPor}
        podeEditar={podeEditar}
        meId={me?.id || ""}
        onSave={async (parcial) => { if (me) await save(parcial, me.id); }}
      />

      <CardapioCard
        rid={rid}
        idioma="en"
        label="English"
        bandeira="🇺🇸"
        url={config.cardapioPdfEnUrl}
        atualizadoEm={config.cardapioPdfEnAtualizadoEm}
        atualizadoPor={config.cardapioPdfEnAtualizadoPor}
        podeEditar={podeEditar}
        meId={me?.id || ""}
        onSave={async (parcial) => { if (me) await save(parcial, me.id); }}
      />
    </div>
  );
}

function CardapioCard({
  rid, idioma, label, bandeira, url, atualizadoEm, atualizadoPor, podeEditar, meId, onSave,
}: {
  rid: string;
  idioma: "pt" | "en";
  label: string;
  bandeira: string;
  url?: string;
  atualizadoEm?: string;
  atualizadoPor?: string;
  podeEditar: boolean;
  meId: string;
  onSave: (parcial: Partial<SiteConfig>) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File) {
    setErro("");
    if (file.type !== "application/pdf") {
      setErro("Arquivo precisa ser PDF.");
      return;
    }
    const mb = file.size / (1024 * 1024);
    if (mb > TAMANHO_MAX_MB) {
      setErro(`Arquivo muito grande (${mb.toFixed(1)} MB). Máximo: ${TAMANHO_MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    setProgresso(0);
    try {
      const path = `cardapios/${rid}/${idioma}.pdf`;
      const ref = storageRef(storage, path);
      // uploadBytes simples — pra ter progress real usaríamos uploadBytesResumable
      // mas o ganho pra arquivos pequenos não compensa a complexidade.
      setProgresso(25);
      const snap = await uploadBytes(ref, file, {
        contentType: "application/pdf",
        customMetadata: { atualizadoPor: meId, restaurantId: rid },
      });
      setProgresso(75);
      const downloadUrl = await getDownloadURL(snap.ref);
      const now = new Date().toISOString();
      const parcial: Partial<SiteConfig> = idioma === "pt"
        ? {
            cardapioPdfPtUrl: downloadUrl,
            cardapioPdfPtAtualizadoEm: now,
            cardapioPdfPtAtualizadoPor: meId,
          }
        : {
            cardapioPdfEnUrl: downloadUrl,
            cardapioPdfEnAtualizadoEm: now,
            cardapioPdfEnAtualizadoPor: meId,
          };
      await onSave(parcial);
      setProgresso(100);
    } catch (e) {
      console.error(e);
      setErro(e instanceof Error ? e.message : "Erro ao fazer upload");
    } finally {
      setUploading(false);
      // Limpa o input pra permitir re-upload do mesmo arquivo
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remover() {
    if (!podeEditar) return;
    if (!confirm(`Apagar cardápio ${label}? O link some do site público.`)) return;
    setErro("");
    try {
      const path = `cardapios/${rid}/${idioma}.pdf`;
      try {
        await deleteObject(storageRef(storage, path));
      } catch (e) {
        // OK se já não existia
        console.warn("deleteObject:", e);
      }
      const parcial: Partial<SiteConfig> = idioma === "pt"
        ? {
            cardapioPdfPtUrl: undefined,
            cardapioPdfPtAtualizadoEm: undefined,
            cardapioPdfPtAtualizadoPor: undefined,
          }
        : {
            cardapioPdfEnUrl: undefined,
            cardapioPdfEnAtualizadoEm: undefined,
            cardapioPdfEnAtualizadoPor: undefined,
          };
      await onSave(parcial);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao apagar");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{bandeira}</span>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100">{label}</h3>
            <p className="text-[11px] text-gray-500">
              Caminho: <code className="font-mono">cardapios/{rid}/{idioma}.pdf</code>
            </p>
          </div>
        </div>
        {url ? (
          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
            ✓ ativo
          </span>
        ) : (
          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            sem PDF
          </span>
        )}
      </div>

      {url && (
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-2 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              📄 abrir PDF
            </a>
          </div>
          {atualizadoEm && (
            <div className="text-gray-500">
              Atualizado em {new Date(atualizadoEm).toLocaleString("pt-BR")}
              {atualizadoPor && ` por ${atualizadoPor}`}
            </div>
          )}
        </div>
      )}

      {podeEditar && (
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
            disabled={uploading}
            className="block w-full text-sm text-gray-700 dark:text-gray-300
              file:mr-3 file:py-2 file:px-3 file:rounded file:border-0
              file:text-sm file:font-semibold
              file:bg-indigo-50 dark:file:bg-indigo-900/30
              file:text-indigo-700 dark:file:text-indigo-300
              hover:file:bg-indigo-100 disabled:opacity-50"
          />
          {uploading && (
            <div className="space-y-1">
              <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progresso}%` }} />
              </div>
              <p className="text-[11px] text-gray-500">Enviando... {progresso}%</p>
            </div>
          )}
          {erro && <p className="text-xs text-rose-600">⚠ {erro}</p>}
          {url && !uploading && (
            <button onClick={remover} className="text-xs text-rose-600 hover:underline">
              apagar este PDF
            </button>
          )}
        </div>
      )}

      {!podeEditar && !url && (
        <p className="text-xs text-gray-500 italic">Nenhum PDF cadastrado ainda.</p>
      )}
    </div>
  );
}
