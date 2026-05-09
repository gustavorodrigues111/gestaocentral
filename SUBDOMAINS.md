# Subdomínios por restaurante

Cada restaurante pode ter um subdomínio próprio (ex: `lobozo.planejamento.app`)
que serve como porta de entrada brandada — o login mostra o nome do
restaurante e após autenticar a equipe vai direto pro restaurante dele.

## Como funciona

1. **Configuração**: o admin (com permissão `configuracoes.configurar`) entra
   em `Configurações → Dados do restaurante` e preenche o campo "Subdomínio
   público" (ex: `lobozo`).

2. **Acesso**: a equipe abre `lobozo.planejamento.app`. A tela de login
   mostra "Lobozo" como título.

3. **Pós-login**: o `RestaurantContext` detecta o subdomínio, fixa o
   restaurante automaticamente (sem precisar escolher), e esconde o seletor
   de restaurantes no header.

4. **Sem acesso**: se o usuário logar mas não tiver acesso àquele restaurante,
   aparece tela amigável "Sem acesso a Lobozo" com instruções.

5. **Master/multi-restaurante**: pra alternar entre restaurantes (master ou
   gestor com vários), use `planejamento.app` (sem subdomínio).

## Setup DNS + Vercel (uma vez por domínio)

Pra `*.planejamento.app` funcionar, precisa configurar:

### 1. Comprar/configurar o domínio `planejamento.app`

Em qualquer registrar (Registro.br, Namecheap, etc).

### 2. DNS — apontar wildcard pra Vercel

No painel do registrar, adicionar **2 records**:

| Tipo | Nome | Valor |
|------|------|-------|
| A | `@` | `76.76.21.21` (IP da Vercel) |
| CNAME | `*` | `cname.vercel-dns.com` |

> O CNAME wildcard captura `lobozo.planejamento.app`,
> `bardobicho.planejamento.app`, etc — todos vão pra Vercel.

### 3. Vercel — adicionar domínio + wildcard

No painel do projeto Vercel:

1. **Settings → Domains**
2. Adicionar `planejamento.app`
3. Adicionar `*.planejamento.app` (wildcard)
4. Vercel detecta o DNS e gera certificados Let's Encrypt automaticamente

Pode demorar até 24h pra propagar DNS, mas geralmente em ~10 min funciona.

### 4. Smoke tests

Depois da config:

```bash
curl -I https://planejamento.app                  # → 200 OK
curl -I https://lobozo.planejamento.app           # → 200 OK
curl -I https://qualquer-coisa.planejamento.app   # → 200 OK (mesmo sem rest cadastrado)
```

A app que decide o que mostrar quando o subdomínio não bate.

## Subdomínios reservados

Esses **NÃO** são tratados como subdomínio de restaurante (pra deixar livre
pra entrada genérica e infraestrutura):

- `www.planejamento.app` → root
- `app.planejamento.app` → root (entrada genérica)
- `admin.planejamento.app` → reservado
- `api.planejamento.app` → reservado pra API futura
- `staging.planejamento.app` → ambiente staging
- `preview.planejamento.app` → reservado
- `test.planejamento.app` → reservado
- `*.vercel.app` → preview deploys do Vercel

Lista em `src/core/restaurant/subdomain.ts → RESERVED_SUBDOMAINS`.

## Validação do subdomínio

Pra cadastrar um subdomínio, vale:

- 3 a 30 caracteres
- Só `a-z`, `0-9`, e `-` (hífen)
- Não pode começar nem terminar com hífen
- Lowercase
- Único entre todos os restaurantes (validado no save)
- Não pode ser um subdomain reservado

A UI normaliza pra lowercase automaticamente.

## Testando local

Subdomínio em `localhost` não funciona direto. Duas opções:

### Opção A — `localhost.direct` (DNS público)

`*.localhost.direct` resolve sempre pra `127.0.0.1`. Acesse:

```
http://lobozo.localhost.direct:5173
```

Funciona out-of-the-box, sem mexer em nada.

### Opção B — `/etc/hosts`

```
sudo bash -c 'echo "127.0.0.1 lobozo.localhost" >> /etc/hosts'
```

Depois acesse `http://lobozo.localhost:5173`.

(Repita pra cada subdomain que quiser testar.)
