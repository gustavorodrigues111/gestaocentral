// Semente do Caderno — PENDÊNCIAS conhecidas por módulo (do histórico de trabalho).
// Só pendências (o que já foi feito não entra). A IA adiciona novas aqui conforme
// a gente trabalha; o estado (feito/pendente) e itens manuais vivem no Firestore.
// responsavel: "gustavo" (você) · "ia" (Claude) · ou nome livre.
import type { CadernoItem } from "../../core/types";

type Seed = { modulo: string; titulo: string; resp: "gustavo" | "ia" | string; descricao?: string };

const SEED: Seed[] = [
  // ── Geral / infra ──
  { modulo: "geral", resp: "gustavo", titulo: "Confirmar que o RESEND_API_KEY está setado na Vercel (RESEND_FROM_DEFAULT já está) — se os emails de reserva já saem, o convite de acesso por email também sai" },
  { modulo: "geral", resp: "gustavo", titulo: "Criar os templates válidos na Meta (aviso_fechamento com variáveis NUMERADAS, aviso_geral, lembrete_prazo) e excluir os rejeitados (acesso_inicial, novo_fechamento_de_caixa)", descricao: "As credenciais do WhatsApp Cloud API já estão na Vercel; foi só conteúdo/categoria." },
  { modulo: "geral", resp: "ia", titulo: "Padronizar layout/botões dos módulos no core/ui (design system) — executar no gatilho 'bora unificação', piloto Análise de Ponto" },

  // ── Drive / conta central ──
  { modulo: "recebimento", resp: "gustavo", titulo: "Configurar a CONTA CENTRAL do Drive na Vercel (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN) — sem isso os uploads caem no login Google de cada usuário e batem no bloqueio 'app só pode ser usado dentro da organização'", descricao: "Código já usa driveShared (central quando configurada). Refresh token via OAuth Playground com um client Web + a conta que dona da pasta. Vale pra Fechamento e Recebimento." },

  // ── Admissão ──
  { modulo: "admissao", resp: "ia", titulo: "Envio da ficha do candidato passa pelo servidor (/api/admissao-submit) — acabou o 'Missing or insufficient permissions'. Regra pública de escrita de admissoes TRAVADA (só authed). Pendente: validar que a foto (Storage) sobe como image/jpeg (rule exige jpeg/png)." },

  // ── Segurança Sanitária ──
  { modulo: "seguranca", resp: "gustavo", titulo: "Criar o template da lista-base, atribuir áreas dos itens e apagar as avaliações de teste antigas" },
  { modulo: "seguranca", resp: "ia", titulo: "PDF do relatório agora embute as fotos (seção Evidências) + Duplicar área (com itens) no editor de modelo. Caveat: só embute fotos com URL do Storage; fotos legado do Drive (driveId/webViewLink) não entram no PDF." },

  // ── Wiki de Processos (guias por área + agente de IA) ──
  { modulo: "wikiProcessos", resp: "gustavo", titulo: "Subir os guias HTML de Financeiro, Compras e Eventos (Pessoas já vem com o modelo inicial embutido)", descricao: "Módulo reformulado: cada área (Pessoas/Financeiro/Compras/Eventos) = 1 guia HTML + 1 agente de IA que responde a partir do guia. Upload em ⬆️ Publicar guia (salva em wikiGuias/{key}, sem deploy)." },
  { modulo: "wikiProcessos", resp: "ia", titulo: "Links do guia pro próprio sistema (deep-links) — decidir target (_top pra navegar o app x _blank) e como o iframe abre a rota certa do rid atual" },
  { modulo: "wikiProcessos", resp: "ia", titulo: "Avaliar reaproveitar o wikiGuias/wikiDocs como fonte da skill do Claude (SKILL.md de Pessoas) — hoje as references são geradas do HTML canônico por script externo" },
  { modulo: "wikiProcessos", resp: "gustavo", titulo: "Popular o acervo das áreas: subir regulamento interno, convenção coletiva e demais docs de referência (Acervo de cada área — PDF/imagem extraem texto sozinhos; docx/outros = colar texto)" },
  // ── Documentos (fábrica de documentos trabalhistas) ──
  { modulo: "documentos", resp: "ia", titulo: "Novos contratos de trabalho FEITO (setorizado + triagem + geração). api/contrato-preencher.py roda a skill (api/_contratos, 7 modelos, stdlib) → DOCX. Aba 'Novos contratos' com triagem→dados→gerar. Falta: PDF (LibreOffice no Railway), aditivos e termos como categorias próprias (skill de cada), puxar empregado direto da Admissão, e catálogos empresas/cargos virem do cadastro do app (hoje são JSON bundlado)." },
  { modulo: "documentos", resp: "gustavo", titulo: "Preencher os Dados trabalhistas das 4 empresas (🏢 Dados das empresas) — razão, CNPJ, endereço, cidade, e-mail, contato e conta salário. Sem isso os campos de empresa saem em branco." },
  { modulo: "documentos", resp: "ia", titulo: "IA redigir os textos livres (motivo da advertência etc.) a partir do relato — hoje o texto é digitado à mão no gerador. Endpoint dedicado + botão '✍️ IA redigir'." },
  { modulo: "documentos", resp: "gustavo", titulo: "Configurar o mapa Termo→Modelo por empresa (⚙️ Configurações › Termos da Admissão) — ex.: Contrato CLT→contrato de prazo determinado, Uniforme→ficha, EPI→termo de EPI. Sem o mapa, a Admissão segue no upload manual." },
  { modulo: "documentos", resp: "ia", titulo: "Fase 2 FEITA (Admissão gera termo pelo Documentos → Drive). Peça 1 FEITA: uniforme/EPI da ENTREGA já gera o termo do advogado (fábrica) nos 2 contextos + trava de C.A. Peça 2 FEITA: Documentos por cargo (Admissão → Configurações) → checklist já vem por cargo. Peça 3 FEITA: contratos puxam FUNÇÃO/REMUNERAÇÃO/ATIVIDADES do cadastro do cargo (salarioBase/descrição) no prefill. Falta polir: puxar ENDEREÇO/RG/CTPS do candidato (dadosPreenchidos) pro prefill." },
  { modulo: "admissao", resp: "gustavo", titulo: "Configurar 'Documentos por cargo' (Admissão → Configurações) — marcar por cargo quais termos do kit de assinatura aplicam. Vale pra admissões NOVAS (as existentes mantêm o que já tinham). Cargo sem ajustar = todos." },
  { modulo: "documentos", resp: "ia", titulo: "Ampliar o auto-preenchimento do empregado (RG, CTPS, endereço, salário) quando esses campos existirem no cadastro; hoje só nome/CPF/admissão vêm automáticos." },
  { modulo: "documentos", resp: "gustavo", titulo: "docx→PDF idêntico no app: quando quiser PDF direto (não pela skill), subir LibreOffice/Gotenberg no host do Railway (onde roda o Evolution) e o app chama. Por ora, DOCX no app + PDF pela skill." },
  { modulo: "documentos", resp: "ia", titulo: "Aba Histórico FEITA — lista documentosGerados por empresa e rebaixa o DOCX regenerando pelo input salvo (não guarda arquivo). Escopo por rid. Regra Firestore documentosGerados no ar." },
  { modulo: "documentos", resp: "ia", titulo: "Aba ⚙️ Cargos p/ contrato FEITA — configura por cargo do app (documentosCargos) os campos que o contrato usa: função legal, CBO, salário, regime, jornada, GORJETA MÉDIA (gorjeta_texto), atribuições, e (híbrido) ajuda de custo + dias presencial/casa. O contrato puxa o cargo da Admissão (cargoId) e usa essa config; cargo sem configurar avisa 'falta configurar'. Regra Firestore documentosCargos no ar." },
  { modulo: "documentos", resp: "gustavo", titulo: "Configurar os cargos p/ contrato (⚙️ Cargos p/ contrato) de cada empresa — sem isso o contrato sai sem CBO/jornada/gorjeta média. Basta preencher 1x por cargo." },
  { modulo: "documentos", resp: "ia", titulo: "Polir contrato: puxar ENDEREÇO/RG do candidato já entra via dadosDoCandidato; falta CTPS/PIS quando existir no dadosPreenchidos. E ainda faltam aditivos/termos como categorias próprias (skill de cada)." },
  { modulo: "tarefas", resp: "ia", titulo: "Anexo de link FEITO com form inline (fim do prompt() tosco): completa esquema http, nome automático pelo hostname, Enter/Esc; anexo já abre em nova aba." },

  // ── Pessoas / onboarding ──
  { modulo: "pessoas", resp: "gustavo", titulo: "Recuperação de senha 100% automática: liberar Admin SDK (org policy) OU configurar domínio/remetente verificado nos templates de Authentication do Firebase (pra o email de reset parar de cair no spam do Hotmail)", descricao: "Sem Admin não dá pra resetar senha de conta existente por código — só recriar. Hoje: apagar no Console + '🔁 Reenviar acesso (email)' recria e manda pelo Resend." },
  { modulo: "pessoas", resp: "ia", titulo: "P3 do redesenho de Pessoas: fundir o EmpregadoModal no cadastro" },
  { modulo: "pessoas", resp: "ia", titulo: "Escalas nomeadas — Parte B: alternância de escala no empregado (Parte A/catálogo já feita)" },
  { modulo: "pessoas", resp: "gustavo", titulo: "Corrigir admissões placeholder (~30 empregados com admissão fake 01/04/2026) via CSV pra os prazos 45/90 baterem" },

  // ── WhatsApp ──
  { modulo: "whatsapp", resp: "ia", titulo: "Aplicar o Storage no ENVIO de mídia grande (hoje só o recebimento sobe pro Storage)" },
  { modulo: "whatsapp", resp: "ia", titulo: "Spam: pular a resposta automática/bot de triagem no webhook para contatos marcados como spam" },
  { modulo: "whatsapp", resp: "gustavo", titulo: "Travar o host da Evolution (device-link) antes do primeiro cliente" },

  // ── Prazos / aposentadoria dos módulos antigos ──
  { modulo: "prazos", resp: "gustavo", titulo: "Confirmar migração e então apagar as coleções legadas contasFixas/manutencoes do Firestore" },
  { modulo: "prazos", resp: "ia", titulo: "Aposentar o Planner (desacoplar ContaFixaForm/ManutencaoForm) e deletar as páginas legadas ContasFixas/Manutenções" },
  { modulo: "prazos", resp: "ia", titulo: "Remover no-op/dead code do módulo Admissão: gerarCascataAdmissao e recalcularPrazosExperiencia" },

  // ── Cardápio ──
  { modulo: "cardapio", resp: "ia", titulo: "Render do cardápio no site público + PDF de impressão + tradução EN por IA" },
  { modulo: "cardapio", resp: "ia", titulo: "Ícones de bebida: silhueta preenchida + maior + coluna centrada uniforme (feito)", descricao: "Os 12 ícones do catálogo (iconesCardapio.tsx) foram redesenhados de traço → SILHUETA PREENCHIDA (fill + fill-rule evenodd p/ furos como o gelo do copo baixo). Tamanho aumentado (CardapioVisual ×2.3; site ×38/46 txCorpo) e coluna fixa CENTRADA por seção que usa ícone, descrição indentada. Verificado rasterizando via qlmanage." },
  { modulo: "cardapio", resp: "ia", titulo: "Selo da Carta Curadoria (LM · safra) na capa da Carta de Vinhos — desenhar em reportlab (círculo + 'CURADORIA DO SOMMELIER' + estrela). Ficou pra depois a pedido do usuário.", descricao: "Carta Curadoria já entrou na coluna esquerda da capa (título + bio + 5 vinhos, editável pelo agente via salvar_curadoria). Só o selo não." },

  // ── Vendas ──
  { modulo: "vendas", resp: "ia", titulo: "Editar/excluir venda + PDF de cobrança" },

  // ── Recebimento ──
  { modulo: "recebimento", resp: "ia", titulo: "Fase 2: OCR (Haiku) da nota + export PDF/XLSX" },

  // ── Fichas Técnicas ──
  { modulo: "fichas", resp: "gustavo", titulo: "Definir as 5 decisões pendentes antes de codar a evolução das Fichas Técnicas" },

  // ── Unificação tarefa/ação (Gestor de Tarefas × lente enxuta) ──
  { modulo: "planoDeAcao", resp: "ia", titulo: "Limpeza pós-unificação: apagar PlanoDeAcaoPage.tsx + AcaoModal.tsx (órfãos) e simplificar VirarAcaoModal pra só criar tarefa (remover o path 'acao' morto)", descricao: "Unificação Fases 1-4 feitas: tudo é Tarefa, coleção acoes aposentada. Sobrou código morto." },
  { modulo: "reunioes", resp: "ia", titulo: "Polish: modal da reunião em SEÇÕES roláveis (pauta→ata→tarefas) no lugar das abas + faixa 'Próximas reuniões' no Gestor", descricao: "O modal já ficou bem mais limpo (removido acoes legado + botão único); falta o redesenho em seções." },

  // ── Fechamento de Caixa ──
  { modulo: "fechamentoCaixa", resp: "gustavo", titulo: "OPCIONAL: vincular os sócios (Pessoas cadastradas) em Configurações pra receberem o resumo — email/WhatsApp vêm da ficha da pessoa", descricao: "Cadastre a pessoa em Pessoas e marque aqui. Sem vincular ninguém, o fechamento arquiva no Drive do mesmo jeito." },

  // ── Agentes de IA ──
  { modulo: "agentes", resp: "ia", titulo: "F1b: motor api/agente + chat (F1a de gestão já no ar)" },

  // ── Reservas / Concierge ──
  { modulo: "reservas", resp: "ia", titulo: "Concierge IA no WhatsApp: ligar no webhook + cron + booking agent (Fase 1 de config no ar)" },
  { modulo: "reservas", resp: "ia", titulo: "Unir mesas numa reserva (multi-mesa) — feito", descricao: "Reserva.mesaIds[] (retrocompat com mesaId legado via reservaMesaIds/reservaMesasNomes em core/reservas/mesas.ts). Form (ReservaModal) e chegada (ChegouModal) agora selecionam N mesas em chips/tiles: capacidade SOMADA (só avisa, não bloqueia) e mesa já ocupada no horário (±2h) fica BLOQUEADA. Lista e histórico mostram 'M15 + M16'. Pendente: WhatsApp/comprovante ainda não citam mesa." },

  // ── Escala ──
  { modulo: "escala", resp: "ia", titulo: "Solicitação de ajuste de escala: notificar o empregado quando aprovado/aplicado" },

  // ── Análise de ponto ──
  { modulo: "analise-ponto", resp: "ia", titulo: "Fechamento de ponto cockpit — Fase 2 (aba Inconsistências) e Fase 3 (correção in-app pelo empregado)" },
  { modulo: "analise-ponto", resp: "ia", titulo: "Comparação de escalas: horário cadastrado/dia + seletor de fonte + PDF de todos + confiança + ciclo de domingos (feito)", descricao: "A aba Escalas exibe entrada/intervalo/saída de cada fonte por dia, não só a carga. Seletor Comparar/Só Sólides/Só Planejamento. Detecta ⏰ horário diferente (ex: 08–17 × 09–18, mesma carga), ⏱ carga diferente e ➖ dia só num lado. Botão Exportar PDF (landscape, um bloco por pessoa, Sólides × planejamento.app) que sinaliza 🔒 cargo de confiança (não bate ponto) e o ciclo de domingos do planejamento.app (alternante A/B). Pendente: comparar por data-calendário (hoje é por dia-da-semana vigente) e ler o ciclo completo do alternante." },

  // ── Câmeras & Analytics ──
  { modulo: "cameras", resp: "gustavo", titulo: "Ativar o NUC central no escritório (mini-PC sempre ligado) — pré-requisito pra retomar a análise por câmera", descricao: "Piloto validou o caminho ponta a ponta: captura 1 foto/30s → Drive → análise, calibração das 36 mesas nas 3 câmeras, cruzamento com o POS Altec. Análise recorrente SEGURADA até o NUC estar de pé." },
  { modulo: "cameras", resp: "ia", titulo: "SEGURADO até o NUC: teste cego de ocupação — usuário não informa o número; entregar só couvert do POS + linha do tempo de mesas pela câmera, SEM estimar cabeça", descricao: "Lição dura do piloto: câmera SD NÃO conta gente em multidão (oclusão) — flip-floppei 35→70→45→70. Quem conta gente é o POS (couvert exato, 196 no dia 15/08); a câmera só dá tempo/ocupação por mesa. Nunca mais estimar cabeça pela câmera." },
  { modulo: "cameras", resp: "gustavo", titulo: "Ligar o Altec sync do Sororoca: cadastrar restaurants/{sororoca}.altec = { host: sororocabar.r3.riser.com.br, credKey: SOROROCA } + secrets ALTEC_SOROROCA_USER/PASS (você cadastra o segredo)", descricao: "Gerencial (dashboardData.php) e o relatório de Cupons Emitidos (rlt/fcx/relCuponsNew.php, com mesa+valor+abriu+fechou) já validados logado. Falta a config pro sync automático." },
  { modulo: "cameras", resp: "ia", titulo: "Achar o endpoint da LISTA de comandas abertas ao vivo (ocupação em tempo real por mesa) — o card 'Vendas em Aberto' da dashboard tem só o valor; falta a lista das mesas", descricao: "Garimpar o 'Ver mais' do card. msgFunction.php deu File not found; o relatório de cupons só traz as Encerradas." },
  { modulo: "cameras", resp: "ia", titulo: "Produção: robô de visão local no NUC contando MESA ocupada/livre (não cabeça) → evento no Firestore → painel; cruzar com relCuponsNew (per-mesa) do Altec", descricao: "Vídeo não sai da loja, só evento de texto sobe. Câmera = tempo/ocupação por mesa; POS = couvert/dinheiro exato." },
];

export const CADERNO_SEED: CadernoItem[] = SEED.map((s, i) => ({
  id: `seed_${s.modulo}_${i}`,
  moduloId: s.modulo,
  titulo: s.titulo,
  descricao: s.descricao,
  status: "pendente",
  responsavel: s.resp,
  criadoEm: "2026-07-21T00:00:00.000Z",
  ordem: i,
  origem: "seed",
}));
