import type { Metadata } from "next";
import { clubeOu404 } from "@/lib/clube";
import { emDemonstracao } from "@/lib/modo";
import { Checkout } from "./Checkout";

/**
 * O carrinho e o pagamento. O carrinho vive no browser (`lib/loja.ts`), por
 * isso o servidor só desenha a casca: o que está lá dentro, os preços e o
 * stock de agora pede-os o browser à API ao abrir.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Carrinho", robots: { index: false, follow: true } };

type Props = { params: Promise<{ clube: string }> };

export default async function Carrinho({ params }: Props) {
  const clube = await clubeOu404(params);
  return <Checkout slug={clube.slug} api={process.env.SITE_API_URL ?? ""} demonstracao={emDemonstracao()} loja={clube.loja ?? null} clube={clube.shortName} />;
}
