import { useState } from "react";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx } from "@/components/primitives";
import { InviteAdminDialog } from "@/components/InviteAdminDialog";
import { Failed } from "./Overview";
import { shortDate } from "@/lib/format";
import { apiPatch } from "@/lib/http";
import { useApi } from "@/lib/query";
import { ADMIN_ROLE_LABEL, type Admin, type Me } from "@/lib/types";

/**
 * Quem gere a plataforma.
 *
 * Fechado a `OWNER` — dito duas vezes de propósito: o servidor já recusa
 * (`@PlatformRoles("OWNER")`), e esta página nem chega a pedir os dados a quem
 * não é dono, porque um 403 a meio do ecrã pareceria uma avaria e não uma porta
 * fechada.
 *
 * Sem edição de papel nem apagar: um administrador entra por convite, com o
 * papel que o convite disse, e sai por desactivação — nunca por uma linha
 * apagada. `isActive: false` já corta o acesso por completo (é o que o
 * `PlatformGuard` verifica), e mantém `AuditLog`/`Contact` a apontar para
 * alguém real. Ver o cabeçalho de `admin-invites.service.ts` no servidor.
 */
export default function Admins({ me }: { me: Me }) {
  const { data, loading, error, reload } = useApi<Admin[]>(me.role === "OWNER" ? "/admins" : null);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (me.role !== "OWNER") {
    return (
      <>
        <PageHeader title="Administradores" />
        <Empty title="Só o dono da plataforma gere administradores" detail="Fala com quem tiver esse papel." />
      </>
    );
  }

  if (loading) return <Skeleton />;
  if (error) return <Failed message={error} onRetry={reload} />;

  async function toggle(admin: Admin) {
    setBusyId(admin.id);
    try {
      await apiPatch(`/admins/${admin.id}/estado`, { active: !admin.isActive });
      reload();
    } catch {
      /* o erro fica visível ao tentar outra vez — não há onde o mostrar por linha */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="Administradores" subtitle={`${data?.length ?? 0} pessoas com acesso a este painel`}>
        <button type="button" onClick={() => setInviting(true)} className="ctl-primary">
          <UserPlus className="size-3.5" strokeWidth={2} />
          Convidar
        </button>
      </PageHeader>

      {inviting && (
        <InviteAdminDialog
          onClose={() => setInviting(false)}
          onCreated={() => {
            setInviting(false);
            reload();
          }}
        />
      )}

      <Panel>
        {!data || data.length === 0 ? (
          <Empty title="Ainda não há administradores" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="border-b border-line bg-sunken/60 text-meta font-medium text-ink-3">
                  <th className="px-5 py-2 text-left">Pessoa</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Papel</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Estado</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">2FA</th>
                  <th className="px-5 py-2 text-right whitespace-nowrap">Entrou</th>
                  <th className="px-5 py-2 text-right whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => {
                  const self = a.id === me.id;
                  return (
                    <tr key={a.id} className="border-b border-line last:border-b-0 hover:bg-sunken/40">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-ink">
                          {a.name}
                          {self && <span className="ml-1.5 text-meta font-normal text-ink-4">(tu)</span>}
                        </div>
                        <div className="text-meta text-ink-4">{a.email}</div>
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{ADMIN_ROLE_LABEL[a.role]}</td>
                      <td className="px-3 py-2.5">
                        <Pill tone={a.isActive ? "ok" : "neutral"}>{a.isActive ? "Activo" : "Desactivado"}</Pill>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cx("text-meta", a.mfaEnabled ? "text-[#1f7a45]" : "text-ink-4")}>
                          {a.mfaEnabled ? "Ligado" : "—"}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right text-meta text-ink-3 whitespace-nowrap">{shortDate(a.createdAt)}</td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap">
                        {self ? (
                          <span className="text-meta text-ink-4">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggle(a)}
                            disabled={busyId === a.id}
                            className={cx("ctl-ghost", a.isActive ? "text-[#a82a20]" : "text-[#1f7a45]")}
                          >
                            {busyId === a.id ? "…" : a.isActive ? "Desactivar" : "Reactivar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Skeleton() {
  return (
    <>
      <PageHeader title="Administradores" />
      <div className="panel h-[300px] animate-pulse bg-sunken/40" />
    </>
  );
}
