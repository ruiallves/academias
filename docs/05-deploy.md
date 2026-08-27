# Deploy

Três deployments, cinco apps. A consola e a app da família não têm deployment
próprio — são compiladas e servidas pela API. Ver "Uma origem por clube" em
`02-arquitetura.md` para o porquê.

| Onde | O quê | Domínios |
| --- | --- | --- |
| Railway | a API + a consola + a app da família | `*.academias.pt`, `api.academias.pt` |
| Vercel | o site de marketing | `academias.pt`, `www.academias.pt` |
| Vercel | o painel da plataforma | `admin.academias.pt` |

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
