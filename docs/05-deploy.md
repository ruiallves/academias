# Deploy

Três deployments, cinco apps. A consola e a app da família não têm deployment
próprio — são compiladas e servidas pela API. Ver "Uma origem por clube" em
`02-arquitetura.md` para o porquê.

| Onde | O quê | Domínios |
| --- | --- | --- |
| Railway | a API + a consola + a app da família | `*.academias.pt`, `api.academias.pt` |
| Railway | o worker da Academias AI (serviço à parte) | o domínio que o Railway der |
| Vercel | o site de marketing | `academias.pt`, `www.academias.pt` |
| Vercel | o painel da plataforma | `admin.academias.pt` |

---

## Railway — o worker da Academias AI

Serviço **à parte** da API, no mesmo projecto. Não é uma escolha de arrumação:
processar um jogo demora horas, e um deploy da API não pode matar isso a meio.

### Como se cria

Serviço novo → mesmo repositório → **Root Directory `ai-worker`**. O
[`Dockerfile`](../ai-worker/Dockerfile) e o
[`railway.json`](../ai-worker/railway.json) estão lá e dizem o resto: ffmpeg no
contentor, torch na build de **CPU** (a de CUDA traz dois gigabytes de
dependências da NVIDIA para uma máquina sem GPU), healthcheck em `/health`.

### O que tem de ser configurado

```
AI_WORKER_TOKEN=<o mesmo valor que a API tem>
ACADEMIAS_API_URL=https://api.academias.pt
AI_WORKER_NAME=railway-1
AI_WORKER_SPOOL=/data/spool
AI_WORKER_SPOOL_TTL_HOURS=72
```

E, do lado da **API**, o endereço público deste serviço:

```
AI_WORKER_PUBLIC_URL=https://<o-domínio-do-worker>.up.railway.app
```

Sem essa variável a API volta ao caminho antigo — o vídeo pelo Supabase, com o
tecto de 50 MB por ficheiro do plano. É esta variável que liga o caminho
directo.

### O volume

O vídeo aterra no disco deste serviço e vive lá enquanto se processa. Montar um
**volume em `/data`**, com espaço para o maior jogo que se espera receber (um
jogo de duas horas em 1080p passa dos 7 GB). Sem volume o carregamento
funciona na mesma, mas um restart a meio obriga a repeti-lo.

O que sobra é limpo sozinho: a API pede a purga quando o processamento acaba, e
o zelador do worker apaga o que tiver mais de `AI_WORKER_SPOOL_TTL_HOURS`.

### Uma réplica, sempre

O carregamento faz-se em blocos que se somam a um ficheiro **local**. Com duas
réplicas atrás do mesmo domínio, os blocos dividem-se por duas máquinas e
nenhuma fica com o vídeo inteiro. `numReplicas: 1` está no `railway.json` e não
deve ser mexido — escalar faz-se com mais **serviços**, cada um com o seu
`AI_WORKER_NAME` e o seu domínio (e a API a apontar para um deles).

### Quanto tempo demora, e porquê

No Railway não há GPU: a detecção corre em CPU, na variante MobileNet do
detector. Um jogo de duas horas a 5 FPS são cerca de 33 mil frames.

Medido numa fonte de 640×360, 4 threads, lotes de 2 — 33 300 frames por jogo:

| Lado curto de trabalho | Por frame | Por jogo de 111 min |
| --- | --- | --- |
| 800 px — como estava | 322 ms | **178 min** |
| 540 px (`MAX_UPSCALE=1.5`, o valor por omissão) | 144 ms | 80 min |
| 450 px (`MAX_UPSCALE=1.25`, o que o `Dockerfile` põe) | 97 ms | **54 min** |
| 360 px — a resolução da fonte | 70 ms | 39 min |
| `AI_WORKER_DETECTOR=ssdlite` (320 px fixos) | 43 ms | 24 min |

O `Dockerfile` fica em 1,25× por ser onde a curva ainda paga: 3,3× mais
rápido do que estava, e ainda amplia o suficiente para um jogador de 30 px não
desaparecer. Descer daí troca precisão por minutos, e essa troca mede-se antes
de se fazer.

O `ssdlite` não é o valor por omissão de propósito: é um detector de um passo,
e falha mais com jogadores sobrepostos — que num jogo são muitos. Está a uma
variável de distância para quando o tempo mandar, e
`ai-worker/scripts/comparar-detector.py` mede a troca num clip real antes de
se decidir.

Mais vCPU no serviço encurta tudo isto quase linearmente — é a forma mais
directa de comprar tempo sem tocar em precisão.

