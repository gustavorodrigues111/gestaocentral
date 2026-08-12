# Módulo de Etiquetas de Validade — Investigação + Especificação

> **Status:** rascunho de arquitetura (12/08/2026)
> **Repo:** gestaocentral (planejamento.app) · React + Firebase (southamerica-east1) + Vercel
> **Objetivo:** módulo próprio de gestão + impressão de etiquetas de validade para as cozinhas do grupo (Lobozó, Sororoca, Puba SP, Puba Belém, futura Peixaria), integrado ao ecossistema existente.

Este documento descreve o **funcionamento** observado na Kali (benchmarking do produto que assinamos) e especifica a **nossa** solução. Não reproduz a base de prazos, os textos nem o layout proprietário da Kali — nossa tabela de prazos sai de fontes públicas (CVS-5/SP + RDC 216) + fichas técnicas próprias.

---

## 1. O que a Kali faz (observado no portal de gestão)

Investigação feita no backoffice web `gestao.alimentares.com` (conta ativa, white-label com a marca Lobozó). A **impressão em si roda no device** (terminal Android tipo Sunmi — confirmado pela pré-visualização), fora do portal web — o fluxo de toques precisa ser cronometrado no aparelho (ver gap na §6).

### 1.1 Navegação do backoffice
`Dashboard` · `Etiquetas` (→ Validade, Impressas) · `Estoque` · `Produtos` · `Configurações`.

### 1.2 Dashboard
- **Estoque:** posição em R$ + contagem de etiquetas ativas (ex.: 968 etiq.).
- **P. Custo Cadastrado:** % de produtos com preço de custo (ex.: 0/1241).
- **Validades (FEFO):** cards por dia (Ontem→+7), cada um com valor R$ e nº de etiquetas que vencem naquele dia. É a visão "o que vence quando".

### 1.3 Cadastro de produto (campos observados)
| Campo | Tipo | Nota |
|---|---|---|
| Nome do Produto | texto (≤20 char) | limite curto (cabe na etiqueta) |
| **Validade** | número (dias) | **um único valor por produto** |
| Categoria(s) | seleção | categorias livres (ex.: "Geladeira Fogão") |
| **Conservação** | seleção | **um único método** (Refrigerado/Congelado/…) |
| Porção | qtd + unidade (unid/kg/…) + toggle | |
| Permitir Baixa Parcial | toggle | consumo fracionado |
| Data de | Manipulação \| Fabricação | qual data dispara a validade |
| Marca / Fornecedor | texto (≤15) | |
| Registro (SIF) | texto (≤6) | |
| Estoque Mínimo | número | alimenta alerta |
| Preço de Custo (R$/unid) | número | alimenta valor R$ do estoque |
| Lote | — | **informado na hora da impressão**, não no cadastro |

### 1.4 Etiqueta impressa (campos, na ordem)
Produto · **VALIDADE + data** (destacado) · Conservação + Porção · Categoria · **Manipulação + data** · Lote (nº) · **RESP: <manipulador>** · Empresa + CNPJ · **QR** · timestamp de impressão + contagem de cópias (1/1).
Cobre os obrigatórios da RDC 216 (produto, manipulação, validade, responsável) + rastreio.

### 1.5 Etiquetas Impressas (rastreabilidade)
- Ciclo de vida: **Impressa → Baixada** (consumida/descartada). Analytics por hora (impressas vs baixadas), períodos Ontem/Hoje/7d/30d.
- Cada etiqueta tem **código**, produto, categoria, status, timestamp. Filtros por categoria e status.

### 1.6 Hardware
Terminal **Sunmi** (Android, botões laterais laranja — família V2). A impressão é on-device; o portal web é gestão/cadastro/relatórios.

---

## 2. Mapa funcional — replicar / melhorar / cortar

