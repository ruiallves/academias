import type { Metadata } from "next";
import { clubeOu404 } from "@/lib/clube";
import { emDemonstracao } from "@/lib/modo";
import { PaginaDaEncomenda } from "./PaginaDaEncomenda";

/**
 * A página de uma encomenda: o pagamento por fazer e, paga, o que leva e
 * como se entrega. O endereço leva o token da encomenda, que é o que dá
 * acesso: vem da compra e do email, e não entra no sitemap nem no Google
 * (`noindex` aqui, `X-Robots-Tag` no proxy).
 *
 * O servidor só desenha a casca; o estado pede-o o browser à API, sem cache,
 * e volta a perguntar enquanto o pagamento não chega.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "A tua encomenda",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ clube: string; token: string }> };

export default async function EncomendaPage({ params }: Props) {
  const clube = await clubeOu404(params);
  const { token } = await params;
  return <PaginaDaEncomenda slug={clube.slug} token={token} api={process.env.SITE_API_URL ?? ""} demonstracao={emDemonstracao()} />;
}
