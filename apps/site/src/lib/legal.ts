/**
 * Os documentos legais.
 *
 * ## O que isto é, e o que não é
 *
 * É a **estrutura** e a linguagem — escrita em português simples, a descrever o que
 * o produto realmente faz. Não é um parecer jurídico, e não inventa cláusulas,
 * prazos legais nem artigos: onde a lei exige uma formulação específica, o texto
 * descreve a realidade e deixa o enquadramento para quem o vai rever.
 *
 * **Antes de publicar, isto passa por um advogado de RGPD e SaaS.** Está dito aqui,
 * no código, e não na página: um visitante que leia "documento por rever" no rodapé
 * dos termos não fica mais informado — fica com menos confiança e com a mesma
 * informação.
 *
 * ## A identificação da entidade
 *
 * `COMPANY` em `content.ts` tem os campos legais vazios. As frases que dependem
 * deles só aparecem quando forem preenchidos — nenhuma página mostra um espaço por
 * completar, e nenhuma inventa uma morada.
 */

export type LegalDoc = {
  slug: string;
  title: string;
  intro: string;
  sections: { h: string; p: string[] }[];
};

/** A data em que estes textos foram escritos. Actualizar quando mudarem. */
export const LEGAL_UPDATED = "Agosto de 2026";

export const TERMOS: LegalDoc = {
  slug: "termos",
  title: "Termos e Condições",
  intro:
    "Estas condições regulam a utilização da plataforma Academias por clubes e academias desportivas. Estão escritas para serem lidas por quem dirige um clube, não por juristas.",
  sections: [
    {
      h: "1. O serviço",
      p: [
        "A Academias é uma plataforma de gestão para clubes e academias desportivas, disponibilizada como serviço em linha (SaaS). Inclui a consola de gestão, as ferramentas da equipa técnica e — consoante o plano contratado — a aplicação para famílias, a gestão de mensalidades e a página pública de adesão a sócio.",
        "O serviço é prestado tal como descrito no site e na documentação. Funcionalidades identificadas como estando em desenvolvimento não fazem parte do contrato até estarem disponíveis.",
      ],
    },
    {
      h: "2. Contas e acesso",
      p: [
        "O clube indica quem tem acesso à plataforma e com que papel. É o clube que cria, altera e revoga esses acessos.",
        "Cada conta é pessoal. As credenciais não devem ser partilhadas entre pessoas — a partilha impede o clube de saber quem fez o quê, e é a única forma de o registo de auditoria perder utilidade.",
        "O clube é responsável por manter a lista de acessos actualizada, nomeadamente por revogar o acesso de quem deixa de colaborar com o clube.",
      ],
    },
    {
      h: "3. Utilização da plataforma",
      p: [
        "A plataforma destina-se à gestão da actividade do clube. Não pode ser usada para fins ilícitos, nem para tratar dados sem fundamento para o fazer.",
        "É proibido tentar aceder a dados de outros clubes, contornar limites técnicos, ou sobrecarregar deliberadamente o serviço.",
      ],
    },
    {
      h: "4. Responsabilidades do clube",
      p: [
        "O conteúdo introduzido na plataforma é do clube e da sua responsabilidade: dados de atletas, famílias, staff, valores de mensalidades e comunicações.",
        "Cabe ao clube assegurar que tem fundamento para tratar os dados que introduz, incluindo os dados de menores, e que informa os titulares nos termos da legislação aplicável.",
        "O clube é responsável pelo que comunica às famílias através da plataforma.",
      ],
    },
    {
      h: "5. Período experimental",
      p: [
        "Oferecemos um período experimental de 30 dias com acesso à plataforma. Não é exigido cartão de crédito para o iniciar.",
        "No fim do período, o clube decide se subscreve. Se não subscrever, o acesso termina e os dados são tratados nos termos da secção de eliminação.",
      ],
    },
    {
      h: "6. Preços e pagamento",
      p: [
        "Os preços em vigor são os publicados no site. São por clube — não variam com o número de atletas.",
        "A subscrição pode ser mensal ou anual. Na modalidade anual aplica-se o desconto anunciado e a facturação é feita à cabeça, pelo período contratado.",
        "Aos preços acresce IVA à taxa legal em vigor.",
        "Alterações de preço são comunicadas com antecedência razoável e nunca se aplicam a um período já pago.",
      ],
    },
    {
      h: "7. Mensalidades cobradas pelo clube",
      p: [
        "A gestão de mensalidades permite ao clube cobrar às famílias. Essa relação é entre o clube e a família: a Academias disponibiliza a ferramenta e a ligação ao prestador de pagamentos, não é parte no pagamento da mensalidade.",
        "Os pagamentos são processados por um prestador de serviços de pagamento e sujeitos às condições desse prestador.",
        "O estado de um pagamento na plataforma reflecte a confirmação recebida do prestador.",
      ],
    },
    {
      h: "8. Cancelamento",
      p: [
        "O clube pode cancelar a subscrição a qualquer momento, sem período mínimo de permanência.",
        "O cancelamento produz efeitos no fim do período já pago. Não há reembolso de períodos em curso, salvo quando a lei o imponha.",
      ],
    },
    {
      h: "9. Disponibilidade do serviço",
      p: [
        "Procuramos manter o serviço disponível de forma contínua, mas não garantimos ausência total de interrupções. Podem existir janelas de manutenção, preferencialmente fora dos períodos de maior utilização.",
        "Interrupções causadas por fornecedores de infra-estrutura, por falhas de rede ou por causas fora do nosso controlo não constituem incumprimento.",
      ],
    },
    {
      h: "10. Suporte",
      p: [
        "O suporte é prestado por correio electrónico, com resposta em dias úteis.",
        "Durante o período experimental acompanhamos a montagem do clube na plataforma.",
      ],
    },
    {
      h: "11. Propriedade intelectual",
      p: [
        "A plataforma, o software, a marca e o desenho são nossos. A subscrição dá ao clube o direito de utilizar o serviço, não a propriedade sobre ele.",
        "Os dados que o clube introduz continuam a ser do clube. A marca do clube — nome, cor, símbolo — é do clube, e é usada apenas para personalizar o serviço que lhe é prestado.",
      ],
    },
    {
      h: "12. Dados pessoais",
      p: [
        "No tratamento dos dados que o clube introduz, o clube é o responsável pelo tratamento e a Academias é subcontratante. Os termos desse tratamento constam do documento de tratamento de dados (DPA).",
        "A informação sobre os dados que tratamos por conta própria — por exemplo, os dados de contacto de quem subscreve — consta da Política de Privacidade.",
      ],
    },
    {
      h: "13. Exportação de dados",
      p: [
        "Os dados do clube podem ser exportados a pedido, em formato aberto e legível por máquina, sem custo.",
        "A exportação directa a partir da consola está em desenvolvimento.",
      ],
    },
    {
      h: "14. Suspensão e cessação",
      p: [
        "Podemos suspender o acesso em caso de falta de pagamento, de utilização que ponha em risco o serviço ou outros clubes, ou de utilização ilícita.",
        "Salvo em caso de risco imediato, a suspensão é precedida de aviso e de prazo para corrigir.",
      ],
    },
    {
      h: "15. Eliminação de dados",
      p: [
        "Terminada a relação, os dados do clube são eliminados dos sistemas activos dentro do prazo indicado no DPA, após o período em que o clube pode ainda pedir a exportação.",
        "Cópias de segurança são eliminadas de acordo com o respectivo ciclo de retenção.",
      ],
    },
    {
      h: "16. Limitação de responsabilidade",
      p: [
        "Respondemos pelos danos directos que resultem de incumprimento nosso, nos limites permitidos por lei.",
        "Não respondemos por decisões desportivas, administrativas ou financeiras tomadas pelo clube com base na informação da plataforma, nem por conteúdos introduzidos pelo clube.",
      ],
    },
    {
      h: "17. Alterações a estes termos",
      p: [
        "Estes termos podem ser actualizados. Alterações relevantes são comunicadas com antecedência, e a data da última actualização está no topo do documento.",
      ],
    },
    {
      h: "18. Lei aplicável e foro",
      p: [
        "Aplica-se a lei portuguesa. Para litígios emergentes destes termos são competentes os tribunais portugueses, sem prejuízo das regras imperativas de protecção do consumidor.",
      ],
    },
  ],
};

