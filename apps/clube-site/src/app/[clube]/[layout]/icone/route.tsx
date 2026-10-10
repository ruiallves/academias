import { ImageResponse } from "next/og";
import { fonte } from "@/dados/fonte";
import { monograma } from "@/componentes/Emblema";
import { onColor, strongSignal } from "@academia/ui/tokens";

export const revalidate = 3600;

/**
 * O favicon de cada clube, em `/icone`: o logótipo se o tiver, senão um
 * quadrado com o monograma na cor do clube.
 *
 * É uma rota e não o `icon.tsx` do Next de propósito: a convenção escreve no
 * HTML um `href` com o segmento dinâmico (`/monteverde/icon`), e o proxy
 * voltava a pôr o slug à frente. Com a rota, o `href` é o que o layout
 * escreve (`/icone`), e o proxy trata-o como a qualquer outra página.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ clube: string }> }) {
  const { clube: slug } = await params;
  const clube = await fonte.clube(slug);
  const cor = strongSignal(clube?.signalColor ?? "#0f6b62");
  const tinta = onColor(cor);
  const size = { width: 64, height: 64 };

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
