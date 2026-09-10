# Documentos legais — versão 1.0

Os ficheiros desta pasta são a **versão 1.0** de cada documento legal, no
Markdown que a plataforma renderiza (títulos, parágrafos, listas, negrito,
ligações — sem HTML).

`npm run seed:legal` publica-os na base de dados como `LegalDocument`
(`status = PUBLISHED`, `effectiveAt = agora`), uma vez: um tipo que já tenha a
versão 1.0 é deixado como está. A partir daí a fonte de verdade é a base —
edita-se na plataforma (`admin.academias.pt/legal`), publicando versões novas,
e **não** aqui. Estes ficheiros ficam como origem histórica da 1.0.

## Revisão jurídica

**Nenhum destes textos passou por advogado.** São a estrutura e a linguagem,
escritos em português simples a descrever o que o produto faz — não são um
parecer jurídico, e não inventam cláusulas, prazos legais nem artigos. Onde a
lei exige uma formulação específica, o texto descreve a realidade e deixa o
enquadramento para quem o vai rever.

Antes de considerar qualquer versão final:

- rever com advogado de RGPD e de SaaS;
- preencher a identificação da entidade (denominação, NIF, sede, email de
  contacto legal) — está **por preencher de propósito**, ver `COMPANY` em
  `apps/site/src/lib/content.ts`; nenhum texto inventa uma morada;
- confirmar os prazos de retenção e de eliminação (hoje descritos, não
  quantificados);
- confirmar se o registo de IP e navegador nas aceitações é a base a manter;
- decidir se os Termos de Serviço cobrem a utilização pelo responsável do
  clube (é o que a configuração actual assume — ver `legal.catalog.ts`);
- nos Termos de Serviço v1.1, as cláusulas que mais precisam de olhar jurídico:
  desactivação aos 30 dias e cessação com eliminação aos 60 dias sem pagamento
  (secção 9); desactivação "com ou sem aviso prévio" passado mais de um mês
  desde o último pagamento; a janela do dia 15 para mudar de plano (secção 8);
  sem reembolsos por haver 30 dias de teste (secção 11); indemnização pelo
  clube (secção 5); limitação de responsabilidade ao valor de 12 meses
  (secção 20); referência de cliente salvo oposição (secção 16); preços com
  IVA incluído (secção 7).

## Como se corrige um texto antes de haver aceitações a sério

Uma versão publicada é imutável — o hash está nas aceitações. Antes do
lançamento, com só a academia de demonstração a aceitar, o caminho é apagar a
linha da versão (e as aceitações de demonstração dela) e correr o `seed:legal`
outra vez. Depois do lançamento, é sempre uma versão nova (`version:` no
frontmatter, `changeNote:` a dizer o que mudou), e o gate volta a pedir.

## Frontmatter

Cada ficheiro começa com um bloco de metadados:

```
---
type: TERMS_OF_SERVICE
version: 1.0
title: Termos de Serviço
summary: uma frase para o gate
---
```

`changeNote:` é opcional — o que mudou face à versão anterior, mostrado no gate.
O resto do ficheiro é o texto. O `scope`, as audiências e o tipo de aceitação
vêm dos valores por omissão do catálogo (`legal.catalog.ts`).