export const PRIVACIDADE: LegalDoc = {
  slug: "privacidade",
  title: "Política de Privacidade",
  intro:
    "Como tratamos dados pessoais. Há duas situações diferentes e vale a pena separá-las: os dados que tratamos por conta própria e os dados que tratamos por conta de um clube.",
  sections: [
    {
      h: "As duas situações",
      p: [
        "Quando um clube introduz na plataforma os dados dos seus atletas, famílias e staff, é o clube que decide o que trata e porquê. Nós tratamos esses dados por conta dele, e nos limites que ele definir. As regras dessa relação estão no DPA.",
        "Quando alguém nos contacta, subscreve o serviço ou visita este site, os dados envolvidos são tratados por nós — e é disso que trata esta política.",
      ],
    },
    {
      h: "Que dados tratamos por conta própria",
      p: [
        "Dados de contacto de quem representa o clube: nome, email, telefone e o clube a que pertence.",
        "Dados de subscrição e facturação necessários para emitir factura e gerir o contrato.",
        "Registos técnicos do serviço, como endereços IP e datas de acesso, usados para segurança e diagnóstico.",
      ],
    },
    {
      h: "Para que os usamos",
      p: [
        "Para prestar o serviço contratado e comunicar sobre ele.",
        "Para responder a pedidos de contacto e acompanhar períodos experimentais.",
        "Para cumprir obrigações legais, nomeadamente fiscais.",
        "Não vendemos dados pessoais, e não os usamos para publicidade de terceiros.",
      ],
    },
    {
      h: "Onde estão alojados",
      p: [
        "A base de dados e os ficheiros estão alojados na União Europeia.",
        "Recorremos a fornecedores de infra-estrutura, de autenticação e de pagamentos. A lista actual consta do DPA.",
      ],
    },
    {
      h: "Durante quanto tempo",
      p: [
        "Dados de contacto e de contrato: enquanto durar a relação e pelo período legalmente exigido depois disso.",
        "Registos técnicos: por períodos curtos, adequados a segurança e diagnóstico.",
      ],
    },
    {
      h: "Os teus direitos",
      p: [
        "Acesso, rectificação, apagamento, limitação, portabilidade e oposição, nos termos do RGPD.",
        "Se os dados em causa forem de um atleta ou de uma família de um clube, o pedido deve ser dirigido ao clube — é ele o responsável pelo tratamento. Encaminhamos qualquer pedido que nos chegue e apoiamos o clube na resposta.",
        "Existe ainda o direito de reclamar junto da Comissão Nacional de Protecção de Dados.",
      ],
    },
    {
      h: "Segurança",
      p: [
        "Os dados de cada clube estão isolados ao nível da base de dados. O acesso administrativo por parte da nossa equipa é restrito, justificado e registado.",
        "Dados clínicos são tratados como categoria especial: ficam fora do alcance de quem não pertence ao departamento clínico do clube, e fora do alcance do apoio ao cliente.",
      ],
    },
  ],
};

