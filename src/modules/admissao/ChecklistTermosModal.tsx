// ════════════════════════════════════════════════════════════════════════════
//  Modal — Checklist de termos a assinar
//
//  Aberto pelo botão "📋 Abrir checklist de kit de documentos para
//  assinatura" da subtarefa st_termos_assinatura
//  ("Kit de documentos para assinatura").
//  Mostra cada termo com checkbox + campo de link opcional (URL do PDF
//  assinado, Drive ou Clicksign).
//
//  Os termos vivem em `admissao.termosAssinados`. Quando o array tá vazio
//  (admissão nova ou criada antes desta feature), instancia com o default
//  global de `getTermosAssinaturaDefault()`.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type {
  Admissao, ItemUniforme, KitAreaUniforme, Pessoa, Restaurant, TermoAssinado,
} from "../../core/types";
import {
  atualizarTermoAssinado,
  instanciarTermosAssinados,
  salvarDriveFolder,
} from "../../core/admissao/admissaoHelpers";
import { NovaEntregaModal } from "../uniformes/NovaEntregaModal";
import { isDriveConfigured, driveFolderUrl } from "../../core/google/driveConfig";
import {
  createEmployeeFolderTree, uploadFileToFolder, listFolderFiles, type DriveFile,
} from "../../core/google/driveClient";

type Props = {
  admissao: Admissao;
  pessoa: Pessoa;
  activeRestaurant: Restaurant;
  onClose: () => void;
};

