// Aba "Avisos do sistema" do módulo Rotinas e Avisos: lista os tipos de aviso
// (avisosCatalogo) e deixa configurar canais (in-app / email / WhatsApp),
// destinatários, horário, dias e "respeitar folga" por tipo × restaurante.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { NotificacaoConfig, NotificacaoDestinatarioModo, Pessoa, ModuleId } from "../../core/types";
import { AVISO_CATALOGO, type CanalEstado } from "./avisosCatalogo";
import { salvarNotifConfig } from "./notificacaoRepo";

const DIAS = [{ v: 1, l: "Seg" }, { v: 2, l: "Ter" }, { v: 3, l: "Qua" }, { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" }, { v: 0, l: "Dom" }];

type Props = { rid: string; pessoas: Pessoa[]; modulosAtivos: ModuleId[]; meId: string; podeGerenciar: boolean };

export function AvisosSistemaTab({ rid, pessoas, modulosAtivos, meId, podeGerenciar }: Props) {
  const [configs, setConfigs] = useState<Record<string, NotificacaoConfig>>({});
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(query(collection(db, "notificacaoConfigs"), where("restaurantId", "==", rid)), snap => {
      const m: Record<string, NotificacaoConfig> = {};
      snap.docs.forEach(d => { const c = { id: d.id, ...d.data() } as NotificacaoConfig; m[c.tipo] = c; });
      setConfigs(m);
    });
    return () => u();
  }, [rid]);

  const itens = useMemo(() => AVISO_CATALOGO.filter(i => modulosAtivos.includes(i.modulo)), [modulosAtivos]);

  const cfg = (tipo: string): NotificacaoConfig => configs[tipo] || { id: "", restaurantId: rid, tipo, inApp: true };
  const set = (tipo: string, patch: Partial<NotificacaoConfig>) => { if (podeGerenciar) void salvarNotifConfig(rid, tipo, patch, meId); };

  if (itens.length === 0) return <div className="text-sm text-gray-500 py-8 text-center">Nenhum módulo com avisos ativo neste restaurante.</div>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Escolha os canais de cada aviso. <b>In-app</b> é a Central (ao vivo). <span className="text-amber-600 dark:text-amber-400">Email/WhatsApp marcados “em breve” já ficam configurados e passam a disparar quando o módulo entrar na próxima fase.</span></p>
      {itens.map(item => {
        const c = cfg(item.tipo);
        const inApp = c.inApp !== false;
        const open = aberto === item.tipo;
        return (
          <div key={item.tipo} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="flex items-center gap-3 p-3 flex-wrap">
              <span className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 grid place-items-center text-lg shrink-0">{item.icone}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 dark:text-gray-100">{item.label}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{item.quando}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Canal ativo={inApp} live label="in-app" onClick={() => set(item.tipo, { inApp: !inApp })} disabled={!podeGerenciar} />
                <Canal ativo={!!c.email} estado={item.email} label="email" onClick={() => set(item.tipo, { email: !c.email })} disabled={!podeGerenciar} />
                <Canal ativo={!!c.whatsapp} estado={item.whatsapp} label="whats" onClick={() => set(item.tipo, { whatsapp: !c.whatsapp })} disabled={!podeGerenciar} />
                <button type="button" onClick={() => setAberto(open ? null : item.tipo)} className={`text-xs px-2 py-1.5 rounded-lg border ${open ? "border-indigo-400 text-indigo-600 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-500"}`}>⚙</button>
              </div>
            </div>
            {open && <ConfigDrawer c={c} pessoas={pessoas} onSet={patch => set(item.tipo, patch)} podeGerenciar={podeGerenciar} />}
          </div>
        );
      })}
    </div>
  );
}

function Canal({ ativo, live, estado, label, onClick, disabled }: { ativo: boolean; live?: boolean; estado?: CanalEstado; label: string; onClick: () => void; disabled?: boolean }) {
  const soon = estado === "soon";
  const cor = label === "whats" ? "emerald" : label === "email" ? "amber" : "indigo";
  const onCls = cor === "emerald" ? "bg-emerald-500 border-emerald-500 text-white" : cor === "amber" ? "bg-amber-500 border-amber-500 text-white" : "bg-indigo-500 border-indigo-500 text-white";
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={soon ? "Configurável agora; dispara na próxima fase" : undefined}
      className={`text-[11px] font-medium px-2.5 py-1.5 rounded-full border transition-colors ${ativo ? onCls : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"} ${disabled ? "opacity-60" : ""}`}>
      {label}{ativo && soon ? " · em breve" : ""}{live && ativo ? "" : ""}
    </button>
  );
}