É aceitável porque ninguém está à espera à frente do ecrã (a consola diz "podes
fechar" e a notificação chega no fim). E é a razão de o worker ser um serviço
separado: pode ser movido para uma máquina com GPU sem tocar em mais nada —
copia-se o processo, o token, e aponta-se o `AI_WORKER_PUBLIC_URL` da API para
lá. Numa RTX 5050 o mesmo jogo passou de 1h51 para cerca de 40 minutos.

---

## Railway

### Comandos

```
Build:  npm run build:server
Start:  npm run start:api
```

`build:server` compila a consola, compila a app da família, copia os dois `dist/`
para `apps/api/public/` e só depois compila a API. Se algum dos `vite build`
falhar, o deploy pára aí — que é o que se quer.

### Domínios

1. `api.academias.pt` — o endereço fixo. É por aqui que o painel da plataforma e o
   formulário de contacto do site falam com a API, e é o URL do webhook da euPago.
2. `*.academias.pt` — o wildcard. É este que faz um clube novo funcionar sem
   ninguém tocar em nada: assim que a academia existe na base de dados,
   `oclubenovo.academias.pt` responde.

No DNS, um `CNAME` de `*` para o alvo que o Railway indicar. O wildcard exige plano
pago.

### Variáveis

Além das que já lá estão (`DATABASE_URL`, `SUPABASE_*`, `EUPAGO_*`, `VAPID_*`):

```
TENANT_DOMAIN=academias.pt
PUBLIC_BASE_URL=https://{slug}.academias.pt
PUBLIC_API_URL=https://api.academias.pt
PLATFORM_ORIGIN=https://admin.academias.pt
SITE_ORIGIN=https://academias.pt

MAIL_API_KEY=re_...
MAIL_FROM=noreply@academias.pt
MAIL_FROM_NAME=Academias
```

### Email

O serviço é o **Resend**, e quem o escolhe é o **prefixo da chave**: `re_` é
Resend, `xkeysib-` é Brevo, o resto é SendGrid. Não há `MAIL_PROVIDER` — trocar de
serviço é trocar `MAIL_API_KEY` e reiniciar. Ver `mail/mail.client.ts`.

`MAIL_FROM` tem de ser um endereço **do domínio verificado no Resend**. Não é uma
caixa de correio: ninguém lê o que for enviado para lá. Quem responde a um convite
cai no `replyTo`, que é o endereço do clube.

`MAIL_API_URL` existe só para desenvolvimento — aponta os envios a um recolector
local em vez do serviço. **Vazia em produção.**

Sem `MAIL_API_KEY` ou sem `MAIL_FROM` o servidor arranca na mesma e avisa no
arranque: os convites continuam a ser criados e o link aparece na consola para ser
enviado à mão. É o push a fazer o mesmo sem chaves VAPID.

`TENANT_DOMAIN` é a que liga tudo. **Sem ela nenhum host é tratado como clube** —
`fafe.academias.pt/` dá 404 e a consola não encontra academia nenhuma. Falha para
o lado seguro de propósito: adivinhar aqui era adivinhar de quem são os dados.

`CONSOLE_ORIGIN` e `FAMILY_ORIGIN` **não** se definem em produção. As duas apps são
same-origin; pô-las na lista de CORS não faz mal nenhum, mas também não faz nada, e
é uma dica errada para quem ler a configuração daqui a um ano.

### Migrações

`npx prisma migrate deploy` **não** corre pelo `DATABASE_URL` com pool — fica
pendurado. Corre-se com o URL directo:

```
DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy
```

---

## Vercel

Dois projectos, cada um com a sua Root Directory. É o que faz o `vercel.json` de
cada app ser lido.

| Projecto | Root Directory | Domínio |
| --- | --- | --- |
| site | `apps/site` | `academias.pt` |
| plataforma | `apps/platform` | `admin.academias.pt` |

O `vercel.json` de cada um faz duas coisas: manda tudo o que não é ficheiro para o
`index.html` (sem isto, abrir `academias.pt/planos` directamente dá 404 — só
funcionava navegando a partir da raiz) e marca os assets com hash como imutáveis.

Os projectos da **consola** e da **família** no Vercel devem ser apagados depois de
o Railway estar a servi-las. Não antes: ter dois sítios a servir a mesma consola é
a maneira mais rápida de depurar aquilo que não está a correr.

---

## Configuração dos builds

Cada app tem um `.env.production` versionado. Não têm segredos — dizem "mesma
origem" ou apontam para `api.academias.pt`, e a chave `anon` do Supabase é pública
por desenho (está no HTML de todas as landings que servimos; quem manda é a RLS).

Existem por uma razão concreta: o Vite lê `.env.local` **também nos builds**, e sem
`.env.production` um `npm run build:web` feito numa máquina de desenvolvimento saía
com `localhost:3000` cozido no bundle — a consola do cliente a tentar falar com o
computador de quem a compilou.

O build da app da família **recusa compilar** sem `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY`. Sem eles o botão "Já tenho conta — entrar" falha no
telemóvel de um pai, depois do deploy, e ninguém dá por isso até alguém telefonar
ao clube.

---

## Verificar depois do deploy

Com `{clube}` substituído por uma academia que exista:

```bash
curl -sI https://{clube}.academias.pt/                    # 200, text/html
curl -sI https://{clube}.academias.pt/ser-socio           # 200, text/html
curl -s  https://{clube}.academias.pt/manifest.webmanifest  # o nome e a cor do clube
curl -sI https://{clube}.academias.pt/consola/            # 200, text/html
curl -sI https://{clube}.academias.pt/app/                # 200, text/html
curl -sI https://{clube}.academias.pt/app/sw.js           # Service-Worker-Allowed: /
curl -sI https://naoexiste.academias.pt/                  # 404 (a página de academia não encontrada)
```

O `Service-Worker-Allowed: /` é o que menos se nota e mais custa: sem ele o service
worker fica com âmbito `/app/`, não controla a landing, e o Chrome deixa de oferecer
a instalação — a app passa a "atalho de browser" sem nenhuma mensagem de erro.

A seguir, no telemóvel: abrir um link de convite de família, instalar, e confirmar
que o ícone no ecrã inicial tem o nome do clube.
