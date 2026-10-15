import type { Metadata } from "next";
import { fonte } from "@/dados/fonte";
import { clubeOu404, layoutAtual } from "@/lib/clube";
import { emDemonstracao } from "@/lib/modo";
import { FluxoDeSocio } from "@/componentes/socio/FluxoDeSocio";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ clube: string }> }): Promise<Metadata> {
  const clube = await clubeOu404(params);
  const adesao = await fonte.socios(clube.slug);
  return { title: "Ser sócio", description: `Torna-te sócio do ${clube.name}. ${adesao.intro}`.trim() };
}

/**
 * A adesão a sócio numa página do site. É para onde vão os links partilhados
 * e os botões de sócio sem JavaScript; com JavaScript, os botões abrem a
 * mesma adesão numa janela (`AdesaoNoSite`).
 */
export default async function SerSocio({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const [adesao, layout] = await Promise.all([fonte.socios(clube.slug), layoutAtual(clube)]);
  return (
    <div className="container-site py-10 sm:py-14">
      <FluxoDeSocio
        clube={{ slug: clube.slug, name: clube.name, shortName: clube.shortName, logoUrl: clube.logoUrl }}
        adesao={adesao}
        api={process.env.SITE_API_URL ?? ""}
        demonstracao={emDemonstracao()}
        quadrado={layout === "porto"}
        modo="pagina"
        idTitulo="adesao-pagina-titulo"
      />
    </div>
  );
}
