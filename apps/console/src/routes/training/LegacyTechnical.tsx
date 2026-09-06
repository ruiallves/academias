import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Loading } from "@/components/primitives";
import { useStore } from "@/lib/store";
import { modulePath, profileOf, profiledSports, sportAreaById, sportPath, type ModuleKey } from "@/lib/sports";
import { getExercise, listGameModels, listSetPieces } from "@/lib/training";

/**
 * Os caminhos antigos da Área técnica.
 *
 * `/exercicios`, `/modelos-jogo` e `/bolas-paradas` eram menus; passaram a
 * viver dentro de cada modalidade em `/modalidades/:id/…`. Os endereços antigos
 * continuam a funcionar — estão em favoritos, em mensagens, em notificações —
 * e resolvem-se para o novo sítio:
 *
 *  - uma **ficha** (`/exercicios/abc`) pergunta ao próprio conteúdo de que
 *    modalidade é e vai para lá;
 *  - uma **lista** vai para a primeira modalidade do clube com área técnica;
 *  - sem nenhuma, vai para os Treinos — que é a página da área técnica que
 *    existe para toda a gente.
 */
export default function LegacyTechnical({ module }: { module?: ModuleKey }) {
  const { id } = useParams();
  useStore();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const first = profiledSports()[0];
    const fallback = first
      ? module
        ? modulePath(first.id, profileOf(first)!, module, id === "novo" ? "novo" : undefined)
        : sportPath(first.id)
      : "/treinos";

    if (!id || !module || id === "novo") {
      setTarget(fallback);
      return;
    }

    const sportOf: Promise<string | null> =
      module === "exercises"
        ? getExercise(id).then((e) => e.sportId)
        : module === "playbook"
          ? listGameModels().then((rows) => rows.find((r) => r.id === id)?.sportId ?? null)
          : listSetPieces().then((rows) => rows.find((r) => r.id === id)?.sportId ?? null);

    sportOf
      .then((sportId) => {
        const area = sportAreaById(sportId);
        setTarget(area ? modulePath(area.sport.id, area.profile, module, id) : fallback);
      })
      .catch(() => setTarget(fallback));
  }, [id, module]);

  if (!target) return <Loading />;
  return <Navigate to={target} replace />;
}
