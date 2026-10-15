"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Adesao } from "@/dados/tipos";
import { FluxoDeSocio } from "./FluxoDeSocio";

/**
 * O "Ser sócio" numa janela por cima da página, em vez de mandar a pessoa
 * para a página de adesão da API.
 *
 * Os botões de sócio do site (`BotaoSocio`) são links para `/ser-socio`: sem
 * JavaScript, ou abertos noutro separador, chega-se à mesma adesão numa
 * página do site. Com JavaScript, abrem esta janela.
 *
 * - O resto da página fica `inert` enquanto a janela está aberta: o teclado
 *   não sai dela, e o leitor de ecrã só a lê a ela.
 * - Esc, o "Fechar" e o botão de voltar do telemóvel fecham-na; o foco volta
 *   ao botão que a abriu.
 * - A janela fica montada depois de aberta a primeira vez: fechar e abrir
 *   encontra o formulário como estava. Depois de enviar, recomeça.
 */

type Contexto = { abrir: (origem?: HTMLElement | null) => void };
const ContextoAdesao = createContext<Contexto | null>(null);

export const useAdesao = () => useContext(ContextoAdesao);

export function AdesaoNoSite({
  clube,
  adesao,
  api,
  demonstracao,
  quadrado = false,
  children,
}: {
  clube: { slug: string; name: string; shortName: string; logoUrl?: string };
  adesao: Adesao;
  api: string;
  demonstracao: boolean;
  quadrado?: boolean;
  children: ReactNode;
}) {
  const [montada, setMontada] = useState(false);
  const [aberta, setAberta] = useState(false);
  const [aSair, setASair] = useState(false);
  const [versao, setVersao] = useState(0);
  const origem = useRef<HTMLElement | null>(null);
  const janela = useRef<HTMLDivElement | null>(null);
  const comHistoria = useRef(false);
  const enviado = useRef(false);
  const devolverFoco = useRef(false);

  const abrir = useCallback((el?: HTMLElement | null) => {
    origem.current = el ?? (document.activeElement as HTMLElement | null);
    setMontada(true);
    setASair(false);
    setAberta(true);
    // Uma entrada no histórico: o "voltar" do telemóvel fecha a janela em vez
    // de sair da página com o formulário a meio.
    window.history.pushState({ ...window.history.state, adesaoSocio: true }, "");
    comHistoria.current = true;
  }, []);

  const esconder = useCallback(() => {
    setASair(true);
    // A saída é mais curta do que a entrada; depois some de vez.
    window.setTimeout(() => {
      setAberta(false);
      setASair(false);
      // Depois de enviar, a próxima abertura começa do princípio.
      if (enviado.current) {
        enviado.current = false;
        setVersao((v) => v + 1);
      }
      devolverFoco.current = true;
    }, 160);
  }, []);

  // O foco volta ao botão que abriu a janela, mas só depois de a página
  // deixar de estar `inert`: antes disso o browser recusa-o.
  useEffect(() => {
    if (aberta || !devolverFoco.current) return;
    devolverFoco.current = false;
    origem.current?.focus({ preventScroll: true });
  }, [aberta]);

  const fechar = useCallback(() => {
    if (comHistoria.current) {
      comHistoria.current = false;
      window.history.back(); // o `popstate` abaixo esconde a janela
    } else {
      esconder();
    }
  }, [esconder]);

  // O "voltar" do browser com a janela aberta.
  useEffect(() => {
    const aoVoltar = () => {
      if (!aberta) return;
      comHistoria.current = false;
      esconder();
    };
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, [aberta, esconder]);

  // Esc fecha; a página por trás não rola.
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    document.addEventListener("keydown", tecla);
    const html = document.documentElement;
    const antes = html.style.overflow;
    html.style.overflow = "hidden";
    janela.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", tecla);
      html.style.overflow = antes;
    };
  }, [aberta, fechar]);

  return (
    <ContextoAdesao.Provider value={{ abrir }}>
      <div className="contents" inert={aberta || undefined}>
        {children}
      </div>

      {montada && (
        <div className={`fixed inset-0 z-[100] flex items-stretch justify-center lg:items-center lg:p-6 ${aberta ? "" : "hidden"}`}>
          <div
            className={`absolute inset-0 bg-night/60 backdrop-blur-[3px] ${aSair ? "animate-[socio-fundo-sair_160ms_ease-in_forwards]" : "animate-[socio-fundo_220ms_ease-out]"}`}
            onClick={fechar}
            aria-hidden
          />
          <div
            ref={janela}
            role="dialog"
            aria-modal="true"
            aria-labelledby="adesao-titulo"
            tabIndex={-1}
            className={`relative flex w-full flex-col overflow-hidden bg-canvas outline-none lg:h-[min(48rem,calc(100dvh-3rem))] lg:max-w-[66rem] lg:shadow-[0_40px_90px_-30px_rgb(20_19_17/0.6)] ${quadrado ? "" : "lg:rounded-[20px]"} ${
              aSair ? "animate-[socio-janela-sair_160ms_ease-in_forwards]" : "animate-[socio-janela_320ms_var(--ease-out)]"
            }`}
          >
            <FluxoDeSocio
              key={versao}
              clube={clube}
              adesao={adesao}
              api={api}
              demonstracao={demonstracao}
              quadrado={quadrado}
              modo="janela"
              onFechar={fechar}
              onEnviado={() => {
                enviado.current = true;
              }}
            />
          </div>
        </div>
      )}
    </ContextoAdesao.Provider>
  );
}
