import { Navigate, useSearchParams } from "react-router-dom";

/**
 * A antiga lista de artigos, que passou a ser a vista "Artigos" do Inventário.
 * Fica a redirecionar para os links guardados continuarem a funcionar
 * (`?estado=low` vai para "A repor").
 */
export default function Items() {
  const [params] = useSearchParams();
  const p = new URLSearchParams(params);
  if (p.get("estado") === "low") {
    p.delete("estado");
    p.set("vista", "repor");
  }
  const qs = p.toString();
  return <Navigate to={`/inventario${qs ? `?${qs}` : ""}`} replace />;
}
