import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { Cockpit, Stars } from "@/components/certification/Cockpit";
import { Criteria, Path } from "@/components/certification/Overview";
import { ProfileDialog } from "@/components/certification/ProfileDialog";
import { Requirements, type RequirementsView } from "@/components/certification/Requirements";
import { Award, TriangleAlert } from "@/lib/icons";
import { mostrarOk } from "@/lib/avisos";
import {
  answerRequirement,
  clearAnswer,
  getCertification,
  levelTitle,
  pts,
  saveProfile,
  type Profile,
  type Summary,
  type Unavailable,
} from "@/lib/certification";
import "./certification.css";

type Tab = "overview" | "criteria" | "requirements";

/** Os requisitos como abrem: o que trava a estrela seguinte, sem mais filtros. */
const VISTA: RequirementsView = { filter: "next", criterion: "all", level: "all", cumulative: true, query: "", open: null };

/**
 * Certificação FPF.
 *
 * O resumo responde a duas perguntas e a mais nenhuma: em que nível o clube
 * está, e o que lhe falta para o seguinte. Os critérios e a lista dos
 * requisitos têm separador próprio — já estiveram todos na mesma página, e ela
 * lia-se como um relatório em vez de dizer o que fazer.
 *
 * ## Tudo vem calculado do servidor
 *
 * A página não faz contas. Cada escrita devolve o resumo inteiro já
 * recalculado e ele substitui o anterior: o mostrador, o caminho e a lista
 * mudam juntos, e não há estado local para ficar para trás.
 */
export default function Certification() {
  const [data, setData] = useState<Summary | Unavailable | null>(null);
  const [erro, setErro] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState<RequirementsView>(VISTA);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    // O aviso do erro já apareceu ao canto (`lib/http`); aqui só se decide o
    // que a página mostra no lugar do conteúdo.
    getCertification().then(setData, () => setErro(true));
  }, []);

  if (erro) return <Empty title="Certificação FPF" detail="Não foi possível carregar a certificação. Tente outra vez daqui a pouco." icon={TriangleAlert} />;
  if (!data) return <Loading />;

  if (!data.available) {
    return (
      <>
        <PageHeader title="Certificação FPF" />
        <Empty title="Sem candidatura para mostrar" detail={data.reason} icon={Award} />
      </>
    );
  }

  /** Grava, e troca o resumo pelo que o servidor devolveu. */
  async function gravar(chave: string, pedido: () => Promise<Summary>, confirmacao?: string) {
    setSaving(chave);
    try {
      setData(await pedido());
      if (confirmacao) mostrarOk(confirmacao);
      return true;
    } catch {
      // O erro já foi mostrado pelo cliente HTTP.
      return false;
    } finally {
      setSaving(null);
    }
  }

  const abrirRequisito = (code: string) => {
    setTab("requirements");
    setView({ ...VISTA, filter: "all", open: code });
    // Depois de a lista desenhar: o requisito pode estar a duzentas linhas.
    requestAnimationFrame(() => {
      const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`requisito-${code}`)?.scrollIntoView({ block: "center", behavior: reduzido ? "auto" : "smooth" });
    });
  };

  const abrirCriterio = (criterion: number) => {
    setTab("requirements");
    setView({ ...VISTA, filter: "all", criterion: String(criterion) });
  };

  const guardarPerfil = async (profile: Profile) => {
    if (await gravar("perfil", () => saveProfile(profile), "Perfil da candidatura guardado")) setPerfilAberto(false);
  };

  return (
    <div className="cert">
      <PageHeader title="Certificação FPF" subtitle={`${data.catalog.title} · Época ${data.catalog.season} · ${data.catalog.manual}`}>
        <Segmented<Tab>
          size="md"
          label="Vista"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Resumo" },
            { value: "criteria", label: "Critérios" },
            { value: "requirements", label: "Requisitos" },
          ]}
        />
      </PageHeader>

      {!data.profileSet && data.canWrite && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-warn-soft px-5 py-3">
          <p className="min-w-0 text-body text-ink">
            <b className="font-semibold">O perfil da candidatura ainda não foi confirmado.</b> O nível abaixo assume que o clube não recruta, não tem
            praticantes deslocados nem futebol feminino.
          </p>
          <button type="button" className="ctl-primary shrink-0" onClick={() => setPerfilAberto(true)}>
            Confirmar o perfil
          </button>
        </div>
      )}

      {tab === "overview" ? (
        <div className="flex flex-col gap-4">
          <Cockpit data={data} onProfile={() => setPerfilAberto(true)} />
          <Path
            data={data}
            onOpen={abrirRequisito}
            onProfile={() => setPerfilAberto(true)}
            onAll={() => {
              setTab("requirements");
              setView({ ...VISTA, filter: "missing" });
            }}
          />
        </div>
      ) : tab === "criteria" ? (
        <div className="flex flex-col gap-4">
          <LevelBar data={data} />
          <Criteria data={data} onCriterion={abrirCriterio} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <LevelBar data={data} />
          <Requirements
            data={data}
            view={view}
            onView={(patch) => setView((v) => ({ ...v, ...patch }))}
            saving={saving}
            onAnswer={(code, value) => void gravar(code, () => answerRequirement(code, value))}
            onClear={(code) => void gravar(code, () => clearAnswer(code))}
            onProfile={() => setPerfilAberto(true)}
          />
        </div>
      )}

      {perfilAberto && <ProfileDialog data={data} saving={saving === "perfil"} onClose={() => setPerfilAberto(false)} onSave={(p) => void guardarPerfil(p)} />}
    </div>
  );
}

/** O nível numa linha, fora do resumo: é para ele que se trabalha nos outros separadores. */
function LevelBar({ data }: { data: Summary }) {
  const { next } = data;
  return (
    <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
      <Stars n={data.level.stars} small />
      <span className="text-panel text-ink">{levelTitle(data.level)}</span>
      <span className="tabular font-mono text-meta text-ink-3">
        <span className="text-ink">{pts(data.points.got)}</span> / 100 pontos
      </span>
      {next && (next.mandatory.length > 0 || next.points > 0) && (
        <span className="text-meta text-ink-3 md:ml-auto">
          {next.mandatory.length > 0 && `${next.mandatory.length} ${next.mandatory.length === 1 ? "obrigatório" : "obrigatórios"} em falta para ${alvo(next.target.stars)}`}
          {next.mandatory.length > 0 && next.points > 0 && " · "}
          {next.points > 0 && `${pts(next.points)} pontos por ganhar`}
        </span>
      )}
    </div>
  );
}

const alvo = (stars: number) => (stars === 1 ? "1 estrela" : stars > 1 ? `as ${stars} estrelas` : "o CBFF");
