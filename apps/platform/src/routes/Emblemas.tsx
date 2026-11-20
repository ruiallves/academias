import { useState } from "react";
import { Check, ShieldHalf, X } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Failed, Skeleton } from "./Overview";
import { useApi } from "@/lib/query";
import { shortDate } from "@/lib/format";
import { ESTADO_LABEL, aprovarEmblema, rejeitarEmblema, type EmblemaProposto } from "@/lib/emblemas";

/**
 * Os emblemas que os clubes carregaram para os adversários.
 *
 * Um clube marca um jogo com um adversário sem emblema e carrega um. Para
 * ele fica logo a valer; aqui vemos o que entrou e decidimos se vai para o
 * diretório (para todos os clubes) ou não. O clube não sabe que isto existe,
 * e não precisa: do lado dele correu bem.
 *
 * Aprovar: a imagem passa ao clube do diretório (ou cria-o, se o adversário
 * foi escrito à mão) e os jogos desse clube ficam ligados. Rejeitar: deixa
 * de aparecer ao clube que o carregou.
 */
export default function Emblemas() {
  const q = useApi<EmblemaProposto[]>("/emblemas");
  const [aFazer, setAFazer] = useState<string | null>(null);

  const agir = async (id: string, f: () => Promise<unknown>) => {
    setAFazer(id);
    try {
      await f();
      q.reload();
    } finally {
      setAFazer(null);
    }
  };

  if (q.error) return <Failed message={q.error} onRetry={q.reload} />;
  if (!q.data) return <Skeleton />;

  const porRever = q.data.filter((p) => p.estado === "PENDING");
  const tratados = q.data.filter((p) => p.estado !== "PENDING");

  return (
    <>
      <PageHeader title="Emblemas" subtitle="Os emblemas que os clubes carregaram para os adversários. Aprovar põe-nos no diretório, para todos os clubes." />

      <Panel>
        <PanelHead title="Por rever" hint={porRever.length ? String(porRever.length) : undefined} />
        {porRever.length === 0 ? (
          <Empty title="Nada por rever" detail="Quando um clube carregar um emblema para um adversário, aparece aqui." />
        ) : (
          <ul className="divide-y divide-line">
            {porRever.map((p) => (
              <Linha key={p.id} p={p} ocupado={aFazer === p.id}>
                <button type="button" className="ctl-outline" disabled={aFazer !== null} onClick={() => void agir(p.id, () => rejeitarEmblema(p.id))}>
                  <X className="size-3.5" strokeWidth={2} />
                  Rejeitar
                </button>
                <button type="button" className="ctl-primary" disabled={aFazer !== null} onClick={() => void agir(p.id, () => aprovarEmblema(p.id))}>
                  <Check className="size-3.5" strokeWidth={2} />
                  Aprovar
                </button>
              </Linha>
            ))}
          </ul>
        )}
      </Panel>

      {tratados.length > 0 && (
        <Panel className="mt-5">
          <PanelHead title="Tratados" hint={String(tratados.length)} />
          <ul className="divide-y divide-line">
            {tratados.map((p) => (
              <Linha key={p.id} p={p} ocupado={false}>
                <Pill tone={p.estado === "APPROVED" ? "ok" : "neutral"}>{ESTADO_LABEL[p.estado]}</Pill>
                {p.revisto && (
                  <span className="text-meta text-ink-3">
                    {shortDate(p.revisto.em)}
                    {p.revisto.por ? ` · ${p.revisto.por}` : ""}
                  </span>
                )}
              </Linha>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Linha({ p, ocupado, children }: { p: EmblemaProposto; ocupado: boolean; children: React.ReactNode }) {
  return (
    <li className={cx("flex flex-wrap items-center gap-4 px-5 py-4", ocupado && "opacity-60")}>
      {/* O emblema em grande: é isto que se está a avaliar. */}
      <a href={p.emblema.grande} target="_blank" rel="noreferrer" className="shrink-0" title="Abrir a imagem">
        <img src={p.emblema.grande} alt="" className="size-20 rounded-[12px] border border-line bg-surface object-contain p-1.5" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">{p.clube}</p>
        <p className="mt-0.5 text-meta text-ink-3">
          Carregado por {p.academia.name}
          {p.quem ? ` (${p.quem})` : ""} · {shortDate(p.em)}
        </p>
        {p.noDiretorio ? (
          <p className="mt-1.5 inline-flex items-center gap-2 text-meta text-ink-2">
            <ShieldHalf className="size-3.5 text-ink-4" strokeWidth={1.75} />
            No diretório como <strong className="font-semibold">{p.noDiretorio.nome}</strong>
            {p.noDiretorio.associacao ? ` · ${p.noDiretorio.associacao}` : ""}
            {p.noDiretorio.emblema && (
              <>
                <span className="text-ink-4">· já tinha</span>
                <img src={p.noDiretorio.emblema.pequeno} alt="" className="size-6 rounded-[5px] border border-line bg-surface object-contain" />
              </>
            )}
          </p>
        ) : (
          <p className="mt-1.5 text-meta text-ink-3">Nome escrito à mão: ao aprovar, o clube entra no diretório com este nome.</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}
