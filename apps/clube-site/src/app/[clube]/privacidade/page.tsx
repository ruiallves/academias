import type { Metadata } from "next";
import { clubeOu404 } from "@/lib/clube";
import { legalDe } from "@/lib/legal";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { ComoFalar, CorpoLegal, Ligacao, NotaDoClube, Seccao } from "@/componentes/PaginaLegal";

export const revalidate = 60;

export const metadata: Metadata = { title: "Privacidade" };

/**
 * A política de privacidade do site do clube, escrita a partir dos dados do
 * clube. O responsável é o clube; a plataforma Academias trata por conta
 * dele (ver o Acordo de Tratamento de Dados). A secção `#cookies` é a
 * política de cookies: o rodapé e o mapa dos contactos apontam para ela.
 *
 * O que aqui se diz tem de bater com o que o site faz. Ao acrescentar um
 * formulário, um script de fora ou um cookie, muda-se esta página também.
 */
export default async function Privacidade({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const l = legalDe(clube);
  const morada = clube.address.lines.join(", ");

  return (
    <>
      <CabecalhoPagina eyebrow="Privacidade" titulo="Política de privacidade" linha={`Como o ${clube.shortName} trata os dados de quem usa este site.`} />
      <CorpoLegal>
        <Seccao titulo="Quem é o responsável">
          <p>
            {/* Sem artigo: "o Clube…", "a Associação…", e o site não sabe qual. */}
            <strong className="font-semibold text-ink">{l.nome}</strong>
            {l.nipc ? `, NIPC ${l.nipc}` : ""}
            {morada ? `, com sede em ${morada}` : ""}.
          </p>
          <p>É o responsável pelo tratamento dos dados recolhidos neste site.</p>
          <p>
            Para qualquer assunto sobre os teus dados, <ComoFalar email={clube.email} />.
          </p>
        </Seccao>

        <Seccao titulo="O que este site recolhe e para quê">
          <p>Este site só recolhe dados teus quando os escreves num formulário.</p>
          <ul className="list-disc space-y-3 pl-5">
            <li>
              <strong className="font-semibold text-ink">Formulário de contactos.</strong> O nome, o email, o telefone (se o deixares), o assunto e a mensagem,
              com o endereço IP de quem envia. Servem para o clube te responder e para travar envios automáticos.
            </li>
            <li>
              <strong className="font-semibold text-ink">Adesão a sócio.</strong> A identificação, a data de nascimento, os contactos, a morada, o documento e a
              categoria escolhida. Servem para o clube analisar o pedido e, se o aceitar, gerir a tua inscrição e as quotas. A base é o contrato de sócio que
              pedes para fazer. As autorizações para comunicações e partilha com parceiros são à parte, opcionais, e podes retirá-las quando quiseres.
            </li>
            <li>
              <strong className="font-semibold text-ink">Compras na loja.</strong> O nome, o email, o telemóvel, a morada de entrega (se pedires envio), a nota
              que deixares e os artigos comprados. Servem para cobrar, preparar e entregar a encomenda, enviar a fatura e tratar trocas, devoluções e
              reclamações. A base é o contrato de compra e, para a fatura, a obrigação legal.
            </li>
            <li>
              <strong className="font-semibold text-ink">Bilhetes.</strong> O nome, o email e o telemóvel de quem compra, o jogo e os lugares. Para um bilhete de
              sócio, o número de sócio e a data de nascimento, só para confirmar que és sócio. Servem para cobrar, enviar o bilhete, validar a entrada à porta e
              devolver o dinheiro se o jogo for cancelado.
            </li>
            <li>
              <strong className="font-semibold text-ink">Registos técnicos.</strong> O alojamento guarda registos dos pedidos ao site (endereço IP, página pedida,
              data e hora) para o manter a funcionar e em segurança.
            </li>
          </ul>
          <p>
            Os pagamentos (MB WAY e Multibanco) são feitos pela entidade de pagamentos do clube, a euPago. Para um pagamento MB WAY, o número de telemóvel
            segue para ela. Nem o clube nem a plataforma guardam dados de cartões ou de contas bancárias.
          </p>
          <p>Os dados não são vendidos, e não são usados para publicidade.</p>
        </Seccao>

        <Seccao titulo="Durante quanto tempo">
          <p>As mensagens do formulário de contactos ficam na consola do clube até o clube as apagar.</p>
          <p>Os dados da adesão a sócio ficam enquanto fores sócio e, depois, pelo tempo que a lei e os estatutos do clube exigirem.</p>
          <p>
            As encomendas e os bilhetes ficam pelo menos pelo tempo que a lei fiscal exige para os documentos de faturação, em regra dez anos.
          </p>
          <p>Os registos técnicos do alojamento são apagados ao fim de pouco tempo.</p>
        </Seccao>

        <Seccao titulo="Quem trata por conta do clube">
          <p>
            Este site, a loja, a bilheteira e a consola onde o clube lê os pedidos são da plataforma <Ligacao href="https://www.academias.pt">Academias</Ligacao>,
            que trata os dados por conta do clube, como subcontratante, e só para o que o clube lhe pede. A política de privacidade da plataforma está em{" "}
            <Ligacao href="https://www.academias.pt/privacidade">academias.pt/privacidade</Ligacao>.
          </p>
          <p>
            A plataforma recorre a outros prestadores para isso: o alojamento e a base de dados, na União Europeia; a Vercel, que serve as páginas do site; o
            serviço de envio de emails; a Cloudflare, na verificação contra envios automáticos; e a euPago, nos pagamentos.
          </p>
        </Seccao>

        <Seccao id="cookies" titulo="Cookies e o que fica no teu browser">
          <p>Este site não põe cookies de publicidade nem de estatísticas, e não segue o que fazes noutros sites. Por isso não te pede autorização ao entrar.</p>
          <ul className="list-disc space-y-3 pl-5">
            <li>
              <strong className="font-semibold text-ink">O carrinho da loja</strong> fica guardado no teu browser, só no teu dispositivo, para não perderes o que
              escolheste. É preciso para a loja funcionar, e apagas o carrinho quando quiseres.
            </li>
            <li>
              <strong className="font-semibold text-ink">A verificação contra robôs</strong> da Cloudflare corre nos formulários de contactos, de compra e de
              bilhetes. Serve só para travar envios automáticos, e é precisa para os formulários funcionarem.
            </li>
            <li>
              <strong className="font-semibold text-ink">O mapa do Google</strong> na página de contactos só abre quando carregas em &ldquo;Mostrar o mapa&rdquo;.
              A partir daí, o Google pode guardar os seus cookies, segundo a{" "}
              <Ligacao href="https://policies.google.com/privacy?hl=pt-PT">política de privacidade do Google</Ligacao>. Sem abrires o mapa, o Google não
              recebe nada.
            </li>
          </ul>
          <p>Podes apagar o que o site guardou nas definições do teu browser.</p>
        </Seccao>

        <Seccao titulo="Os teus direitos">
          <p>Sobre os teus dados, tens direito a:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>saber que dados o clube tem sobre ti e pedir uma cópia;</li>
            <li>corrigir o que estiver errado;</li>
            <li>pedir que sejam apagados;</li>
            <li>pedir que o tratamento fique limitado;</li>
            <li>receber os teus dados num formato que possas levar para outro lado;</li>
            <li>opor-te a um tratamento, e retirar uma autorização que tenhas dado.</li>
          </ul>
          <p>
            Para exercer qualquer um destes direitos, <ComoFalar email={clube.email} />. Se achares que o clube não respeitou os teus direitos, podes apresentar
            queixa à Comissão Nacional de Proteção de Dados (CNPD), em <Ligacao href="https://www.cnpd.pt">cnpd.pt</Ligacao>.
          </p>
        </Seccao>

        <NotaDoClube titulo={`Mais do ${clube.shortName}`} paragrafos={l.notaPrivacidade} />
      </CorpoLegal>
    </>
  );
}