export function ChecklistTermosModal({ admissao, pessoa, activeRestaurant, onClose }: Props) {
  // Inicializa com o existente OU com o default global
  const [termos, setTermos] = useState<TermoAssinado[]>(
    () => instanciarTermosAssinados(admissao.termosAssinados),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // ─── Google Drive (kit de documentos para assinatura) ───
  // Pasta no Drive da conta conectada. Seed do que já tá salvo na admissão.
  const [folder, setFolder] = useState<{ id: string; url: string } | null>(
    admissao.driveFolderId
      ? {
          id: admissao.driveFolderId,
          url: admissao.driveFolderUrl || driveFolderUrl(admissao.driveFolderId),
        }
      : null,
  );
  // Subpasta "docs assinados" (alvo dos uploads dos termos assinados)
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(
    admissao.driveDocsAssinadosFolderId || null,
  );
  // "" | "criando" | "conferindo" | "up_<termoId>"
  const [driveBusy, setDriveBusy] = useState("");
  const [driveErro, setDriveErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [arquivosPasta, setArquivosPasta] = useState<DriveFile[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTermoId, setUploadTermoId] = useState<string | null>(null);

  // Modal de entrega (uniforme/EPI) — aberto pelo botão "Gerar termo"
  const [gerarTermoTipo, setGerarTermoTipo] = useState<"uniforme" | "epi" | null>(null);
  // Carrega lazy itens + kits quando o NovaEntregaModal precisa
  const [itensUniforme, setItensUniforme] = useState<ItemUniforme[]>([]);
  const [kitsAreaUniforme, setKitsAreaUniforme] = useState<KitAreaUniforme[]>([]);
  const [carregandoUniformes, setCarregandoUniformes] = useState(false);
  async function abrirGerarTermo(tipo: "uniforme" | "epi") {
    if (itensUniforme.length === 0 && !carregandoUniformes) {
      setCarregandoUniformes(true);
      try {
        const [iSnap, kSnap] = await Promise.all([
          getDocs(query(collection(db, "itensUniforme"), where("restaurantId", "==", admissao.restaurantId))),
          getDocs(query(collection(db, "kitsAreaUniforme"), where("restaurantId", "==", admissao.restaurantId))),
        ]);
        setItensUniforme(iSnap.docs.map(d => ({ ...d.data(), id: d.id }) as ItemUniforme));
        setKitsAreaUniforme(kSnap.docs.map(d => ({ ...d.data(), id: d.id }) as KitAreaUniforme));
      } finally {
        setCarregandoUniformes(false);
      }
    }
    setGerarTermoTipo(tipo);
  }
  // Quando entrega é criada via NovaEntregaModal, marca o termo correspondente
  // como assinado (com link pendente — DP pode atualizar depois com URL do PDF).
  function marcarTermoEspecialComoAssinado(tipo: "uniforme" | "epi") {
    const now = new Date().toISOString();
    setTermos(prev => prev.map(t => {
      if (t.tipoEspecial !== tipo) return t;
      return {
        ...t,
        assinado: true,
        assinadoEm: now,
        assinadoPor: { id: pessoa.id, nome: pessoa.nome },
      };
    }));
  }

  // Sincroniza com mudanças externas (admissão atualizada em outro lugar)
  useEffect(() => {
    setTermos(instanciarTermosAssinados(admissao.termosAssinados));
  }, [admissao.termosAssinados]);

  const obrigatorios = useMemo(() => termos.filter(t => t.obrigatorio), [termos]);
  const obrigPendentes = obrigatorios.filter(t => !t.assinado).length;
  const totalAssinados = termos.filter(t => t.assinado).length;
  // Conferência: quantos obrigatórios já têm um PDF/link anexado.
  const obrigComAnexo = obrigatorios.filter(t => !!t.link).length;

  function togglarAssinatura(id: string) {
    const now = new Date().toISOString();
    setTermos(prev => prev.map(t => {
      if (t.id !== id) return t;
      const assinado = !t.assinado;
      const merged: TermoAssinado = {
        ...t,
        assinado,
      };
      if (assinado) {
        merged.assinadoEm = now;
        merged.assinadoPor = { id: pessoa.id, nome: pessoa.nome };
      } else {
        delete merged.assinadoEm;
        delete merged.assinadoPor;
      }
      return merged;
    }));
  }

  function atualizarLink(id: string, link: string) {
    setTermos(prev => prev.map(t => {
      if (t.id !== id) return t;
      const merged: TermoAssinado = { ...t };
      if (link.trim()) merged.link = link.trim();
      else delete merged.link;
      return merged;
    }));
  }

  // Garante a árvore de pastas do empregado (pasta [Nome] + subpastas:
  // 1- CONTRATOS, 2 - DOCUMENTOS, docs assinados) dentro da pasta "Empregados
  // Ativos" da empresa. Retorna o id da "docs assinados" (alvo dos uploads).
  // Abre o popup do Google na 1ª vez.
  async function ensureTree(): Promise<string> {
    if (folder?.id && uploadFolderId) return uploadFolderId;
    const parentId = activeRestaurant.driveEmpregadosAtivosFolderId;
    if (!parentId) {
      throw new Error(
        "Configure a pasta 'Empregados Ativos' desta empresa em Admissão → Configurações antes de criar a pasta do empregado.",
      );
    }
    const tree = await createEmployeeFolderTree(parentId, admissao.candidato.nome);
    await salvarDriveFolder(admissao.id, tree.folderId, tree.folderUrl, tree.docsAssinadosFolderId);
    setFolder({ id: tree.folderId, url: tree.folderUrl });
    setUploadFolderId(tree.docsAssinadosFolderId);
    return tree.docsAssinadosFolderId;
  }

  async function criarPasta() {
    setDriveErro("");
    setDriveBusy("criando");
    try {
      await ensureTree();
    } catch (e) {
      setDriveErro(e instanceof Error ? e.message : "Falha ao criar a pasta no Drive.");
    } finally {
      setDriveBusy("");
    }
  }

  async function copiarLink() {
    if (!folder) return;
    try {
      await navigator.clipboard.writeText(folder.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setDriveErro("Não consegui copiar — abra a pasta e copie o link manualmente.");
    }
  }

  async function conferirKit() {
    const alvo = uploadFolderId || folder?.id;
    if (!alvo) return;
    setDriveErro("");
    setDriveBusy("conferindo");
    try {
      setArquivosPasta(await listFolderFiles(alvo));
    } catch (e) {
      setDriveErro(e instanceof Error ? e.message : "Falha ao listar a pasta.");
    } finally {
      setDriveBusy("");
    }
  }

  function pedirArquivo(termoId: string) {
    setUploadTermoId(termoId);
    fileInputRef.current?.click();
  }

  async function onArquivoEscolhido(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";   // permite re-subir o mesmo arquivo
    const termoId = uploadTermoId;
    setUploadTermoId(null);
    if (!file || !termoId) return;
    setDriveErro("");
    setDriveBusy(`up_${termoId}`);
    try {
      const folderId = await ensureTree();
      const uploaded = await uploadFileToFolder(folderId, file);
      if (uploaded.webViewLink) atualizarLink(termoId, uploaded.webViewLink);
    } catch (err) {
      setDriveErro(err instanceof Error ? err.message : "Falha no upload do arquivo.");
    } finally {
      setDriveBusy("");
    }
  }

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      await atualizarTermoAssinado(admissao.id, termos);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="📋 Termos a assinar" onClose={onClose} maxWidth="max-w-xl">
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600 dark:text-gray-400">
          Marca cada termo conforme o candidato vai assinando. Cole o link do
          PDF assinado (Drive, Clicksign) pra deixar registrado.
        </div>

        {/* Input de arquivo escondido — acionado pelo "⬆️ Subir PDF" de cada termo */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={onArquivoEscolhido}
        />

        {/* ─── Painel Google Drive ─── (só aparece se a integração tá configurada) */}
        {isDriveConfigured() && (
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-900/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                📁 Google Drive
              </span>
              {folder && (
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                  pasta criada ✓
                </span>
              )}
            </div>
            {!folder ? (
              <>
                {activeRestaurant.driveEmpregadosAtivosFolderId ? (
                  <p className="text-[11px] text-gray-600 dark:text-gray-400">
                    Cria a pasta <strong>{admissao.candidato.nome}</strong> dentro de
                    "Empregados Ativos" (com subpastas) pra subir os PDFs assinados.
                    Na 1ª vez o Google pede pra autorizar o acesso.
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠ Antes, configure a pasta "Empregados Ativos" desta empresa em{" "}
                    <strong>Admissão → Configurações</strong>.
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={criarPasta}
                  disabled={driveBusy !== "" || !activeRestaurant.driveEmpregadosAtivosFolderId}
                >
                  {driveBusy === "criando" ? "Criando…" : "📁 Criar pasta do empregado no Drive"}
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={copiarLink}>
                  {copiado ? "✓ link copiado" : "📋 Copiar link da pasta"}
                </Button>
                <a
                  href={folder.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  ↗ abrir pasta
                </a>
                <Button size="sm" variant="secondary" onClick={conferirKit} disabled={driveBusy !== ""}>
                  {driveBusy === "conferindo" ? "Conferindo…" : "🔄 Conferir kit"}
                </Button>
              </div>
            )}
            {obrigatorios.length > 0 && (
              <div className="text-[11px] border-t border-indigo-200/60 dark:border-indigo-900/40 pt-1.5">
                Anexos:{" "}
                <span
                  className={
                    obrigComAnexo >= obrigatorios.length
                      ? "text-emerald-700 dark:text-emerald-400 font-semibold"
                      : "text-gray-600 dark:text-gray-400"
                  }
                >
                  {obrigComAnexo} de {obrigatorios.length} termos obrigatórios com PDF/link
                </span>
                {obrigComAnexo < obrigatorios.length && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}· faltam {obrigatorios.length - obrigComAnexo}
                  </span>
                )}
              </div>
            )}
            {arquivosPasta && (
              <div className="text-[11px] text-gray-600 dark:text-gray-400 border-t border-indigo-200/60 dark:border-indigo-900/40 pt-1.5">
                {arquivosPasta.length === 0 ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    Nenhum arquivo na pasta ainda.
                  </span>
                ) : (
                  <>
                    <div className="mb-1">{arquivosPasta.length} arquivo(s) na pasta:</div>
                    <ul className="space-y-0.5">
                      {arquivosPasta.map((a) => (
                        <li key={a.id} className="truncate">
                          📄{" "}
                          {a.webViewLink ? (
                            <a
                              href={a.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              {a.name}
                            </a>
                          ) : (
                            a.name
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {driveErro && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400">{driveErro}</div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {totalAssinados} de {termos.length} assinados
          </span>
          {obrigPendentes > 0 && (
            <span className="text-amber-700 dark:text-amber-400 font-semibold">
              ⚠ {obrigPendentes} obrigatório(s) pendente(s)
            </span>
          )}
          {obrigPendentes === 0 && (
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
              ✓ Todos obrigatórios assinados
            </span>
          )}
        </div>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {termos.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border p-3 ${
                t.assinado
                  ? "bg-emerald-50/40 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/60"
                  : t.obrigatorio
                    ? "bg-white dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"
                    : "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"
              }`}
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={t.assinado}
                  onChange={() => togglarAssinatura(t.id)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${t.assinado ? "line-through text-gray-600 dark:text-gray-400" : "text-gray-900 dark:text-gray-100 font-medium"}`}>
                    {t.nome}
                    {!t.obrigatorio && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">opcional</span>
                    )}
                  </div>
                  {t.assinado && t.assinadoEm && (
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                      ✓ {new Date(t.assinadoEm).toLocaleString("pt-BR", {
                        day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                      {t.assinadoPor?.nome ? ` · por ${t.assinadoPor.nome}` : ""}
                    </div>
                  )}
                </div>
              </label>
              <div className="mt-2 pl-6 space-y-1.5">
                {/* Botão "Gerar termo" pra termos com tipo especial (uniforme/EPI).
                    Abre o modal de entrega — gera PDF + baixa estoque + cria
                    registro de entrega. Termo entra no kit do Clicksign depois. */}
                {t.tipoEspecial && !t.assinado && (
                  <button
                    type="button"
                    onClick={() => abrirGerarTermo(t.tipoEspecial!)}
                    disabled={carregandoUniformes}
                    className="text-[11px] px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-medium"
                  >
                    {carregandoUniformes
                      ? "Carregando catálogo…"
                      : t.tipoEspecial === "uniforme"
                        ? "📦 Gerar termo de uniformes"
                        : "🦺 Gerar termo de EPIs"}
                  </button>
                )}
                {isDriveConfigured() && (
                  <button
                    type="button"
                    onClick={() => pedirArquivo(t.id)}
                    disabled={driveBusy !== ""}
                    className="text-[11px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-medium"
                  >
                    {driveBusy === `up_${t.id}` ? "Subindo…" : "⬆️ Subir PDF pro Drive"}
                  </button>
                )}
                <input
                  type="url"
                  value={t.link || ""}
                  onChange={(e) => atualizarLink(t.id, e.target.value)}
                  placeholder="https://… (link do PDF assinado)"
                  className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
                {t.link && (
                  <a
                    href={t.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5 inline-block"
                  >
                    ↗ abrir link
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      {gerarTermoTipo && (
        <NovaEntregaModal
          tipo={gerarTermoTipo}
          itens={itensUniforme}
          kits={kitsAreaUniforme}
          restaurantId={admissao.restaurantId}
          activeRestaurant={activeRestaurant}
          pessoa={pessoa}
          admissaoContexto={admissao}
          onEntregaCriada={() => marcarTermoEspecialComoAssinado(gerarTermoTipo)}
          onClose={() => setGerarTermoTipo(null)}
        />
      )}
    </Modal>
  );
}
