import { Navigate, useLocation } from "react-router-dom";

/**
 * Os endereços antigos das Contas (`/contas/movimentos`, `/contas/orcamento`)
 * abrem a mesma página no separador certo, com os filtros que traziam
 * (`?estado=PLANNED` continua a funcionar). Há links guardados em emails e nos
 * cartões do Assistente IA, e um endereço que deixa de abrir é pior do que um
 * que redireciona.
 */
export function RedirecionarContas({ vista }: { vista: "movimentos" | "orcamento" | "vencimentos" }) {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("vista", vista);
  return <Navigate to={`/contas?${p.toString()}`} replace />;
}
