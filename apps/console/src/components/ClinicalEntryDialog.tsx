import { Link } from "react-router-dom";
import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, ListaDeEscolha, Monogram, SelectField } from "./primitives";
import { Repetir, useRepeticao } from "./Repetir";
import { Search, Settings, X } from "@/lib/icons";
import { listAthletes, teamById } from "@/lib/api";
import { addClinicalEntry, IMPACT_LABEL, isoToday, KIND_LABEL } from "@/lib/clinical";
import { useActiveCatalog } from "@/lib/catalogs";
import { shortName } from "@/lib/format";
import { can, type Session } from "@/lib/permissions";
import type { Athlete, ClinicalImpact, ClinicalKind } from "@/data/types";

/** O que se regista na ficha do atleta: o que aconteceu. Agendar é a outra variante. */
const KINDS_REGISTO: ClinicalKind[] = ["injury", "exam", "physio", "nutrition", "psychology", "note"];

/** Um ano a contar de hoje — a validade típica de um exame médico-desportivo. */
function maisUmAno(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
const IMPACTS: ClinicalImpact[] = ["none", "limited", "out"];

/**
 * O que o diálogo faz.
 *
 * - `lesao`: os Boletins. Só se regista uma lesão, e o tipo nem se pergunta.
 * - `registo`: a ficha do atleta. Regista o que aconteceu, de qualquer tipo
 *   (é por aqui que um exame feito actualiza a validade médica).
 * - `consulta`: agendar. Os tipos são os do clube (catálogo `consultationTypes`,
 *   nas Definições), e uma lesão nunca aparece: uma lesão acontece, não se marca.
 */
export type ClinicalDialogVariant = "lesao" | "registo" | "consulta";

/**
 * Registar no boletim, ou agendar uma consulta.
 *
 * O impacto na disponibilidade é um campo explícito e não uma consequência do
 * tipo: há lesões que não afastam ninguém. Deixar o sistema adivinhar daria
 * baixas erradas.
 *
 * `athlete` é opcional. A partir da ficha de um atleta já se sabe de quem se
 * trata; a partir dos ecrãs do departamento clínico não, e aí aparece um selector
 * — é o que evita ter de navegar até à ficha só para registar uma consulta.
 */
export function ClinicalEntryDialog({
  athlete,
  session,
  onClose,
  variant,
  defaultDate,
}: {
  athlete?: Athlete;
  session: Session;
  onClose: () => void;
  variant: ClinicalDialogVariant;
  /** `2026-10-07` — quem abre a partir de um dia do calendário de Consultas já o escolheu. */
  defaultDate?: string;
}) {
  const [picked, setPicked] = useState<Athlete | undefined>(athlete);
  const scheduling = variant === "consulta";

  const tipos = useActiveCatalog("consultationTypes");
  /* O primeiro da lista vem escolhido: é o clube que decide a ordem. */
  const [typeId, setTypeId] = useState("");
  const tipo = tipos.find((t) => t.id === typeId) ?? tipos[0];

  const [kind, setKind] = useState<ClinicalKind>("injury");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [impact, setImpact] = useState<ClinicalImpact>("out");
  const [date, setDate] = useState(defaultDate ?? isoToday());
  const [time, setTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");
  /*
   * Até quando o exame vale.
   *
   * Um ano a contar de hoje é o que a esmagadora maioria dos exames desportivos
   * dá, e é o valor que a médica confirmaria à mão em quase todos os casos.
   */
  const [validUntil, setValidUntil] = useState(maisUmAno());

  /* Só num agendamento: fisioterapia às terças e quintas até ao fim do mês. */
  const repeticao = useRepeticao(date);
  /* Pedir confirmação, como numa convocatória: quem responde é um só. */
  const [pedirConfirmacao, setPedirConfirmacao] = useState(false);
  const [respondBy, setRespondBy] = useState<"GUARDIAN" | "ATHLETE">("GUARDIAN");

  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const kindEfectivo: ClinicalKind = variant === "lesao" ? "injury" : kind;
  /* O exame realizado é o único registo que também escreve na ficha do atleta. */
  const exameFeito = !scheduling && kindEfectivo === "exam";
  const semTipos = scheduling && tipos.length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked || busy || semTipos) return;
    setBusy(true);
    setErro(null);
    try {
      /*
       * Os dias de paragem e o autor são do servidor. O autor sobretudo — um
       * boletim clínico tem de dizer quem escreveu, e quem escreveu é quem o
       * pedido autentica, não o que o browser disser que é.
       */
      await addClinicalEntry(
        picked.id,
        scheduling
          ? {
              date,
              status: "scheduled",
              time,
              location: location.trim() || undefined,
              // O servidor decide o `kind` pelo tipo; este é só o de reserva.
              kind: "consultation",
              typeId: tipo?.id,
              title: title.trim() || tipo?.label,
              detail: detail.trim() || undefined,
              // Um agendamento futuro não afasta ninguém hoje.
              impact: "none",
              repeat: repeticao.repeat,
              confirmationRequired: pedirConfirmacao,
              respondBy,
            }
          : {
              date,
              status: "done",
              kind: kindEfectivo,
              title: title.trim() || KIND_LABEL[kindEfectivo],
              detail: detail.trim() || undefined,
              impact,
              expectedReturn: impact !== "none" && expectedReturn ? expectedReturn : undefined,
              /* Só num exame realizado — é o que actualiza a validade na ficha. */
              validUntil: exameFeito && validUntil ? validUntil : undefined,
            },
      );
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
      setBusy(false);
    }
  }

  const titulo = scheduling ? "Agendar consulta" : variant === "lesao" ? "Registar lesão" : "Novo registo clínico";

  return (
    <Dialog
      labelledBy="registo-clinico"
      title={titulo}
      subtitle={picked?.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-clinico" className="ctl-primary" disabled={!picked || busy || semTipos}>
            {busy ? "A guardar…" : scheduling ? "Agendar" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-clinico" onSubmit={submit} className="space-y-4 p-5">
        {erro && (
          <p role="alert" className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta leading-relaxed text-risk">
            {erro}
          </p>
        )}

        {/* Só quando não se veio da ficha de alguém. */}
        {!athlete && <AthletePicker session={session} picked={picked} onPick={setPicked} />}

        {semTipos && (
          <p className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3 text-meta leading-relaxed text-ink-3">
            O clube não tem tipos de consulta activos.{" "}
            {can(session, "settings:write") ? (
              <Link to="/definicoes?catalogo=consultationTypes" className="font-medium text-ink underline underline-offset-2">
                Criar nas Definições
              </Link>
            ) : (
              "Pede à direção que os crie nas Definições."
            )}
          </p>
        )}

        <div className={cx("grid gap-3", variant === "lesao" ? "grid-cols-1" : "grid-cols-2")}>
          {scheduling ? (
            <DialogField
              label="Tipo"
              hint={
                can(session, "settings:write") ? (
                  <Link to="/definicoes?catalogo=consultationTypes" className="inline-flex items-center gap-1 hover:text-ink">
                    <Settings className="size-3" strokeWidth={1.75} />
                    gerir
                  </Link>
                ) : undefined
              }
            >
              <SelectField
                className="w-full"
                value={tipo?.id ?? ""}
                onChange={setTypeId}
                options={tipos.map((t) => ({ value: t.id, label: t.label }))}
              />
            </DialogField>
          ) : variant === "registo" ? (
            <DialogField label="Tipo">
              <SelectField
                className="w-full"
                value={kind}
                onChange={(v) => setKind(v as ClinicalKind)}
                options={KINDS_REGISTO.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
            </DialogField>
          ) : null}
          <DialogField label="Data">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dialogInputClass} required />
          </DialogField>
        </div>

        {scheduling && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <DialogField label="Hora">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={dialogInputClass} required />
            </DialogField>
            <DialogField label="Local" hint="opcional">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Clínica, sede da academia…"
                className={dialogInputClass}
              />
            </DialogField>
          </div>
        )}

        <DialogField label={variant === "lesao" ? "Lesão" : "Descrição"} hint={variant === "lesao" ? undefined : "opcional"}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              variant === "lesao" ? "Entorse do tornozelo direito…" : scheduling ? tipo?.label ?? "Consulta" : KIND_LABEL[kindEfectivo]
            }
            className={dialogInputClass}
          />
        </DialogField>

        <DialogField label={scheduling ? "Nota para a família" : "Notas"} hint={scheduling ? "a família vê esta nota" : "fica no boletim"}>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={scheduling ? 2 : 3}
            placeholder={scheduling ? "Trazer calções e toalha…" : undefined}
            className={cx(dialogInputClass, "h-auto resize-none py-2")}
          />
        </DialogField>

        {/*
          A validade do exame, aqui e não no formulário administrativo.

          Era só lá que `medicalValidUntil` se escrevia — um formulário que pede
          `athlete:write` e que exige o NIF do atleta para gravar seja o que for.
          A médica não tem a primeira e não tem por que saber o segundo.
        */}
        {exameFeito && (
          <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
            <DialogField label="Exame válido até" hint="actualiza a ficha do atleta">
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className={dialogInputClass}
              />
            </DialogField>
            <p className="mt-2 text-meta leading-relaxed text-ink-3">
              Ao guardar, o atleta deixa de aparecer em "exame por fazer" e a data passa a
              contar para as convocatórias. Deixa em branco se este exame não renova a validade.
            </p>
          </div>
        )}

        {scheduling && <Repetir r={repeticao} dica="a mesma consulta até uma data" />}

        {/*
          Pedir confirmação, como na convocatória.

          Sem isto a família sabe da consulta mas ninguém sabe se ela vai. Com
          isto, quem responde recebe o pedido na app e diz "vai" ou "não vai"
          com o motivo, e a resposta aparece na página da consulta.
        */}
        {scheduling && (
          <div className="rounded-[var(--radius-control)] border border-line">
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
              <input
                type="checkbox"
                checked={pedirConfirmacao}
                onChange={(e) => setPedirConfirmacao(e.target.checked)}
                className="size-3.5 accent-[var(--color-signal)]"
              />
              <span className="text-body text-ink">Pedir confirmação</span>
              <span className="text-meta text-ink-3">a família responde na app</span>
            </label>
            {pedirConfirmacao && (
              <div className="space-y-1.5 border-t border-line p-3">
                <span className="block text-meta font-medium text-ink">Quem confirma</span>
                <div className="flex gap-1.5">
                  {([["GUARDIAN", "Encarregado"], ["ATHLETE", "Atleta"]] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRespondBy(v)}
                      aria-pressed={respondBy === v}
                      className={cx(
                        "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors",
                        respondBy === v ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-ink-4">
                  {respondBy === "ATHLETE"
                    ? "Só o atleta com conta na app pode responder. O encarregado recebe o aviso na mesma."
                    : "O encarregado responde. O atleta com conta recebe o aviso na mesma."}
                </p>
              </div>
            )}
          </div>
        )}

        {scheduling ? (
          <p className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3 text-meta text-ink-3">
            O encarregado e o atleta com conta recebem um aviso na app. A disponibilidade do
            atleta só muda quando registares o resultado.
          </p>
        ) : (
          <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
            <DialogField label="Impacto na disponibilidade">
              <SelectField
                className="w-full"
                value={impact}
                onChange={(v) => setImpact(v as ClinicalImpact)}
                options={IMPACTS.map((i) => ({ value: i, label: IMPACT_LABEL[i] }))}
              />
            </DialogField>

            {impact !== "none" && (
              <div className="mt-3">
                <DialogField label="Retoma prevista" hint="o treinador vê esta data">
                  <input
                    type="date"
                    value={expectedReturn}
                    onChange={(e) => setExpectedReturn(e.target.value)}
                    className={dialogInputClass}
                  />
                </DialogField>
                <p className="mt-2 text-meta text-ink-3">
                  Ao guardar, o atleta fica marcado em toda a aplicação — ficha, plantel,
                  convocatórias e registo de presenças.
                </p>
              </div>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}


/* -------------------------------------------------------------------------- */

/**
 * Escolher o atleta.
 *
 * Uma lista com cento e tal nomes num `<select>` é intragável — escrever duas
 * letras e escolher é o gesto natural. Mostra só seis resultados de cada vez: uma
 * lista mais longa obriga a percorrer em vez de refinar a pesquisa.
 */
function AthletePicker({
  session,
  picked,
  onPick,
}: {
  session: Session;
  picked?: Athlete;
  onPick: (a: Athlete | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const athletes = listAthletes(session);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return athletes.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 6);
  }, [athletes, query]);

  if (picked) {
    return (
      <DialogField label="Atleta">
        <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2">
          <Monogram name={picked.name} photoUrl={picked.photoUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body font-medium text-ink">{picked.name}</div>
            <div className="text-meta text-ink-3">{teamById(picked.teamId)?.name}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              onPick(undefined);
              setQuery("");
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink"
            aria-label="Escolher outro atleta"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </DialogField>
    );
  }

  return (
    <DialogField label="Atleta">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escrever o nome…"
          className={cx(dialogInputClass, "pl-8")}
        />
      </div>

      {matches.length > 0 && (
        <ListaDeEscolha className="mt-1.5 overflow-hidden rounded-[var(--radius-control)] border border-line">
          {matches.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onPick(a)}
                className="flex w-full items-center gap-2.5 border-b border-line px-2.5 py-2 text-left last:border-0 hover:bg-sunken/60"
              >
                <Monogram name={a.name} photoUrl={a.photoUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{shortName(a.name)}</span>
                  <span className="block truncate text-meta text-ink-3">{teamById(a.teamId)?.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ListaDeEscolha>
      )}

      {query.trim() && matches.length === 0 && (
        <p className="mt-1.5 text-meta text-ink-3">Nenhum atleta com esse nome.</p>
      )}
    </DialogField>
  );
}
