# Diretório de clubes e emblemas

Desde 17/11/2026 a plataforma tem a lista dos clubes federados de Portugal
(futebol, futsal, futebol de praia e basquetebol) com o emblema de cada um,
para pôr o emblema do adversário num jogo, numa convocatória ou no site sem
cada clube o ter de carregar.

## Onde vive

| Peça | O que é |
| --- | --- |
| `KnownClub` | Uma linha por clube e por fonte (`fpfId` ou `fpbId`, únicos). Nome, nome curto (só a FPB dá), `normalizedName` (sem acentos, para procurar), associação, região, localidade, modalidades, e o emblema (`logoKey`, `logoVersion`, `logoHash`, tamanho do original). Tabela da plataforma: sem `academyId`, sem RLS; `academia_app` só tem SELECT. |
| Bucket `emblemas` | Público, 1 MB por ficheiro. Por clube: `<id>/<versao>/256.webp`, `64.webp` e `original.<ext>`. Sobe com `cache-control: max-age=31536000`. |
| `scripts/emblemas-importar.mjs` | Lê as fontes, trata com o `sharp`, sobe ao bucket e escreve a tabela (com `MIGRATE_DATABASE_URL` e a chave de serviço). `npm run emblemas:importar`; `--so fpf|fpb`, `--limite N`, `--sem-imagens`, `--de-cache`. |
| `scripts/emblemas-cobertura.mjs` | Quantos adversários escritos nos jogos da plataforma batem no diretório. `npm run emblemas:cobertura [--todos]`. |
| `GET /api/clubes-conhecidos?q=&modalidade=&limite=` | A procura para a consola e a app: todas as palavras, sem acentos; devolve até 20 com `emblema.pequeno` (64) e `emblema.grande` (256). |

## As fontes

- **FPF** (futebol e futsal): o diretório `fpf.pt/pt/Clubes`, que é uma página
  Angular sobre `POST /DesktopModules/MVC/SearchClubs/Default/GetClubs`
  (cabeçalhos `ModuleId: 3220` e `TabId: 848`, páginas de 20). Em 17/11/2026
  dava 6.563 organizações nas 22 associações; 3.690 traziam o escudo genérico
  do site (`FPF_PlaceHolers/club-default.png`), que o importador trata como
  "sem emblema". Os emblemas reais vêm de `imagehandler.fpf.pt`, a ~100 px (o
  `w`/`h` do endereço não faz nada). A modalidade só se sabe para quem tem
  equipas nas provas nacionais da época 100 (`GetFootballClasses?season=100`
  e `GetClubs` com `FootballClass`): ~250 clubes; os outros ficam só com
  `fpfId` (são futebol ou futsal).
- **FPB** (basquetebol): `fpb.pt/clubes/`, uma página com os 297 clubes de
  todas as associações (as páginas por associação rebentam a meio em quatro
  delas). Dá nome, nome curto, pavilhão, associação e o emblema em
  `sav2.fpb.pt`, a 200 px ou mais.
- O `fetch` do Node leva "Your request was blocked" do WAF da FPF: os pedidos
  vão pelo `curl` com User-Agent de browser.

## O que ficou a 17/11/2026

| | Clubes | Com emblema |
| --- | --- | --- |
| FPF (futebol e futsal) | 6.563 | 2.855 |
| FPB (basquetebol) | 297 | 293 |
| Total | 6.860 | 3.148 |

Bucket: 9.444 ficheiros, 81 MB (64 px: 5,8 MB, média 1,9 KB; 256 px: 18,6 MB,
média 6 KB; originais: 56,5 MB). Originais acima de 1 MB (PNG da FPB) ficam
como cópia a 512 px em WebP. Dos 250 adversários distintos escritos nos jogos
da plataforma, 218 batem no diretório e 216 têm emblema (`emblemas:cobertura`);
os que faltam são erros de escrita ("Pinalnovense"), siglas coladas
("SCBraga") e clubes que a FPF não lista (Vitória SC, Boavista FC).

A procura (`nomeNormalizado` + `SIGLAS` em `src/clubes/diretorio.service.ts`,
copiadas nos scripts) junta siglas com pontos ("Rio Ave F.C." → "rio ave fc")
e expande as que os clubes escrevem ("SC" → "sport clube", "sporting clube";
"CD" → "clube desportivo"…). O `normalizedName` leva também o nome curto da
FPB a seguir a um " | ".

## O egress

O que faz o egress subir é a mesma imagem a sair muitas vezes, não o volume
(ver `StorageService`). Por isso o endereço de um emblema é fixo e público,
com cache de um ano: o browser guarda-o e não volta a pedi-lo. Um emblema que
muda na fonte ganha uma versão nova (`logoVersion`), logo um endereço novo. As
listas usam o de 64 px (2 a 5 KB); a ficha do jogo o de 256 (10 a 25 KB).

## O adversário de um jogo (17/11/2026, migração `20261117150000_adversario_no_diretorio`)

- `Match.opponentClubId` → `KnownClub`, quando o adversário foi escolhido do
  diretório. `opponent` continua a ser o nome escrito.
- Consola: `components/CampoAdversario.tsx` procura nos já defrontados (da
  consola) e no diretório (`GET /api/clubes-conhecidos`, a partir de duas
  letras, filtrado pela modalidade da equipa), mostra o emblema ao lado e
  deixa carregar um (`lib/clubes.ts`: `POST /api/clubes-conhecidos/emblemas`
  → PUT assinado → `POST …/:id/confirmar`, que trata com o `sharp`).
- `ClubLogoProposal` (RLS por clube): o emblema carregado. Para o clube que o
  carregou vale logo (`emblemasDosAdversarios` em `src/clubes/emblemas.ts`
  resolve o emblema de cada jogo: diretório, senão a proposta do clube, por
  `knownClubId` ou pelo nome normalizado; só as não rejeitadas). As listas e a
  ficha do jogo devolvem `opponentClubId` e `opponentLogo {pequeno, grande}`;
  a app da família lê o mesmo.
- Painel → Emblemas (`GET/POST /api/platform/emblemas`): aprovar copia a imagem
  para `<clube>/<versao>/`, cria o `KnownClub` se o nome foi escrito à mão e
  liga os jogos desse clube; rejeitar só muda o estado. O clube não é avisado.

## Por fazer

- Completar os emblemas em falta na FPF (3.690 sem emblema real) e os clubes
  que a FPF não lista (Vitória SC, Boavista FC) com outra fonte; juntar as duas
  linhas do mesmo clube (FPF e FPB) quando for útil.
- Emblema nas convocatórias em PDF e no site do clube.
- Correr o importador de tempos a tempos (clubes novos, emblemas que mudam).
