import { Link } from "react-router-dom";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { cx } from "./primitives";

/**
 * O nome de uma pessoa, clicável até à ficha dela.
 *
 * Existe para que "quem é este treinador?" tenha sempre a mesma resposta, venha a
 * pergunta do plantel de uma equipa, de um treino por registar ou de um aviso
 * enviado às famílias. Espalhar `<Link>` por seis ficheiros dava seis
 * comportamentos ligeiramente diferentes ao fim de um mês.
 *
 * ## Duas coisas que tem de acertar
 *
 * **Permissão.** Sem `staff:read` não há ficha para ver, e um link que leva a um
 * ecrã de "sem acesso" é pior do que texto simples. Nesse caso rende só o nome.
 *
 * **Cliques dentro de linhas clicáveis.** Várias tabelas navegam com `onClick` na
 * linha inteira. Sem `stopPropagation`, clicar no nome de um treinador dentro da
 * linha de um treino disparava as duas navegações e ganhava a errada.
 */
export function PersonLink({
  id,
  name,
  className,
  /** Primeiro nome apenas — para tabelas estreitas, onde o nome completo não cabe. */
  short = false,
}: {
  id: string | undefined;
  name: string | undefined;
  className?: string;
  short?: boolean;
}) {
  const { session } = useSession();

  if (!name) return <span className={cx("text-ink-4", className)}>—</span>;

  const label = short ? name.split(/\s+/)[0] : name;

  if (!id || !can(session, "staff:read")) {
    return <span className={className}>{label}</span>;
  }

  return (
    <Link
      to={`/staff/${id}`}
      onClick={(e) => e.stopPropagation()}
      className={cx("hover:underline", className)}
    >
      {label}
    </Link>
  );
}
