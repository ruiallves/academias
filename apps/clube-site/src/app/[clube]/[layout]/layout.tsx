import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Cabecalho } from "@/componentes/Cabecalho";
import { Rodape } from "@/componentes/Rodape";
import { Revelar } from "@/componentes/Revelar";
import { CascaPorto } from "@/layouts/porto/Casca";
import { estiloDoClube } from "@/lib/tema";
import { clubeOu404 } from "@/lib/clube";
import { layoutValido } from "@/dados/tipos";

type Params = Promise<{ clube: string; layout: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const clube = await clubeOu404(params);
  return {
    title: { default: `${clube.shortName} · Site oficial`, template: `%s · ${clube.shortName}` },
    description: clube.about,
    openGraph: { siteName: clube.name, locale: "pt_PT", type: "website" },
    icons: { icon: "/icone" },
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
  const { layout } = await params;
  if (!layoutValido(layout)) notFound();

  const estilo = estiloDoClube(clube.signalColor);

  if (layout === "porto") {
    return (
      <div style={estilo} data-layout="porto" className="min-h-dvh">
        <CascaPorto clube={clube}>{children}</CascaPorto>
        <Revelar />
      </div>
    );
  }

  return (
    <div style={estilo} className="flex min-h-dvh flex-col">
      <Cabecalho clube={clube} />
      <main className="flex-1">{children}</main>
      <Rodape clube={clube} />
      <Revelar />
    </div>
  );
}