| Feature Kali | Decisão | Por quê |
|---|---|---|
| Cadastro de produto + validade | **Replicar + melhorar** | ver §3 (matriz de conservação) |
| Cálculo automático de validade (manipulação/fabricação + dias) | **Replicar** | núcleo do valor |
| Etiqueta com campos RDC 216 + QR | **Replicar** | conformidade obrigatória |
| Dashboard FEFO por dia | **Replicar** | melhor feature deles |
| Rastreabilidade impressa→baixada | **Replicar** | base de relatório de desperdício |
| Lote na hora da impressão | **Replicar** | correto |
| Categorias livres | **Replicar** | |
| **1 produto por método de conservação** | **Melhorar (cortar duplicata)** | ver friction §4 |
| Estoque em R$ / preço de custo | **Melhorar** | herdar das nossas fichas técnicas (custo já calculado) |
| White-label por marca | **Já temos** | multi-loja/branding do planejamento.app |
| Login/usuários próprios | **Cortar** | usar login existente (não-negociável §"Requisitos") |
| Alertas | **Melhorar** | WhatsApp via infra do agente (eles: escopo a confirmar) |
| Base de prazos proprietária | **Não usar** | montar do CVS-5/RDC 216 (público) |

---

## 3. Melhoria-chave: matriz de conservação

Na Kali, **cada método de conservação é um produto separado** → catálogo inflado (1241 itens com duplicatas: 4× "Abobora", "Abóbora Cortada", "Abóbora Cozida"…). O operador precisa achar a variante certa.

**Nossa proposta:** UM produto com **matriz método→dias**:

```
Abóbora cortada
  ├─ Refrigerado (0–4°C): 3 dias   [base: manipulação]
  ├─ Congelado (≤-18°C): 90 dias
  └─ Temperatura ambiente: —
```

Na impressão, o operador escolhe o método (1 toque) e a validade sai automática. Resultado: catálogo ~4× menor, busca mais limpa, menos erro.

---

## 3.5 Dois tipos de etiqueta (a Kali só tem o primeiro)

### Tipo A — Produção / Validade (o padrão, = Kali)
Item **preparado na cozinha**. Data de manipulação → validade calculada. Colada no recipiente. Ciclo simples: impressa → consumida/descartada. É a etiqueta das §1.4/§5 (`etiquetas`).

### Tipo B — Estoque / Lote (NOVO — gestão de estoque)
**Modelo escolhido: 1 etiqueta FIXA por produto** (colada no local — prateleira/caixa/câmara), com **QR do produto**. Os **lotes são virtuais** (só dados no sistema): produto fechado mantém a etiqueta do fabricante, **não é exigência relabelar** — então **não se imprime nada a cada compra**. Trabalha-se com a etiqueta fixa e o sistema por trás.

**Fluxo de ENTRADA (módulo dedicado "Entrada & Organização de Estoque", sem impressão):**
- Manual ou por **foto da NF** (OCR pré-preenche produto + qtd + fornecedor; *reaproveita `api/ocr-nota.ts` do Recebimento*).
- O sistema **pede a validade do lote novo** e cria o lote (data only, `status: ativo`). **Não imprime etiqueta.** Se for produto novo (sem etiqueta fixa ainda), aí sim imprime a etiqueta fixa **1×**.
- **Instrução de arrumação PVPS/PEPS:** ao lançar, o sistema diz **onde colocar fisicamente** o lote novo em relação aos existentes — ex. *"vence 10/12: coloque ATRÁS dos que vencem antes e À FRENTE dos que vencem depois"* (FEFO) ou *"coloque atrás de tudo"* (FIFO). Assim a prateleira fica na ordem certa e o popup de baixa sempre bate com o físico.

**Fluxo de BAIXA (QR do produto = saída, ação padrão):**
1. Escaneia o **QR fixo do produto** → o sistema **já entende que é uma baixa** (não precisa escolher a ação).
2. **Popup indica de QUAL lote pegar** (o próximo pela regra de giro) — mostra **validade e local** pra achar a embalagem certa.
3. Usuário **confirma o lote** e informa **quantas unidades** → baixa daquele lote → registra movimento (quem/quando). Lote zerou → `esgotado`.

