// ════════════════════════════════════════════════════════════════════════════
//  Modal de iniciar admissão — RH preenche dados básicos do candidato +
//  cargo. Schema do form é congelado na admissão (snapshot).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import type { Admissao, Cargo, FormField } from "../../core/types";
import {
  buscarPessoaPorCpf,
  buscarPessoaPorEmail,
  type IniciarAdmissaoInput,
} from "../../core/admissao/admissaoHelpers";

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

type Props = {
  rid: string;
  cargos: Cargo[];
  schemaUsado: FormField[];
  // Pré-preenchimento (ex.: vindo de um candidato aprovado no Processo Seletivo).
  defaults?: { nome?: string; email?: string; whatsapp?: string; cargoId?: string };
  onClose: () => void;
  // O caller adiciona o restaurantSnapshot — modal só lida com os dados do candidato.
  onConfirm: (input: Omit<IniciarAdmissaoInput, "restaurantSnapshot">) => Promise<Admissao | undefined>;
};

export function IniciarAdmissaoModal({ rid, cargos, schemaUsado, defaults, onClose, onConfirm }: Props) {
  const [nome, setNome] = useState(defaults?.nome || "");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState(defaults?.email || "");
  const [whatsapp, setWhatsapp] = useState((defaults?.whatsapp || "").replace(/\D/g, ""));
  const [cargoId, setCargoId] = useState(defaults?.cargoId || "");
  const [salario, setSalario] = useState("");
  const [dataAdmissao, setDataAdmissao] = useState("");
  const [cargoConfianca, setCargoConfianca] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Pessoa encontrada pelo CPF (se houver)
  const [pessoaExistente, setPessoaExistente] = useState<{
    id: string;
    nome: string;
    email: string;
    whatsapp?: string;
    restaurantIds: string[];
  } | null>(null);
  const [buscando, setBuscando] = useState(false);
  // Quando true, dados foram pré-preenchidos a partir da Pessoa existente
  const [pessoaIdVinculada, setPessoaIdVinculada] = useState<string | undefined>(undefined);

  // Busca debounced quando CPF completa 11 dígitos
  useEffect(() => {
    const d = onlyDigits(cpf);
    if (d.length !== 11) {
      setPessoaExistente(null);
      return;
    }
    let cancelled = false;
    setBuscando(true);
    const t = setTimeout(() => {
      buscarPessoaPorCpf(d)
        .then((p) => { if (!cancelled) setPessoaExistente(p); })
        .catch(() => { if (!cancelled) setPessoaExistente(null); })
        .finally(() => { if (!cancelled) setBuscando(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cpf]);

  // Conflito de e-mail: outra Pessoa (não o vínculo atual) já usa esse e-mail
  // → bloqueia o save porque viraria login duplicado no futuro.
  const [emailConflito, setEmailConflito] = useState<{
    id: string;
    nome: string;
    cpf?: string;
  } | null>(null);
  const [verificandoEmail, setVerificandoEmail] = useState(false);

  useEffect(() => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) {
      setEmailConflito(null);
      return;
    }
    let cancelled = false;
    setVerificandoEmail(true);
    const t = setTimeout(() => {
      buscarPessoaPorEmail(e)
        .then((p) => {
          if (cancelled) return;
          // Conflito SÓ se a pessoa encontrada NÃO é a vinculada pelo CPF
          if (p && p.id !== pessoaIdVinculada) {
            setEmailConflito(p);
          } else {
            setEmailConflito(null);
          }
        })
        .catch(() => { if (!cancelled) setEmailConflito(null); })
        .finally(() => { if (!cancelled) setVerificandoEmail(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [email, pessoaIdVinculada]);

  // Pré-preenche dados a partir da Pessoa existente. Mantém edição livre.
  function usarPessoaExistente() {
    if (!pessoaExistente) return;
    if (pessoaExistente.nome && !nome) setNome(pessoaExistente.nome);
    if (pessoaExistente.email && !email) setEmail(pessoaExistente.email);
    if (pessoaExistente.whatsapp && !whatsapp) setWhatsapp(pessoaExistente.whatsapp);
    setPessoaIdVinculada(pessoaExistente.id);
  }

  // Desfaz o vínculo (caso o RH decida criar Pessoa nova mesmo havendo casamento)
  function desvincularPessoa() {
    setPessoaIdVinculada(undefined);
  }

  const cargosAtivos = cargos.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));

  async function salvar() {
    setErro("");
    const nomeT = nome.trim();
    const cpfD = onlyDigits(cpf);
    const emailT = email.trim().toLowerCase();
    const whatsD = onlyDigits(whatsapp);
    if (!nomeT) { setErro("Nome completo é obrigatório."); return; }
    if (cpfD.length !== 11) { setErro("CPF inválido — precisa de 11 dígitos."); return; }
    // CPF já cadastrado e RH ignorou o banner → bloqueia. Se quiser mesmo
    // criar admissão pra essa pessoa, precisa clicar "Usar dados desta
    // pessoa" no banner verde (vincula). Senão, geraria 2 Pessoa com mesmo
    // CPF — fonte garantida de bug futuro.
    if (pessoaExistente && !pessoaIdVinculada) {
      setErro(
        `Esse CPF já tem cadastro no sistema (${pessoaExistente.nome}). ` +
        `Clique em "Usar dados desta pessoa" acima pra vincular a admissão ` +
        `ao cadastro existente, ou troque o CPF se não for essa pessoa.`,
      );
      return;
    }
    if (!emailT || !emailT.includes("@")) { setErro("E-mail inválido."); return; }
    if (emailConflito) {
      setErro(
        `Esse e-mail já está vinculado a outra pessoa cadastrada (${emailConflito.nome}). ` +
        `Não dá pra usar — viraria login duplicado.`,
      );
      return;
    }
    if (whatsD.length < 10) { setErro("WhatsApp inválido — informe DDD + número."); return; }
    if (!cargoId) { setErro("Selecione o cargo."); return; }

    const salarioNum = salario ? parseFloat(salario.replace(",", ".")) : undefined;
    if (salario && (!salarioNum || Number.isNaN(salarioNum))) {
      setErro("Salário inválido."); return;
    }

    setSalvando(true);
    try {
      await onConfirm({
        restaurantId: rid,
        candidato: { nome: nomeT, cpf: cpfD, email: emailT, whatsapp: whatsD },
        cargoId,
        salario: salarioNum,
        dataAdmissao: dataAdmissao || undefined,
        cargoConfianca: cargoConfianca || undefined,
        schemaUsado,
        pessoaIdVinculada,
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao iniciar admissão.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="🪪 Iniciar admissão" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Preencha os dados básicos do candidato. O resto da ficha será preenchido por ele via link.
        </p>

        {/* CPF primeiro — dispara busca por Pessoa existente. Antes de
            digitar o resto, RH pode reusar cadastro pré-existente. */}
        <Input label="CPF *" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" autoFocus />

        {/* Banner: pessoa já cadastrada (mesmo CPF). Permite reutilizar dados
            e vincula a admissão à Pessoa existente. */}
        {buscando && onlyDigits(cpf).length === 11 && (
          <div className="text-[11px] text-gray-500 italic">Verificando se já existe pessoa com esse CPF…</div>
        )}
        {pessoaExistente && !pessoaIdVinculada && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-800 p-3 space-y-2">
            <div className="text-xs text-emerald-900 dark:text-emerald-300">
              ✓ Já existe uma pessoa cadastrada com esse CPF: <strong>{pessoaExistente.nome}</strong>
              {pessoaExistente.email && <> · {pessoaExistente.email}</>}
              <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                Em {pessoaExistente.restaurantIds.length} restaurante(s). Pode reutilizar os dados — não
                duplica cadastro de Pessoa quando você admitir.
              </div>
            </div>
            <Button size="sm" onClick={usarPessoaExistente}>
              ↪ Usar dados desta pessoa
            </Button>
          </div>
        )}
        {pessoaIdVinculada && (
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-300 dark:border-indigo-800 p-2 flex items-center justify-between gap-2">
            <span className="text-xs text-indigo-900 dark:text-indigo-300">
              🔗 Vinculado à Pessoa <strong>{pessoaExistente?.nome}</strong>. A admissão vai reusar esse cadastro.
            </span>
            <button
              type="button"
              onClick={desvincularPessoa}
              className="text-[10px] text-rose-600 hover:underline"
            >
              desvincular
            </button>
          </div>
        )}

        <Input label="Nome completo *" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome e sobrenome" />
        <Input label="E-mail *" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@dominio.com" type="email" />
        {verificandoEmail && email.includes("@") && (
          <div className="text-[11px] text-gray-500 italic -mt-2">Verificando e-mail…</div>
        )}
        {emailConflito && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-300 dark:border-rose-800 p-2 -mt-2">
            <div className="text-xs text-rose-800 dark:text-rose-300">
              ❌ Esse e-mail já está cadastrado em outra pessoa: <strong>{emailConflito.nome}</strong>
              {emailConflito.cpf && <> (CPF {emailConflito.cpf})</>}
            </div>
            <div className="text-[10px] text-rose-700/80 dark:text-rose-400/80 mt-0.5">
              Cada pessoa precisa ter e-mail único — é o que vai virar login no sistema.
              Use outro e-mail (ou{" "}
              {emailConflito.cpf && emailConflito.cpf === onlyDigits(cpf)
                ? "vincule essa pessoa pelo CPF acima"
                : "verifique se o CPF está correto"}).
            </div>
          </div>
        )}
        <Input label="WhatsApp *" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Cargo *</label>
          <select
            value={cargoId}
            onChange={(e) => setCargoId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">— selecione —</option>
            {cargosAtivos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({c.area})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Salário (opcional)" value={salario} onChange={(e) => setSalario(e.target.value)} placeholder="2500,00" inputMode="decimal" />
          <Input label="Data de admissão" value={dataAdmissao} onChange={(e) => setDataAdmissao(e.target.value)} type="date" />
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 select-none">
          <input
            type="checkbox"
            checked={cargoConfianca}
            onChange={(e) => setCargoConfianca(e.target.checked)}
            className="accent-indigo-600"
          />
          Cargo de confiança
        </label>

        {erro && <div className="text-xs text-red-600 dark:text-red-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Iniciando…" : "Iniciar admissão"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
