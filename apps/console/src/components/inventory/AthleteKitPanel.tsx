import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, Loading, Panel, PanelHead, Pill } from "@/components/primitives";
import { DeliverDialog } from "@/components/inventory/DeliverDialog";
import { ReturnDialog } from "@/components/inventory/ReturnDialog";
import { Boxes, PackageOpen, Undo2 } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { ASSIGNMENT_LABEL, listAssignments, type Assignment } from "@/lib/inventory";

/**
 * O equipamento de um atleta, na ficha dele.
 *
 * ## Mostra o que ele tem, e o que já devolveu
 *
 * Primeiro o que está com ele — é a pergunta de Junho, quando se recolhe o
 * material. O que já voltou fica por baixo, mais discreto: serve para responder
 * a "mas eu entreguei" sem ninguém ter de procurar no histórico do armazém.
 *
 * ## Carrega sozinho, e só aqui
 *
 * O inventário não entra na `store` da aplicação: muda a cada entrega, e uma
 * cópia global seria uma cópia velha. Este painel pede o que precisa quando
 * abre — que é o mesmo que o painel clínico faz, pela mesma razão.
 */
export function AthleteKitPanel({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const { session } = useSession();
  const podeEscrever = can(session, "inventory:write");

  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [entregar, setEntregar] = useState(false);
  const [devolver, setDevolver] = useState<Assignment | null>(null);

  async function carregar() {
    setErro(null);
    try {
      setRows(await listAssignments({ athleteId, status: "all" }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o equipamento.");
    }
  }

  useEffect(() => {
    void carregar();
  }, [athleteId]);

  const comEle = (rows ?? []).filter((a) => a.status === "ACTIVE");
  const fechados = (rows ?? []).filter((a) => a.status !== "ACTIVE");

  return (
    <>
      <Panel>
        <PanelHead
          title="Equipamento atribuído"
          hint={comEle.length ? `${comEle.length} ${comEle.length === 1 ? "artigo" : "artigos"}` : "nada por devolver"}
        >
          {podeEscrever && (
            <button type="button" className="ctl-ghost" onClick={() => setEntregar(true)}>
              <PackageOpen className="size-3.5" strokeWidth={1.75} />
              Entregar
            </button>
          )}
        </PanelHead>

        {erro ? (
          <p className="px-5 py-4 text-meta text-risk">{erro}</p>
        ) : rows === null ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty
            title="Sem equipamento entregue"
            detail={
              podeEscrever
                ? "Quando o clube lhe entregar material, aparece aqui — com a data e quem entregou."
                : "Ainda não lhe foi entregue material do clube."
            }
            icon={Boxes}
            compact
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {comEle.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <Link to={`/inventario/artigos/${a.itemId}`} className="block truncate text-body font-medium text-ink hover:underline">
                      {a.itemName} <span className="font-normal text-ink-3">· {a.variantLabel}</span>
                    </Link>
                    <span className="block truncate text-meta text-ink-3">
                      {a.quantity} {a.quantity === 1 ? "unidade" : "unidades"} · entregue em {shortDate(new Date(a.assignedAt))}
                      {a.assignedBy ? ` por ${a.assignedBy}` : ""}
                      {a.notes ? ` · ${a.notes}` : ""}
                    </span>
                  </span>
                  {podeEscrever && (
                    <button type="button" className="ctl-ghost h-7 shrink-0 text-meta" onClick={() => setDevolver(a)}>
                      <Undo2 className="size-3.5" strokeWidth={1.75} />
                      Devolver
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {fechados.length > 0 && (
              <div className="border-t border-line">
                <p className="px-5 pt-3 pb-1 text-meta font-medium text-ink-3">Já devolvido</p>
                <ul className="divide-y divide-line">
                  {fechados.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink-2">
                          {a.itemName} <span className="text-ink-3">· {a.variantLabel}</span>
                        </span>
                        <span className="block truncate text-meta text-ink-3">
                          {a.quantity} × · {a.returnedAt ? shortDate(new Date(a.returnedAt)) : "—"}
                          {a.returnedBy ? ` · ${a.returnedBy}` : ""}
                        </span>
                      </span>
                      <Pill tone={a.status === "RETURNED" ? "ok" : "risk"}>{ASSIGNMENT_LABEL[a.status]}</Pill>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Panel>

      {entregar && (
        <DeliverDialog
          athleteId={athleteId}
          onClose={() => setEntregar(false)}
          onDone={() => void carregar()}
        />
      )}

      {devolver && (
        <ReturnDialog
          assignment={{ ...devolver, athleteName }}
          onClose={() => setDevolver(null)}
          onDone={() => {
            setDevolver(null);
            void carregar();
          }}
        />
      )}
    </>
  );
}
