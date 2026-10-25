import type { Metadata } from "next";
import { clubeOu404 } from "@/lib/clube";
import { legalDe } from "@/lib/legal";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { ComoFalar, CorpoLegal, Ligacao, Seccao } from "@/componentes/PaginaLegal";

export const revalidate = 60;

export const metadata: Metadata = { title: "Termos do sócio" };

/**
 * Os termos que quem pede para ser sócio aceita no formulário de adesão
 * ("Concordo com os termos do sócio"). A parte geral é a mesma em todos os
 * clubes e só diz o que o site e a plataforma fazem de facto: o pedido fica
 * à espera do clube, a quota é a da categoria escolhida. As regras do clube
 * (direitos, deveres, saída, quotas em atraso) são as dos estatutos, e o
 * clube escreve o resto na consola (Website › Informação legal).
 */
export default async function TermosDoSocio({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const l = legalDe(clube);

  return (
    <>
      <CabecalhoPagina eyebrow="Ser sócio" titulo="Termos do sócio" linha={`O que aceitas ao pedir para ser sócio do ${clube.shortName}.`} />
      <CorpoLegal>
        <Seccao titulo="O pedido de adesão">
          <p>
            Ao enviar o formulário de adesão pedes para ser sócio do {clube.shortName}. O pedido fica à espera do clube, e só és sócio depois de o clube o aceitar.
          </p>
          <p>Os dados que escreves têm de ser verdadeiros e teus, ou de quem representas, se pedes por um menor.</p>
        </Seccao>

        <Seccao titulo="A quota">
          <p>
            A quota é a da categoria que escolhes, com o valor e a periodicidade que o formulário mostra. O valor das quotas pode mudar, segundo as regras
            do clube.
          </p>
          <p>As quotas pagam-se pelos meios que o clube indicar, e com elas em dia ficas com os benefícios da tua categoria.</p>
        </Seccao>

        <Seccao titulo="Direitos e deveres">
          <p>
            Os direitos e os deveres dos sócios, a forma de deixar de ser sócio e o que acontece com quotas em atraso são os dos estatutos e regulamentos do
            clube.
            {l.estatutosUrl && (
              <>
                {" "}
                Podes lê-los <Ligacao href={l.estatutosUrl}>aqui</Ligacao>.
              </>
            )}
          </p>
          <p>
            Para pedir os estatutos, mudar de categoria ou deixar de ser sócio, <ComoFalar email={clube.email} />.
          </p>
        </Seccao>

        {l.termosSocio.length > 0 && (
          <Seccao titulo={`Regras do ${clube.shortName}`}>
            {l.termosSocio.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </Seccao>
        )}

        <Seccao titulo="Os teus dados">
          <p>
            O clube trata os dados da adesão para gerir a tua inscrição e as quotas. Os detalhes, e os teus direitos, estão na{" "}
            <Ligacao href="/privacidade">política de privacidade</Ligacao>. As autorizações para comunicações e partilha com parceiros são opcionais, e não
            mudam nada na adesão.
          </p>
        </Seccao>
      </CorpoLegal>
    </>
  );
}