**Giro PEPS / PVPS (o pulo do gato):** o sistema mantém a fila de lotes por produto e **sempre aponta o próximo a sair**:
- **PVPS / FEFO** (recomendado p/ perecível): **validade mais antiga** primeiro.
- **PEPS / FIFO**: **entrada mais antiga** primeiro.
- Regra configurável por produto/categoria. Se o operador precisar pegar outro lote, confirma/justifica (fica registrado).
- *Caveat:* como o QR é do **produto** (não do lote), o operador identifica a embalagem física pela **data impressa** que o popup indica — padrão de estoque, funciona bem e evita relabelar.

**Controle de estoque:** saldo por produto/loja = **soma dos `qtdRestante`** dos lotes `ativo`; atualiza a cada entrada/baixa/ajuste. Alimenta estoque mínimo + alerta de vencimento (WhatsApp).

> **Aberto vs. fechado:** produto **fechado** no estoque = etiqueta fixa + lotes virtuais (Tipo B, sem reimpressão). Produto **aberto** (cozinha ou estoque) = imprime a **etiqueta de validade (Tipo A)** com a data de abertura. Os dois convivem.

---

## 4. Registro de fricções (oportunidades nossas)

1. **Duplicação por método** — inflar o catálogo (§3). *Nossa:* matriz.
2. **Nome ≤20 char** — trunca preparações compostas. *Nossa:* nome completo + "nome curto de etiqueta" opcional.
3. **Preço de custo manual (0% preenchido)** — ninguém preenche. *Nossa:* herdar custo das fichas técnicas (Lobozó já mapeado) → valor de estoque automático.
4. **Fluxo de impressão no device** — a medir (§6), mas o alvo é ≤4 toques pra item frequente (favoritos/recentes).
5. **Login paralelo** — cadastro à parte da equipe. *Nossa:* login do planejamento.app, manipulador = usuário logado.
6. **Alérgenos ausentes no cadastro** — não vi campo. *Nossa:* alérgenos[] (bônus de conformidade).

---

## 5. Modelo de dados Firestore (proposta)

Multi-loja em tudo (`lojas[]`/`loja`), permissões por unidade herdadas do app.

