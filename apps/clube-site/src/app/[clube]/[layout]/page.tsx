import { fonte, proximoEUltimo } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { InicioClassico } from "@/layouts/classico/Inicio";
import { InicioPorto } from "@/layouts/porto/Inicio";

export const revalidate = 60;

/**
 * A página de início é a que mais muda entre layouts, por isso cada um tem
 * a sua. Os dados são os mesmos; a composição é que não.
 */
export default async function Inicio({ params }: { params: Promise<{ clube: string; layout: string }> }) {
  const clube = await clubeOu404(params);
  const { layout } = await params;
  const [noticias, jogos, equipas, produtos] = await Promise.all([
    fonte.noticias(clube.slug, { limit: 8 }),
    proximoEUltimo(clube.slug),
    fonte.equipas(clube.slug),
    fonte.produtos(clube.slug),
  ]);
  const dados = { clube, noticias, ...jogos, equipas, produtos };
  return layout === "porto" ? <InicioPorto {...dados} /> : <InicioClassico {...dados} />;
}
