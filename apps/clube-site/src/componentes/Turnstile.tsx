"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * O desafio anti-robô da Cloudflare (Turnstile), nos formulários sem sessão:
 * a compra de bilhetes, a identificação de sócio e os contactos.
 *
 * Quase sempre não se vê: a Cloudflare olha para o browser e entrega um token
 * sem perguntar nada (`appearance: "interaction-only"`). Só quando desconfia
 * aparece a caixa a pedir um clique. O token vale uma vez e cinco minutos, por
 * isso o formulário chama `renovar()` depois de cada envio, aceite ou não.
 *
 * Sem `TURNSTILE_SITE_KEY` (desenvolvimento, demonstração) não desenha nada e
 * o token fica vazio; a API também não o pede sem a chave secreta dela.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opcoes: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let aCarregar: Promise<void> | null = null;

function carregarScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!aCarregar) {
    aCarregar = new Promise((ok, falhou) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.defer = true;
      s.onload = () => ok();
      s.onerror = () => {
        aCarregar = null;
        falhou(new Error("Turnstile não carregou"));
      };
      document.head.appendChild(s);
    });
  }
  return aCarregar;
}

export const CHAVE_TURNSTILE = process.env.TURNSTILE_SITE_KEY ?? "";

export type TurnstileHandle = {
  /** O token atual (vazio enquanto a Cloudflare não respondeu, ou sem chave). */
  token: () => string;
  /** Pede um token novo: o anterior já foi gasto. */
  renovar: () => void;
};

export const Turnstile = forwardRef<TurnstileHandle, { onToken?: (token: string) => void; className?: string }>(function Turnstile(
  { onToken, className },
  ref,
) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const id = useRef<string | null>(null);
  const token = useRef("");
  const aoToken = useRef(onToken);
  aoToken.current = onToken;

  useImperativeHandle(ref, () => ({
    token: () => token.current,
    renovar: () => {
      token.current = "";
      aoToken.current?.("");
      if (id.current) window.turnstile?.reset(id.current);
    },
  }));

  useEffect(() => {
    if (!CHAVE_TURNSTILE) return;
    let vivo = true;
    void carregarScript()
      .then(() => {
        if (!vivo || !caixa.current || !window.turnstile || id.current) return;
        id.current = window.turnstile.render(caixa.current, {
          sitekey: CHAVE_TURNSTILE,
          appearance: "interaction-only",
          language: "pt",
          theme: "auto",
          size: "flexible",
          callback: (t: string) => {
            token.current = t;
            aoToken.current?.(t);
          },
          "expired-callback": () => {
            token.current = "";
            aoToken.current?.("");
          },
          "error-callback": () => {
            token.current = "";
            aoToken.current?.("");
          },
        });
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, []);

  if (!CHAVE_TURNSTILE) return null;
  return <div ref={caixa} className={className} />;
});
