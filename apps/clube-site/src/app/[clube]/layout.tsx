import type { Metadata } from "next";
import { headers } from "next/headers";
import { Cabecalho } from "@/componentes/Cabecalho";
import { Rodape } from "@/componentes/Rodape";
import { Revelar } from "@/componentes/Revelar";
import { CascaPorto } from "@/layouts/porto/Casca";
import { estiloDoClube } from "@/lib/tema";
import { clubeOu404, layoutAtual } from "@/lib/clube";
import { fonte } from "@/dados/fonte";
import { AdesaoNoSite } from "@/componentes/socio/Adesao";
import { emDemonstracao, enderecoOficial } from "@/lib/modo";

type Params = Promise<{ clube: string }>;

/**
 * O endereço oficial vai no `canonical`, para o Google juntar tudo nele. Os
 * endereços `…vercel.app` (de cada deploy) não se indexam: são cópias.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const clube = await clubeOu404(params);
  const host = ((await headers()).get("host") ?? "").split(":")[0];
  const oficial = enderecoOficial(clube);
  return {
    metadataBase: new URL(oficial),
    title: { default: `${clube.shortName} · Site oficial`, template: `%s · ${clube.shortName}` },
    description: clube.about,
    alternates: { canonical: "./" },
    openGraph: { siteName: clube.name, locale: "pt_PT", type: "website" },
    icons: { icon: "/icone" },
    ...(host.endsWith(".vercel.app") ? { robots: { index: false, follow: false } } : {}),
  };
}

/**
 * O layout de um clube: resolve o clube, pinta a cor dele no contentor e
 * põe a casca do layout escolhido à volta. A cor vai num `style` e não numa
 * classe, porque é um valor por clube e não uma escolha entre temas; o
 * layout vai num `data-layout`, porque é uma escolha entre dois, e o CSS
 * troca os neutros por ele.
 */
export default async function LayoutDoClube({ children, params }: { children: React.ReactNode; params: Params }) {
  const clube = await clubeOu404(params);
  const layout = await layoutAtual(clube);

  const estilo = estiloDoClube(clube.signalColor);
  // O interruptor de layout é uma ferramenta de demonstração: com dados reais o layout é o que o clube escolheu.
  const trocarLayout = emDemonstracao();

  // O "Ser sócio" abre numa janela por cima de qualquer página do site (ver `componentes/socio`).
  const adesao = await fonte.socios(clube.slug);
  const comAdesao = (conteudo: React.ReactNode) => (
    <AdesaoNoSite
      clube={{ slug: clube.slug, name: clube.name, shortName: clube.shortName, logoUrl: clube.logoUrl }}
      adesao={adesao}
      api={process.env.SITE_API_URL ?? ""}
      demonstracao={emDemonstracao()}
      quadrado={layout === "porto"}
    >
      {conteudo}
    </AdesaoNoSite>
  );

  if (layout === "porto") {
    return (
      <div style={estilo} data-layout="porto" className="min-h-dvh">
        {comAdesao(
          <>
            <CascaPorto clube={clube} trocarLayout={trocarLayout}>
              {children}
            </CascaPorto>
            <Revelar />
          </>,
        )}
      </div>
    );
  }

  return (
    <div style={estilo} className="flex min-h-dvh flex-col">
      {comAdesao(
        <>
          <Cabecalho clube={clube} trocarLayout={trocarLayout} />
          <main className="flex-1">{children}</main>
          <Rodape clube={clube} />
          <Revelar />
        </>,
      )}
    </div>
  );
}
