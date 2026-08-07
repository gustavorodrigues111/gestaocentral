// ════════════════════════════════════════════════════════════════════════════
//  EditarLeadModal — edição dos dados principais de um lead de evento.
//
//  Corrige/atualiza cliente + evento desejado. Ao salvar:
//   1. grava só os campos que mudaram em leadsEvento (updateDoc);
//   2. recalcula `slot` e `duracaoEstimadaHoras` se o horário mudou;
//   3. registra UMA tratativa (canal "sistema") com o diff das alterações,
//      pra aparecer no histórico "📇 Tratativas com o cliente" do LeadDrawer.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { parseYmd, pad2 } from "../../core/utils/date";
import type { LeadEvento } from "../../core/types";
import { ESCOPO_PACOTE_LABEL, MODELO_LABEL, OCASIAO_LABEL, slotDoHorario, duracaoHoras } from "./validacoes";
import { registrarTratativa } from "./tratativas";

type Props = {
  lead: LeadEvento;
  meId: string;
  meNome: string;
  onClose: () => void;
};

const fmtData = (ymd: string) => {
  if (!ymd) return "—";
  const d = parseYmd(ymd);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const simNao = (b: boolean) => (b ? "sim" : "não");

export function EditarLeadModal({ lead, meId, meNome, onClose }: Props) {
  // Rascunho — inicia com os valores atuais do lead.
  const [nome, setNome] = useState(lead.cliente.nome || "");
  const [whatsapp, setWhatsapp] = useState(lead.cliente.whatsapp || "");
  const [email, setEmail] = useState(lead.cliente.email || "");
  const [tipoPessoa, setTipoPessoa] = useState<"PF" | "PJ">(lead.cliente.tipoPessoa || "PF");
  const [cnpj, setCnpj] = useState(lead.cliente.cnpj || "");
  const [razaoSocial, setRazaoSocial] = useState(lead.cliente.razaoSocial || "");
  // Dados pra contrato
  const [cpf, setCpf] = useState(lead.cliente.cpf || "");
  const [endereco, setEndereco] = useState(lead.cliente.endereco || "");
  const [repNome, setRepNome] = useState(lead.cliente.representanteLegal?.nome || "");
  const [repCpf, setRepCpf] = useState(lead.cliente.representanteLegal?.cpf || "");

  const [dataDesejada, setDataDesejada] = useState(lead.dataDesejada || "");
  const [dataAlternativa, setDataAlternativa] = useState(lead.dataAlternativa || "");
  const [horaInicio, setHoraInicio] = useState(lead.horaInicio || "");
  const [horaFim, setHoraFim] = useState(lead.horaFim || "");
  const [numConvidados, setNumConvidados] = useState(String(lead.numConvidados ?? ""));
  const [ocasiao, setOcasiao] = useState(lead.ocasiao);
  const [ocasiaoOutros, setOcasiaoOutros] = useState(lead.ocasiaoOutros || "");
  const [modeloEvento, setModeloEvento] = useState(lead.modeloEvento);
  const [escopoPacote, setEscopoPacote] = useState(lead.escopoPacote || "");
  const [escopoPacoteOutro, setEscopoPacoteOutro] = useState(lead.escopoPacoteOutro || "");
  const [musicaAoVivo, setMusicaAoVivo] = useState(!!lead.musicaAoVivo);
  const [decoracao, setDecoracao] = useState(!!lead.decoracao);
  const [observacoesCliente, setObservacoesCliente] = useState(lead.observacoesCliente || "");

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Monta (updates para o Firestore) + (linhas de diff pro histórico).
  const { updates, diffLinhas } = useMemo(() => {
    const up: Record<string, unknown> = {};
    const diff: string[] = [];
    const conv = Number(numConvidados) || 0;

    const nomeT = nome.trim(), waT = whatsapp.trim(), emailT = email.trim();
    const cnpjT = cnpj.trim(), rsT = razaoSocial.trim();
    if (nomeT && nomeT !== (lead.cliente.nome || "")) { up["cliente.nome"] = nomeT; diff.push(`Nome: "${lead.cliente.nome || "—"}" → "${nomeT}"`); }
    if (waT !== (lead.cliente.whatsapp || "")) { up["cliente.whatsapp"] = waT; diff.push(`WhatsApp: ${lead.cliente.whatsapp || "—"} → ${waT || "—"}`); }
    if (emailT !== (lead.cliente.email || "")) { up["cliente.email"] = emailT; diff.push(`E-mail: ${lead.cliente.email || "—"} → ${emailT || "—"}`); }
    if (tipoPessoa !== (lead.cliente.tipoPessoa || "PF")) { up["cliente.tipoPessoa"] = tipoPessoa; diff.push(`Tipo: ${lead.cliente.tipoPessoa || "PF"} → ${tipoPessoa}`); }
    // CNPJ/razão só fazem sentido se PJ; se virou PF, limpa.
    if (tipoPessoa === "PJ") {
      if (cnpjT !== (lead.cliente.cnpj || "")) { up["cliente.cnpj"] = cnpjT; diff.push(`CNPJ: ${lead.cliente.cnpj || "—"} → ${cnpjT || "—"}`); }
      if (rsT !== (lead.cliente.razaoSocial || "")) { up["cliente.razaoSocial"] = rsT; diff.push(`Razão social: ${lead.cliente.razaoSocial || "—"} → ${rsT || "—"}`); }
    } else {
      if (lead.cliente.cnpj) { up["cliente.cnpj"] = ""; }
      if (lead.cliente.razaoSocial) { up["cliente.razaoSocial"] = ""; }
    }
    // Dados pra contrato
    const cpfT = cpf.trim(), endT = endereco.trim(), repNT = repNome.trim(), repCT = repCpf.trim();
    if (cpfT !== (lead.cliente.cpf || "")) { up["cliente.cpf"] = cpfT; diff.push(`CPF: ${lead.cliente.cpf || "—"} → ${cpfT || "—"}`); }
    if (endT !== (lead.cliente.endereco || "")) { up["cliente.endereco"] = endT; diff.push(`Endereço: ${lead.cliente.endereco || "—"} → ${endT || "—"}`); }
    if (repNT !== (lead.cliente.representanteLegal?.nome || "")) { up["cliente.representanteLegal.nome"] = repNT; diff.push(`Representante: ${lead.cliente.representanteLegal?.nome || "—"} → ${repNT || "—"}`); }
    if (repCT !== (lead.cliente.representanteLegal?.cpf || "")) { up["cliente.representanteLegal.cpf"] = repCT; diff.push(`CPF do representante: ${lead.cliente.representanteLegal?.cpf || "—"} → ${repCT || "—"}`); }

    if (dataDesejada && dataDesejada !== (lead.dataDesejada || "")) { up.dataDesejada = dataDesejada; diff.push(`Data: ${fmtData(lead.dataDesejada)} → ${fmtData(dataDesejada)}`); }
    if (dataAlternativa !== (lead.dataAlternativa || "")) { up.dataAlternativa = dataAlternativa; diff.push(`Data alternativa: ${lead.dataAlternativa ? fmtData(lead.dataAlternativa) : "—"} → ${dataAlternativa ? fmtData(dataAlternativa) : "—"}`); }
    const horaMudou = horaInicio !== (lead.horaInicio || "") || horaFim !== (lead.horaFim || "");
    if (horaMudou) {
      up.horaInicio = horaInicio; up.horaFim = horaFim;
      up.slot = slotDoHorario(horaInicio, horaFim);
      up.duracaoEstimadaHoras = duracaoHoras(horaInicio, horaFim);
      diff.push(`Horário: ${lead.horaInicio || "—"}–${lead.horaFim || "—"} → ${horaInicio || "—"}–${horaFim || "—"}`);
    }
    if (conv !== (lead.numConvidados ?? 0)) { up.numConvidados = conv; diff.push(`Convidados: ${lead.numConvidados ?? 0} → ${conv}`); }
    if (ocasiao !== lead.ocasiao) { up.ocasiao = ocasiao; diff.push(`Ocasião: ${OCASIAO_LABEL[lead.ocasiao] || lead.ocasiao} → ${OCASIAO_LABEL[ocasiao] || ocasiao}`); }
    if (ocasiao === "outros" && ocasiaoOutros.trim() !== (lead.ocasiaoOutros || "")) { up.ocasiaoOutros = ocasiaoOutros.trim(); diff.push(`Ocasião (outros): ${lead.ocasiaoOutros || "—"} → ${ocasiaoOutros.trim() || "—"}`); }
    if (modeloEvento !== lead.modeloEvento) { up.modeloEvento = modeloEvento; diff.push(`Modelo: ${MODELO_LABEL[lead.modeloEvento] || lead.modeloEvento} → ${MODELO_LABEL[modeloEvento] || modeloEvento}`); }
    if (modeloEvento === "pacote_por_pessoa") {
      if (escopoPacote && escopoPacote !== (lead.escopoPacote || "")) { up.escopoPacote = escopoPacote; diff.push(`Pacote: ${lead.escopoPacote ? ESCOPO_PACOTE_LABEL[lead.escopoPacote] : "—"} → ${ESCOPO_PACOTE_LABEL[escopoPacote as keyof typeof ESCOPO_PACOTE_LABEL] || escopoPacote}`); }
      if (escopoPacote === "outro" && escopoPacoteOutro.trim() !== (lead.escopoPacoteOutro || "")) { up.escopoPacoteOutro = escopoPacoteOutro.trim(); diff.push(`Pacote (outro): ${lead.escopoPacoteOutro || "—"} → ${escopoPacoteOutro.trim() || "—"}`); }
    }
    if (musicaAoVivo !== !!lead.musicaAoVivo) { up.musicaAoVivo = musicaAoVivo; diff.push(`Música ao vivo: ${simNao(!!lead.musicaAoVivo)} → ${simNao(musicaAoVivo)}`); }
    if (decoracao !== !!lead.decoracao) { up.decoracao = decoracao; diff.push(`Decoração própria: ${simNao(!!lead.decoracao)} → ${simNao(decoracao)}`); }
    if (observacoesCliente.trim() !== (lead.observacoesCliente || "")) { up.observacoesCliente = observacoesCliente.trim(); diff.push("Observações do cliente atualizadas"); }

    return { updates: up, diffLinhas: diff };
  }, [nome, whatsapp, email, tipoPessoa, cnpj, razaoSocial, cpf, endereco, repNome, repCpf, dataDesejada, dataAlternativa, horaInicio, horaFim, numConvidados, ocasiao, ocasiaoOutros, modeloEvento, escopoPacote, escopoPacoteOutro, musicaAoVivo, decoracao, observacoesCliente, lead]);

  const nMudancas = diffLinhas.length;

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("O nome do cliente não pode ficar vazio."); return; }
    if (horaInicio && horaFim && horaFim <= horaInicio) { setErro("O horário de fim tem que ser depois do início."); return; }
    if (nMudancas === 0) { onClose(); return; }
    setSalvando(true);
    try {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ ...updates, atualizadoEm: new Date().toISOString(), updatedAt: new Date().toISOString() }));
      try {
        await registrarTratativa({
          restaurantId: lead.restaurantId, leadId: lead.id, canal: "sistema",
          porId: meId, porNome: meNome, manual: true,
          texto: `✏️ Dados do lead editados:\n• ${diffLinhas.join("\n• ")}`,
        });
      } catch { /* log é best-effort */ }
      onClose();
    } catch (e) {
      setErro("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  }

  const inCls = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const lblCls = "text-[11px] font-semibold text-gray-500 dark:text-gray-400";

  return (
    <Modal title="✏️ Editar lead" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Cliente */}
        <section className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Cliente</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 sm:col-span-2"><span className={lblCls}>Nome</span>
              <input value={nome} onChange={e => setNome(e.target.value)} className={inCls} /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>WhatsApp</span>
              <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} className={inCls} placeholder="(91) 90000-0000" /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>E-mail</span>
              <input value={email} onChange={e => setEmail(e.target.value)} className={inCls} type="email" /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>Tipo</span>
              <select value={tipoPessoa} onChange={e => setTipoPessoa(e.target.value as "PF" | "PJ")} className={inCls}>
                <option value="PF">Pessoa física (PF)</option>
                <option value="PJ">Pessoa jurídica (PJ)</option>
              </select></label>
            {tipoPessoa === "PJ" && (
              <>
                <label className="flex flex-col gap-1"><span className={lblCls}>CNPJ</span>
                  <input value={cnpj} onChange={e => setCnpj(e.target.value)} className={inCls} /></label>
                <label className="flex flex-col gap-1 sm:col-span-2"><span className={lblCls}>Razão social</span>
                  <input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)} className={inCls} /></label>
              </>
            )}
            {tipoPessoa === "PF" && (
              <label className="flex flex-col gap-1"><span className={lblCls}>CPF <span className="text-gray-400 normal-case">(contrato)</span></span>
                <input value={cpf} onChange={e => setCpf(e.target.value)} placeholder="000.000.000-00" className={inCls} /></label>
            )}
            <label className="flex flex-col gap-1 sm:col-span-2"><span className={lblCls}>Endereço <span className="text-gray-400 normal-case">(contrato)</span></span>
              <input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, nº, bairro, cidade/UF, CEP" className={inCls} /></label>
            {tipoPessoa === "PJ" && (
              <>
                <label className="flex flex-col gap-1"><span className={lblCls}>Representante legal <span className="text-gray-400 normal-case">(quem assina)</span></span>
                  <input value={repNome} onChange={e => setRepNome(e.target.value)} className={inCls} /></label>
                <label className="flex flex-col gap-1"><span className={lblCls}>CPF do representante</span>
                  <input value={repCpf} onChange={e => setRepCpf(e.target.value)} placeholder="000.000.000-00" className={inCls} /></label>
              </>
            )}
          </div>
        </section>

        {/* Evento */}
        <section className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Evento desejado</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className={lblCls}>Data</span>
              <input type="date" value={dataDesejada} onChange={e => setDataDesejada(e.target.value)} className={inCls} /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>Data alternativa (opcional)</span>
              <input type="date" value={dataAlternativa} onChange={e => setDataAlternativa(e.target.value)} className={inCls} /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>Início</span>
              <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} className={inCls} /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>Fim</span>
              <input type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} className={inCls} /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>Convidados</span>
              <input type="number" min={0} value={numConvidados} onChange={e => setNumConvidados(e.target.value)} className={inCls} /></label>
            <label className="flex flex-col gap-1"><span className={lblCls}>Ocasião</span>
              <select value={ocasiao} onChange={e => setOcasiao(e.target.value as typeof ocasiao)} className={inCls}>
                <option value="aniversario">{OCASIAO_LABEL.aniversario}</option>
                <option value="corporativo">{OCASIAO_LABEL.corporativo}</option>
                <option value="encontro_amigos">{OCASIAO_LABEL.encontro_amigos}</option>
                <option value="outros">{OCASIAO_LABEL.outros}</option>
              </select></label>
            {ocasiao === "outros" && (
              <label className="flex flex-col gap-1 sm:col-span-2"><span className={lblCls}>Qual ocasião?</span>
                <input value={ocasiaoOutros} onChange={e => setOcasiaoOutros(e.target.value)} className={inCls} /></label>
            )}
            <label className="flex flex-col gap-1"><span className={lblCls}>Modelo</span>
              <select value={modeloEvento} onChange={e => setModeloEvento(e.target.value as typeof modeloEvento)} className={inCls}>
                <option value="locacao_consumo_livre">{MODELO_LABEL.locacao_consumo_livre}</option>
                <option value="pacote_por_pessoa">{MODELO_LABEL.pacote_por_pessoa}</option>
              </select></label>
            {modeloEvento === "pacote_por_pessoa" && (
              <label className="flex flex-col gap-1"><span className={lblCls}>Escopo do pacote</span>
                <select value={escopoPacote} onChange={e => setEscopoPacote(e.target.value as typeof escopoPacote)} className={inCls}>
                  <option value="">— escolher —</option>
                  <option value="somente_comidas">{ESCOPO_PACOTE_LABEL.somente_comidas}</option>
                  <option value="comidas_bebidas_nao_alcoolicas">{ESCOPO_PACOTE_LABEL.comidas_bebidas_nao_alcoolicas}</option>
                  <option value="comidas_bebidas_alcoolicas">{ESCOPO_PACOTE_LABEL.comidas_bebidas_alcoolicas}</option>
                  <option value="outro">{ESCOPO_PACOTE_LABEL.outro}</option>
                </select></label>
            )}
            {modeloEvento === "pacote_por_pessoa" && escopoPacote === "outro" && (
              <label className="flex flex-col gap-1 sm:col-span-2"><span className={lblCls}>Qual pacote?</span>
                <input value={escopoPacoteOutro} onChange={e => setEscopoPacoteOutro(e.target.value)} className={inCls} /></label>
            )}
          </div>
          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={musicaAoVivo} onChange={e => setMusicaAoVivo(e.target.checked)} /> Música ao vivo
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={decoracao} onChange={e => setDecoracao(e.target.checked)} /> Decoração própria
            </label>
          </div>
          <label className="flex flex-col gap-1"><span className={lblCls}>Observações do cliente</span>
            <textarea value={observacoesCliente} onChange={e => setObservacoesCliente(e.target.value)} rows={2}
              className="w-full px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" /></label>
        </section>

        {erro && <div className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2">{erro}</div>}

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <span className="text-[11px] text-gray-500">
            {nMudancas === 0 ? "Nenhuma alteração" : `${nMudancas} alteração(ões) — ficam registradas no histórico`}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
