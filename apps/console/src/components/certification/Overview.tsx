import type { ReactNode } from "react";
import { Panel, PanelHead, Pill } from "@/components/primitives";
import { ArrowRight, CircleCheck } from "@/lib/icons";
import { pts, type Requirement, type Summary } from "@/lib/certification";

/** Quantas linhas de cada género cabem no resumo. O resto está nos Requisitos. */
const ATALHOS_NO_RESUMO = 5;
const OBRIGATORIOS_NO_RESUMO = 6;

/**
 * O que falta para a estrela seguinte.
 *
 * É a única lista da página de resumo, e é curta de propósito: primeiro o que
 * trava (as obrigatórias, e as equipas quando são elas), e só se faltarem
 * pontos é que aparecem os requisitos por onde se ganha mais. Tudo o resto —
 * os critérios, os 195 requisitos, os escalões — vive nos outros separadores e
 * no perfil. Já esteve tudo aqui, e a página lia-se como um relatório em vez de
 * dizer o que fazer.
 */
export function Path({
  data,
  onOpen,
  onProfile,
  onAll,
}: {
  data: Summary;
  /** Abre um requisito no separador dos requisitos. */
  onOpen: (code: string) => void;
  onProfile: () => void;
  /** Leva à lista de tudo o que está em falta. */
  onAll: () => void;
}) {
  const { next, quickWins } = data;
  const porCodigo = new Map(data.requirements.map((r) => [r.code, r]));
  const todos = (next?.mandatory ?? []).map((c) => porCodigo.get(c)).filter((r): r is Requirement => Boolean(r));
  const obrigatorios = todos.slice(0, OBRIGATORIOS_NO_RESUMO);
  const porMostrar = todos.length - obrigatorios.length;

  // Os atalhos só interessam quando faltam pontos — ou quando já não há mais
  // estrelas para subir e o que resta é afinar a nota. E só quando as
  // obrigatórias cabem todas: com a lista cortada, o que há a fazer é abri-la.
  const atalhos = (porMostrar === 0 && (!next || next.points > 0) ? quickWins : [])
    .slice(0, ATALHOS_NO_RESUMO)
    .map((w) => ({ r: porCodigo.get(w.code), gain: w.gain }))
    .filter((w): w is { r: Requirement; gain: number } => Boolean(w.r));

  const titulo = !next
    ? "Pontos ainda por ganhar"
    : next.target.stars === 1
      ? "O que falta para 1 estrela"
      : next.target.stars > 1
        ? `O que falta para as ${next.target.stars} estrelas`
        : "O que falta para o CBFF";

  const faltaAcesso = next && !next.accessOk ? data.access.missing : [];
  const vazio = !obrigatorios.length && !faltaAcesso.length && !atalhos.length;

  return (
    <Panel>
      <PanelHead title={titulo}>
        <button type="button" className="ctl-ghost" onClick={onAll}>
          Ver tudo o que falta
          <ArrowRight className="size-3.5" strokeWidth={1.75} />
        </button>
      </PanelHead>

      {vazio ? (
        <div className="flex items-center gap-3 px-5 py-8 text-body text-ink-2">
          <CircleCheck className="size-5 shrink-0 text-ok" strokeWidth={1.5} />
          Não há nada por tratar. Está tudo em dia.
        </div>
      ) : (
        <div>
          {faltaAcesso.map((frase) => (
            <button key={frase} type="button" className="cert-row" onClick={onProfile}>
              <span className="cert-status mt-px" data-s="missing" data-block="true" aria-hidden />
              <span className="min-w-0 flex-1 text-body text-ink">{frase}</span>
              <Pill tone="risk">Equipas</Pill>
            </button>
          ))}

          {obrigatorios.map((r) => (
            <Row key={r.code} r={r} onOpen={onOpen} tag={<Pill tone="risk">Obrigatório</Pill>} />
          ))}

          {porMostrar > 0 && (
            <button type="button" className="cert-row items-center text-meta font-medium text-ink-2" onClick={onAll}>
              <span className="flex-1">
                Mais {porMostrar} {porMostrar === 1 ? "requisito obrigatório" : "requisitos obrigatórios"}
                {next && next.points > 0 ? ` e ${pts(next.points)} pontos por ganhar` : ""}
              </span>
              <ArrowRight className="size-3.5 shrink-0" strokeWidth={1.75} />
            </button>
          )}

          {atalhos.length > 0 && (
            <>
              {next && (obrigatorios.length > 0 || faltaAcesso.length > 0) && (
                <div className="border-t border-line bg-canvas px-5 py-2.5 text-meta font-semibold text-ink-2">
                  E {pts(next.points)} pontos. Estes são os que valem mais:
                </div>
              )}
              {atalhos.map(({ r, gain }) => (
                <Row key={r.code} r={r} onOpen={onOpen} tag={<Pill tone="signal">+{pts(gain)} pt</Pill>} />
              ))}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function Row({ r, tag, onOpen }: { r: Requirement; tag: ReactNode; onOpen: (code: string) => void }) {
  return (
    <button type="button" className="cert-row" onClick={() => onOpen(r.code)}>
      <span className="cert-status mt-px" data-s={r.status} data-block={r.blocking} aria-hidden />
      <span className="min-w-0 flex-1 text-body text-ink">{r.text}</span>
      <span className="shrink-0">{tag}</span>
    </button>
  );
}

/**
 * Os nove critérios, cada um com os pontos que tem e os que pode ter.
 *
 * Num separador próprio: é a vista de quem quer saber onde o clube está forte
 * e onde está fraco, que é outra pergunta que não "o que faço a seguir".
 */
export function Criteria({ data, onCriterion }: { data: Summary; onCriterion: (criterion: number) => void }) {
  return (
    <Panel>
      <PanelHead title="Pontos por critério" hint={`${pts(data.points.got)} de 100`} />
      <div>
        {data.criteria
          .filter((c) => c.criterion > 0)
          .map((c) => (
            <button key={c.criterion} type="button" className="cert-row items-center" onClick={() => onCriterion(c.criterion)}>
              <span className="cert-code w-4 text-center">{c.criterion}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-body font-medium text-ink">{c.name}</span>
                  <span className="tabular shrink-0 font-mono text-[11.5px] text-ink-3">
                    <span className="text-ink">{pts(c.got)}</span> / {pts(c.reach)}
                  </span>
                </span>
                <span className="cert-meter mt-2 block" aria-hidden>
                  <i style={{ width: `${c.reach ? (c.got / c.reach) * 100 : 0}%` }} />
                </span>
              </span>
              {c.blocking > 0 ? (
                <Pill tone="risk">
                  {c.blocking} {c.blocking === 1 ? "obrigatório" : "obrigatórios"}
                </Pill>
              ) : (
                <ArrowRight className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
              )}
            </button>
          ))}
      </div>
      <p className="border-t border-line px-5 py-3 text-meta text-ink-3">
        {data.points.assessor > 0 && `${pts(data.points.assessor)} dos 100 pontos só o avaliador da FPF atribui, depois da visita técnica. `}
        {data.points.notApplicable > 0 && `${pts(data.points.notApplicable)} são de questões que não se aplicam a este clube.`}
      </p>
    </Panel>
  );
}
