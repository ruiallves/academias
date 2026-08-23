import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { can, type Permission } from "@/lib/permissions";
import { useSession } from "@/session";

import DirectorOverview from "@/routes/director/Overview";
import CoachOverview from "@/routes/coach/Overview";
import Athletes from "@/routes/director/Athletes";
import Families from "@/routes/director/Families";
import Staff from "@/routes/director/Staff";
import Members from "@/routes/director/Members";
import MemberDetail from "@/routes/director/MemberDetail";
import StaffDetail from "@/routes/StaffDetail";
import Calendar from "@/routes/director/Calendar";
import Fees from "@/routes/director/Fees";
import Comms from "@/routes/director/Comms";
import Settings from "@/routes/director/Settings";
import Teams from "@/routes/Teams";
import TeamDetail from "@/routes/TeamDetail";
import AthleteDetail from "@/routes/AthleteDetail";
import MedicalOverview from "@/routes/medical/Overview";
import MedicalClinical from "@/routes/medical/Clinical";
import MedicalConsultations from "@/routes/medical/Consultations";
import Sessions from "@/routes/Sessions";
import CallUps from "@/routes/CallUps";
import Evaluations from "@/routes/Evaluations";
import Reports from "@/routes/Reports";
import ScoutingOverview from "@/routes/scouting/Overview";
import Prospects from "@/routes/scouting/Prospects";
import ProspectDetail from "@/routes/scouting/ProspectDetail";
import Shortlists, { ShortlistDetail } from "@/routes/scouting/Shortlists";
import ScoutingRequests from "@/routes/scouting/Requests";
import ScoutingObservations from "@/routes/scouting/Observations";
import ScoutingOverviewHome from "@/routes/scouting/Overview";

/**
 * A mesma árvore de rotas serve os dois perfis.
 *
 * O que muda é quem pode entrar — `<Allow>` verifica a permissão, não o papel — e
 * o que cada ecrã mostra, porque os dados já vêm limitados pelo âmbito na fronteira
 * de `lib/api`. Não há duas aplicações a manter em paralelo.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} />

        <Route path="atletas" element={<Allow p="athlete:read"><Athletes /></Allow>} />
        <Route path="atletas/:id" element={<Allow p="athlete:read"><AthleteDetail /></Allow>} />

        <Route path="familias" element={<Allow p="family:read"><Families /></Allow>} />
        <Route path="equipas" element={<Allow p="team:read"><Teams /></Allow>} />
        <Route path="equipas/:id" element={<Allow p="team:read"><TeamDetail /></Allow>} />

        <Route path="staff" element={<Allow p="staff:read"><Staff /></Allow>} />
        <Route path="staff/:id" element={<Allow p="staff:read"><StaffDetail /></Allow>} />

        {/* Sócios — o livro do clube, ao lado do staff. */}
        <Route path="socios" element={<Allow p="member:read"><Members /></Allow>} />
        <Route path="socios/:id" element={<Allow p="member:read"><MemberDetail /></Allow>} />
        {/* O menu chamava-se "Treinadores" até a academia passar a ter também
            departamento clínico e direção. Links antigos continuam a funcionar. */}
        <Route path="treinadores" element={<Navigate to="/staff" replace />} />

        <Route path="calendario" element={<Allow p="calendar:read"><Calendar /></Allow>} />

        {/* Presenças (direção) e Treinos (equipa técnica) são o mesmo ecrã. */}
        <Route path="presencas" element={<Allow p="attendance:read"><Sessions /></Allow>} />
        {/* "Treinos" foi renomeado para "Presenças" — o menu diz o que lá se faz.
            O caminho antigo reencaminha: links guardados não devem partir. */}
        <Route path="treinos" element={<Navigate to="/presencas" replace />} />
        <Route path="convocatorias" element={<Allow p="attendance:read"><CallUps /></Allow>} />

        <Route path="mensalidades" element={<Allow p="billing:read"><Fees /></Allow>} />
        <Route path="comunicacao" element={<Allow p="comms:read"><Comms /></Allow>} />
        <Route path="avaliacoes" element={<Allow p="evaluation:read"><Evaluations /></Allow>} />
        <Route path="relatorios" element={<Allow p="report:read"><Reports /></Allow>} />
        <Route path="definicoes" element={<Allow p="settings:write"><Settings /></Allow>} />

        {/*
          Scouting. `scouting:read` guarda os dossiês; o vídeo tem permissão
          própria (é imagem de menores de outros clubes), e os **pedidos** têm
          outra ainda: `scouting:request`, que é o que um treinador tem.

          A guarda da rota tem de casar com a do menu. Não casava — o item
          aparecia ao treinador e o clique reencaminhava-o para a página inicial,
          o que é o pior dos dois mundos: promete e não cumpre. Sempre que um
          item de navegação mudar de permissão, esta lista muda com ele.
        */}
        <Route path="scouting" element={<Allow p="scouting:read"><ScoutingOverview /></Allow>} />
        <Route path="scouting/prospects" element={<Allow p="scouting:read"><Prospects /></Allow>} />
        <Route path="scouting/prospects/:id" element={<Allow p="scouting:read"><ProspectDetail /></Allow>} />
        <Route path="scouting/observacoes" element={<Allow p="scouting:read"><ScoutingObservations /></Allow>} />
        <Route path="scouting/shortlists" element={<Allow p="scouting:read"><Shortlists /></Allow>} />
        <Route path="scouting/shortlists/:id" element={<Allow p="scouting:read"><ShortlistDetail /></Allow>} />
        <Route path="scouting/pedidos" element={<Allow p="scouting:request"><ScoutingRequests /></Allow>} />

        {/* Departamento clínico. `clinical:read` é o que separa o boletim do
            estado de disponibilidade — ver lib/permissions.ts. */}
        <Route path="clinico" element={<Allow p="clinical:read"><MedicalClinical /></Allow>} />
        <Route path="clinico/consultas" element={<Allow p="clinical:read"><MedicalConsultations /></Allow>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * A página inicial é a de quem entra.
 *
 * O departamento de scouting via a visão geral da direção — mensalidades, atletas,
 * a semana da academia — que não é o trabalho dele e não responde a nenhuma das
 * suas perguntas. Agora a sua página inicial é a sala de operações do scouting, e
 * é por isso que o menu deixou de precisar de uma entrada "Visão geral".
 */
function Overview() {
  const { session } = useSession();
  if (session.role === "SCOUT") return <ScoutingOverviewHome />;
  if (session.role === "MEDICAL") return <MedicalOverview />;
  if (session.role === "COACH" || session.role === "STAFF") return <CoachOverview />;
  return <DirectorOverview />;
}

/**
 * Guarda de permissão.
 *
 * Do lado do cliente isto é conveniência, não segurança — quem sabe o URL chega cá.
 * A garantia real está no servidor (guard + RLS); aqui só evitamos mostrar um ecrã
 * vazio a quem não devia sequer saber que ele existe.
 */
function Allow({ p, children }: { p: Permission; children: React.ReactNode }) {
  const { session } = useSession();
  return can(session, p) ? <>{children}</> : <Navigate to="/" replace />;
}
