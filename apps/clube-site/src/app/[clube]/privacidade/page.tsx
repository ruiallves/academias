import type { Metadata } from "next";
import Link from "next/link";
import { clubeOu404 } from "@/lib/clube";
import { CabecalhoPagina } from "@/componentes/Seccao";

export const revalidate = 60;

export const metadata: Metadata = { title: "Privacidade" };

/**
 * A política de privacidade do site do clube, escrita a partir dos dados do
 * clube: o responsável é o clube, e a plataforma Academias trata por conta
 * dele. Linguagem simples e títulos curtos: é para a família ler, não para o
 * advogado.
 */
export default async function Privacidade({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const morada = clube.address.lines.join(", ");

  return (
    <>
      <CabecalhoPagina eyebrow="Privacidade" titulo="Política de privacidade" linha={`Como o ${clube.shortName} trata os dados de quem usa este site.`} />
      <div className="container-site mt-10 max-w-3xl space-y-12 text-[1.0625rem] leading-relaxed text-ink-2">
        <Seccao titulo="Quem é o responsável">
          <p>
            O responsável pelo tratamento dos dados recolhidos neste site é o {clube.name}
            {morada ? `, com sede em ${morada}` : ""}.
          </p>
          {clube.email && (
            <p>
              Para qualquer assunto sobre os teus dados, escreve para{" "}
              <a href={`mailto:${clube.email}`} className="font-semibold text-ink hover:underline">
                {clube.email}
              </a>
              .
            </p>
          )}
        </Seccao>

        <Seccao titulo="O que este site recolhe e para quê">
          <p>Este site só recolhe dados quando os escreves num formulário.</p>
          <ul className="list-disc space-y-3 pl-5">
            <li>
              <strong className="font-semibold text-ink">Formulário de contactos.</strong> O nome, o email, o telefone (se o deixares) e a mensagem, juntamente com o
              endereço IP de quem envia. Servem para o clube te responder e para travar envios automáticos.
            </li>
            <li>
              <strong className="font-semibold text-ink">Adesão a sócio.</strong> Os dados do formulário de adesão (identificação, contactos, morada e documento). São
              tratados pelo clube para criar e gerir a tua inscrição como sócio.
            </li>
            <li>
              <strong className="font-semibold text-ink">Registos técnicos.</strong> O alojamento guarda registos dos pedidos ao site (endereço IP, página pedida, data
              e hora) para o manter a funcionar e em segurança.
            </li>
          </ul>
        </Seccao>

        <Seccao titulo="Durante quanto tempo">
          <p>As mensagens do formulário de contactos ficam na consola do clube até o clube as apagar.</p>
          <p>Os dados da adesão a sócio seguem as regras do clube para os seus sócios, enquanto a inscrição durar e pelo tempo que a lei exigir depois.</p>
          <p>Os registos técnicos do alojamento são apagados ao fim de pouco tempo.</p>
        </Seccao>

        <Seccao titulo="Quem trata por conta do clube">
          <p>
            Este site e a consola onde o clube lê as mensagens são da plataforma{" "}
            <a href="https://www.academias.pt" className="font-semibold text-ink hover:underline">
              Academias
            </a>
            , que trata os dados por conta do clube, como subcontratante, e só para o que o clube lhe pede. A política de privacidade da plataforma está em{" "}
            <a href="https://www.academias.pt/privacidade" className="font-semibold text-ink hover:underline">
              academias.pt/privacidade
            </a>
            .
          </p>
          <p>O alojamento e a base de dados estão na União Europeia. As páginas do site são servidas pela Vercel.</p>
        </Seccao>

        <Seccao titulo="Cookies">
          <p>O site não usa cookies próprios.</p>
          <p>O mapa do Google na página de contactos é um conteúdo de terceiros, e o Google pode usar os seus próprios cookies quando o mapa carrega.</p>
        </Seccao>

        <Seccao titulo="Os teus direitos">
          <p>Sobre os teus dados, tens direito a:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>saber que dados o clube tem sobre ti e pedir uma cópia;</li>
            <li>corrigir o que estiver errado;</li>
            <li>pedir que sejam apagados;</li>
            <li>pedir que o tratamento fique limitado;</li>
            <li>receber os teus dados num formato que possas levar para outro lado;</li>
            <li>opor-te a um tratamento.</li>
          </ul>
          <p>
            Para exercer qualquer um destes direitos, fala com o clube pelos{" "}
            <Link href="/contactos" className="font-semibold text-ink hover:underline">
              contactos
            </Link>
            . Se achares que o clube não respeitou os teus direitos, podes apresentar queixa à Comissão Nacional de Proteção de Dados (CNPD), em{" "}
            <a href="https://www.cnpd.pt" target="_blank" rel="noopener noreferrer" className="font-semibold text-ink hover:underline">
              cnpd.pt
            </a>
            .
          </p>
        </Seccao>
      </div>
    </>
  );
}

function Seccao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section data-reveal>
      <h2 className="display text-2xl">{titulo}</h2>
      <span className="traco mt-3" aria-hidden />
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}
