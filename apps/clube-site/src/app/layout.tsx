import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

/**
 * Uma letra só, servida por nós (o Next descarrega-a na build e serve-a da
 * mesma origem: sem pedido ao Google em cada visita). O eixo de largura é o
 * que dá os títulos apertados dos cartazes de jogo sem uma segunda família.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Site do clube",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT" className={archivo.variable} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
