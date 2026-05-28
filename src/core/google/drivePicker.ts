// ════════════════════════════════════════════════════════════════════════════
//  Google Picker — seletor de pasta do Drive
//
//  Usado nas Configurações de Admissão pra apontar, uma vez por empresa, a
//  pasta "Empregados Ativos" onde o app vai criar a pasta de cada empregado.
//
//  Com o escopo drive.file, o app não enxerga o Drive todo — mas o Picker é
//  uma superfície hospedada pelo Google: o usuário navega e seleciona a pasta,
//  e essa seleção concede ao app acesso (drive.file) àquela pasta. Depois disso
//  o app consegue criar filhos lá dentro.
//
//  Carrega gapi (apis.google.com/js/api.js) sob demanda + a lib "picker".
// ════════════════════════════════════════════════════════════════════════════

import { GOOGLE_APP_ID, GOOGLE_PICKER_API_KEY } from "./driveConfig";
import { requestAccessToken } from "./driveClient";

// ─── Tipagem mínima do gapi + Google Picker (sem puxar @types) ──────────────
type PickerDoc = { id: string; name: string };
type PickerData = { action: string; docs?: PickerDoc[] };

interface DocsView {
  setIncludeFolders(b: boolean): DocsView;
  setSelectFolderEnabled(b: boolean): DocsView;
  setMimeTypes(m: string): DocsView;
  setParent(folderId: string): DocsView;
}
interface PickerInstance {
  setVisible(visible: boolean): void;
}
interface PickerBuilder {
  setAppId(id: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  addView(view: DocsView): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (data: PickerData) => void): PickerBuilder;
  build(): PickerInstance;
}
interface PickerNamespace {
  ViewId: { FOLDERS: string };
  Action: { PICKED: string; CANCEL: string };
  DocsView: new (viewId: string) => DocsView;
  PickerBuilder: new () => PickerBuilder;
}
interface GapiNamespace {
  load(lib: string, cb: () => void): void;
}
type GlobalsComPicker = {
  gapi?: GapiNamespace;
  google?: { picker?: PickerNamespace };
};

// Cast local (via unknown) pra não conflitar com a declaração de window.google
// do driveClient.ts. Acessamos gapi/google.picker só aqui.
function globais(): GlobalsComPicker {
  return window as unknown as GlobalsComPicker;
}

// ─── Loader do gapi + lib picker (idempotente) ──────────────────────────────
const GAPI_SRC = "https://apis.google.com/js/api.js";
let pickerLibPromise: Promise<void> | null = null;

function loadPickerLib(): Promise<void> {
  if (pickerLibPromise) return pickerLibPromise;
  pickerLibPromise = new Promise<void>((resolve, reject) => {
    const carregarLib = () => {
      const g = globais();
      if (g.gapi) g.gapi.load("picker", () => resolve());
      else reject(new Error("Google API (gapi) não carregou."));
    };
    if (globais().gapi) {
      carregarLib();
      return;
    }
    const s = document.createElement("script");
    s.src = GAPI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => carregarLib();
    s.onerror = () => {
      pickerLibPromise = null;
      reject(new Error("Falha ao carregar o Google API (gapi)."));
    };
    document.head.appendChild(s);
  });
  return pickerLibPromise;
}

// Abre o seletor de pasta. Resolve com a pasta escolhida, ou null se cancelado.
// parentId (opcional) abre o Picker já DENTRO daquela pasta (ex: "Empregados
// Ativos") — aí o usuário vê as pastas existentes + busca, e escolhe a certa.
export async function pickDriveFolder(
  title = "Selecione a pasta",
  parentId?: string,
): Promise<{ id: string; name: string } | null> {
  const token = await requestAccessToken();
  await loadPickerLib();
  const picker = globais().google?.picker;
  if (!picker) throw new Error("Google Picker indisponível.");
  return new Promise<{ id: string; name: string } | null>((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes("application/vnd.google-apps.folder");
      if (parentId) view.setParent(parentId);
      const built = new picker.PickerBuilder()
        .setAppId(GOOGLE_APP_ID)
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_PICKER_API_KEY)
        .addView(view)
        .setTitle(title)
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED) {
            const doc = data.docs?.[0];
            resolve(doc ? { id: doc.id, name: doc.name } : null);
          } else if (data.action === picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      built.setVisible(true);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Erro ao abrir o seletor de pastas."));
    }
  });
}
