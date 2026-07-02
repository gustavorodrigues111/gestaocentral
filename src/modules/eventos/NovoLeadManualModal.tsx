// Modal de criação manual de lead. Pra equipe lançar lead que veio por
// outro canal (telefone, indicação, WhatsApp direto) sem precisar abrir
// o form público. Campos mínimos pra criar; resto preenche depois no LeadDrawer.
import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { LeadEvento, OcasiaoEvento, ModeloEvento, SlotEvento } from "../../core/types";

type Props = {
  rid: string;
  onClose: () => void;
  onCreated?: (leadId: string) => void;
};

function slotDoHorario(horaInicio: string, horaFim: string): SlotEvento {
  const hi = Number(horaInicio.slice(0, 2));
  const hf = Number(horaFim.slice(0, 2));
  if (hf - hi >= 8) return "dia_inteiro";
  if (hi >= 18) return "jantar";
  return "almoco";
}

export function NovoLeadManualModal({ rid, onClose, onCreated }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const cfg = restaurants.find(r => r.id === rid)?.eventosConfig;
  const [captacao, setCaptacao] = useState<"inbound" | "outbound">("inbound");
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [dataDesejada, setDataDesejada] = useState("");
  const [horaInicio, setHoraInicio] = useState("19:00");
  const [horaFim, setHoraFim] = useState("23:00");
  const [numConvidados, setNumConvidados] = useState("20");
  const [ocasiao, setOcasiao] = useState<OcasiaoEvento>("aniversario");
  const [modeloEvento, setModeloEvento] = useState<ModeloEvento>("pacote_por_pessoa");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setErro("");
    if (!nome.trim()) return setErro("Nome obrigatório");
    if (!whatsapp.trim()) return setErro("WhatsApp obrigatório");
    if (!dataDesejada) return setErro("Data obrigatória");
    const num = parseInt(numConvidados, 10);
    if (!num || num < 1) return setErro("Nº de convidados inválido");

    setSalvando(true);
    try {
      const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const lead: LeadEvento = {
        id,
        restaurantId: rid,
        status: "novo",
        cliente: {
          nome: nome.trim(),
          whatsapp: whatsapp.trim(),
          email: email.trim(),
          tipoPessoa: "PF",
        },
        dataDesejada,
        slot: slotDoHorario(horaInicio, horaFim),
        horaInicio,
        horaFim,
        numConvidados: num,
        ocasiao,
        modeloEvento,
        musicaAoVivo: false,
        decoracao: false,
        observacoesCliente: observacoes.trim() || undefined,
        origem: "manual",
        // Captação declarada no cadastro + responsável padrão do restaurante.
        classificacaoPrevia: captacao,
        captadoPorPessoaId: captacao === "outbound" ? me?.id : undefined,
        captadoPorNome: captacao === "outbound" ? me?.nome : undefined,
        responsavelId: cfg?.responsavelPadraoId,
        responsavelNome: cfg?.responsavelPadraoNome,
        createdAt: now,
        createdBy: me?.id,
        updatedAt: now,
      };
      await setDoc(doc(db, "leadsEvento", id), sanitizeForFirestore(lead));
      onCreated?.(id);
      onClose();
    } catch (e) {
      console.error(e);
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal title="+ Novo lead manual" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          Pra leads vindos por outro canal (telefone, indicação, etc.). Preenche o mínimo aqui e completa depois abrindo o card.
        </p>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Como chegou este lead?</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {([
              { v: "inbound" as const, t: "Cliente procurou", s: "Passiva — ele veio até nós" },
              { v: "outbound" as const, t: "Captação ativa", s: "Nós fomos atrás" },
            ]).map(o => (
              <button
                key={o.v}
                type="button"
                onClick={() => setCaptacao(o.v)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  captacao === o.v
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                }`}
              >
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{o.t}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{o.s}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">WhatsApp *</label>
            <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+5511..." className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Data *</label>
            <input value={dataDesejada} onChange={e => setDataDesejada(e.target.value)} type="date" className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Nº convidados *</label>
            <input value={numConvidados} onChange={e => setNumConvidados(e.target.value)} type="number" min="1" className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Hora início</label>
            <input value={horaInicio} onChange={e => setHoraInicio(e.target.value)} type="time" className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Hora fim</label>
            <input value={horaFim} onChange={e => setHoraFim(e.target.value)} type="time" className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Ocasião</label>
            <select value={ocasiao} onChange={e => setOcasiao(e.target.value as OcasiaoEvento)} className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="aniversario">Aniversário</option>
              <option value="corporativo">Corporativo</option>
              <option value="encontro_amigos">Encontro de amigos</option>
              <option value="outros">Outros</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Modelo</label>
            <select value={modeloEvento} onChange={e => setModeloEvento(e.target.value as ModeloEvento)} className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="pacote_por_pessoa">Pacote por pessoa</option>
              <option value="locacao_consumo_livre">Locação + consumo livre</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Observações</label>
          <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2} className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
        </div>

        {erro && <div className="text-sm text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Criando..." : "Criar lead"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
