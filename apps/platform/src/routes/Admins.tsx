import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx } from "@/components/primitives";
import { InviteAdminDialog } from "@/components/InviteAdminDialog";
import { Failed, Skeleton } from "./Overview";
import { shortDate } from "@/lib/format";
import { apiDelete, apiPatch, ApiError } from "@/lib/http";
import { useApi } from "@/lib/query";
import { ADMIN_ROLE_LABEL, type Admin, type Me, type PlatformRole } from "@/lib/types";

const ROLES: PlatformRole[] = ["OWNER", "ADMIN", "SUPPORT"];

/**
 * Quem gere a plataforma.
 *
 * Fechado a `OWNER` — dito duas vezes de propósito: o servidor já recusa
 * (`@PlatformRoles("OWNER")`), e esta página nem chega a pedir os dados a quem
 * não é dono, porque um 403 a meio do ecrã pareceria uma avaria e não uma porta
 * fechada.
 *
 * ## O que se pode fazer à própria linha, e o que não
 *
 * Mudar o próprio papel, sim — não corta o acesso a meio da sessão, só muda o
 * que se pode fazer daqui para a frente. Desactivar-se ou apagar-se, não: as
 * duas cortariam o próprio acesso agora mesmo, e o servidor recusa-o sempre. A
 * saída é entrar com outra conta de administrador.
 *
 * O servidor também recusa ficar sem nenhum `OWNER` activo — o erro aparece
 * aqui tal como ele o disser, e não é escondido.
 */
export default function Admins({ me }: { me: Me }) {
  const { data, loading, error, reload } = useApi<Admin[]>(me.role === "OWNER" ? "/admins" : null);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  async function toggleActive(admin: Admin) {
    setBusyId(admin.id);
    setActionError(null);
    try {
      await apiPatch(`/admins/${admin.id}/estado`, { active: !admin.isActive });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Não foi possível mudar o estado.");
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(admin: Admin, role: PlatformRole) {
    if (role === admin.role) return;
    setBusyId(admin.id);
    setActionError(null);
    try {
      await apiPatch(`/admins/${admin.id}/papel`, { role });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Não foi possível mudar o papel.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(admin: Admin) {
    setBusyId(admin.id);
    setActionError(null);
    try {
      await apiDelete(`/admins/${admin.id}`);
      setConfirmingId(null);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Não foi possível apagar.");
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

      {actionError && (
        <p className="mb-4 rounded-[var(--radius-control)] bg-[#fae9e7] px-3.5 py-2.5 text-meta leading-relaxed text-[#a82a20]">
          {actionError}
        </p>
      )}

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
                  const busy = busyId === a.id;
                  const confirming = confirmingId === a.id;

                  return (
                    <tr key={a.id} className="border-b border-line last:border-b-0 hover:bg-sunken/40">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-ink">
                          {a.name}
                          {self && <span className="ml-1.5 text-meta font-normal text-ink-4">(tu)</span>}
                        </div>
                        <div className="text-meta text-ink-4">{a.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={a.role}
                          disabled={busy}
                          onChange={(e) => changeRole(a, e.target.value as PlatformRole)}
                          className="h-7 rounded-[var(--radius-control)] border border-line bg-surface px-1.5 text-meta text-ink-2 focus:border-line-strong focus:outline-none disabled:opacity-50"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ADMIN_ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </td>
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
                        ) : confirming ? (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => remove(a)}
                              disabled={busy}
                              className="ctl-ghost text-[#a82a20]"
                            >
                              {busy ? "…" : "Confirmar apagar"}
                            </button>
                            <button type="button" onClick={() => setConfirmingId(null)} className="ctl-ghost">
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleActive(a)}
                              disabled={busy}
                              className={cx("ctl-ghost", a.isActive ? "text-[#a82a20]" : "text-[#1f7a45]")}
                            >
                              {busy ? "…" : a.isActive ? "Desactivar" : "Reactivar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(a.id)}
                              disabled={busy}
                              className="ctl-ghost size-7 justify-center px-0 text-ink-3 hover:text-[#a82a20]"
                              aria-label={`Apagar ${a.name}`}
                            >
                              <Trash2 className="size-3.5" strokeWidth={1.75} />
                            </button>
                          </span>
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

