import type { Metadata } from "next";
import { clubeOu404 } from "@/lib/clube";
import { legalDe, LISTA_RAL, LIVRO_DE_RECLAMACOES } from "@/lib/legal";
import { euro } from "@/lib/formatar";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { ComoFalar, CorpoLegal, Ligacao, NotaDoClube, Seccao } from "@/componentes/PaginaLegal";

export const revalidate = 60;

export const metadata: Metadata = { title: "Condições de venda" };

/**
 * As condições de venda da loja e da bilheteira, escritas a partir dos dados
 * do clube: quem vende, os preços, o pagamento, a entrega, a livre resolução
 * (DL 24/2014), a garantia (DL 84/2021), o Livro de Reclamações e a entidade
 * de resolução alternativa de litígios (Lei 144/2015).
 *
 * A página existe sempre (um link antigo não dá 404); o rodapé só a mostra
 * com a venda ligada. As regras aqui têm de bater com as da API: reserva de
 * 10 minutos (`reservedUntil`), MB WAY e Multibanco, reembolsos feitos pelo
 * clube, e um jogo cancelado devolve o dinheiro.
 */
export default async function CondicoesDeVenda({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const l = legalDe(clube);
  const morada = clube.address.lines.join(", ");
  const loja = clube.loja;

  return (
    <>
      <CabecalhoPagina eyebrow="Condições de venda" titulo="Condições de venda" linha={`Como funcionam as compras na loja e na bilheteira do ${clube.shortName}.`} />
      <CorpoLegal>
        <Seccao titulo="Quem vende">
          <p>
            {/* Sem artigo: "o Clube…", "a Associação…", e o site não sabe qual. */}
            <strong className="font-semibold text-ink">{l.nome}</strong>
            {l.nipc ? `, NIPC ${l.nipc}` : ""}
            {morada ? `, com sede em ${morada}` : ""}.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            {clube.email && (
              <li>
                Email: <Ligacao href={`mailto:${clube.email}`}>{clube.email}</Ligacao>
              </li>
            )}
            {clube.phone && (
              <li>
                Telefone: <Ligacao href={`tel:${clube.phone.replace(/\s/g, "")}`}>{clube.phone}</Ligacao>
              </li>
            )}
            <li>
              Ou pelo formulário dos <Ligacao href="/contactos">contactos</Ligacao>.
            </li>
          </ul>
          <p>
            O site é da plataforma <Ligacao href="https://www.academias.pt">Academias</Ligacao>, que o disponibiliza ao clube. O contrato de compra é entre ti e o
            clube: é o clube que recebe o pagamento, entrega os artigos, recebe à porta e trata das devoluções.
          </p>
        </Seccao>

        <Seccao titulo="Preços e pagamento">
          <p>Os preços estão em euros e são os preços finais, com os impostos incluídos. Os portes de envio, quando os há, aparecem à parte antes de pagares.</p>
          <p>
            Pagas por MB WAY ou por referência Multibanco. Ao avançar para o pagamento, os artigos ou os lugares ficam guardados para ti durante 10 minutos. A
            compra fica feita quando o pagamento é confirmado, e recebes a confirmação por email.
          </p>
          <p>
            Se o pagamento chegar depois desses 10 minutos e o artigo ou o lugar já não estiver disponível, a compra não se faz e o clube devolve-te o valor
            pago.
          </p>
        </Seccao>

        <Seccao titulo="Entrega das compras da loja">
          {loja?.levantamento && (
            <p>
              <strong className="font-semibold text-ink">Levantamento no clube.</strong>{" "}
              {loja.levantamento.local ? `${loja.levantamento.local}. ` : ""}
              {loja.levantamento.nota ? `${loja.levantamento.nota} ` : ""}O clube avisa-te por email quando a encomenda estiver pronta.
            </p>
          )}
          {loja?.envio && (
            <p>
              <strong className="font-semibold text-ink">Envio pelo correio.</strong> Os portes são de {euro(loja.envio.preco)}
              {loja.envio.gratisAPartirDe !== null ? `, e grátis em compras a partir de ${euro(loja.envio.gratisAPartirDe)}` : ""}.{" "}
              {loja.envio.nota ? `${loja.envio.nota} ` : ""}O clube avisa-te por email quando a encomenda seguir.
            </p>
          )}
          <p>Se o clube não indicar outro prazo, a encomenda é entregue no máximo em 30 dias depois do pagamento.</p>
        </Seccao>

        <Seccao titulo="Bilhetes">
          <p>O bilhete chega por email, com um código QR que é lido à entrada. Cada código entra uma vez.</p>
          <p>
            Os bilhetes para um jogo com data marcada não têm direito de livre resolução: a lei exclui os serviços de lazer com data certa (artigo 17.º do
            Decreto-Lei n.º 24/2014). Se o jogo for cancelado, o clube devolve-te o valor dos bilhetes. Se o jogo for adiado, fala com o clube.
          </p>
          <p>Um bilhete com preço de sócio só vale para o sócio a quem se destina, e pode ser pedido o cartão de sócio à entrada.</p>
        </Seccao>

        <Seccao titulo="Devolver uma compra da loja">
          <p>
            Tens 14 dias, a contar do dia em que recebes ou levantas os artigos, para desistir da compra sem dizer porquê. Para isso, <ComoFalar email={clube.email} />{" "}
            com o número da encomenda. Podes usar o modelo abaixo, mas não é obrigatório.
          </p>
          <p>
            Depois de avisares, tens 14 dias para devolver os artigos ao clube, sem uso e como os recebeste. Os custos de os devolver são teus, exceto se o clube
            disser outra coisa. O clube devolve-te o que pagaste, incluindo os portes de envio normais, no máximo 14 dias depois de saber que desististe, pelo mesmo
            meio de pagamento ou por outro que combines com o clube. O clube pode esperar até ter os artigos de volta.
          </p>
          <p>
            Não há direito de livre resolução nos artigos feitos à tua medida ou personalizados, como uma camisola com nome e número, nem nos artigos selados que,
            por razões de higiene, não podem ser devolvidos depois de abertos.
          </p>
          <div className="rounded-card border border-line bg-surface p-5 text-base">
            <p className="font-semibold text-ink">Modelo de livre resolução</p>
            <p className="mt-3">
              Para: {l.nome}
              {morada ? `, ${morada}` : ""}
              {clube.email ? `, ${clube.email}` : ""}
            </p>
            <p className="mt-2">
              Venho por este meio comunicar que desisto do contrato de compra dos seguintes bens: [artigos], encomenda n.º [número], recebida a [data]. Nome: [o teu
              nome]. Morada: [a tua morada]. Data: [data].
            </p>
          </div>
        </Seccao>

        <Seccao titulo="Garantia">
          <p>
            Os artigos novos têm a garantia legal de três anos a contar da entrega. Se um artigo tiver um defeito, <ComoFalar email={clube.email} /> e o clube
            repara, troca, baixa o preço ou devolve o dinheiro, como a lei prevê (Decreto-Lei n.º 84/2021).
          </p>
        </Seccao>

        <Seccao titulo="Reclamações e litígios">
          <p>
            Podes reclamar no <Ligacao href={LIVRO_DE_RECLAMACOES}>Livro de Reclamações Eletrónico</Ligacao>, ou diretamente ao clube.
          </p>
          <p>
            Em caso de litígio de consumo, podes recorrer a uma entidade de resolução alternativa de litígios:{" "}
            {l.ral.url ? <Ligacao href={l.ral.url}>{l.ral.nome}</Ligacao> : <strong className="font-semibold text-ink">{l.ral.nome}</strong>}
            {l.ral.sigla ? ` (${l.ral.sigla})` : ""}. A lista completa das entidades está no Portal do Consumidor, em{" "}
            <Ligacao href={LISTA_RAL}>consumidor.gov.pt</Ligacao>.
          </p>
          <p>Estas condições seguem a lei portuguesa.</p>
        </Seccao>

        <NotaDoClube titulo={`Mais do ${clube.shortName}`} paragrafos={l.notaVenda} />
      </CorpoLegal>
    </>
  );
}