```
produtosEtiqueta/{id}
  nome                string        // completo
  nomeEtiqueta        string?       // curto p/ bobina (fallback: nome)
  categoria           string
  conservacao: {                    // MATRIZ método→dias (a melhoria)
    refrigerado?:  number|null      // dias
    congelado?:    number|null
    seco?:         number|null
    ambiente?:     number|null
    quente?:       number|null
  }
  baseData            "manipulacao"|"fabricacao"
  porcao: { qtd: number, unidade: string }
  permiteBaixaParcial boolean
  alergenos           string[]      // bônus RDC/rotulagem
  marcaFornecedor     string?
  sif                 string?       // registro
  estoqueMinimo       number?
  precoCusto          number?       // herdável da ficha técnica
  fichaTecnicaId      string?       // vínculo p/ custo/rendimento
  lojas               string[]      // restaurantIds onde vale
  regraGiro           "fefo"|"fifo" // giro do estoque (Tipo B) — default fefo
  qrTokenEstoque      string        // QR da etiqueta FIXA de estoque (baixa por scan)
  etiquetaFixaImpressa boolean      // já imprimiu a fixa? (imprime 1×)
  ativo               boolean
  criadoEm, atualizadoEm

etiquetas/{id}                       // 1 doc por etiqueta impressa (rastreio)
  produtoId, produtoNome
  loja                restaurantId
  conservacao         string        // método escolhido na impressão
  manipuladorUid, manipuladorNome    // = usuário logado
  impressaoTs         timestamp
  validadeTs          timestamp      // calculada
  lote                string?        // informado na impressão
  porcao, qtdCopias
  qrToken             string         // rastreio individual (abre histórico)
  status              "ativa"|"consumida"|"descartada"
  baixaTs?, baixaMotivo?             // desperdício/consumo
  criadoEm

etiquetaConfig/{loja}                // layout da bobina + dados fixos da empresa
  empresaNome, cnpj, logoUrl
  bobina: { larguraMm, alturaMm }
  campos: [...]                      // ordem/visibilidade dos campos

// ── Tipo B: etiqueta de ESTOQUE / LOTE (produto comprado, fechado ou aberto) ──
lotesEstoque/{id}                    // LOTE VIRTUAL — só dados, NÃO imprime etiqueta
  produtoId, produtoNome
  loja                restaurantId
  local               string                // prateleira/câmara (onde está a etiqueta FIXA do produto)
  qtdInicial, qtdRestante, unidade
  entradaData         date                  // compra/recebimento
  validade            date                  // PEDIDA na entrada (NF quase nunca traz)
  fornecedor?, loteFornecedor?, precoUnit?  // da NF quando houver
  notaFiscalId?                             // origem (módulo Recebimento)
  status              "ativo"|"esgotado"|"descartado"
  criadoEm, criadoPor
  // sem qrToken/impresso: o QR é FIXO no produto (produtosEtiqueta.qrTokenEstoque)

movimentosEstoque/{id}               // auditoria de entrada/baixa
  loteId, produtoId, loja
  tipo                "entrada"|"baixa"|"ajuste"|"descarte"
  qtd, saldoDepois
  usuarioUid, usuarioNome, ts
  motivo?, alertaGiroIgnorado?       // registrou que ignorou o aviso PEPS/PVPS
```

> `etiquetas/{id}` (Tipo A) ganha `tipo:"producao"`; os lotes de compra vivem em `lotesEstoque` (Tipo B) porque têm quantidade + giro + entrada-por-NF. **Saldo de estoque** de um produto/loja = soma dos `qtdRestante` dos lotes `ativo`. Os dois tipos têm **QR** e fazem **baixa** — a diferença é que o Tipo B baixa **por quantidade** e dispara o aviso de giro.

**Aproveitar do que já existe:** coleção de usuários/pessoas (manipulador + permissões), fichas técnicas do Lobozó (seed de produtos + custo), infra WhatsApp (alertas), padrão de PDF do grupo.

**Offline-first:** habilitar Firestore offline persistence; fila local de `etiquetas` grava no cache e sincroniza quando volta a rede. `qrToken` gerado no cliente (uuid) pra não depender do servidor no momento da impressão.

---

## 6. Especificação do MVP (fases)

### F1 — Web/PWA (testável no navegador) — **começa aqui**
- Cadastro de produto com **matriz de conservação** + importação em massa (CSV/das fichas técnicas).
- Cálculo de validade (base + método → validadeTs).
- Tela de impressão com **busca + favoritos + recentes** (meta ≤4 toques) e **botão mock** (gera a etiqueta em tela/PDF, sem hardware).
- **Dashboard FEFO** (o que vence hoje/amanhã/semana) por loja.
- Rastreio `etiquetas` (impressa→baixada) + relatório de desperdício básico.
- Multi-loja + permissões por unidade desde o dia 1.
- **Etiqueta de estoque (Tipo B) — 1 etiqueta FIXA por produto, lotes virtuais:**
  - **Módulo "Entrada & Organização de Estoque":** entrada manual ou por **foto da NF** (OCR, reaproveita `api/ocr-nota.ts`) → o sistema **pede a validade do lote**, adiciona ao estoque **sem imprimir** (fixa só na 1ª vez do produto) e dá a **instrução de arrumação PVPS/PEPS** (onde colocar o lote novo).
  - **Baixa por QR** do produto → o scan **já é entendido como baixa** → **popup indica o lote certo** (FEFO/FIFO) com validade + local → usuário confirma + informa qtd.
  - **Saldo** por produto/loja (soma dos lotes ativos) + `movimentosEstoque` (auditoria) + alerta de mínimo/vencimento (WhatsApp).

