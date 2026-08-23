import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import Overview from "@/routes/Overview";
import Academies from "@/routes/Academies";
import Contacts from "@/routes/Contacts";
import Growth from "@/routes/Growth";
import Audit from "@/routes/Audit";
import type { Me } from "@/lib/types";

export default function App({ me }: { me: Me }) {
  return (
    <Routes>
      <Route element={<Shell me={me} />}>
        <Route index element={<Overview />} />
        <Route path="academias" element={<Academies me={me} />} />
        <Route path="contactos" element={<Contacts me={me} />} />
        <Route path="crescimento" element={<Growth />} />
        <Route path="registo" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
