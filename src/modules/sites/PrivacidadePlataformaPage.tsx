// Política de privacidade da PLATAFORMA (planejamento.app), acessível em
// /privacidade — pública, sem auth e sem dependência de restaurante.
// Usada, entre outras coisas, pra publicar o app de integração do WhatsApp
// na Meta (que exige uma URL de política de privacidade válida).

const EMAIL = "gustavo@quibebe.com.br";
const EMPRESA = "Quibebe Cozinha LTDA";
const PRODUTO = "Planejamento.app";

export function PrivacidadePlataformaPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#f7f3e9", padding: "40px 20px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: 16, padding: "40px 32px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#1a1a1a", marginBottom: 4 }}>Política de Privacidade</h1>
        <p style={{ fontSize: 14, color: "#888", marginBottom: 28 }}>{PRODUTO} · Última atualização: 04/07/2026</p>

        <div style={{ fontSize: 15, lineHeight: 1.7, color: "#1a1a1a" }}>
          <h3 style={h3}>1. Quem somos</h3>
          <p>
            O <strong>{PRODUTO}</strong> é uma plataforma de gestão operacional para restaurantes e empresas de
            alimentação, operada por <strong>{EMPRESA}</strong>. Esta política descreve como tratamos os dados
            pessoais dos usuários da plataforma, em conformidade com a Lei Geral de Proteção de Dados
            (LGPD — Lei nº 13.709/2018).
          </p>

          <h3 style={h3}>2. Quais dados coletamos</h3>
          <ul style={ul}>
            <li><strong>Dados de conta</strong>: nome, e-mail, CPF, telefone/WhatsApp, cargo e vínculo com o restaurante.</li>
            <li><strong>Dados operacionais</strong> inseridos no uso do sistema (escalas, ponto, checklists, contagens, comunicados, etc).</li>
            <li><strong>Mensagens de WhatsApp</strong> trocadas com o número oficial da plataforma (ver seção 4).</li>
            <li><strong>Dados técnicos</strong>: registros de acesso e uso, necessários à segurança e ao funcionamento.</li>
          </ul>

          <h3 style={h3}>3. Pra que usamos</h3>
          <ul style={ul}>
            <li>Fornecer e operar as funcionalidades da plataforma.</li>
            <li>Autenticar usuários e controlar permissões de acesso.</li>
            <li>Enviar e receber comunicações operacionais (inclusive por WhatsApp) — lembretes, links de formulários e avisos.</li>
            <li>Cumprir obrigações legais e manter registros exigidos por lei.</li>
          </ul>

          <h3 style={h3}>4. WhatsApp</h3>
          <p>
            Usamos a <strong>Plataforma do WhatsApp Business</strong> (fornecida pela Meta) para enviar e receber
            mensagens operacionais entre a empresa e seus colaboradores. Quando você envia uma mensagem para o número
            oficial do {PRODUTO}, o <strong>conteúdo da mensagem, seu número e seu nome de exibição</strong> são
            recebidos e armazenados para que a equipe possa ler e responder pela própria plataforma.
          </p>
          <p style={{ marginTop: 12 }}>
            As mensagens são usadas <strong>exclusivamente</strong> para a comunicação operacional relacionada ao
            serviço. Não usamos o conteúdo para publicidade e não vendemos esses dados. O tráfego das mensagens é
            processado pela Meta conforme os termos e a política de privacidade dela.
          </p>

          <h3 style={h3}>5. Com quem compartilhamos</h3>
          <p>
            Não vendemos nem compartilhamos dados pessoais com terceiros para fins de marketing. Utilizamos provedores
            de infraestrutura estritamente para operar o serviço:
          </p>
          <ul style={ul}>
            <li><strong>Google / Firebase (Google Cloud)</strong> — hospedagem, banco de dados e autenticação (data center em São Paulo).</li>
            <li><strong>Meta / WhatsApp</strong> — envio e recebimento de mensagens pela API oficial.</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            Também podemos divulgar dados quando exigido por obrigação legal ou ordem judicial.
          </p>

          <h3 style={h3}>6. Como armazenamos e protegemos</h3>
          <p>
            Os dados ficam em servidores criptografados (infraestrutura Firebase / Google Cloud). O acesso é restrito
            a pessoas autorizadas e protegido por autenticação. Adotamos boas práticas de segurança para prevenir
            acessos não autorizados.
          </p>

          <h3 style={h3}>7. Retenção</h3>
          <p>
            Mantemos os dados pelo tempo necessário para prestar o serviço e cumprir obrigações legais. Mensagens e
            registros operacionais podem ser mantidos como histórico de relacionamento e apagados mediante solicitação,
            salvo quando a lei exigir a guarda por prazo determinado.
          </p>

          <h3 style={h3}>8. Seus direitos (LGPD Art. 18)</h3>
          <ul style={ul}>
            <li><strong>Acesso</strong>, <strong>correção</strong>, <strong>exclusão</strong> e <strong>portabilidade</strong> dos seus dados.</li>
            <li><strong>Revogar consentimento</strong> a qualquer momento.</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            Para exercer qualquer direito, entre em contato pelo e-mail abaixo.
          </p>

          <h3 style={h3}>9. Contato</h3>
          <p>
            Dúvidas ou solicitações sobre privacidade e dados: <strong>{EMAIL}</strong>.
          </p>

          <hr style={{ margin: "32px 0", borderColor: "#eee" }} />
          <p style={{ fontSize: 13, color: "#888" }}>
            Esta política pode ser atualizada periodicamente. Recomendamos consultá-la regularmente.
          </p>
        </div>
      </div>
    </div>
  );
}

const h3: React.CSSProperties = { marginTop: 26, marginBottom: 10, fontSize: 17, fontWeight: 700 };
const ul: React.CSSProperties = { paddingLeft: 22, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 };