export const COOKIES: LegalDoc = {
  slug: "cookies",
  title: "Política de Cookies",
  intro: "O que guardamos no teu navegador, e porquê. É pouco.",
  sections: [
    {
      h: "Neste site",
      p: [
        "Este site não usa cookies de publicidade nem de perfilagem, e não corre rastreadores de terceiros.",
      ],
    },
    {
      h: "Na plataforma",
      p: [
        "Depois de entrar, a plataforma guarda no teu navegador o necessário para manteres a sessão iniciada e para a aplicação abrir com a identidade do clube certo.",
        "Este armazenamento é essencial ao funcionamento do serviço: sem ele, seria preciso escrever a palavra-passe a cada ecrã.",
      ],
    },
    {
      h: "Tipos de armazenamento que usamos",
      p: [
        "Sessão: mantém a autenticação enquanto estás a usar a plataforma.",
        "Preferências locais: pequenas escolhas de interface, guardadas no dispositivo.",
      ],
    },
    {
      h: "Como controlar",
      p: [
        "Podes apagar este armazenamento nas definições do navegador. Ao fazê-lo, terás de voltar a iniciar sessão.",
      ],
    },
  ],
};

export const DPA: LegalDoc = {
  slug: "dpa",
  title: "Tratamento de dados (DPA)",
  intro:
    "Este documento descreve a relação de tratamento de dados entre o clube e a Academias. É parte integrante dos Termos e Condições.",
  sections: [
    {
      h: "Quem é quem",
      p: [
        "O clube é o responsável pelo tratamento: decide que dados trata, com que finalidade e durante quanto tempo.",
        "A Academias é subcontratante: trata os dados por conta do clube e apenas de acordo com as instruções dele e com o necessário para prestar o serviço.",
      ],
    },
    {
      h: "Objecto e duração",
      p: [
        "O tratamento tem por objecto a prestação do serviço descrito nos Termos, e dura enquanto durar a subscrição, acrescido do período de exportação e eliminação previsto abaixo.",
      ],
    },
    {
      h: "Categorias de dados e de titulares",
      p: [
        "Titulares: atletas (frequentemente menores), encarregados de educação, staff do clube e sócios.",
        "Dados: identificação e contacto, dados de inscrição, presenças, convocatórias, avaliações desportivas, dados de facturação e mensalidades.",
        "Dados de saúde relativos a lesões e disponibilidade desportiva, quando o clube utilize o módulo clínico. São categoria especial de dados e tratados como tal.",
      ],
    },
    {
      h: "Instruções e confidencialidade",
      p: [
        "Tratamos os dados apenas segundo as instruções documentadas do clube, incluindo as que decorrem da utilização normal da plataforma.",
        "Quem tem acesso aos dados está sujeito a dever de confidencialidade.",
      ],
    },
    {
      h: "O nosso acesso aos dados",
      p: [
        "Não afirmamos ser tecnicamente incapazes de aceder aos dados do clube — seria falso, e um clube que confia num software merece saber a verdade.",
        "O que garantimos é que esse acesso é restrito a quem dele precisa para operar e apoiar o serviço, que exige justificação, e que fica registado.",
        "O acesso de apoio à consola de um clube é temporário, tem motivo escrito e é auditado.",
      ],
    },
    {
      h: "Medidas de segurança",
      p: [
        "Isolamento dos dados de cada clube ao nível da base de dados.",
        "Controlo de acessos por papel e por âmbito, definido pelo clube.",
        "Autenticação através de fornecedor de identidade dedicado; as palavras-passe não são guardadas por nós.",
        "Registo de auditoria das operações administrativas.",
        "Comunicações cifradas em trânsito e dados cifrados em repouso pelo fornecedor de infra-estrutura.",
      ],
    },
    {
      h: "Subcontratantes",
      p: [
        "Recorremos a subcontratantes para infra-estrutura, autenticação, armazenamento de ficheiros, envio de notificações e processamento de pagamentos.",
        "A lista actualizada é disponibilizada a pedido. Alterações relevantes são comunicadas com antecedência, para que o clube possa opor-se.",
      ],
    },
    {
      h: "Transferências internacionais",
      p: [
        "Os dados são alojados na União Europeia. Caso venha a existir alguma transferência para fora do Espaço Económico Europeu, será feita com as garantias exigidas pelo RGPD.",
      ],
    },
    {
      h: "Apoio ao responsável pelo tratamento",
      p: [
        "Apoiamos o clube no cumprimento dos seus deveres: resposta a pedidos de titulares, avaliação de impacto quando aplicável, e notificação de incidentes.",
        "Comunicamos ao clube, sem demora indevida, qualquer violação de dados de que tenhamos conhecimento e que lhe diga respeito.",
      ],
    },
    {
      h: "Devolução e eliminação",
      p: [
        "Terminada a relação, o clube pode pedir a exportação dos dados em formato aberto.",
        "Findo esse período, os dados são eliminados dos sistemas activos. As cópias de segurança são eliminadas no ciclo de retenção respectivo.",
      ],
    },
    {
      h: "Auditoria",
      p: [
        "Disponibilizamos ao clube a informação necessária para demonstrar o cumprimento destas obrigações e colaboramos em auditorias razoáveis, acordadas com antecedência.",
      ],
    },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [TERMOS, PRIVACIDADE, COOKIES, DPA];
