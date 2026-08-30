# Capturas de produto

Duas imagens, e o site usa-as automaticamente:

| Ficheiro | Onde aparece | Proporção sugerida |
|---|---|---|
| `consola.png` | herói, secção "Gestão do clube", página Software | 16:10, ≥ 2400px de largura |
| `app.png` | dentro do telemóvel, em três sítios | 9:19.5 (ecrã de telemóvel), ≥ 1200px de largura |
| `socios.png` | secção "Sócios" da landing | 16:10, ≥ 2000px de largura |
| `treino-editor.png` | secção "Área técnica" (Software e landing) | 16:10, ≥ 2000px de largura |
| `treino-plano.png` | secção "Área técnica" da página Software | 16:10, ≥ 2000px de largura |

**Enquanto não existirem**, o site desenha a interface em HTML — com os mesmos
tokens da consola e da app. Não é um espaço vazio nem um "imagem em falta": é o
produto redesenhado à escala do sítio onde aparece, nítido em qualquer ecrã.

Quando largares os ficheiros aqui, eles ganham. Se um deles falhar a carregar, a
reconstrução volta sozinha — o site nunca mostra um rectângulo partido.

## Como tirar as capturas

- **Consola**: a Visão geral da direção, com dados de demonstração. Janela larga,
  sem separadores do browser à volta.
- **Sócios**: a página pública de adesão, no passo "A tua categoria".
- **App**: o primeiro ecrã da app da família (o que tem a mensalidade e o próximo
  treino), num telemóvel ou no modo dispositivo do Chrome, sem barra de browser.
- **Editor tático**: um exercício com jogadores, zona e setas desenhados, no campo
  de 11 — com a barra de ferramentas e a régua de frames à vista.
- **Plano de treino**: a página de um treino planeado (`/treinos/:id`) com 4–5
  blocos e o painel "Carga estimada" visível.
