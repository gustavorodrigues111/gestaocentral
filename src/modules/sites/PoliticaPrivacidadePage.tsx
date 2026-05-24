import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { SiteConfig } from "../../core/types";
import { SiteFormShell, SiteFormScreen } from "./shared/SiteFormShell";

// Página pública de política de privacidade (LGPD). Acessível em
// /politica/:slug. Renderiza texto modelo personalizado com o nome do
// restaurante. Link no rodapé do site público.
export function PoliticaPrivacidadePage() {
  const { slug } = useParams<{ slug: string }>();
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "sitesConfig"), where("slug", "==", slug)));
        if (snap.empty) {
          setErro("Site não encontrado.");
          return;
        }
        const doc = snap.docs[0]!;
        setSiteConfig({ id: doc.id, ...doc.data() } as SiteConfig);
      } catch (e) {
        console.error(e);
        setErro("Erro ao carregar.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Carregando...</div>;
  if (erro || !siteConfig) {
    return <SiteFormScreen siteConfig={siteConfig} icone="⚠️" titulo="Erro" mensagem={erro || "Site não encontrado."} />;
  }

  const nomeRest = siteConfig.slug || "o restaurante";
  const emailContato = siteConfig.emailContato || "—";
  const telefone = siteConfig.telefone || "—";
  const restaurantId = siteConfig.restaurantId;

  return (
    <SiteFormShell siteConfig={siteConfig} titulo="Política de Privacidade" maxWidth={760}>
      <div style={{ fontSize: 15, lineHeight: 1.7, color: "#1a1a1a" }}>
        <p style={{ fontStyle: "italic", color: "#666", marginBottom: 24 }}>
          Última atualização: {new Date().toLocaleDateString("pt-BR")}
        </p>

        <h3 style={{ marginTop: 24, marginBottom: 12 }}>1. Quem somos</h3>
        <p>
          Esta política descreve como <strong>{nomeRest}</strong> trata os dados pessoais
          coletados através deste site, em conformidade com a Lei Geral de Proteção
          de Dados (LGPD — Lei nº 13.709/2018).
        </p>

        <h3 style={{ marginTop: 24, marginBottom: 12 }}>2. Quais dados coletamos</h3>
        <p>Quando você usa nossos formulários (reservas, eventos, candidatura), coletamos:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li><strong>Nome completo</strong></li>
          <li><strong>Telefone (WhatsApp)</strong></li>
          <li><strong>Email</strong> (opcional na reserva, obrigatório em candidaturas)</li>
          <li><strong>Observações</strong> que você fornece (alergias, restrições alimentares, ocasião do evento, etc)</li>
          <li><strong>Currículo</strong> (somente em candidaturas Trabalhe Conosco)</li>
          <li><strong>CNPJ e razão social</strong> (somente em eventos contratados por empresas)</li>
        </ul>

        <h3 style={{ marginTop: 24, marginBottom: 12 }}>3. Pra que usamos</h3>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li><strong>Processar sua solicitação</strong> (reserva, evento, candidatura)</li>
          <li><strong>Entrar em contato</strong> pra confirmar e tirar dúvidas</li>
          <li><strong>Histórico de relacionamento</strong> (CRM): te atender melhor quando voltar</li>
          <li><strong>Conformidade legal</strong> (manter registros pelo prazo exigido por lei)</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          <strong>Não compartilhamos seus dados com terceiros</strong> sem seu consentimento, exceto quando exigido por
          obrigação legal ou ordem judicial.
        </p>

        <h3 style={{ marginTop: 24, marginBottom: 12 }}>4. Seus direitos (LGPD Art. 18)</h3>
        <p>Você tem direito a:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li><strong>Acesso</strong>: receber uma cópia dos seus dados conosco</li>
          <li><strong>Correção</strong>: pedir correção de dados incompletos ou desatualizados</li>
          <li><strong>Exclusão</strong>: solicitar a eliminação dos seus dados (anonimização)</li>
          <li><strong>Portabilidade</strong>: receber seus dados em formato legível por máquina</li>
          <li><strong>Revogar consentimento</strong> a qualquer momento</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          Pra exercer qualquer direito, use{" "}
          <Link to={`/r/excluir-dados/${restaurantId}`} style={{ color: siteConfig.tema?.corPrimaria || "#1a5c2a", fontWeight: 600 }}>
            o formulário de solicitação
          </Link>{" "}
          ou nos contate em <strong>{emailContato}</strong>.
        </p>

        <h3 style={{ marginTop: 24, marginBottom: 12 }}>5. Como armazenamos</h3>
        <p>
          Seus dados ficam em servidores criptografados (infraestrutura Firebase / Google Cloud, com data center
          em São Paulo). O acesso aos dados pessoais é restrito a pessoas autorizadas e protegido por autenticação.
        </p>
        <p style={{ marginTop: 12 }}>
          O site segue boas práticas: dados públicos (estatísticas de disponibilidade) ficam separados de dados
          pessoais (nome, telefone, email), e apenas pessoas autorizadas conseguem acessar os pessoais.
        </p>

        <h3 style={{ marginTop: 24, marginBottom: 12 }}>6. Prazo de retenção</h3>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li><strong>Reservas</strong>: mantidas indefinidamente como histórico de relacionamento (você pode pedir exclusão a qualquer momento)</li>
          <li><strong>Candidaturas</strong>: 12 meses após o envio, salvo solicitação contrária</li>
          <li><strong>Eventos</strong>: enquanto a relação contratual estiver ativa + 5 anos pra fins fiscais</li>
        </ul>

        <h3 style={{ marginTop: 24, marginBottom: 12 }}>7. Contato</h3>
        <p>
          Dúvidas ou solicitações: <strong>{emailContato}</strong>
          {telefone !== "—" && <> · <strong>{telefone}</strong></>}
        </p>

        <hr style={{ margin: "32px 0", borderColor: "#eee" }} />
        <p style={{ fontSize: 13, color: "#888" }}>
          Esta política pode ser atualizada periodicamente. Recomendamos consultar regularmente.
        </p>
      </div>
    </SiteFormShell>
  );
}
