import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Panel, PanelHead } from "./primitives";
import { ArrowRight, CalendarCheck, Hash, Tag, UserPlus, Wallet } from "@/lib/icons";
import { listMembers, type MemberRow } from "@/lib/members";
import { periodLabel } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { NewMemberDialog, StatusPill } from "@/routes/director/Members";
import type { Athlete } from "@/data/types";

/**
 * A ficha de sócio do atleta, no perfil dele (pedido do Rui, 02/11/2026).
 *
 * Se é sócio: número, categoria, estado e a última quota paga, com a ligação
 * para a ficha de sócio. Se não é: o botão que abre o Novo sócio já com este
 * atleta escolhido e a ficha preenchida, para não ter de ir aos Sócios
 * procurá-lo.
 *
 * Só aparece a quem vê os sócios (`member:read`); criar pede `member:write`.
 * Reconhece o sócio pela ligação ao atleta (`Member.athleteId`), que é a que o
 * servidor usa para as quotas pagas pelos encarregados.
 */
export function SocioDoAtletaPanel({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const mayRead = can(session, "member:read");
  const mayWrite = can(session, "member:write");
  const [socio, setSocio] = useState<MemberRow | null | undefined>(undefined);
  const [novo, setNovo] = useState(false);

  const carregar = useCallback(() => {
    if (!mayRead) return;
    listMembers({ athleteId: athlete.id })
      /* Confirma-se aqui também: uma API antiga ignora o filtro e devolve o livro todo. */
      .then((r) => setSocio(r.members.find((m) => m.athlete?.id === athlete.id) ?? null))
      .catch(() => setSocio(null));
  }, [athlete.id, mayRead]);

  useEffect(carregar, [carregar]);

  if (!mayRead) return null;

  return (
    <Panel>
      <PanelHead title="Sócio" hint={socio ? "a ficha de sócio deste atleta" : "ficha de sócio"}>
        {socio && <StatusPill status={socio.status} />}
      </PanelHead>

      {socio === undefined ? (
        <div className="h-[92px]" aria-busy />
      ) : socio ? (
        <>
          <dl className="px-5 py-1.5">
            <Linha icon={Hash} label="Número de sócio" value={socio.number != null ? `n.º ${socio.number}` : "por atribuir"} />
            <Linha icon={Tag} label="Categoria" value={socio.tier?.name ?? "Sem categoria"} />
            <Linha
              icon={CalendarCheck}
              label="Última quota paga"
              value={socio.lastPaidPeriod ? periodLabel(socio.lastPaidPeriod) : "nenhuma"}
            />
            {socio.paidByFamily && <Linha icon={Wallet} label="Quem paga as quotas" value="os encarregados" />}
          </dl>
          <div className="border-t border-line px-5 py-2.5">
            <Link
              to={`/socios/${socio.id}`}
              className="inline-flex items-center gap-1.5 text-meta font-medium text-ink-2 hover:text-ink"
            >
              Abrir a ficha de sócio
              <ArrowRight className="size-3.5" strokeWidth={1.75} />
            </Link>
          </div>
        </>
      ) : (
        <div className="space-y-2 px-5 py-3">
          <p className="text-meta leading-relaxed text-ink-3">
            {athlete.name} ainda não é sócio do clube.
            {mayWrite &&
              athlete.status === "active" &&
              " Ao criar, a ficha de sócio vem preenchida com os dados do atleta e fica ligada a ele."}
          </p>
          {mayWrite && athlete.status === "active" && (
            <button type="button" className="ctl-ghost" onClick={() => setNovo(true)}>
              <UserPlus className="size-3.5" strokeWidth={1.75} />
              Criar sócio
            </button>
          )}
        </div>
      )}

      {novo && <NewMemberDialog inicial={[`a:${athlete.id}`]} onClose={() => setNovo(false)} onCreated={carregar} />}
    </Panel>
  );
}

function Linha({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
      <Icon className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
      <dt className="min-w-0 flex-1 text-body text-ink-3">{label}</dt>
      <dd className="shrink-0 text-body font-medium text-ink">{value}</dd>
    </div>
  );
}
