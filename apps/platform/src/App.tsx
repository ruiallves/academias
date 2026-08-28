import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import Overview from "@/routes/Overview";
import Academies from "@/routes/Academies";
import AcademyDetail from "@/routes/AcademyDetail";
import Contacts from "@/routes/Contacts";
import Tickets from "@/routes/Tickets";
import Growth from "@/routes/Growth";
import Audit from "@/routes/Audit";
import Admins from "@/routes/Admins";
import type { Me } from "@/lib/types";

export default function App({ me }: { me: Me }) {
  return (
    <Routes>
      <Route element={<Shell me={me} />}>
        <Route index element={<Overview />} />
        <Route path="academias" element={<Academies me={me} />} />
        {/* A ficha de um clube. Ver `AcademyDetail` — responde a outra pergunta
            que a lista, e por isso é outra página e não mais colunas. */}
        <Route path="academias/:id" element={<AcademyDetail />} />
        <Route path="tickets" element={<Tickets me={me} />} />
        <Route path="contactos" element={<Contacts me={me} />} />
        <Route path="crescimento" element={<Growth />} />
        <Route path="registo" element={<Audit />} />
        <Route path="administradores" element={<Admins me={me} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
