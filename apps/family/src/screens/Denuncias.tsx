import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, EyeOff, Lock, ShieldAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { FRASE_DO_ESTADO, minhasDenuncias, type Denuncia } from "@/lib/conduta";
import { cx, dateShort } from "@/ui";

/**
 * O canal de denúncia: os casos que esta pessoa enviou, e a porta para enviar
 * outro.
 *
 * ## O que este ecrã tem de dizer antes de pedir seja o que for
 *
 * Quem chega aqui está, quase sempre, preocupado ou zangado. Por isso a
 * primeira coisa que o ecrã diz não é "preenche", é **o que acontece ao que
 * se escreve**: quem lê (só a direção, nunca os treinadores), e que se pode
 * pedir para não ser identificado. É o que faz alguém decidir escrever.
 *
 * Sem casos, o ecrã é só isso e o botão. Com casos, a lista fica por cima, com
 * o estado de cada um numa frase e não num código, e o ponto do "há resposta".
 */
export default function Denuncias() {
  const store = useStore();
  const navigate = useNavigate();
  const [casos, setCasos] = useState<Denuncia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    minhasDenuncias()
      .then(setCasos)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  return (
    <div className="pt-2">
      <button type="button" onClick={() => navigate(-1)} className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2">
        <ChevronLeft className="size-4" strokeWidth={2.2} />
        Voltar
      </button>

      <header className="px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{store.academy.shortName}</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">Canal de denúncia</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
          Bullying, uma falta de respeito, uma situação que te deixou desconfortável. O clube quer saber.
        </p>
      </header>

      {/* As duas garantias, antes de qualquer pedido. */}
      <ul className="mt-5 space-y-2">
        <Garantia icone={Lock} titulo="Só a direção lê" texto="O que escreves não chega aos treinadores nem ao resto do staff. Só a quem o clube escolheu para tratar destes casos." />
        <Garantia icone={EyeOff} titulo="Podes não ser identificado" texto="Se pedires, o clube não vê quem enviou. Continuas a receber as respostas aqui na app." />
      </ul>

      <Link to="/denuncias/nova" className="cta mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold">
        <ShieldAlert className="size-[18px]" strokeWidth={2} />
        Enviar uma denúncia
      </Link>

      {erro && <p className="mt-4 text-center text-[13px] text-risk">{erro}</p>}

      {casos && casos.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">As tuas denúncias</h2>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
            {casos.map((c) => (
              <li key={c.id} className="border-b border-line last:border-0">
                <Link to={`/denuncia/${c.id}`} className="flex items-center gap-3 p-4 active:bg-sunken/60">
                  <span className={cx("size-2 shrink-0 rounded-full", c.unread ? "bg-signal" : "bg-transparent")} aria-label={c.unread ? "Resposta por ler" : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cx("truncate text-body text-ink", c.unread ? "font-semibold" : "font-medium")}>{c.categoryLabel}</span>
                      <span className="shrink-0 text-[12px] text-ink-4">#{c.number}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                      {FRASE_DO_ESTADO[c.status]} · {dateShort(new Date(c.createdAt))}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Garantia({ icone: Icone, titulo, texto }: { icone: typeof Lock; titulo: string; texto: string }) {
  return (
    <li className="flex items-start gap-3 rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
        <Icone className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-semibold text-ink">{titulo}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-3">{texto}</span>
      </span>
    </li>
  );
}
