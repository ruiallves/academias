import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import Overview from "@/routes/Overview";
import Academies from "@/routes/Academies";
import AcademyDetail from "@/routes/AcademyDetail";
import Tickets from "@/routes/Tickets";
import Growth from "@/routes/Growth";
import Contas from "@/routes/Contas";
import Audit from "@/routes/Audit";
import Admins from "@/routes/Admins";
import Legal from "@/routes/Legal";
import Novidades from "@/routes/Novidades";
import Comercial from "@/routes/comercial/Comercial";
import Hoje from "@/routes/comercial/Hoje";
import Clubes from "@/routes/comercial/Clubes";
import Reunioes from "@/routes/comercial/Reunioes";
import Mes from "@/routes/comercial/Mes";
import type { Me } from "@/lib/types";

export default function App({ me }: { me: Me }) {
  const comercial = (
    <Route path="comercial" element={<Comercial me={me} />}>
      <Route index element={<Hoje me={me} />} />
      <Route path="clubes" element={<Clubes me={me} />} />
      <Route path="reunioes" element={<Reunioes me={me} />} />
      <Route path="mes" element={<Mes me={me} />} />
    </Route>
  );

  /*
   * O comercial só tem a área comercial. As outras páginas nem existem para ele
   * (o servidor recusava-as de qualquer forma); qualquer endereço vai para Hoje.
   */
  if (me.role === "COMERCIAL") {
    return (
      <Routes>
        <Route element={<Shell me={me} />}>
          {comercial}
          <Route path="*" element={<Navigate to="/comercial" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Shell me={me} />}>
        <Route index element={<Overview />} />
        <Route path="academias" element={<Academies me={me} />} />
        {/* A ficha de um clube. Ver `AcademyDetail` — responde a outra pergunta
            que a lista, e por isso é outra página e não mais colunas. */}
        <Route path="academias/:id" element={<AcademyDetail me={me} />} />
        <Route path="tickets" element={<Tickets me={me} />} />
        {comercial}
        {/* "Contactos" passou a "Comercial → Clubes". O endereço antigo continua a abrir. */}
        <Route path="contactos" element={<Navigate to="/comercial/clubes" replace />} />
        <Route path="crescimento" element={<Growth />} />
        {/* As contas do negócio. `OWNER` e `ADMIN` no servidor; quem dá apoio não
            vê quanto a empresa ganha ou gasta. */}
        <Route path="contas" element={<Contas />} />
        <Route path="registo" element={<Audit />} />
        <Route path="administradores" element={<Admins me={me} />} />
        <Route path="comunicados" element={<Novidades />} />
        {/* O endereço antigo, para os favoritos e os links já partilhados. */}
        <Route path="novidades" element={<Navigate to="/comunicados" replace />} />
        <Route path="legal" element={<Legal me={me} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
