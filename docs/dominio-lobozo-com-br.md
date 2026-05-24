# Publicar lobozo.com.br

> Passo a passo pra apontar o domínio próprio do Lobozó pro site rodando no Vercel.

## Estado atual do código

✅ **Mapeamento de host → slug** em `src/modules/sites/shared/customDomain.ts`
✅ **Detecção client-side** no `App.tsx` (`RootOrShell` → checa `getSlugFromHost()`)
✅ **`SitePublicaPage` aceita `slugFromHost` via prop** (prioridade sobre `useParams`)

Quando `lobozo.com.br` (com ou sem `www`) for acessado:
1. Vercel responde com `index.html`
2. React Router cai no catch-all `*` → `RootOrShell`
3. `RootOrShell` detecta host → renderiza `<SitePublicaPage slugFromHost="lobozo" />`
4. SitePublicaPage carrega `sitesConfig` onde `slug === "lobozo"` do Firestore
5. Renderiza o template Personalizado

Forms públicos (`/reservas/:rid`, `/eventos/:rid`, `/trabalhe/:rid`, `/politica/:slug`, `/r/excluir-dados/:rid`) funcionam **em ambos os domínios** sem mudança — usam params da URL.

## Passo 1 — Adicionar domínio no Vercel

1. Acessar [vercel.com](https://vercel.com) → projeto `gestaocentral`
2. **Settings → Domains**
3. Adicionar:
   - `lobozo.com.br`
   - `www.lobozo.com.br`
4. O Vercel vai mostrar instruções específicas de DNS — anote os valores. Geralmente:
   - **Apex (`lobozo.com.br`)**: A record → `76.76.21.21`
   - **www (`www.lobozo.com.br`)**: CNAME → `cname.vercel-dns.com`

## Passo 2 — Configurar DNS no Registro.br

1. Acessar [registro.br](https://registro.br) → entrar com sua conta
2. **Meus Domínios → lobozo.com.br → DNS**
3. O Registro.br oferece 2 opções:
   - **(A) Editar zona DNS aqui mesmo** — adicionar registros direto (mais simples se você já usa Registro.br como DNS)
   - **(B) Apontar pros servidores DNS do Vercel** — preencher os 2 nameservers do Vercel (mais flexível mas precisa transferir gestão DNS pro Vercel)

**Recomendação: opção (A)** — editar zona DNS direto no Registro.br.

### Registros a adicionar

| Tipo | Nome | Valor |
|---|---|---|
| **A** | `@` (ou em branco) | `76.76.21.21` |
| **CNAME** | `www` | `cname.vercel-dns.com.` (com ponto final) |

Se o Vercel pedir AAAA record (IPv6), inclui também.

### Cuidados

- ⚠️ **Remover registros A/CNAME antigos** que apontavam pro provedor anterior (ex: GoDaddy, locaweb) — se ficarem, podem causar conflito.
- ⏱️ **Propagação**: 1-48 horas (geralmente 30 min - 4h).
- Pra verificar se propagou: [dnschecker.org](https://dnschecker.org) com `lobozo.com.br` (tipo A) e `www.lobozo.com.br` (tipo CNAME).

## Passo 3 — Validar no Vercel

1. Voltar em **Settings → Domains** no Vercel
2. Os domínios vão mudar de "Invalid Configuration" → "Valid Configuration" automaticamente quando o DNS propagar
3. Vercel emite SSL (Let's Encrypt) automaticamente — leva ~10 min

## Passo 4 — Testar

1. Abrir `https://lobozo.com.br` no navegador → deve renderizar o site do Lobozó na raiz
2. Abrir `https://www.lobozo.com.br` → mesma coisa
3. Testar formulários:
   - `https://lobozo.com.br/reservas/<RID>` (rid do Lobozó)
   - `https://lobozo.com.br/politica/lobozo`
4. SSL: cadeado verde no browser

## Passo 5 — Atualizar Google Business Profile

Depois que `lobozo.com.br` estiver no ar:

1. Acessar [business.google.com](https://business.google.com)
2. Login com conta dona do perfil Lobozó
3. **Edit profile → Booking** (ou Reservas)
4. Trocar provedor atual (GetinApp) por **URL custom**:
   - URL: `https://lobozo.com.br/reservas/<RID>` (substituir `<RID>` pelo restaurantId do Lobozó)
5. Salvar
6. Google atualiza no resultado de busca em algumas horas

## Adicionar mais restaurantes no futuro

Pra colocar Sororoca/Puba etc em domínio próprio:

1. Editar `src/modules/sites/shared/customDomain.ts` — adicionar entradas:
   ```ts
   "sororoca.com.br": "sororoca",
   "www.sororoca.com.br": "sororoca",
   ```
2. Vercel → Settings → Domains → adicionar `sororoca.com.br` e `www.sororoca.com.br`
3. DNS do Registro.br (ou outro) → seguir Passo 2
4. Deploy (Vercel detecta o commit e faz deploy automático)

## Troubleshooting

- **"Site não encontrado"** → confere se `sitesConfig` tem doc com `slug === "lobozo"` e `publicado: true`
- **404 do Vercel** → falta o domínio em Settings → Domains
- **"Invalid Configuration" persistente no Vercel** → DNS não propagou ou registros errados. Usa dnschecker.org pra verificar.
- **SSL não aparece (cadeado vermelho)** → Vercel ainda emitindo certificado. Aguardar 10 min.
- **Cache do navegador** → tentar em aba anônima / Cmd+Shift+R
