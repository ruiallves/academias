import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Banner as DadosBanner } from "@/dados/tipos";
import { classeDeBotao } from "./Botao";

/**
 * A faixa de destaque do início: um torneio, uma campanha, uma inscrição. A
 * fotografia por trás e o título por cima, com o degradê escuro fixo, como no
 * herói: o texto lê-se sobre qualquer foto. Sem foto, a cor do clube.
 *
 * Só se desenha com título e, pelo menos, foto ou texto: um título sozinho
 * numa faixa vazia parecia uma secção por acabar. O botão só aparece com
 * rótulo e endereço; um caminho do site vai por `Link`, um endereço completo
 * abre em separador novo.
 *
 * `quadrado` é o tema Holofote: cantos direitos e sem contentor, porque a
 * página é a toda a largura.
 */
export function temBanner(banner: DadosBanner): boolean {
  return !!banner.titulo.trim() && (!!banner.imagem.trim() || !!banner.texto.trim());
}

export function Banner({ banner, quadrado = false }: { banner: DadosBanner; quadrado?: boolean }) {
  if (!temBanner(banner)) return null;
  const titulo = banner.titulo.trim();
  const texto = banner.texto.trim();
  const imagem = banner.imagem.trim();

  const botao = banner.botao.trim();
  const url = banner.url.trim();
  const comBotao = !!botao && !!url;
  const interno = url.startsWith("/");
  const classeBotao = `${classeDeBotao("claro")} mt-6 !bg-white !text-[#1a1917]`;

  return (
    <section aria-label={titulo} className={quadrado ? "px-4 pb-10 sm:px-6 lg:px-8" : "container-site mt-16 sm:mt-20"} data-reveal>
      <div className={`relative overflow-hidden bg-signal-strong text-signal-on ${quadrado ? "" : "rounded-card"}`}>
        {imagem && (
          <>
            <Image src={imagem} alt="" fill sizes="(min-width: 1200px) 1200px, 100vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-night via-night/60 to-night/20" aria-hidden />
          </>
        )}
        <div className={`relative flex min-h-[18rem] flex-col justify-end p-6 sm:min-h-[22rem] sm:p-10 ${imagem ? "text-night-ink" : ""}`}>
          <h2 className={`display max-w-3xl text-3xl sm:text-4xl lg:text-5xl ${imagem ? "text-night-ink" : "text-signal-on"}`}>{titulo}</h2>
          {texto && <p className={`mt-4 max-w-2xl text-base sm:text-lg ${imagem ? "text-night-ink-2" : "text-[color:rgb(var(--signal-on-rgb)/0.85)]"}`}>{texto}</p>}
          {comBotao &&
            (interno ? (
              <Link href={url} className={`${classeBotao} self-start`}>
                {botao}
                <ArrowRight size={18} aria-hidden />
              </Link>
            ) : (
              <a href={url} target="_blank" rel="noopener noreferrer" className={`${classeBotao} self-start`}>
                {botao}
                <ArrowRight size={18} aria-hidden />
              </a>
            ))}
        </div>
      </div>
    </section>
  );
}
