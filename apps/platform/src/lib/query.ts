import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, ApiError } from "@/lib/http";

/**
 * Leitura de dados com estado de carregamento e de erro.
 *
 * Uma implementação pequena e não uma biblioteca de data-fetching: o que a consola
 * precisa é de carregar, falhar com uma mensagem, e voltar a carregar quando
 * alguém escreve. Trazer uma dependência para isso — e o seu modelo de cache, de
 * invalidação e de chaves — seria mais peça a manter do que problema resolvido.
 *
 * ## Três estados, e nenhum deles é "vazio"
 *
 * A distinção que interessa é entre **a carregar**, **falhou** e **está vazio**. Os
 * três parecem-se no ecrã e significam coisas opostas: uma lista vazia porque a
 * academia ainda não tem atletas é um convite a criar o primeiro; a mesma lista
 * vazia porque o pedido rebentou é um erro escondido. Por isso `data` é `undefined`
 * até haver resposta, e nunca um array vazio por omissão.
 */

export type Query<T> = {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  /** 403 é diferente de tudo o resto: não é um erro para repetir, é uma porta fechada. */
  forbidden: boolean;
  reload: () => void;
};

export function useApi<T>(path: string | null): Query<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  // Descarta respostas de pedidos que já não interessam: sem isto, um pedido lento
  // a chegar depois de um rápido escrevia por cima do resultado mais recente.
  const generation = useRef(0);

  const run = useCallback(() => {
    if (path === null) {
      setLoading(false);
      return;
    }

    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    setStatus(null);

    apiGet<T>(path)
      .then((result) => {
        if (mine !== generation.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (mine !== generation.current) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar.");
        setStatus(err instanceof ApiError ? err.status : null);
        setLoading(false);
      });
  }, [path]);

  useEffect(run, [run]);

  return { data, loading, error, forbidden: status === 403, reload: run };
}
