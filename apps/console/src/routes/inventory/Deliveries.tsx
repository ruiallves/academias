import { Navigate } from "react-router-dom";

/**
 * A antiga página das entregas, que passou a ser a vista "Com atletas" do
 * Inventário. Fica a redirecionar para os links guardados continuarem a funcionar.
 */
export default function Deliveries() {
  return <Navigate to="/inventario?vista=atletas" replace />;
}
