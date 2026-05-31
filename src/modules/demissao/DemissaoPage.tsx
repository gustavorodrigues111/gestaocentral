// Módulo Demissão — kanban + lista de processos.
// Similar a AdmissaoPage, mas pra fluxo de saída.

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { pickDriveFile } from "../../core/google/drivePicker";
import {
  ouvirProcessos, iniciarProcesso, cancelarProcesso, atualizarSubtarefa,
  bloquearAcesso, moverColunaProcesso, atualizarProcesso,
} from "./repository";
import { COLUNAS_DEMISSAO_DEFAULT } from "./template";
import type {
  ProcessoDemissao, DemissaoIniciativa, Empregado,
  SubtarefaDemissaoInstance, ContatoExterno,
} from "../../core/types";
import { DEMISSAO_INICIATIVA_LABEL, DEMISSAO_STATUS_LABEL } from "../../core/types";
import { getContatoClinica, getContatoContabilidade } from "../../core/admissao/admissaoHelpers";
import { montarGmailComposeUrl } from "../../core/admissao/exportFicha";

type Tab = "kanban" | "lista" | "concluidos";

export function DemissaoPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const [tab, setTab] = useState<Tab>("kanban");
  const [processos, setProcessos] = useState<ProcessoDemissao[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [iniciando, setIniciando] = useState(false);
  const [processoSelecionado, setProcessoSelecionado] = useState<ProcessoDemissao | null>(null);

  // Abre IniciarDemissaoModal automaticamente quando a URL tem empregadoId
  // (vindo do botão "Não renovar" da Experiência)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("empregadoId")) setIniciando(true);
  }, []);

  useEffect(() => {
    if (!rid) return;
    const u1 = ouvirProcessos(rid, setProcessos);
    const u2 = onSnapshot(
      query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      snap => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() } as Empregado)))
    );
    return () => { u1(); u2(); };
  }, [rid]);

  // Re-puxa o processo selecionado pra atualizar UI quando muda no firestore
  useEffect(() => {
    if (!processoSelecionado) return;
    const atualizado = processos.find(p => p.id === processoSelecionado.id);
    if (atualizado && atualizado.updatedAt !== processoSelecionado.updatedAt) {
      setProcessoSelecionado(atualizado);
    }
  }, [processos, processoSelecionado]);

  const ativos = useMemo(
    () => processos.filter(p => p.status !== "concluido" && p.status !== "cancelado"),
    [processos]
  );
  const concluidos = useMemo(
    () => processos.filter(p => p.status === "concluido" || p.status === "cancelado")
      .sort((a, b) => (b.concluidoEm || b.canceladoEm || b.iniciadoEm).localeCompare(a.concluidoEm || a.canceladoEm || a.iniciadoEm)),
    [processos]
  );

  if (!rid) return <div className="text-center py-12 text-gray-500">Selecione um restaurante.</div>;

  return (
    <div className="max-w-7xl mx-auto p-4">
      <header className="flex items-center justify-between mb-4 gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">👋 Demissão</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {ativos.length} em andamento · {concluidos.length} concluídos/cancelados
          </p>
        </div>
        <Button onClick={() => setIniciando(true)}>+ Iniciar Demissão</Button>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        <TabBtn ativo={tab === "kanban"} onClick={() => setTab("kanban")}>Kanban</TabBtn>
        <TabBtn ativo={tab === "lista"} onClick={() => setTab("lista")}>Lista</TabBtn>
        <TabBtn ativo={tab === "concluidos"} onClick={() => setTab("concluidos")}>Histórico</TabBtn>
      </nav>

      {tab === "kanban" && (
        <KanbanView processos={ativos} onAbrir={setProcessoSelecionado} />
      )}
      {tab === "lista" && (
        <ListaView processos={ativos} onAbrir={setProcessoSelecionado} />
      )}
      {tab === "concluidos" && (
        <ListaView processos={concluidos} onAbrir={setProcessoSelecionado} histórico />
      )}

      {iniciando && (
        <IniciarDemissaoModal
          empregados={empregados.filter(e => e.estaAtivo !== false)}
          rid={rid}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
          processosAtivos={ativos}
          onClose={() => setIniciando(false)}
        />
      )}
      {processoSelecionado && (
        <DetalheDrawer
          proc={processoSelecionado}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
          onClose={() => setProcessoSelecionado(null)}
        />
      )}
    </div>
  );
}

function TabBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        ativo
          ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Kanban ────────────────────────────────────────────────────────────

function KanbanView({ processos, onAbrir }: {
  processos: ProcessoDemissao[];
  onAbrir: (p: ProcessoDemissao) => void;
}) {
  const colunas = COLUNAS_DEMISSAO_DEFAULT.filter(c => c.id !== "col_concluido" && c.id !== "col_cancelado");
  function porColuna(colId: string) {
    return processos.filter(p => (p.kanbanColunaId || "col_iniciado") === colId);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
      {colunas.map(col => {
        const items = porColuna(col.id);
        return (
          <div
            key={col.id}
            className="flex-shrink-0 w-72 rounded-xl bg-gray-50 dark:bg-gray-800/40 p-2 min-h-[200px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) moverColunaProcesso(id, col.id).catch(console.error);
            }}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300" style={col.cor ? { color: `#${col.cor}` } : undefined}>
                {col.nome}
              </h3>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{items.length}</span>
            </div>
            <div className="space-y-1.5">
              {items.length === 0 && (
                <div className="text-[10px] text-gray-400 dark:text-gray-600 text-center py-3 italic">— vazio —</div>
              )}
              {items.map(p => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                  onClick={() => onAbrir(p)}
                  className="p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 cursor-pointer hover:shadow-md transition-shadow"
                  style={col.cor ? { borderLeftWidth: 3, borderLeftColor: `#${col.cor}` } : undefined}
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.empregadoNomeSnapshot}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {DEMISSAO_INICIATIVA_LABEL[p.iniciativa]}
                    {p.cargoSnapshot && ` · ${p.cargoSnapshot}`}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    {DEMISSAO_STATUS_LABEL[p.status]}
                    {p.acessoBloqueadoEm && <span className="ml-1 text-amber-600">🔒</span>}
                  </div>
                  {p.dataAlvo && <div className="text-[10px] text-gray-500 dark:text-gray-400">📅 {p.dataAlvo}</div>}
                  {p.subtarefas && (
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                      ☑ {p.subtarefas.filter(s => s.feita).length}/{p.subtarefas.length}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Lista ─────────────────────────────────────────────────────────────

function ListaView({ processos, onAbrir, histórico }: {
  processos: ProcessoDemissao[];
  onAbrir: (p: ProcessoDemissao) => void;
  histórico?: boolean;
}) {
  if (processos.length === 0) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">{histórico ? "Sem histórico ainda." : "Nenhum processo ativo."}</div>;
  }
  return (
    <div className="space-y-2">
      {processos.map(p => (
        <div
          key={p.id}
          onClick={() => onAbrir(p)}
          className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 cursor-pointer hover:shadow-md transition-shadow flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-900 dark:text-gray-100">{p.empregadoNomeSnapshot}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {DEMISSAO_INICIATIVA_LABEL[p.iniciativa]} · {DEMISSAO_STATUS_LABEL[p.status]}
              {p.cargoSnapshot && ` · ${p.cargoSnapshot}`}
              {p.dataAlvo && ` · 📅 ${p.dataAlvo}`}
              {p.acessoBloqueadoEm && <span className="ml-1 text-amber-600">🔒 acesso bloqueado</span>}
            </div>
          </div>
          {p.subtarefas && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              ☑ {p.subtarefas.filter(s => s.feita).length}/{p.subtarefas.length}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Modal: Iniciar Demissão ──────────────────────────────────────────

function IniciarDemissaoModal({ empregados, rid, autor, processosAtivos, onClose }: {
  empregados: Empregado[];
  rid: string;
  autor: { id: string; nome: string };
  processosAtivos: ProcessoDemissao[];
  onClose: () => void;
}) {
  const [empregadoId, setEmpregadoId] = useState("");
  const [iniciativa, setIniciativa] = useState<DemissaoIniciativa>("empresa");
  const [dataAlvo, setDataAlvo] = useState("");
  const [avisoPrevio, setAvisoPrevio] = useState<"trabalhado" | "indenizado">("trabalhado");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const emp = empregados.find(e => e.id === empregadoId);
  const jaTemProcesso = processosAtivos.find(p => p.empregadoId === empregadoId);

  // Pré-preenche da query string (vindo do botão "Não renovar" da Experiência)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const empId = params.get("empregadoId");
    const m = params.get("motivo");
    if (empId) setEmpregadoId(empId);
    if (m) setMotivo(decodeURIComponent(m));
  }, []);

  async function salvar() {
    if (!emp) { alert("Escolha um empregado"); return; }
    if (jaTemProcesso) { alert(`Esse empregado já tem processo em andamento (${jaTemProcesso.status}).`); return; }
    setSalvando(true);
    try {
      const id = await iniciarProcesso({
        restaurantId: rid,
        empregadoId: emp.id,
        empregadoNomeSnapshot: emp.nome,
        cargoSnapshot: undefined,
        pessoaId: emp.pessoaId || undefined,
        iniciativa,
        dataAlvo: dataAlvo || undefined,
        avisoPrevio,
        motivoIniciacao: motivo || undefined,
        iniciadoPor: autor,
      });
      const bloqueio = iniciativa === "empresa"
        ? "Acesso NÃO foi bloqueado ainda — será automático ao marcar 'Informar demissão pro empregado' ou via botão manual no detalhe."
        : "Acesso foi bloqueado IMEDIATAMENTE.";
      alert(`✓ Processo de demissão iniciado (${id}).\n\n${bloqueio}`);
      onClose();
    } catch (e) {
      alert("Erro: " + String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">+ Iniciar Demissão</h2>
        <div className="space-y-3 text-sm">
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">Empregado *</div>
            <select value={empregadoId} onChange={(e) => setEmpregadoId(e.target.value)} className="dm-input">
              <option value="">— escolher —</option>
              {empregados.sort((a, b) => a.nome.localeCompare(b.nome)).map(e => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
            {jaTemProcesso && (
              <div className="text-xs text-red-600 mt-1">⚠ Já existe processo em andamento — não dá pra iniciar outro</div>
            )}
          </label>
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">Iniciativa *</div>
            <div className="grid grid-cols-3 gap-2">
              {(["empresa", "empregado", "acordo"] as const).map(i => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIniciativa(i)}
                  className={`px-2 py-2 rounded-lg border text-xs ${iniciativa === i
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 hover:bg-gray-50"}`}
                >
                  {DEMISSAO_INICIATIVA_LABEL[i]}
                </button>
              ))}
            </div>
          </label>
          {iniciativa === "empresa" && (
            <div className="text-xs p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-amber-900 dark:text-amber-200">
              Acesso do empregado <b>NÃO será bloqueado agora</b>. Será automático quando você marcar a subtarefa "Informar demissão pro empregado" (depois da decisão + comunicação oficial). Ou use o botão manual "Bloquear acesso" no detalhe do processo.
            </div>
          )}
          {(iniciativa === "empregado" || iniciativa === "acordo") && (
            <div className="text-xs p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-red-900 dark:text-red-200">
              ⚠ Acesso do empregado será bloqueado <b>IMEDIATAMENTE</b> ao confirmar.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label>
              <div className="text-xs text-gray-600 mb-1">Data alvo</div>
              <input type="date" value={dataAlvo} onChange={(e) => setDataAlvo(e.target.value)} className="dm-input" />
            </label>
            <label>
              <div className="text-xs text-gray-600 mb-1">Aviso prévio</div>
              <select value={avisoPrevio} onChange={(e) => setAvisoPrevio(e.target.value as "trabalhado" | "indenizado")} className="dm-input">
                <option value="trabalhado">Trabalhado</option>
                <option value="indenizado">Indenizado</option>
              </select>
            </label>
          </div>
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">Motivo / observação</div>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className="dm-input" placeholder="Ex: Não renovação contrato experiência, redução de quadro, justa causa..." />
          </label>
        </div>
        <style>{`.dm-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .dm-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !empregadoId || !!jaTemProcesso}>{salvando ? "Iniciando…" : "Iniciar processo"}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Drawer de detalhe (subtarefas + ações) ───────────────────────────

function DetalheDrawer({ proc, autor, onClose }: {
  proc: ProcessoDemissao;
  autor: { id: string; nome: string };
  onClose: () => void;
}) {
  const { activeRestaurant } = useRestaurant();
  const [empregado, setEmpregado] = useState<Empregado | null>(null);

  // Carrega empregado pra usar telefone do whatsapp_empregado
  useEffect(() => {
    (async () => {
      const { getDoc, doc: docFn } = await import("firebase/firestore");
      try {
        const s = await getDoc(docFn(db, "empregados", proc.empregadoId));
        if (s.exists()) setEmpregado({ id: s.id, ...s.data() } as Empregado);
      } catch (e) { console.warn(e); }
    })();
  }, [proc.empregadoId]);

  // Executa atalho de canal preferido (email/whatsapp/telefone)
  function abrirAtalho(s: SubtarefaDemissaoInstance) {
    if (!s.atalho || !activeRestaurant) return;
    let contato: ContatoExterno | null = null;
    let assunto = "";
    let corpo = "";
    const empNome = proc.empregadoNomeSnapshot;
    if (s.atalho.tipo === "contato_contabilidade") {
      contato = getContatoContabilidade(activeRestaurant);
      assunto = `Demissão — ${empNome} (${activeRestaurant.nome})`;
      corpo = `Olá, ${contato.nome}.\n\nEstamos iniciando o processo de demissão de ${empNome}.\nIniciativa: ${DEMISSAO_INICIATIVA_LABEL[proc.iniciativa]}\n${proc.dataAlvo ? `Data alvo: ${proc.dataAlvo}\n` : ""}${proc.avisoPrevio ? `Aviso prévio: ${proc.avisoPrevio}\n` : ""}\nAguardo retorno.\n\nObrigado.`;
    } else if (s.atalho.tipo === "contato_clinica") {
      contato = getContatoClinica(activeRestaurant);
      assunto = `Agendamento exame demissional — ${empNome}`;
      corpo = `Olá, ${contato.nome}.\n\nGostaríamos de agendar exame demissional para ${empNome} (${activeRestaurant.nome}).\n\nAguardo retorno com horário disponível.`;
    } else if (s.atalho.tipo === "whatsapp_empregado") {
      // Usa telefone do empregado direto (não passa pelo contatosAdmissao)
      const num = (empregado?.telefone || "").replace(/\D/g, "");
      if (!num) {
        alert(`Empregado ${empNome} não tem telefone cadastrado.`);
        return;
      }
      const numCompleto = num.length === 10 || num.length === 11 ? `55${num}` : num;
      const msg = `Olá ${empNome}, vamos conversar sobre o desligamento. Pode me ligar ou marcar um horário?`;
      window.open(`https://api.whatsapp.com/send?phone=${numCompleto}&text=${encodeURIComponent(msg)}`, "_blank");
      return;
    }
    if (!contato) return;
    if (contato.canalPreferido === "email") {
      if (!contato.email?.trim()) { alert(`${contato.nome} sem email cadastrado.`); return; }
      window.open(montarGmailComposeUrl({ to: contato.email, subject: assunto, body: corpo }), "_blank");
    } else if (contato.canalPreferido === "whatsapp") {
      const num = (contato.whatsapp || "").replace(/\D/g, "");
      if (!num) { alert(`${contato.nome} sem WhatsApp cadastrado.`); return; }
      const numCompleto = num.length === 10 || num.length === 11 ? `55${num}` : num;
      window.open(`https://api.whatsapp.com/send?phone=${numCompleto}&text=${encodeURIComponent(corpo)}`, "_blank");
    } else {
      // telefone: copia número + script
      const num = contato.telefone || "—";
      alert(`Telefone: ${num}\n\nScript sugerido:\n\n${corpo}`);
    }
  }

  async function marcarSub(s: SubtarefaDemissaoInstance, marcar: boolean) {
    if (!marcar) {
      await atualizarSubtarefa(proc.id, s.id, { feita: false, feitaEm: undefined, feitaPor: undefined }, autor);
      return;
    }
    // Tratamentos especiais
    if (s.ehDecisaoRealizar) {
      const decisao = confirm("Decisão: VAI REALIZAR a demissão?\n\n✓ OK = Sim, prosseguir\n✗ Cancelar = Não, cancelar processo");
      if (!decisao) {
        const motivo = prompt("Motivo do cancelamento:") || "Decisão de não realizar após prévia";
        await cancelarProcesso(proc.id, autor, motivo);
        onClose();
        return;
      }
      await atualizarProcesso(proc.id, {
        status: "decidido_realizar",
        kanbanColunaId: "col_decisao",
        decisaoRealizarEm: new Date().toISOString(),
        decisaoRealizarPor: autor,
      });
    }
    let link: string | undefined;
    let dataInformada: string | undefined;
    if (s.pedeLink) {
      const escolha = confirm("Anexar arquivo do Drive agora? (Cancelar = colar URL manual)");
      if (escolha) {
        try {
          const f = await pickDriveFile("Selecione o arquivo");
          if (!f) return;
          link = `https://drive.google.com/open?id=${f.id}`;
        } catch (e) { alert(String(e)); return; }
      } else {
        const url = prompt("Cole a URL:");
        if (!url) return;
        link = url;
      }
    }
    if (s.pedeData) {
      const d = prompt("Data:", new Date().toISOString().slice(0, 10));
      if (!d) return;
      dataInformada = d;
    }
    await atualizarSubtarefa(proc.id, s.id, {
      feita: true,
      feitaEm: new Date().toISOString(),
      feitaPor: autor,
      link,
      dataInformada,
    }, autor);
  }

  async function bloquearManual() {
    if (!confirm("Bloquear acesso do empregado AGORA? Isso impede login no próximo polling (≤30s).")) return;
    await bloquearAcesso(proc.id, autor);
  }

  async function cancelar() {
    const motivo = prompt("Motivo do cancelamento:");
    if (!motivo) return;
    await cancelarProcesso(proc.id, autor, motivo);
    onClose();
  }

  // Agrupa subtarefas por coluna + checklist
  const subs = proc.subtarefas || [];
  const colunas = COLUNAS_DEMISSAO_DEFAULT;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{proc.empregadoNomeSnapshot}</h2>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
              <span>{DEMISSAO_INICIATIVA_LABEL[proc.iniciativa]}</span>
              <span>·</span>
              <span>{DEMISSAO_STATUS_LABEL[proc.status]}</span>
              {proc.dataAlvo && <><span>·</span><span>📅 {proc.dataAlvo}</span></>}
              {proc.avisoPrevio && <><span>·</span><span>Aviso: {proc.avisoPrevio}</span></>}
              {proc.acessoBloqueadoEm && <><span>·</span><span className="text-amber-600 font-medium">🔒 acesso bloqueado em {proc.acessoBloqueadoEm.slice(0, 10)}</span></>}
            </div>
            {proc.motivoIniciacao && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic">{proc.motivoIniciacao}</div>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {proc.status !== "cancelado" && proc.status !== "concluido" && proc.iniciativa === "empresa" && !proc.acessoBloqueadoEm && (
            <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs">
              <div className="font-medium text-amber-900 dark:text-amber-100 mb-1">Acesso do empregado AINDA não foi bloqueado.</div>
              <p className="text-amber-800 dark:text-amber-300 mb-2">
                Vai bloquear automaticamente quando marcar "Informar demissão pro empregado". Ou bloqueia manualmente agora:
              </p>
              <Button size="sm" onClick={bloquearManual}>🔒 Bloquear acesso agora</Button>
            </div>
          )}

          {colunas.map(col => {
            const subsCol = subs.filter(s => s.colunaId === col.id);
            if (subsCol.length === 0) return null;
            // Agrupa por checklist
            const porCk = new Map<string, SubtarefaDemissaoInstance[]>();
            subsCol.forEach(s => {
              const arr = porCk.get(s.checklistId) || [];
              arr.push(s);
              porCk.set(s.checklistId, arr);
            });
            return (
              <details key={col.id} className="rounded-lg border border-gray-200 dark:border-gray-800" open>
                <summary className="px-3 py-2 font-semibold text-sm cursor-pointer text-gray-900 dark:text-gray-100" style={col.cor ? { color: `#${col.cor}` } : undefined}>
                  {col.nome}
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-normal">
                    ({subsCol.filter(s => s.feita).length}/{subsCol.length})
                  </span>
                </summary>
                <div className="px-3 pb-3 space-y-1">
                  {Array.from(porCk.entries()).map(([ckId, lista]) => (
                    <div key={ckId} className="mt-2">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{lista[0].checklistNome}</div>
                      {lista.sort((a, b) => a.ordem - b.ordem).map(s => (
                        <label key={s.id} className="flex items-start gap-2 text-sm py-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={s.feita}
                            onChange={(e) => marcarSub(s, e.target.checked)}
                            disabled={proc.status === "cancelado" || proc.status === "concluido"}
                            className="mt-1"
                          />
                          <span className="flex-1">
                            <span className={s.feita ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-300"}>
                              {s.nome}
                            </span>
                            <span className="ml-2 inline-flex items-center gap-1">
                              {s.ehBloqueioAcesso && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">🔒 bloqueia ao marcar</span>}
                              {s.ehDecisaoRealizar && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">⚖ decisão</span>}
                              {s.ehInativacaoFinal && <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✓ finaliza</span>}
                            </span>
                            {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5">📎 anexo</a>}
                            {s.dataInformada && <span className="block text-[11px] text-gray-500">📅 {s.dataInformada}</span>}
                            {s.atalho && !s.feita && (
                              <button
                                onClick={(e) => { e.preventDefault(); abrirAtalho(s); }}
                                className="mt-1 text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100"
                              >
                                {s.atalho.tipo === "contato_contabilidade" && "📧 Abrir contato Contabilidade"}
                                {s.atalho.tipo === "contato_clinica" && "🩺 Abrir contato Clínica"}
                                {s.atalho.tipo === "whatsapp_empregado" && "💬 WhatsApp pro empregado"}
                              </button>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>

        <footer className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-between gap-2 flex-wrap">
          {proc.status !== "cancelado" && proc.status !== "concluido" ? (
            <Button variant="danger" onClick={cancelar}>✗ Cancelar processo (reverte tudo)</Button>
          ) : (
            <div className="text-xs text-gray-500">
              {proc.status === "concluido" && `Concluído em ${proc.concluidoEm?.slice(0, 10)}`}
              {proc.status === "cancelado" && `Cancelado em ${proc.canceladoEm?.slice(0, 10)} — ${proc.motivoCancelamento}`}
            </div>
          )}
          <Button onClick={onClose}>Fechar</Button>
        </footer>
      </div>
    </div>
  );
}

void getDocs; void pickDriveFile;
