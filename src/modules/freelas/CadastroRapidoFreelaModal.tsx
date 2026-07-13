import { useState } from "react";
import { addDoc, collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Pessoa } from "../../core/types";

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

type Props = {
  restaurantId: string;
  // Pré-preenche os campos (ex: vindo de uma candidatura no Processo Seletivo).
  defaults?: { nome?: string; whatsapp?: string; cpf?: string; pix?: string };
  // Quando o cadastro termina (ou já existia uma pessoa com esse CPF),
  // devolve a Pessoa pra o caller usar (ex: pré-preencher o turno).
  onSaved: (pessoa: Pessoa) => void;
  onClose: () => void;
};

// Cadastro rápido de freela. Cria uma Pessoa "leve" no restaurante, com
// nome / CPF / PIX / WhatsApp obrigatórios. Permissões ficam vazias — o freela
// não acessa o app, é só pra ter cadastro de pagamento e identidade.
//
// Se já existir Pessoa com o mesmo CPF (em qualquer restaurante), oferece
// vincular a existente ao restaurante atual (evita duplicação).
export function CadastroRapidoFreelaModal({ restaurantId, defaults, onSaved, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [nome, setNome] = useState(defaults?.nome || "");
  const [cpf, setCpf] = useState(defaults?.cpf || "");
  const [pix, setPix] = useState(defaults?.pix || "");
  const [whatsapp, setWhatsapp] = useState(defaults?.whatsapp || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicada, setDuplicada] = useState<Pessoa | null>(null);

  async function salvar() {
    setErr("");
    setDuplicada(null);
    if (!me) return;
    const nomeT = nome.trim();
    const cpfD = onlyDigits(cpf);
    const pixT = pix.trim();
    const whatsT = onlyDigits(whatsapp);
    if (!nomeT) { setErr("Nome completo obrigatório"); return; }
    if (cpfD.length !== 11) { setErr("CPF inválido — precisa de 11 dígitos"); return; }
    if (!pixT) { setErr("Chave PIX obrigatória"); return; }
    if (whatsT.length < 10) { setErr("WhatsApp inválido — informe DDD + número"); return; }

    setSaving(true);
    try {
      // Procura por CPF já existente
      const dupSnap = await getDocs(
        query(collection(db, "pessoas"), where("cpf", "==", cpfD), limit(1)),
      );
      if (!dupSnap.empty) {
        const existente = { id: dupSnap.docs[0].id, ...dupSnap.docs[0].data() } as Pessoa;
        setDuplicada(existente);
        setSaving(false);
        return;
      }

      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, "pessoas"), {
        email: "",
        nome: nomeT,
        cpf: cpfD,
        whatsapp: whatsT,
        pix: pixT,
        isMaster: false,
        restaurantIds: [restaurantId],
        permissions: { [restaurantId]: {} },
        ativa: true,
        createdAt: now,
      });
      const novaPessoa: Pessoa = {
        id: ref.id,
        email: "",
        nome: nomeT,
        cpf: cpfD,
        whatsapp: whatsT,
        pix: pixT,
        isMaster: false,
        restaurantIds: [restaurantId],
        permissions: { [restaurantId]: {} },
        ativa: true,
        createdAt: now,
      };
      onSaved(novaPessoa);
    } catch (e) {
      console.error(e);
      setErr(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  }

  return (
    <Modal title="🎒 Cadastrar freela" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Cadastro mínimo pra pagar e identificar o freela. Os 4 campos são
          obrigatórios.
        </p>

        <Input
          label="Nome completo *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome e sobrenome"
        />
        <Input
          label="CPF *"
          value={cpf}
          onChange={(e) => setCpf(e.target.value)}
          inputMode="numeric"
          placeholder="000.000.000-00"
        />
        <Input
          label="Chave PIX *"
          value={pix}
          onChange={(e) => setPix(e.target.value)}
          placeholder="CPF, email, telefone ou chave aleatória"
        />
        <Input
          label="WhatsApp *"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          inputMode="tel"
          placeholder="(11) 99999-9999"
        />

        {err && (
          <div className="text-xs text-red-600 dark:text-red-400">{err}</div>
        )}
        {duplicada && (
          <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
            Já existe pessoa cadastrada com esse CPF (<strong>{duplicada.nome}</strong>).
            {duplicada.restaurantIds.includes(restaurantId) ? (
              <> Use essa pessoa direto no lançamento — clique em "Usar este cadastro".</>
            ) : (
              <> Adicione esta pessoa ao restaurante pela tela Pessoas, ou use o cadastro existente clicando em "Usar este cadastro".</>
            )}
            <div className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { onSaved(duplicada); }}
              >
                Usar este cadastro
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando…" : "Cadastrar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