function ConfigDrawer({ c, pessoas, onSet, podeGerenciar }: { c: NotificacaoConfig; pessoas: Pessoa[]; onSet: (p: Partial<NotificacaoConfig>) => void; podeGerenciar: boolean }) {
  const modo: NotificacaoDestinatarioModo = c.destinatarios?.modo || "permissao";
  const pessoaIds = c.destinatarios?.pessoaIds || [];
  const usaHorario = !!c.email || !!c.whatsapp;
  const dias = c.diasSemana || [];
  return (
    <div className="border-t border-gray-100 dark:border-gray-800 p-3 space-y-3 bg-gray-50/60 dark:bg-gray-800/20">
      {/* Destinatários */}
      <div>
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Quem recebe</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {([["permissao", "Quem tem a permissão"], ["pessoas", "Pessoas específicas"]] as const).map(([v, l]) => (
            <button key={v} type="button" disabled={!podeGerenciar} onClick={() => onSet({ destinatarios: { modo: v, pessoaIds: v === "pessoas" ? pessoaIds : [] } })}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border ${modo === v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300"}`}>{l}</button>
          ))}
        </div>
        {modo === "pessoas" && (
          <PessoaMulti pessoas={pessoas} selecionados={pessoaIds} disabled={!podeGerenciar}
            onChange={ids => onSet({ destinatarios: { modo: "pessoas", pessoaIds: ids } })} />
        )}
      </div>
      {/* Horário/dias/folga — só relevante pra email/WhatsApp */}
      {usaHorario && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Horário (email/WhatsApp)</div>
            <input type="time" step={1800} value={c.horario || ""} disabled={!podeGerenciar} onChange={e => onSet({ horario: e.target.value })}
              className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            <label className="flex items-center gap-2 mt-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={c.respeitarFolga !== false} disabled={!podeGerenciar} onChange={e => onSet({ respeitarFolga: e.target.checked })} className="accent-emerald-600" />
              Não avisar quem está de folga
            </label>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Dias</div>
            <div className="grid grid-cols-7 gap-1">
              {DIAS.map(d => {
                const on = dias.length === 0 || dias.includes(d.v);
                return (
                  <button key={d.v} type="button" disabled={!podeGerenciar}
                    onClick={() => { const base = dias.length === 0 ? DIAS.map(x => x.v) : dias; const nx = base.includes(d.v) ? base.filter(x => x !== d.v) : [...base, d.v]; onSet({ diasSemana: nx.length === 7 ? [] : nx }); }}
                    className={`py-1.5 rounded-md text-[11px] font-semibold border ${on ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>{d.l}</button>
                );
              })}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">Vazio = todos os dias.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PessoaMulti({ pessoas, selecionados, onChange, disabled }: { pessoas: Pessoa[]; selecionados: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const [busca, setBusca] = useState("");
  const sel = pessoas.filter(p => selecionados.includes(p.id));
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pessoas.filter(p => !q || p.nome.toLowerCase().includes(q)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 40);
  }, [pessoas, busca]);
  const toggle = (id: string) => onChange(selecionados.includes(id) ? selecionados.filter(x => x !== id) : [...selecionados, id]);
  return (
    <div>
      {sel.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {sel.map(p => (
            <button key={p.id} type="button" disabled={disabled} onClick={() => toggle(p.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
              {p.nome} <span className="text-indigo-400">✕</span>
            </button>
          ))}
        </div>
      )}
      <input value={busca} disabled={disabled} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar pessoa…"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 mb-1" />
      <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {lista.map(p => (
          <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60">
            <input type="checkbox" checked={selecionados.includes(p.id)} disabled={disabled} onChange={() => toggle(p.id)} className="accent-indigo-600" />
            <span className="text-gray-900 dark:text-gray-100">{p.nome}</span>
            {!p.whatsapp && <span className="text-[10px] text-amber-600">sem zap</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
