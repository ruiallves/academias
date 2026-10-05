# Guião das capturas do site

O site novo (`apps/site`) conta uma semana de um clube inventado. Os ecrãs que
aparecem no site são **capturas reais** da consola e da app do clube, tiradas ao
código verdadeiro (`apps/console`, `apps/family`) com a rede toda simulada.
Nenhuma captura toca na API real, no Supabase nem na base de dados.

## O clube e as pessoas (tudo inventado)

- Clube: **CD Academias** (Clube Desportivo Academias), slug `cd-academias`.
- Cor de sinal do clube: `#12936B` (verde-esmeralda, da família do verde do site). Atlético da Serra: `#8C1D2F` (grená). União do Mar: `#E4572E`. Emblema: `apps/site/public/clube/emblema.svg` e `emblema.png`.
- Modalidade: futebol. Equipas: Sub-11, **Sub-13** (futebol 9), Sub-15, Seniores.
- Treinador dos Sub-13: Miguel Antunes. Diretor: Paulo Rebelo.
- Atleta que o site segue: **Tomás Ferreira**, n.º 8, médio centro, Sub-13, nascido a 14/03/2014.
- Mãe e encarregada: **Carla Ferreira**. Também é sócia, n.º 1284, categoria Adulto, quota mensal de 5,00 €, paga até outubro.
- Plantel Sub-13 (n.º, nome): 1 Afonso Lima (guarda-redes), 2 Bernardo Costa, 3 Daniel Pinto, 4 Diogo Reis, 5 Duarte Matos, 6 Francisco Sá, 7 Gabriel Nunes, 8 Tomás Ferreira, 9 Henrique Melo, 10 João Brito, 11 Lourenço Faria, 12 Martim Rocha, 13 Rodrigo Leal, 14 Salvador Cruz, 15 Vicente Maia, 16 Gonçalo Vaz.
- Sem fotografias de pessoas: ficam as iniciais ou o número, como o produto faz quando não há foto.

## A semana (5 a 11 de outubro de 2026)

| Dia | Hora | O que acontece |
|---|---|---|
| Seg 5/10 | 09:12 | A mensalidade de outubro do Tomás (35,00 €) está por pagar. Às 09:14 a Carla paga por MB WAY e passa a paga. |
| Ter 6/10 | 18:30 | O treinador prepara o treino de quarta: exercício "Saída a três e finalização" no editor tático (futebol 9), plano de sessão de 75 min (Ativação com bola 15', Saída a três e finalização 20', Jogo reduzido 6×6 25', Retorno à calma 15'). |
| Qua 7/10 | 19:00 | Treino no Campo 2 (19:00 às 20:15). 14 presentes. Lourenço Faria faltou, com falta avisada pela família às 17:10. Salvador Cruz está de baixa clínica. |
| Qui 8/10 | 21:15 | A Carla abre a app em casa. O Tomás tem 11 de 12 treinos (92%). |
| Sex 9/10 | 17:40 | Aviso do clube aos Sub-13: "Sábado jogamos em casa às 15:00. Concentração às 14:15 no Campo 1." Lido por 41 de 46. Convocatória de 16 atletas, 15 confirmados, 1 não pode. Treino leve às 19:00 (60 min). |
| Sáb 10/10 | 15:00 | Jogo em casa, Sub-13, Jornada 5 contra a União da Serra (inventado). Resultado 2-1. Tomás jogou 60 minutos e marcou 1 golo. |
| Dom 11/10 | 10:00 | Avaliação do Tomás: Técnica 4,3; Tática 3,9; Físico 4,0; Atitude 4,6 (ou a escala que o produto usar, com valores equivalentes). |
| Seg 12/10 | 09:00 | A direção abre a Visão geral e vê o que precisa de atenção. |

## Regras das capturas

- Consola: viewport 1920×1080, `deviceScaleFactor: 2` (3840×2160, 4K).
- App: viewport 390×844, `deviceScaleFactor: 3` (1170×2532), `isMobile`, `hasTouch`.
- Relógio do browser congelado na hora da cena.
- Sem barras de scroll, sem avisos de desenvolvimento, sem cursores de texto a piscar, com as fontes carregadas.
- Saída em `apps/site/public/shots/`: `<id>.webp` (resolução total, qualidade 90) e `<id>-m.webp` (metade da largura).
- Um manifesto por superfície (`manifesto-consola.json`, `manifesto-app.json`):

```json
{
  "con-mensalidades-depois": {
    "ficheiro": "con-mensalidades-depois.webp",
    "largura": 1920, "altura": 1080, "escala": 2,
    "descricao": "Mensalidades de outubro, Tomás pago",
    "focos": { "linha-tomas": [x, y, w, h], "estado-tomas": [x, y, w, h] }
  }
}
```

Os focos são retângulos em píxeis CSS do viewport, para o site poder aproximar a câmara ou desenhar um realce por cima.
