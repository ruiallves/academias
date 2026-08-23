import { useEffect, useState, type ReactNode } from "react";
import { academySlug, readBrand } from "@/lib/brand";

/**
 * A app das famílias só corre instalada.
 *
 * Decisão de produto, não técnica: o pai instala a app da academia e abre-a pelo
 * ícone, em ecrã inteiro. Nunca por um link no browser, com barra de endereço e
 * separadores à volta — isso faria a coisa parecer um site, que é exactamente o
 * que este produto existe para substituir. A landing (`/l/:slug`) é o único
 * endereço que se envia às famílias, e a única acção que oferece é instalar.
 *
 * **Isto é uma porta, não um cadeado.** Impede o caminho normal, não um
 * utilizador determinado com as ferramentas de programador abertas. O controlo de
 * acesso a sério é a autenticação no servidor — esta barreira é sobre a forma
 * como o produto se apresenta, e é assim que deve ser lida.
 */

/**
 * `standalone` e `fullscreen` são os modos sem barra de browser. `minimal-ui`
 * fica de fora de propósito: ainda mostra parte da moldura, e a promessa aqui é
 * ecrã inteiro. `navigator.standalone` é o equivalente do iOS, anterior à norma.
 */
function isInstalled(): boolean {
  if (typeof window === "undefined") return true;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

export function StandaloneGate({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(isInstalled);

  // O modo pode mudar sem recarregar — instalar a partir desta mesma página, por
  // exemplo. Sem isto, a barreira ficaria de pé depois de deixar de fazer sentido.
  useEffect(() => {
    const query = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setInstalled(isInstalled());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Em `vite dev` a barreira está desligada, senão era impossível desenvolver a
  // app. O build de produção — o que chega ao telemóvel — aplica-a sempre.
  if (installed || import.meta.env.DEV) return <>{children}</>;

  return <InstallRequired />;
}

function InstallRequired() {
  // Esta barreira corre antes de haver sessão ou API — a identidade vem da última
  // vez que a app abriu (ver `lib/brand.ts`), e o slug do ambiente. Quem nunca a
  // abriu vê o texto genérico, que continua a levar ao sítio certo.
  const brand = readBrand();
  const landingUrl = `/l/${academySlug()}`;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 py-10 text-center">
      <span
        className="mb-5 flex size-14 items-center justify-center rounded-[16px] text-[20px] font-bold text-white"
        style={{ background: "var(--color-signal)" }}
        aria-hidden
      >
        {brand.mark || "•"}
      </span>

      <h1 className="mb-2 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Instala a app{brand.shortName ? ` da ${brand.shortName}` : " da academia"}
      </h1>

      <p className="mb-7 max-w-[300px] text-body leading-relaxed text-ink-3">
        Esta aplicação abre-se a partir do ícone no teu ecrã principal, em ecrã inteiro —
        não pelo navegador.
      </p>

      <a
        href={landingUrl}
        className="flex h-12 w-full max-w-[300px] items-center justify-center rounded-[12px] bg-ink px-4 text-body font-semibold text-surface"
      >
        Instalar
      </a>

      <p className="mt-4 max-w-[300px] text-meta text-ink-4">
        Já a instalaste? Fecha esta janela e abre a app pelo ícone.
      </p>
    </div>
  );
}
