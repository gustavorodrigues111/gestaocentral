// Link pra abrir o currículo de uma candidatura. O upload é feito na página
// PÚBLICA (candidato anônimo), que só guarda o PATH no Storage — nunca chama
// getDownloadURL, porque o READ exige auth. Aqui, no lado do DP (autenticado),
// resolvemos o path → URL no clique. Retrocompat: candidaturas antigas que
// guardaram curriculoUrl direto continuam abrindo.
import { useState } from "react";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage } from "../../core/firebase/config";

export function CurriculoLink({ url, path, className, label = "Currículo (PDF) ↗" }: {
  url?: string | null; path?: string | null; className?: string; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  if (!url && !path) return null;

  async function abrir(e: React.MouseEvent) {
    if (url) return;               // já tem URL: deixa o <a> abrir normal
    e.preventDefault();
    if (!path || busy) return;
    setBusy(true);
    try {
      const u = await getDownloadURL(storageRef(storage, path));
      window.open(u, "_blank", "noopener");
    } catch {
      alert("Não consegui abrir o currículo. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <a href={url || "#"} onClick={abrir} target="_blank" rel="noreferrer" className={className}>
      {busy ? "abrindo…" : label}
    </a>
  );
}
