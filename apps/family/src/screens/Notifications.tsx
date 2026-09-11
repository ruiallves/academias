import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { destinoDaNotificacao } from "@/lib/rotas";
import { chooseContext } from "@/lib/contexts";
import { Bell, CalendarClock, FileText, Gauge, Megaphone, Trophy, Wallet, type LucideIcon } from "lucide-react";
import { apiPatch } from "@/lib/http";
import { reload, useStore, type ApiNotification } from "@/lib/store";
import { cx, whenLabel } from "@/ui";
import { currentSubscription, pushState, pushSupported } from "@/lib/push";

/**
 * Notificações — as que o servidor guardou, não uma lista montada no browser.
 *
 * Cada tipo tem peso próprio: uma mensalidade em falta pesa mais e traz a acção
 * junto; um aviso da academia é uma linha calma. A hierarquia faz-se pela cor da
 * marca do tipo e pelo destaque, não por gritar.
 *
 * O push é o empurrão; esta lista é o histórico. Um telemóvel desligado, uma
 * permissão negada, uma notificação lida de passagem — está tudo cá na mesma.
 *
 * O interruptor do push **não** vive aqui: é uma definição da conta e mudou-se
 * para o perfil. Um histórico com um painel de configuração colado ao fundo é um
 * ecrã a fazer duas coisas, e nenhuma pessoa vai a "Notificações" à procura de um
 * interruptor — vai à procura do que a academia lhe disse.
 */

/** O ícone e o tom de cada tipo. Os do enum `NotificationType`, do servidor. */
const STYLE: Record<string, { icon: LucideIcon; cls: string; urgent?: boolean }> = {
  PAYMENT_DUE: { icon: Wallet, cls: "bg-risk-soft text-risk", urgent: true },
  PAYMENT_FAILED: { icon: Wallet, cls: "bg-risk-soft text-risk", urgent: true },
  PAYMENT_PENDING: { icon: Wallet, cls: "bg-warn-soft text-warn" },
  PAYMENT_RECEIVED: { icon: Wallet, cls: "bg-ok-soft text-ok" },
  MATCH_CALLED_UP: { icon: Trophy, cls: "bg-signal-soft text-signal-ink", urgent: true },
  SESSION_CHANGED: { icon: CalendarClock, cls: "bg-warn-soft text-warn" },
  SESSION_CANCELLED: { icon: CalendarClock, cls: "bg-risk-soft text-risk" },
  EVALUATION_PUBLISHED: { icon: Gauge, cls: "bg-signal-soft text-signal-ink" },
  REPORT_SHARED: { icon: FileText, cls: "bg-signal-soft text-signal-ink" },
  ANNOUNCEMENT_PUBLISHED: { icon: Megaphone, cls: "bg-sunken text-ink-2" },
};

const FALLBACK = { icon: Bell, cls: "bg-sunken text-ink-2" };

