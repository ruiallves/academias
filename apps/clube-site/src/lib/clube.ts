import { notFound } from "next/navigation";
import { fonte } from "@/dados/fonte";
import type { Clube } from "@/dados/tipos";

/** O clube deste pedido, ou 404. Todas as páginas começam aqui. */
export async function clubeOu404(params: Promise<{ clube: string }>): Promise<Clube> {
  const { clube: slug } = await params;
  const clube = await fonte.clube(slug);
  if (!clube) notFound();
  return clube;
}
