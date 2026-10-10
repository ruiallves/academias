import { ImageResponse } from "next/og";
import { fonte } from "@/dados/fonte";
import { monograma } from "@/componentes/Emblema";
import { onColor, strongSignal } from "@academia/ui/tokens";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * O favicon de cada clube: o logótipo se o tiver, senão o escudo com o
 * monograma na cor do clube. Gerado no servidor por clube, como o ícone da
 * app (`/icone/:slug/:versao` na API).
 */
export default async function Icon({ params }: { params: Promise<{ clube: string }> }) {
  const { clube: slug } = await params;
  const clube = await fonte.clube(slug);
  const cor = strongSignal(clube?.signalColor ?? "#0f6b62");
  const tinta = onColor(cor);

  if (clube?.logoUrl) {
    return new ImageResponse(
      // eslint-disable-next-line @next/next/no-img-element
      <img src={clube.logoUrl} alt="" width={64} height={64} style={{ objectFit: "contain" }} />,
      size,
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: 64,
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: cor,
          borderRadius: 14,
          color: tinta,
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: -1,
        }}
      >
        {monograma(clube?.shortName ?? "Clube")}
      </div>
    ),
    size,
  );
}