### F2 — Impressão real (celular da cozinha)
- Impressora térmica **Bluetooth genérica** (Knup/Phomemo) via **RawBT/ESC-POS** a partir do celular.
- Layout da etiqueta renderizado (ESC-POS ou imagem) conforme `etiquetaConfig`.
- Bobina **genérica** (nunca insumo proprietário).

### F3 — Hardware dedicado (se a adoção validar)
- Wrapper Android (WebView + bridge JS → SDK de impressão) em **Sunmi V2s/V2 PRO _Label Version_**.
- ⚠️ Só a versão **Label** tem sensor de gap (etiqueta destacável); a padrão (cupom contínuo) não serve.

---

## 7. Tabela de prazos seed — metodologia (validar com a nutricionista)

> ⚠️ **Segurança de alimentos:** os valores abaixo são um **ponto de partida** derivado de normas públicas e **devem ser revisados/aprovados pela nutricionista** (RT) antes de uso em produção. Não usar como verdade absoluta.

**Fontes:** Portaria **CVS-5/2013 (SP)** — tabela de tempo/temperatura para alimentos preparados sob refrigeração; **RDC 216/2004 (ANVISA)** — boas práticas e critérios gerais; **fichas técnicas próprias** (para preparações compostas do grupo).

**Como montar (não copiar base de terceiros):**
1. Para cada preparação, classificar por **grupo** (hortifrúti cru, cozido, carne crua/cozida, pescado, laticínio, molho, sobremesa…).
2. Aplicar a **regra de temperatura de conservação** do CVS-5 (quanto mais frio, maior o prazo; a norma dá faixas por temperatura para refrigerados).
3. Congelados: prazo próprio por grupo (a norma trata separadamente ≤-18°C).
4. Cruzar com a **ficha técnica** (ingrediente mais perecível manda no prazo do prato).
5. Registrar a **fonte** de cada linha (auditável) e marcar `validarRT: true` até a nutricionista assinar.

Estrutura da seed (valores = exemplo a preencher/validar):

```
prazosSeed/{grupo}
  grupo            "hortifruti_cru" | "cozido" | "carne_crua" | "pescado" | ...
  refrigerado      number   // dias @ faixa de temperatura da norma
  congelado        number
  ambiente         number|null
  fonte            "CVS-5/2013 item X" | "RDC 216" | "ficha técnica"
  validarRT        boolean  // trava até aprovação da nutricionista
```

Integra com o módulo **Segurança Sanitária** (a nutricionista já avalia boas práticas ali) — a aprovação da tabela vira uma etapa desse fluxo.

---

## 8. Requisitos não-negociáveis (checklist)

- [ ] Conformidade RDC 216 / CVS-5 (produto, manipulação, validade, responsável na etiqueta)
- [ ] Multi-loja desde o dia 1 (`loja` em tudo; permissão por unidade)
- [ ] Login existente do planejamento.app (manipulador = usuário logado; sem cadastro paralelo)
- [ ] Impressão ≤4 toques para item frequente (favoritos/recentes)
- [ ] Offline-first na cozinha (fila local + sync)
- [ ] Bobina genérica (nunca proprietária)
- [ ] Dashboard de vencimentos + alerta WhatsApp (infra do agente)

---

## 9. Gaps a fechar (próximos passos de investigação)

1. **Fluxo de impressão no device** — cronometrar toques no terminal Sunmi (não acessível pelo portal web).
2. **QR** — confirmar o que abre (rastreio individual? página pública?).
3. **Configurações** — usuários/papéis, mecanismo multi-loja, editor de layout da etiqueta.
4. **Estoque** — submenu (entrada/baixa/inventário) para desenhar o nosso.
5. **Modelo comercial** — o que a assinatura cobre (SW + HW + bobinas), preço/loja — só p/ referência de ROI.
