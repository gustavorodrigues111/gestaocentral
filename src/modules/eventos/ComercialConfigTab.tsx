import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { Pessoa, Restaurant } from "../../core/types";

type Props = {
  rid: string;
};

// Percentuais de comissão padrão (editáveis). INBOUND máx 2%, OUTBOUND máx 3,5%.
export const COMISSAO_DEFAULT = {
  inbound: { negociacaoFechamento: 1, acompanhamento: 1 },
  outbound: { captacao: 1.5, negociacaoFechamento: 1, acompanhamento: 1 },
};

// Aba "Comercial" das configs de Eventos. Master define a lista de pessoas
// que podem aparecer nos pickers do fechamento de evento ("captado por",
// "negociado por", "acompanhado por"). Salvo em
// restaurants/{rid}.eventosConfig.pessoasComerciaisIds.
export function ComercialConfigTab({ rid }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restaurant: Restaurant | null = restaurants.find(r => r.id === rid) || null;

  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const selecionadosIds = restaurant?.eventosConfig?.pessoasComerciaisIds || [];
  const respPadraoId = restaurant?.eventosConfig?.responsavelPadraoId || "";
  const comissaoSalva = restaurant?.eventosConfig?.comissao || COMISSAO_DEFAULT;

  // Comissão: edição local + botão salvar (evita write por tecla).
  const [comissao, setComissao] = useState(comissaoSalva);
  useEffect(() => { setComissao(restaurant?.eventosConfig?.comissao || COMISSAO_DEFAULT); }, [restaurant?.eventosConfig?.comissao]);
  const [savingComissao, setSavingComissao] = useState(false);

  async function setRespPadrao(pessoaId: string) {
    if (!restaurant) return;
    const p = pessoas.find(x => x.id === pessoaId);
    await updateDoc(doc(db, "restaurants", rid), {
      "eventosConfig.responsavelPadraoId": pessoaId || null,
      "eventosConfig.responsavelPadraoNome": p?.nome || null,
    });
  }

  async function salvarComissao() {
    if (!restaurant || savingComissao) return;
    setSavingComissao(true);
    try {
      await updateDoc(doc(db, "restaurants", rid), { "eventosConfig.comissao": comissao });
    } finally {
      setSavingComissao(false);
    }
  }

  const setC = (grupo: "inbound" | "outbound", campo: string, v: number) =>
    setComissao(prev => {
      const g = { ...(prev[grupo] as Record<string, number>), [campo]: v };
      return { ...prev, [grupo]: g } as typeof COMISSAO_DEFAULT;
    });
  const maxInbound = (comissao.inbound.negociacaoFechamento || 0) + (comissao.inbound.acompanhamento || 0);
  const maxOutbound = (comissao.outbound.captacao || 0) + (comissao.outbound.negociacaoFechamento || 0) + (comissao.outbound.acompanhamento || 0);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "pessoas"),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa);
        const ativas = list.filter(p => p.ativa !== false);
        ativas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        setPessoas(ativas);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const selecionados = useMemo(() => {
    const byId = new Map(pessoas.map(p => [p.id, p]));
    return selecionadosIds
      .map(id => byId.get(id))
      .filter((p): p is Pessoa => !!p);
  }, [pessoas, selecionadosIds]);

  async function add(pessoaId: string) {
    if (!restaurant || saving) return;
    if (selecionadosIds.includes(pessoaId)) return;
    setSaving(true);
    try {
      const novo = [...selecionadosIds, pessoaId];
      await updateDoc(doc(db, "restaurants", rid), {
        "eventosConfig.pessoasComerciaisIds": novo,
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(pessoaId: string) {
    if (!restaurant || saving) return;
    setSaving(true);
    try {
      const novo = selecionadosIds.filter(id => id !== pessoaId);
      await updateDoc(doc(db, "restaurants", rid), {
        "eventosConfig.pessoasComerciaisIds": novo,
      });
    } finally {
      setSaving(false);
    }
  }

  if (!me?.isMaster) {
    return (
      <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-200">
        🔒 Só master pode editar a lista de pessoas comerciais.
      </div>
    );
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando pessoas...</div>;

  return (
    <div className="space-y-6">
      {/* Responsável padrão por leads */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Responsável padrão</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
          Quem recebe todos os leads novos deste restaurante (público e manual).
          Aplicado automaticamente; pode ser alterado por evento no card.
          Só é possível escolher entre as pessoas comerciais abaixo.
        </p>
        {selecionados.length === 0 ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Cadastre pessoas comerciais abaixo pra poder definir o responsável padrão.
          </p>
        ) : (
          <select
            value={respPadraoId}
            onChange={(e) => setRespPadrao(e.target.value)}
            className="w-full max-w-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            <option value="">— ninguém (leads entram sem responsável) —</option>
            {selecionados.map(p => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        )}
      </div>

      {/* WhatsApp de avisos de novo lead */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">WhatsApp de avisos</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
          Número que recebe uma mensagem no WhatsApp toda vez que entra um lead
          de evento pelo site. Deixe vazio pra não avisar (o lead continua
          aparecendo no Kanban). Ex.: (11) 91234-5678.
        </p>
        <input
          type="tel"
          defaultValue={restaurant?.eventosConfig?.whatsappAvisos || ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === (restaurant?.eventosConfig?.whatsappAvisos || "")) return;
            void updateDoc(doc(db, "restaurants", rid), { "eventosConfig.whatsappAvisos": v || null });
          }}
          placeholder="(11) 91234-5678"
          className="w-full max-w-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        />
      </div>

      {/* Dados da empresa (CONTRATADA) pro contrato de evento */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Dados da empresa (contrato)</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
          Dados da casa que entram no <strong>contrato de evento</strong> como CONTRATADA. Preenche uma vez.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
          {([
            ["razaoSocial", "Razão social"],
            ["cnpj", "CNPJ"],
            ["endereco", "Endereço"],
            ["representanteNome", "Representante (quem assina)"],
            ["representanteCpf", "CPF do representante"],
          ] as const).map(([campo, label]) => (
            <label key={campo} className={`flex flex-col gap-1 ${campo === "endereco" ? "sm:col-span-2" : ""}`}>
              <span className="text-[11px] uppercase font-bold text-gray-500">{label}</span>
              <input
                defaultValue={(restaurant?.eventosConfig?.dadosContratada?.[campo] as string) || ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v === ((restaurant?.eventosConfig?.dadosContratada?.[campo] as string) || "")) return;
                  void updateDoc(doc(db, "restaurants", rid), { [`eventosConfig.dadosContratada.${campo}`]: v || null });
                }}
                className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Pessoas comerciais</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Selecione quem pode aparecer nos pickers de fechamento de evento
          (quem captou, quem negociou, quem acompanhou). A lista alimenta o
          modal "Fechar evento" no Kanban.
        </p>
      </div>

      {selecionados.length === 0 ? (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
          <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">
            Nenhuma pessoa comercial cadastrada ainda.
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Clica em "+ Adicionar pessoa" pra montar o time comercial deste restaurante.
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
          {selecionados.map(p => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-3 py-2"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-semibold shrink-0">
                {p.nome.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {p.nome}
                </div>
                {p.email && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{p.email}</div>
                )}
              </div>
              {p.isMaster && (
                <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                  master
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(p.id)}
                disabled={saving}
                className="text-xs px-2 py-1 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50 whitespace-nowrap"
              >
                ✕ Remover
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          + Adicionar pessoa
        </button>
      </div>

      {/* Percentuais de comissão */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Comissão</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
          Percentuais sobre o faturamento bruto (sem gorjeta) do evento. Somados por
          atividade que a pessoa realizou, conforme o fechamento.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* INBOUND */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">🔹 Inbound (cliente procurou)</span>
              <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">máx {maxInbound.toLocaleString("pt-BR")}%</span>
            </div>
            <div className="space-y-2">
              <CampoPct label="Negociação e fechamento" value={comissao.inbound.negociacaoFechamento} onChange={v => setC("inbound", "negociacaoFechamento", v)} />
              <CampoPct label="Acompanhamento presencial" value={comissao.inbound.acompanhamento} onChange={v => setC("inbound", "acompanhamento", v)} />
            </div>
          </div>
          {/* OUTBOUND */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">🔹 Outbound (captação ativa)</span>
              <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">máx {maxOutbound.toLocaleString("pt-BR")}%</span>
            </div>
            <div className="space-y-2">
              <CampoPct label="Captação ativa" value={comissao.outbound.captacao} onChange={v => setC("outbound", "captacao", v)} />
              <CampoPct label="Negociação e fechamento" value={comissao.outbound.negociacaoFechamento} onChange={v => setC("outbound", "negociacaoFechamento", v)} />
              <CampoPct label="Acompanhamento presencial" value={comissao.outbound.acompanhamento} onChange={v => setC("outbound", "acompanhamento", v)} />
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={salvarComissao}
            disabled={savingComissao}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {savingComissao ? "Salvando…" : "Salvar comissão"}
          </button>
        </div>
      </div>

      {modalOpen && (
        <AdicionarPessoaModal
          pessoas={pessoas}
          jaSelecionadosIds={selecionadosIds}
          saving={saving}
          onPick={async (id) => {
            await add(id);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

function CampoPct({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-600 dark:text-gray-300">{label}</span>
      <span className="inline-flex items-center gap-1">
        <input
          type="number" min={0} step={0.1} value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-20 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-right"
        />
        <span className="text-xs text-gray-400">%</span>
      </span>
    </label>
  );
}

function AdicionarPessoaModal({
  pessoas,
  jaSelecionadosIds,
  saving,
  onPick,
  onClose,
}: {
  pessoas: Pessoa[];
  jaSelecionadosIds: string[];
  saving: boolean;
  onPick: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [filtro, setFiltro] = useState("");

  const disponiveis = useMemo(() => {
    const jaSet = new Set(jaSelecionadosIds);
    const f = filtro.trim().toLowerCase();
    return pessoas
      .filter(p => !jaSet.has(p.id))
      .filter(p => {
        if (!f) return true;
        return (
          p.nome.toLowerCase().includes(f) ||
          (p.email || "").toLowerCase().includes(f)
        );
      });
  }, [pessoas, jaSelecionadosIds, filtro]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg flex flex-col max-h-[85vh] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
            Adicionar pessoa comercial
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Escolha uma pessoa pra incluir no time comercial. Clica no nome pra adicionar.
          </p>
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por nome ou e-mail..."
            autoFocus
            className="w-full mt-3 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {disponiveis.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {filtro
                ? "Nenhuma pessoa encontrada com esse filtro."
                : "Todas as pessoas ativas já estão no time comercial."}
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {disponiveis.map(p => (
                <button
                  key={p.id}
                  type="button"
                  disabled={saving}
                  onClick={() => onPick(p.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center text-sm font-semibold shrink-0">
                    {p.nome.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {p.nome}
                    </div>
                    {p.email && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{p.email}</div>
                    )}
                  </div>
                  {p.isMaster && (
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                      master
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
