# Produto

## O que é

Um sistema operativo para academias e escolas desportivas. Multi-desporto desde a
arquitetura (futebol, basquetebol, natação, ténis, voleibol, dança, ginástica, artes
marciais, atletismo). Multi-tenant e white-label: cada academia tem nome, logótipo,
cor e PWA próprios.

Substitui o conjunto WhatsApp + Excel + papel + referências MB soltas por um sítio só.

## Contra quem competimos

Clube.pt e Adjunto.pt são bons sistemas de **registo**: guardam atletas, pagamentos,
presenças. O trabalho de perceber o que importa fica todo para o utilizador.

O nosso ângulo é outro:

> Uma academia tem pulso semanal. O produto mostra o pulso, não o arquivo.

Consequências concretas, visíveis no ecrã:

- A Visão Geral do diretor abre com **Precisa de atenção** — uma lista priorizada de
  coisas accionáveis (mensalidades vencidas, treinos sem treinador, fichas médicas a
  expirar), não com um gráfico.
- O treinador vê **o próximo treino**, não um resumo do trimestre.
- O pai abre a app e responde a uma pergunta: **o que acontece hoje?**

Se um elemento do ecrã não ajuda alguém a decidir ou a agir, não entra.

## Os três utilizadores

| | Pergunta que faz | Onde vive |
|---|---|---|
| **Diretor** | Como está a minha academia? | Web — workspace profissional |
| **Treinador** | O que tenho de fazer hoje? | Web + tablet no pavilhão |
| **Pai / EE** | Como está o meu filho? | PWA instalada, telemóvel |

A experiência do pai **não** é o dashboard encolhido. É uma app de consumo.

## Navegação (definida pelo fundador)

**Diretor**

```
Visão geral
PESSOAS          Atletas · Famílias · Equipas · Staff
CLÍNICO          Boletins · Consultas
OPERAÇÃO         Calendário · Presenças
GESTÃO           Mensalidades · Comunicação
DESENVOLVIMENTO  Avaliações · Relatórios
                 Definições  (rodapé)
```

**Treinador**

```
Visão geral
EQUIPA           Equipas · Atletas
CLÍNICO          Boletins · Consultas
OPERAÇÃO         Calendário · Treinos
DESENVOLVIMENTO  Avaliações · Relatórios
```

**Pai** — definido dentro da app (tab bar), não aqui.

A ordem é exactamente a pedida; os rótulos de grupo existem só para dar respiração
às secções, à maneira das referências visuais.

## Fases

**Fase 1 — MVP.** Autenticação, academia, papéis/permissões, PWA dos pais,
pagamentos euPago, notificações, visão geral do diretor e do treinador.

**Fase 2.** Equipas, calendário, treinos, presenças, perfis de atleta.
**Fase 3.** Avaliações, competências, observações, progresso.
**Fase 4.** Relatórios para os pais.
**Fase 5.** Analítica de academia.
**Fase 6.** IA — só sobre dados reais da academia, nunca a inventar.

## Papéis

`OWNER` · `DIRECTOR` · `COORDINATOR` · `COACH` · `MEDICAL` · `STAFF` · `GUARDIAN` · `ATHLETE`

O papel decide o **acesso**; o cargo ("Nutricionista", "Diretor desportivo") é
texto livre em `StaffMember.title`. Quatro pessoas do departamento clínico
partilham `MEDICAL` e têm cargos diferentes — é isso que evita criar uma permissão
nova por cada profissão.

As permissões são dados, não `if (role === 'coach')` espalhados pelo código. Ver
[02-arquitetura.md](02-arquitetura.md#permissões).

Regras que a UI tem de reflectir naturalmente:

- Um treinador não vê informação financeira sem permissão explícita.
- Um pai só vê os seus educandos.
- Um diretor vê a academia — apenas a sua.
