# 📧 Email de comprovante de reserva

> Estado: **implementado, aguardando setup Resend pra entrar em produção**.
> Última revisão: 2026-05-24

## O que é

Quando cliente cria reserva pelo form público (`/reservas/:rid`), recebe email com:
- Comprovante: data, hora, salão, pessoas, ocasião, observações
- Branding do restaurante (cor primária + logo + endereço)
- Mensagem: "aguardando confirmação — te avisamos pelo WhatsApp"

**Não é a confirmação.** Confirmação é outra etapa, feita pelo admin via WhatsApp (botão "Confirmar" na tab Reservas). Esse email aqui é só o registro inicial pro cliente.

## Stack

| Camada | Tecnologia | Custo |
|---|---|---|
| Provider de email | **Resend** | $0 (free: 3k/mês, 100/dia) |
| Backend | **Vercel Function** `/api/send-email` | $0 (incluso) |
| HTML render | Inline styles em `comprovanteReserva.ts` | — |

### Por que não Firebase Extension "Trigger Email"?

Tentamos primeiro. **A extension precisa deployar uma Cloud Function v2 e a org policy do Workspace `gestaocentral-85b13` bloqueia a permissão necessária no service account de build.** Mesma policy bloqueia criação de chave de service account (ver `scripts/prerender-sites.mjs`).

Resend é HTTP puro, sem dependência de Cloud Functions ou service accounts — imune às policies.

## Arquivos

```
src/modules/sites/email/comprovanteReserva.ts
  ├── montarEmailComprovanteReserva()    ← renderiza HTML/text/subject
  └── enviarEmailComprovanteReserva()    ← POSTa em /api/send-email

api/send-email.ts                         ← Vercel route, valida + chama Resend
src/modules/sites/ReservasPublicaPage.tsx ← chama o sender após salvar a reserva
```

## Setup Resend (1x, ~15 min)

### 1. Conta + domínio

1. Cria conta em https://resend.com (pode logar com Google `gustavo@quibebe.com.br`)
2. **Domains** → **Add Domain** → `lobozo.com.br`
3. Resend mostra 3 registros DNS pra adicionar:
   - **SPF** (TXT) — `v=spf1 include:_spf.resend.com ~all`
   - **DKIM** (TXT em `resend._domainkey.lobozo.com.br`) — chave pública longa
   - **MX feedback** (MX em `feedback-smtp.lobozo.com.br`) — `feedback-smtp.us-east-1.amazonses.com`
4. Adicionar esses 3 no **Registro.br** → Painel DNS do `lobozo.com.br`. Propagação ~5–30 min.
5. Voltar no Resend → **Verify Domain**. Status vai pra **Verified** quando os 3 registros propagaram.

> ⚠️ Se já tem SPF no domínio (improvável aqui, mas comum quando alguém adiciona Google + Mailgun + etc), **não criar 2 registros TXT SPF** — junta tudo num só: `v=spf1 include:_spf.google.com include:_spf.resend.com ~all`.

### 2. API Key

1. Resend → **API Keys** → **Create API Key**
2. Nome: `gestaocentral-prod`
3. Permission: **Sending access** (não precisa de "Full access")
4. Domain: `lobozo.com.br` (restringe ao domínio verificado — bom pra segurança)
5. Copia a key — começa com `re_...`. **Mostra só uma vez**, salva no 1Password.

### 3. Env vars na Vercel

Em https://vercel.com → projeto `gestaocentral` → **Settings** → **Environment Variables**:

| Nome | Valor | Environments |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxxxxxx` | Production, Preview |
| `RESEND_FROM_DEFAULT` | `Lobozó <reservas@lobozo.com.br>` | Production, Preview |

Salva → faz **Redeploy** do último deploy de produção (Settings → Deployments → ⋯ → Redeploy) pra pegar as env vars.

### 4. Teste

1. Abre `https://lobozo.com.br/reservas/<rid>` em aba anônima
2. Preenche reserva com **teu** email
3. Confirma e vê se chega o email com cara do Lobozó

Se chegar → tá funcionando. ✅
Se NÃO chegar:
- Checa pasta de spam
- Vercel → projeto → **Functions** → log do `/api/send-email` — vai mostrar o erro do Resend (ex: domínio não verificado, key inválida, sender não autorizado)
- Resend → **Logs** — mostra cada tentativa de envio + estado de entrega (delivered/bounced/complained)

## Dev/preview sem domínio verificado

Em deploy preview da Vercel ou local, se `RESEND_FROM_DEFAULT` não tiver setado, a function cai pra `onboarding@resend.dev` (sender de teste do Resend). Esse sender **só envia pro email cadastrado na conta Resend** (anti-spam). Útil pra testar o fluxo, ruim pra produção real.

Pra evitar confusão, configura `RESEND_FROM_DEFAULT` em todos os environments (Production + Preview + Development).

## Custos esperados

- **Resend Free:** 3.000 emails/mês, 100/dia
- **Lobozó projeção:** 30 reservas/dia × 30 = 900 emails/mês → cabe no free tier por muito tempo
- Acima disso: Resend Pro $20/mês (50k emails)

## Extensões futuras (não implementadas)

- Email quando admin **confirma** ("✓ Sua reserva foi confirmada")
- Email quando admin **cancela** ("Não conseguimos confirmar")
- Lembrete D-1 (cron na véspera)
- Links "Alterar" / "Cancelar" no email (precisa HMAC token + páginas públicas — ver versão antiga deste doc no git history)

## Troubleshooting

### "RESEND_API_KEY não configurada nas env vars"
A env não tá setada na Vercel, ou o deploy foi feito antes de setar. **Redeploy** depois de adicionar.

### Resend retorna `validation_error` com mensagem sobre `from`
Domínio não verificado, ou `from` aponta pra domínio diferente do verificado. Confere em Resend → Domains se `lobozo.com.br` está **Verified** (verde).

### Email vai pra spam
Garantir que SPF + DKIM passaram (Resend mostra ✓ no painel). Se DKIM falha, normalmente é o registro DNS errado — copia/cola direto do Resend, sem editar.

### "Erro de rede" no log do frontend
Vercel function timeout (15s) ou Resend fora do ar. Frontend já trata silenciosamente — reserva NÃO falha, só o email. Cliente vê tela de sucesso normalmente, admin tem WhatsApp como canal primário.