export default function Notifications() {
  const store = useStore();
  const notifications = store.notifications;

  /*
   * O convite para ligar o push só faz sentido a quem não o tem ligado.
   *
   * Aparecia sempre que a lista estivesse vazia — mesmo a quem já tinha as
   * notificações activas no telemóvel. Dizer "Ligar notificações" a quem já as
   * ligou é dizer-lhe que o que ele fez não funcionou.
   *
   * `null` é "ainda não se sabe": a subscrição lê-se do `PushManager`, que é
   * assíncrono. Enquanto não se sabe, não se mostra nada — piscar o convite e
   * escondê-lo um instante depois é pior do que esperar por ele.
   */
  const [pushLigado, setPushLigado] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    void currentSubscription()
      .then((sub) => {
        if (vivo) setPushLigado(pushState() === "granted" && Boolean(sub));
      })
      .catch(() => {
        // Sem `PushManager` (um browser que não suporta), trata-se como "não
        // ligado" — mas o convite só aparece se o push for de todo possível.
        if (vivo) setPushLigado(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  /*
   * Abrir o ecrã é ler.
   *
   * Marca-se do lado do servidor para o contador do sino bater certo entre
   * dispositivos — quem leu no telemóvel não volta a ver o ponto vermelho no
   * tablet. Sem recarregar tudo a seguir: a lista já está no ecrã, e um salto
   * visual a meio da leitura seria pior do que um contador desactualizado por
   * mais um instante.
   */
  useEffect(() => {
    const unread = notifications.filter((n) => !n.readAt).map((n) => n.id);
    if (unread.length === 0) return;

    const t = setTimeout(() => {
      void apiPatch("/api/notifications/read", { ids: unread })
        .then(() => reload())
        .catch(() => {
          /* sem drama: fica por ler e tenta-se na próxima visita */
        });
    }, 1200);
    return () => clearTimeout(t);
  }, [notifications]);

  return (
    <div className="space-y-6 pt-3">
      <h1 className="px-1 text-[30px] leading-tight font-semibold tracking-[-0.03em] text-ink">Notificações</h1>

      {notifications.length === 0 ? (
        <div className="rounded-[var(--radius-xl)] bg-surface p-10 text-center" style={{ boxShadow: "var(--shadow-soft)" }}>
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3">
            <Bell className="size-6" strokeWidth={1.75} />
          </span>
          <p className="text-body font-semibold text-ink">Sem notificações</p>
          <p className="mx-auto mt-1 max-w-[32ch] text-meta text-ink-3">
            Mensalidades, convocatórias e avisos da academia aparecem aqui.
          </p>
          {/*
            Com a lista vazia há espaço para dizer onde ficou o interruptor — é o
            único momento em que ninguém está a ler outra coisa. Mas só a quem
            ainda não o ligou, e só onde ligar seja possível: num browser sem
            `PushManager` o convite manda a pessoa a um sítio onde não há nada
            para carregar.
          */}
          {pushLigado === false && pushSupported() && (
            <Link to="/perfil" className="mt-3 inline-block text-meta font-semibold text-signal-ink underline underline-offset-2">
              Ligar notificações no telemóvel
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n, i) => (
            <NotifRow key={n.id} n={n} i={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NotifRow({ n, i }: { n: ApiNotification; i: number }) {
  const style = STYLE[n.type] ?? FALLBACK;
  const Icon = style.icon;
  const unread = !n.readAt;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /*
   * Nem toda a rota gravada corresponde a uma página desta app — ver
   * `destinoDaNotificacao`. O que não se reconhece fica sem ligação, em vez de
   * levar à inicial a fingir que se navegou.
   */
  const achado = destinoDaNotificacao(n.route);
  /*
   * E um destino que é esta mesma página não é destino nenhum.
   *
   * Um aviso da academia aponta para `/notificacoes`, que é onde ele já está a
   * ser lido: o cartão parecia clicável, tocava-se, e não acontecia nada — a
   * mesma sensação de "não leva a lado nenhum" que um cartão morto, com o
   * agravante de ter prometido. Aqui não promete.
   */
  const destino = achado && achado.area === "FAMILY" && achado.rota === pathname ? null : achado;

  const body = (
    <>
      <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-[14px]", style.cls)}>
        <Icon className="size-[21px]" strokeWidth={1.9} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-body font-semibold text-ink">{n.title}</span>
          <span className="ml-auto shrink-0 text-[12px] font-medium text-ink-4">
            {whenLabel(new Date(n.createdAt), new Date())}
          </span>
        </span>
        <span className="mt-0.5 block text-meta leading-relaxed text-ink-2">{n.body}</span>
      </span>

      {/* Por ler: um ponto, não um "NOVO" a piscar. */}
      {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-signal" aria-label="Por ler" />}
    </>
  );

  const className = cx(
    "flex w-full gap-3.5 rounded-[var(--radius-lg)] p-4 text-left",
    style.urgent && unread ? "bg-surface ring-1 ring-risk/20 shadow-[var(--shadow-soft)]" : "bg-surface shadow-[var(--shadow-soft)]",
  );

  if (!destino) {
    return (
      <li className="rise" style={{ ["--i" as string]: i }}>
        <div className={className}>{body}</div>
      </li>
    );
  }

  /*
   * Uma quota de sócio vive na outra vista da app.
   *
   * O `<Link>` sozinho não chegava: as rotas de sócio só existem enquanto a
   * área de sócio estiver vestida, e de dentro da família caíam no `*` do
   * router — de volta à inicial, que é exactamente o "não leva a lado nenhum"
   * que isto veio resolver. Veste-se a área primeiro, e só depois se navega.
   */
  if (destino.area === "MEMBER") {
    return (
      <li className="rise" style={{ ["--i" as string]: i }}>
        <button
          type="button"
          onClick={() => {
            chooseContext("MEMBER");
            navigate(destino.rota);
          }}
          className={cx(className, "active:scale-[0.99]")}
        >
          {body}
        </button>
      </li>
    );
  }

  return (
    <li className="rise" style={{ ["--i" as string]: i }}>
      <Link to={destino.rota} className={cx(className, "active:scale-[0.99]")}>
        {body}
      </Link>
    </li>
  );
}
