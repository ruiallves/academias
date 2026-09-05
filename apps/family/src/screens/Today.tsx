import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight, MapPin, Megaphone, Trophy, UserRound, Wallet } from "lucide-react";
import { useChild } from "@/App";
import { useStore } from "@/lib/store";
import { cx, dayShort, greeting, money, monthShort, time, whenLabel } from "@/ui";

/**
 * "O que preciso de saber hoje sobre o meu filho?"
 *
 * De cima para baixo por urgência, mas sem transformar cada item num cartão. A
 * página lê-se como uma linha do tempo pessoal: primeiro o dinheiro em falta (se
 * houver), depois o próximo compromisso, e o resto a escorrer por baixo, cada vez
 * mais discreto.
 *
 * **Destaque não é tamanho.** A primeira versão desta página dava meio ecrã ao
 * pagamento em falta e outro meio ao próximo treino: dois blocos enormes que
 * empurravam tudo o resto para fora do ecrã e faziam a app parecer um cartaz. O
 * que destaca uma coisa é o contraste com o que está à volta — o painel escuro
 * entre superfícies claras, a cor da academia entre neutros — e isso funciona com
 * 80px de altura tão bem como com 200.
 */
export default function Today() {
  const { child } = useChild();
  const store = useStore();
  const now = new Date();

  const myTrainings = store.trainings.filter((t) => t.childId === child.id && !t.cancelled);
  const myMatches = store.matches.filter((m) => m.childId === child.id && !m.cancelled);

  // O próximo compromisso é o mais próximo dos dois — um jogo no sábado ganha ao
  // treino de terça, e ao contrário também.
  const nextTraining = myTrainings.filter((t) => t.end >= now).sort(byStart)[0];
  const nextMatch = myMatches.filter((m) => m.end >= now).sort(byStart)[0];
  const next =
    nextTraining && nextMatch ? (nextTraining.start <= nextMatch.start ? nextTraining : nextMatch) : (nextTraining ?? nextMatch);

  /*
   * "Por pagar" e "a confirmar" são duas faixas, não uma.
   *
   * Um pai que pagou por MB Way ontem à noite abria a app de manhã e via a
   * faixa escura a dizer que devia — e ia à secretaria marcar em dinheiro uma
   * mensalidade já paga. A base tinha razão (a euPago ainda não tinha
   * confirmado), mas a faixa dizia a coisa certa da forma errada.
   */
  const mine = store.payments.filter((p) => p.childId === child.id && (p.status === "overdue" || p.status === "pending"));
  const outstanding = mine.filter((p) => !p.confirming).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const confirming = mine.filter((p) => p.confirming);

  const notices = store.notices.slice(0, 3);
  const calledUp = myMatches.filter((m) => m.calledUp && m.end >= now).sort(byStart)[0];

  // A convocatória já é o próximo compromisso? Então não se diz duas vezes.
  const showCallUp = calledUp && calledUp.id !== next?.id;

  let i = 0;

  return (
    <div className="space-y-5 pt-3">
      {/*
        A saudação numa linha só. Partida em duas — "Bom dia," / "Sandra." — era
        um título de cartaz: ocupava o dobro da altura para dizer o mesmo, e
        empurrava o que interessa para baixo da dobra.
      */}
      <header className="rise px-1" style={{ ["--i" as string]: i++ }}>
        <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          {dayShort(now)} · {now.getDate()} {monthShort(now)}
        </p>
        <h1 className="mt-1 text-[26px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink">
          {greeting(now)}, {store.guardian.firstName}
        </h1>
      </header>

      {outstanding.length > 0 && (
        <div className="rise" style={{ ["--i" as string]: i++ }}>
          <PaymentDue items={outstanding} childName={child.firstName} />
        </div>
      )}

      {confirming.length > 0 && (
        <div className="rise" style={{ ["--i" as string]: i++ }}>
          <Link
            to="/pagamentos"
            className="flex items-center gap-3.5 rounded-[var(--radius-lg)] bg-surface p-3.5 shadow-[var(--shadow-soft)] active:scale-[0.99]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-signal-soft text-signal-ink">
              <Wallet className="size-[19px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                A confirmar · {child.firstName}
              </span>
              <span className="block truncate text-body font-semibold text-ink">
                {confirming.length === 1
                  ? `${confirming[0].extra ? confirming[0].label : `Mensalidade de ${confirming[0].label.toLowerCase()}`} — pagamento enviado`
                  : `${confirming.length} pagamentos enviados`}
              </span>
            </span>
            <span className="num shrink-0 text-body font-semibold text-ink-3">
              {money(confirming.reduce((n, p) => n + p.amountCents, 0))}
            </span>
          </Link>
        </div>
      )}

      {next ? (
        <div className="rise" style={{ ["--i" as string]: i++ }}>
          <NextUp item={next} team={child.team} coach={child.coach} />
        </div>
      ) : (
        <div className="rise surface p-5 text-center" style={{ ["--i" as string]: i++ }}>
          <p className="text-body font-semibold text-ink">Nada agendado</p>
          <p className="mt-1 text-meta text-ink-3">Avisamos-te assim que a academia marcar o próximo.</p>
        </div>
      )}

      {/* Convocatória — a única coisa que pede uma resposta do pai. */}
      {showCallUp && (
        <div className="rise" style={{ ["--i" as string]: i++ }}>
          <Link
            to="/agenda"
            className="flex items-center gap-3.5 rounded-[var(--radius-lg)] bg-surface p-3.5 shadow-[var(--shadow-soft)] active:scale-[0.99]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-signal-soft text-signal-ink">
              <Trophy className="size-[19px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                Convocado · {whenLabel(calledUp.start, now)}
              </span>
              <span className="block truncate text-body font-semibold text-ink">
                {calledUp.isHome ? "vs" : "@"} {calledUp.opponent}
              </span>
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-ink-4" strokeWidth={2.25} />
          </Link>
        </div>
      )}

      {/* Régua da semana — sete dias, sete colunas, sem arrastar. */}
      <section className="rise" style={{ ["--i" as string]: i++ }}>
        <div className="mb-2.5 flex items-center justify-between px-1">
          <h2 className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Esta semana</h2>
          <Link to="/agenda" className="inline-flex items-center gap-1 text-[13px] font-semibold text-signal-ink">
            Agenda <ArrowUpRight className="size-3.5" strokeWidth={2.25} />
          </Link>
        </div>
        <WeekRail />
      </section>

      {notices.length > 0 && (
        <section className="rise px-1" style={{ ["--i" as string]: i++ }}>
          <h2 className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Da academia</h2>
          {notices.map((n) => (
            <Link key={n.id} to="/notificacoes" className="block">
              <div className="flex items-start gap-3.5 rounded-[var(--radius-md)] px-2 py-3 active:bg-sunken/60">
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-sunken text-ink-3">
                  <Megaphone className="size-[18px]" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                    {n.from.split(" ")[0]} · {whenLabel(n.at, now)}
                  </p>
                  <p className="mt-0.5 text-body font-semibold text-ink">{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-meta text-ink-2">{n.body}</p>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

const byStart = (a: { start: Date }, b: { start: Date }) => a.start.getTime() - b.start.getTime();

/* -------------------------------------------------------------------------- */
/* Pagamento em falta                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Tinta escura, não vermelho a gritar: numa página de superfícies claras, o
 * painel escuro é a coisa que o olho encontra primeiro — e chega-lhe uma linha
 * para o ser. O valor vai à direita, onde se lê um preço, e a linha inteira é o
 * caminho para os pagamentos: nesta altura o pai já sabe o que quer fazer.
 *
 * Com mais do que uma em atraso mostra-se o **total**, não a primeira: um pai com
 * três meses por pagar quer saber quanto deve, não qual é o mês mais antigo.
 */
function PaymentDue({
  items,
  childName,
}: {
  items: { amountCents: number; label: string; status: string; extra: boolean }[];
  childName: string;
}) {
  const total = items.reduce((n, p) => n + p.amountCents, 0);
  const overdue = items.some((p) => p.status === "overdue");
  const many = items.length > 1;

  /*
   * O que a faixa diz, com uma cobrança avulsa pelo meio.
   *
   * Uma só: o nome do que é. "Mensalidade de setembro" quando é a mensalidade —
   * o rótulo dela é o mês e a palavra tem de vir daqui —, e o título tal como o
   * clube o escreveu quando não é: "Equipamento de treino" já se explica, e
   * "Mensalidade de equipamento de treino" seria mentira.
   *
   * Várias: só se lhes pode chamar "mensalidades" se forem todas mensalidades.
   * Com uma avulsa à mistura são "pagamentos", que é o que têm em comum.
   */
  const titulo = many
    ? items.every((p) => !p.extra)
      ? `${items.length} mensalidades`
      : `${items.length} pagamentos`
    : items[0].extra
      ? items[0].label
      : `Mensalidade de ${items[0].label.toLowerCase()}`;

  return (
    <Link
      to="/pagamentos"
      className="flex items-center gap-3.5 rounded-[var(--radius-lg)] bg-ink p-4 text-white active:scale-[0.99]"
      style={{ boxShadow: "var(--shadow-float)" }}
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-white/12">
        <Wallet className="size-[19px]" strokeWidth={1.9} />
        {overdue && <span className="absolute -top-px -right-px size-2.5 rounded-full bg-risk ring-2 ring-ink" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-[0.06em] text-white/55 uppercase">
          {overdue ? "Por pagar · vencida" : "Por pagar"} · {childName}
        </span>
        <span className="block truncate text-[15px] font-semibold">{titulo}</span>
      </span>

      <span className="num shrink-0 text-[19px] font-semibold">{money(total)}</span>
      <ChevronRight className="size-4 shrink-0 text-white/40" strokeWidth={2.25} />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* O próximo compromisso                                                       */
/* -------------------------------------------------------------------------- */

type Upcoming = { start: Date; end: Date; venue: string; dressingRoom?: string; opponent?: string; isHome?: boolean };

/**
 * Iluminado pela cor da academia, mas do tamanho de um cartão e não de um poster.
 *
 * A hora continua a ser o maior elemento — é a única coisa que um pai a caminho
 * do carro precisa de ler de relance — só que a 36px em vez de 52, e sem o
 * retrato do filho a repetir o que o seletor lá em cima já diz.
 */
function NextUp({ item, team, coach }: { item: Upcoming; team: string; coach: string }) {
  const isMatch = item.opponent !== undefined;

  return (
    <div className="brandlit overflow-hidden rounded-[var(--radius-xl)] p-4" style={{ boxShadow: "var(--shadow-float)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="on-2 text-[11px] font-semibold tracking-[0.06em] uppercase">
          {isMatch ? "Próximo jogo" : "Próximo treino"}
        </span>
        <span className="chip chip-glass py-0.5 text-[11px] uppercase">{whenLabel(item.start, new Date())}</span>
      </div>

      <div className="mt-2.5 flex items-baseline gap-2.5">
        <span className="num text-[36px] leading-none font-semibold">{time(item.start)}</span>
        <span className="on-2 text-[15px] font-semibold">– {time(item.end)}</span>
      </div>

      <h3 className="mt-1.5 truncate text-[17px] font-semibold tracking-[-0.01em]">
        {isMatch ? `${item.isHome ? "vs" : "@"} ${item.opponent}` : team}
      </h3>

      <div className="on-1 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <MapPin className="on-3 size-4 shrink-0" strokeWidth={2} />
          <span className="truncate">
            {item.venue}
            {/* Um pai à porta de um pavilhão com quatro portas procura isto. */}
            {item.dressingRoom && <span className="on-2"> · {item.dressingRoom}</span>}
          </span>
        </span>
        {!isMatch && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <UserRound className="on-3 size-4 shrink-0" strokeWidth={2} />
            <span className="truncate">{coach}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Os próximos sete dias, em sete colunas.
 *
 * Era uma fila que se arrastava na horizontal — e um scroll lateral dentro de uma
 * página que já rola na vertical é sempre uma armadilha: metade das pessoas nunca
 * descobre que há mais para lá da margem, e quem descobre arrasta a página por
 * engano. Sete dias cabem à largura de qualquer telemóvel; o que não cabia era a
 * hora escrita em cada dia, e essa é a informação que a Agenda existe para dar.
 * Fica o ponto: "há alguma coisa neste dia".
 */
function WeekRail() {
  const { child } = useChild();
  const store = useStore();
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));

  const mine = [
    ...store.trainings.filter((t) => t.childId === child.id && !t.cancelled).map((t) => ({ start: t.start, match: false })),
    ...store.matches.filter((m) => m.childId === child.id && !m.cancelled).map((m) => ({ start: m.start, match: true })),
  ];

  return (
    <div className="grid grid-cols-7 gap-0.5 rounded-[var(--radius-lg)] bg-surface p-2 shadow-[var(--shadow-soft)]">
      {days.map((day, index) => {
        const items = mine.filter((x) => x.start.toDateString() === day.toDateString());
        const isToday = index === 0;

        return (
          <div key={day.toISOString()} className="flex flex-col items-center gap-1 py-1">
            <span className="text-[10px] font-semibold tracking-[0.04em] text-ink-4 uppercase">{dayShort(day)}</span>
            <span
              className={cx(
                "num flex size-8 items-center justify-center rounded-full text-[15px] font-semibold",
                isToday ? "bg-ink text-white" : "text-ink",
              )}
            >
              {day.getDate()}
            </span>
            {/* Altura reservada mesmo sem pontos: sem isto, as colunas dançavam. */}
            <span className="flex h-1.5 items-center gap-0.5">
              {items.slice(0, 3).map((x, k) => (
                <span
                  key={k}
                  className="size-1.5 rounded-full"
                  style={{ background: x.match ? "var(--color-signal)" : "var(--color-ink-4)" }}
                />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
