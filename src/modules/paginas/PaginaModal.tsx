import { useState } from "react";
import { Globe, Lock, Upload, FileCheck2 } from "lucide-react";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import type { HostedPage, HostedPageVisibilidade } from "../../core/types";

// Slugs reservados: rotas públicas/estáticas do app que não podem virar página.
const RESERVADOS = new Set([
  "signup", "admissao", "eventos", "trabalhe", "vagas", "vaga", "reservas",
  "politica", "privacidade", "site", "site-preview", "cardapio-pdf", "r", "adm",
  "api", "assets", "portal", "h", "p",
]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LIMITE_BYTES = 900 * 1024;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Dados = Pick<HostedPage, "slug" | "titulo" | "html" | "visibilidade" | "emailsAutorizados" | "senhaHash" | "ativo" | "tamanhoBytes">;

export function PaginaModal({ pagina, slugsUsados, autor, onClose, onSalvar }: {
  pagina: HostedPage | null;
  slugsUsados: Set<string>;
  autor: { id: string; nome: string };
  onClose: () => void;
  onSalvar: (dados: Dados) => Promise<void>;
}) {
  const isNew = !pagina;
  const [titulo, setTitulo] = useState(pagina?.titulo || "");
  const [slug, setSlug] = useState(pagina?.slug || "");
  const [html, setHtml] = useState(pagina?.html || "");
  const [temHtml, setTemHtml] = useState(!!pagina?.html);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [visibilidade, setVisibilidade] = useState<HostedPageVisibilidade>(pagina?.visibilidade || "publico");
  const [emails, setEmails] = useState((pagina?.emailsAutorizados || []).join("\n"));
  const [senha, setSenha] = useState("");
  const [tinhaSenha] = useState(!!pagina?.senhaHash);
  const [mudarSenha, setMudarSenha] = useState(!pagina?.senhaHash);
  const [ativo, setAtivo] = useState(pagina?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");

  const slugNorm = slug.trim().toLowerCase();
  const slugValido = SLUG_RE.test(slugNorm) && !RESERVADOS.has(slugNorm) && (slugNorm === pagina?.slug || !slugsUsados.has(slugNorm));

  async function lerArquivo(file: File) {
    setErr("");
    const texto = await file.text();
    const bytes = new Blob([texto]).size;
    if (bytes > LIMITE_BYTES) { setErr(`HTML tem ${(bytes / 1024).toFixed(0)} KB — o limite é 900 KB. Reduza (ex.: remova imagens embutidas grandes).`); return; }
    setHtml(texto); setTemHtml(true); setNomeArquivo(file.name);
    if (!titulo.trim()) setTitulo(file.name.replace(/\.html?$/i, ""));
  }

  async function salvar() {
    setErr("");
    if (!titulo.trim()) return setErr("Dê um título.");
    if (!slugValido) return setErr("Slug inválido ou já usado. Use só letras minúsculas, números e hífen.");
    if (!temHtml || !html.trim()) return setErr("Suba o arquivo HTML.");
    const bytes = new Blob([html]).size;
    if (bytes > LIMITE_BYTES) return setErr("HTML acima de 900 KB.");
    const listaEmails = emails.split(/[\n,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (visibilidade === "privado" && listaEmails.length === 0 && !(tinhaSenha && !mudarSenha) && !senha.trim()) {
      return setErr("Página privada precisa de ao menos 1 e-mail autorizado ou uma senha.");
    }
    setSalvando(true);
    try {
      let senhaHash: string | null | undefined = pagina?.senhaHash ?? null;
      if (visibilidade === "privado" && mudarSenha) senhaHash = senha.trim() ? await sha256Hex(`${slugNorm}:${senha.trim()}`) : null;
      if (visibilidade === "publico") senhaHash = null;
      await onSalvar({
        slug: slugNorm,
        titulo: titulo.trim(),
        html,
        visibilidade,
        emailsAutorizados: visibilidade === "privado" ? listaEmails : [],
        senhaHash,
        ativo,
        tamanhoBytes: bytes,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar");
      setSalvando(false);
    }
  }
  void autor;

  return (
    <Modal title={isNew ? "Subir HTML" : `Editar — ${pagina.titulo}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {/* Upload */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Arquivo HTML {isNew && "*"}</label>
          <label className="mt-1 flex items-center gap-2 justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 py-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 text-sm text-gray-600 dark:text-gray-300">
            {temHtml ? <><FileCheck2 size={16} className="text-emerald-500" /> {nomeArquivo || "HTML carregado"} · trocar</> : <><Upload size={16} /> escolher .html</>}
            <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); }} />
          </label>
          {temHtml && <p className="text-[11px] text-gray-400 mt-1">{(new Blob([html]).size / 1024).toFixed(0)} KB</p>}
        </div>

        <Input label="Título *" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="ex: Proposta Comercial Puba" />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Endereço *</label>
          <div className="mt-1 flex items-center rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
            <span className="px-2.5 py-2 text-sm text-gray-400 bg-gray-50 dark:bg-gray-800 whitespace-nowrap">planejamento.app/pages/</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="meu-slug" className="flex-1 px-2 py-2 text-sm bg-transparent outline-none text-gray-900 dark:text-gray-100" />
          </div>
          {slugNorm && !slugValido && <p className="text-[11px] text-rose-500 mt-1">Slug inválido ou já usado (só minúsculas, números e hífen).</p>}
        </div>

        {/* Visibilidade */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Acesso</label>
          <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            <button type="button" onClick={() => setVisibilidade("publico")} className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 ${visibilidade === "publico" ? "bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-sm" : "text-gray-500"}`}><Globe size={13} /> Público</button>
            <button type="button" onClick={() => setVisibilidade("privado")} className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 ${visibilidade === "privado" ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}><Lock size={13} /> Privado</button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">{visibilidade === "publico" ? "Qualquer um com o link abre, sem login." : "Só quem você liberar: e-mails autorizados (login) e/ou senha da página."}</p>
        </div>

        {visibilidade === "privado" && (
          <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">E-mails autorizados <span className="text-gray-400">(um por linha)</span></label>
              <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder={"fulano@email.com\nbeltrano@email.com"} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y" />
              <p className="text-[10px] text-gray-400 mt-0.5">A pessoa entra logando com esse e-mail (conta no planejamento.app).</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Senha da página <span className="text-gray-400">(opcional — pra quem não tem conta)</span></label>
              {tinhaSenha && !mudarSenha ? (
                <div className="mt-1 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><Lock size={13} className="text-indigo-500" /> Senha definida <button type="button" onClick={() => setMudarSenha(true)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">trocar</button></div>
              ) : (
                <>
                  <Input value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={tinhaSenha ? "nova senha (vazio = remover)" : "senha (opcional)"} />
                  {tinhaSenha && <button type="button" onClick={() => setMudarSenha(false)} className="text-[11px] text-gray-400 hover:underline mt-0.5">manter a atual</button>}
                </>
              )}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="font-medium">Ativa</span>
          <span className="text-xs text-gray-500">(desativada mostra "página indisponível")</span>
        </label>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : isNew ? "Publicar" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
