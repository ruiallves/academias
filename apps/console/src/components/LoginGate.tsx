import { useEffect, useState, type ReactNode } from "react";
import { academyLandingUrl, adoptSessionFromUrl, readSession } from "@/lib/session";

const WANTED = "academia.wanted";

/**
 * A porta da consola.
 *
 * ## Há um sítio para entrar, e é a página da academia
 *
 * A autenticação acontece em `{slug}.academias.pt` — o endereço do clube, com a
 * marca do clube. A consola não tem login próprio, e é de propósito: dois
 * formulários de entrada são duas coisas para manter em sintonia, dois sítios onde
 * uma mensagem de erro pode divergir, e uma pergunta a mais para quem só quer
 * entrar ("qual dos dois é o meu?").
 *
 * Quem chegar aqui sem sessão é reencaminhado para lá. É o mesmo caminho que
 * `signOut` já usava, agora nos dois sentidos.
 *
 * ## A entrega da sessão
 *
 * Em produção a landing e a consola partilham origem, e o `sessionStorage`
 * atravessa sozinho. Em desenvolvimento são portas diferentes — origens diferentes
 * — e a landing entrega a sessão no fragmento do URL, que `adoptSessionFromUrl`
 * recolhe e limpa. Ver `lib/session.ts`.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  // Lido no primeiro render, antes de qualquer efeito: se a sessão veio no URL,
  // não pode haver um instante em que a consola a dê por inexistente e reencaminhe.
  const [session] = useState(() => adoptSessionFromUrl() ?? readSession());

  useEffect(() => {
    if (session) {
      /*
       * Chegou com sessão e havia um destino guardado — é quem clicou num link
       * de uma ficha, foi mandado entrar, e entrou. Levá-lo à Visão geral seria
       * fazê-lo procurar outra vez o que já tinha pedido.
       */
      try {
        const wanted = sessionStorage.getItem(WANTED);
        sessionStorage.removeItem(WANTED);
        if (wanted && wanted !== window.location.pathname + window.location.search) {
          window.history.replaceState(null, "", wanted);
        }
      } catch {
        /* modo privado: se não deu para guardar, também não há nada a repor */
      }
      return;
    }

    // Onde a pessoa queria ir, para lá voltar depois de entrar.
    try {
      sessionStorage.setItem(WANTED, window.location.pathname + window.location.search);
    } catch {
      /* sem armazenamento, entra-se na mesma — só se perde o destino */
    }

    // `replace` e não `assign`: quem foi mandado entrar não deve poder voltar atrás
    // do histórico para uma consola onde não tem sessão.
    window.location.replace(academyLandingUrl());
  }, [session]);

  if (session) return <>{children}</>;
  return <Redirecting />;
}

function Redirecting() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="text-center">
        <p className="text-body text-ink">A levar-te à página da academia…</p>
        <p className="mt-1 text-meta text-ink-3">É lá que se entra.</p>
        <a href={academyLandingUrl()} className="mt-4 inline-block text-meta font-medium text-ink underline">
          Continuar
        </a>
      </div>
    </div>
  );
}
