import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Empty, Loading, Panel, PanelHead, Pill, SelectField, cx } from "@/components/primitives";
import { ArrowRight, CalendarDays, Check, Search, TriangleAlert } from "@/lib/icons";
import { apiGet, apiPost } from "@/lib/http";
import { longDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { reloadAcademy, useStore } from "@/lib/store";
import { useSession } from "@/session";

/**
 * A época do clube, e o botão de virar para a seguinte.
 *
 * ## Porque é que isto é um botão e não uma data
 *
 * Um clube arranca em Agosto, outro em Setembro, e um clube de futsal noutro
 * mês qualquer. Uma data no código virava a época no dia errado para quase
 * toda a gente — e virar a época mexe em tudo: escalões, plantéis, treinadores
 * e preços. Aqui diz-se em que época o clube está, e só alguém da direcção a
 * faz avançar.
 *
 * O que acontece ao carregar está escrito em `SeasonsService` (no servidor) e
 * resume-se a: nada se apaga. A época que acaba fica inteira, e é dela que sai
 * o percurso de cada atleta e de cada treinador.
 */
export function EpocaPanel() {
  const { session } = useSession();
  const store = useStore();
  const [aVirar, setAVirar] = useState(false);

  const epoca = store.seasons.find((s) => s === store.season) ?? store.season;
  const datas = store.seasonRanges[store.season];
  const podeVirar = can(session, "academy:write");

  return (
    <>
      <Panel>
        <PanelHead title="Época" hint={store.seasons.length > 1 ? `${store.seasons.length} épocas` : undefined} />
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
              <CalendarDays className="size-4" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-ink">{epoca || "Sem época definida"}</span>
              <span className="block truncate text-meta text-ink-3">
                {datas ? `${longDate(new Date(datas.startsOn))} a ${longDate(new Date(datas.endsOn))}` : "As datas vêm da primeira equipa criada."}
              </span>
            </span>
          </div>

          <p className="text-meta leading-relaxed text-ink-3">
            No fim da época, o clube monta a seguinte: os escalões passam, os atletas sobem por idade, os
            treinadores vão atrás e os preços copiam-se. Nada se apaga — o que fica para trás é o percurso de
            cada um.
          </p>

          {podeVirar ? (
            <button type="button" className="ctl-outline w-full justify-center" onClick={() => setAVirar(true)}>
              Começar nova época
              <ArrowRight className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : (
            <p className="text-meta text-ink-4">Só a direção começa uma época nova.</p>
          )}
        </div>
      </Panel>

      {aVirar && <NovaEpocaDialog onClose={() => setAVirar(false)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

type Proposta = {
  actual: { id: string; label: string; startsOn: string; endsOn: string };
  sugestao: { label: string; startsOn: string; endsOn: string };
  equipas: {
    id: string;
    name: string;
    maxAge: number;
    sportName: string;
    atletas: number;
    treinadores: string[];
    amountCents: number | null;
  }[];
  atletas: {
    id: string;
    name: string;
    idadeNaEpoca: number;
    teamId: string | null;
    teamName: string | null;
    sugestaoTeamId: string | null;
    sobe: boolean;
    semEscalao: boolean;
  }[];
};

/** O destino de cada atleta: um escalão, por renovar, ou sai. */
const POR_RENOVAR = "POR_RENOVAR";
const SAI = "SAI";

/**
 * O assistente: a época, os escalões, os atletas, e o resumo.
 *
 * Três passos, e é só no último que se grava. O passo dos atletas assume que
 * **todos renovam** — é o caso normal — e o trabalho de quem lá está é marcar
 * as excepções: quem ainda não confirmou, e quem não continua.
 */
function NovaEpocaDialog({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<Proposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [feito, setFeito] = useState<{ equipas: number; transitaram: number; porRenovar: number; sairam: number } | null>(null);

  /* O que o assistente vai juntando. */
  const [label, setLabel] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [foraDaEpoca, setForaDaEpoca] = useState<Set<string>>(new Set());
  const [destinos, setDestinos] = useState<Record<string, string>>({});
  const [procura, setProcura] = useState("");

  useEffect(() => {
    apiGet<Proposta>("/api/seasons/proposta")
      .then((r) => {
        setP(r);
        setLabel(r.sugestao.label);
        setStartsOn(r.sugestao.startsOn);
        setEndsOn(r.sugestao.endsOn);
        setPrecos(
          Object.fromEntries(
            r.equipas.map((e) => [e.id, e.amountCents == null ? "" : (e.amountCents / 100).toFixed(2).replace(".", ",")]),
          ),
        );
        setDestinos(
          Object.fromEntries(r.atletas.map((a) => [a.id, a.sugestaoTeamId ?? POR_RENOVAR])),
        );
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  const equipasQueTransitam = useMemo(
    () => (p?.equipas ?? []).filter((e) => !foraDaEpoca.has(e.id)),
    [p, foraDaEpoca],
  );

  /* As contas do resumo, e o que o botão diz. */
  const contas = useMemo(() => {
    const vivos = new Set(equipasQueTransitam.map((e) => e.id));
    let transitam = 0;
    let porRenovar = 0;
    let saem = 0;
    for (const a of p?.atletas ?? []) {
      const d = destinos[a.id];
      if (d === SAI) saem++;
      else if (d === POR_RENOVAR || !vivos.has(d)) porRenovar++;
      else transitam++;
    }
    return { transitam, porRenovar, saem };
  }, [p, destinos, equipasQueTransitam]);

  const atletasFiltrados = useMemo(() => {
    const termo = procura.trim().toLocaleLowerCase("pt");
    return (p?.atletas ?? []).filter(
      (a) => !termo || a.name.toLocaleLowerCase("pt").includes(termo) || (a.teamName ?? "").toLocaleLowerCase("pt").includes(termo),
    );
  }, [p, procura]);

  async function virar() {
    if (!p || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const vivos = new Set(equipasQueTransitam.map((e) => e.id));
      const r = await apiPost<{ equipas: number; transitaram: number; porRenovar: number; sairam: number }>(
        "/api/seasons/virar",
        {
          label: label.trim(),
          startsOn,
          endsOn,
          equipas: equipasQueTransitam.map((e) => ({
            fromTeamId: e.id,
            amountCents: paraCentimos(precos[e.id] ?? ""),
          })),
          atletas: (p.atletas ?? []).map((a) => {
            const d = destinos[a.id];
            return { athleteId: a.id, destino: d === SAI ? SAI : vivos.has(d) ? d : POR_RENOVAR };
          }),
        },
      );
      setFeito(r);
      // A consola inteira trabalha na época corrente: recarrega-se tudo.
      await reloadAcademy();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível virar a época.");
    } finally {
      setBusy(false);
    }
  }

  if (feito) {
    return (
      <Dialog title="Época nova a andar" subtitle={label} onClose={onClose} width={520}
        footer={
          <button type="button" className="ctl-primary ml-auto" onClick={onClose}>
            Fechar
          </button>
        }
      >
        <div className="space-y-3 p-5">
          <p className="flex items-start gap-2 text-body text-ink">
            <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2.2} />
            {feito.equipas} {feito.equipas === 1 ? "escalão criado" : "escalões criados"}, {feito.transitaram}{" "}
            {feito.transitaram === 1 ? "atleta transitou" : "atletas transitaram"}.
          </p>
          {feito.porRenovar > 0 && (
            <p className="text-meta leading-relaxed text-ink-3">
              {feito.porRenovar} {feito.porRenovar === 1 ? "atleta ficou" : "atletas ficaram"} por renovar: estão em
              Atletas, sem equipa, à espera de decisão.
            </p>
          )}
          {feito.sairam > 0 && (
            <p className="text-meta leading-relaxed text-ink-3">
              {feito.sairam} {feito.sairam === 1 ? "saiu do clube" : "saíram do clube"}. A ficha e o percurso ficam.
            </p>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Começar nova época"
      subtitle={p ? `A actual é ${p.actual.label}` : undefined}
      onClose={onClose}
      width={720}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3">Passo {passo} de 3</span>
          <div className="flex items-center gap-2">
            {passo > 1 && (
              <button type="button" className="ctl-ghost" disabled={busy} onClick={() => setPasso((n) => (n === 3 ? 2 : 1))}>
                Voltar
              </button>
            )}
            {passo < 3 ? (
              <button
                type="button"
                className="ctl-primary"
                disabled={!p || (passo === 1 && (label.trim().length < 4 || !startsOn || !endsOn || equipasQueTransitam.length === 0))}
                onClick={() => setPasso((n) => (n === 1 ? 2 : 3))}
              >
                Continuar
                <ArrowRight className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : (
              <button type="button" className="ctl-primary" disabled={busy} onClick={() => void virar()}>
                {busy ? "A virar…" : "Virar a época"}
              </button>
            )}
          </div>
        </div>
      }
    >
      {erro && (
        <p role="alert" className="flex items-start gap-1.5 border-b border-line bg-risk-soft px-5 py-2.5 text-meta text-risk">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </p>
      )}

      {!p ? (
        <div className="px-5 py-12"><Loading size="panel" /></div>
      ) : passo === 1 ? (
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_150px_150px] gap-3">
            <DialogField label="A época nova">
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} className={dialogInputClass} />
            </DialogField>
            <DialogField label="Começa">
              <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={dialogInputClass} />
            </DialogField>
            <DialogField label="Acaba">
              <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={dialogInputClass} />
            </DialogField>
          </div>

          <div>
            <p className="mb-1.5 text-meta font-medium text-ink">Os escalões que transitam</p>
            <ul className="overflow-hidden rounded-[var(--radius-control)] border border-line">
              {p.equipas.map((e) => {
                const fora = foraDaEpoca.has(e.id);
                return (
                  <li key={e.id} className={cx("flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0", fora && "opacity-45")}>
                    <input
                      type="checkbox"
                      checked={!fora}
                      onChange={() =>
                        setForaDaEpoca((cur) => {
                          const novo = new Set(cur);
                          if (novo.has(e.id)) novo.delete(e.id);
                          else novo.add(e.id);
                          return novo;
                        })
                      }
                      className="size-4 shrink-0 accent-[var(--color-signal)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">{e.name}</span>
                      <span className="block truncate text-meta text-ink-3">
                        {e.atletas} {e.atletas === 1 ? "atleta" : "atletas"}
                        {e.treinadores.length > 0 ? ` · ${e.treinadores.join(", ")}` : " · sem treinador"}
                      </span>
                    </span>
                    {/* O preço vai à frente: é a altura em que o clube o revê. */}
                    <span className="flex shrink-0 items-center gap-1.5">
                      <input
                        value={precos[e.id] ?? ""}
                        onChange={(ev) => setPrecos((cur) => ({ ...cur, [e.id]: ev.target.value }))}
                        inputMode="decimal"
                        placeholder="sem preço"
                        disabled={fora}
                        className={cx(dialogInputClass, "w-[110px] text-right tabular")}
                      />
                      <span className="text-meta text-ink-3">€/mês</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
              Um escalão desligado não passa para a época nova, e os atletas dele ficam por renovar.
            </p>
          </div>
        </div>
      ) : passo === 2 ? (
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="ok">{contas.transitam} transitam</Pill>
            <Pill tone="warn">{contas.porRenovar} por renovar</Pill>
            <Pill tone="risk">{contas.saem} saem</Pill>
            <span className="relative ml-auto">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
              <input
                value={procura}
                onChange={(e) => setProcura(e.target.value)}
                placeholder="Procurar atleta ou escalão…"
                className={cx(dialogInputClass, "w-[240px] pl-8")}
              />
            </span>
          </div>

          {atletasFiltrados.length === 0 ? (
            <Empty title="Nenhum atleta" detail="Ninguém com esse nome." />
          ) : (
            <ul className="max-h-[360px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
              {atletasFiltrados.map((a) => (
                <li key={a.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{a.name}</span>
                    <span className="block truncate text-meta text-ink-3">
                      {a.teamName ?? "Sem equipa"} · {a.idadeNaEpoca} anos na época nova
                      {a.sobe ? " · sobe de escalão" : ""}
                      {a.semEscalao ? " · sem escalão para a idade" : ""}
                    </span>
                  </span>
                  <SelectField
                    className="w-[200px] shrink-0"
                    value={destinos[a.id] ?? POR_RENOVAR}
                    onChange={(v) => setDestinos((cur) => ({ ...cur, [a.id]: v }))}
                    options={[
                      ...equipasQueTransitam.map((e) => ({ value: e.id, label: e.name })),
                      { value: POR_RENOVAR, label: "Por renovar" },
                      { value: SAI, label: "Não continua" },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="text-meta leading-relaxed text-ink-3">
            Assume-se que todos renovam. Quem fica <strong className="font-medium text-ink-2">por renovar</strong> entra
            na época nova sem equipa, e aparece em Atletas à espera de decisão.
          </p>
        </div>
      ) : (
        <div className="space-y-3 p-5">
          <p className="text-body text-ink">
            {label} · {longDate(new Date(startsOn))} a {longDate(new Date(endsOn))}
          </p>
          <ul className="space-y-1.5 text-meta leading-relaxed text-ink-2">
            <li>
              {equipasQueTransitam.length} {equipasQueTransitam.length === 1 ? "escalão" : "escalões"}, com os
              treinadores de cada um.
            </li>
            <li>
              {contas.transitam} {contas.transitam === 1 ? "atleta transita" : "atletas transitam"};{" "}
              {contas.porRenovar} por renovar; {contas.saem} {contas.saem === 1 ? "sai" : "saem"}.
            </li>
            <li>
              Mensalidades:{" "}
              {equipasQueTransitam.filter((e) => paraCentimos(precos[e.id] ?? "") != null).length} com preço definido
              {equipasQueTransitam.some((e) => paraCentimos(precos[e.id] ?? "") == null) ? ", os outros ficam por definir" : ""}
              .
            </li>
            <li className="text-ink-3">
              A época {p.actual.label} fica inteira: jogos, treinos, mensalidades e avaliações continuam lá.
            </li>
          </ul>
          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
            Depois de virar, a consola passa a trabalhar em {label}. O que ficou para trás lê-se no percurso de cada
            atleta e de cada equipa.
          </p>
        </div>
      )}
    </Dialog>
  );
}

/** "35,50" → 3550. Vazio, ou lixo, é "sem preço". */
function paraCentimos(valor: string): number | null {
  const limpo = valor.trim().replace(/\s/g, "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
