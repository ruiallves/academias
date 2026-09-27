import { useCallback, useEffect, useState } from "react";
import { CustoDoPagamento } from "@/components/finance/CustoDoPagamento";
import { cx, Pill } from "@/components/primitives";
import { Spinner } from "@/components/Busy";
import { apiDelete, apiGet, apiPut } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { money } from "@/lib/format";

/** A partir de quando o preço acabado de definir passa a ser cobrado. */
export type AplicarEm = "atual" | "proximo";

/** O preço de um atleta numa modalidade, como o servidor o resolve. */
export type PrecoNaModalidade = {
  sportId: string;
  sportName: string;
  /** A equipa que conta para o preço desta modalidade. */
  teamName: string;
  teamAmountCents: number | null;
  individualAmountCents: number | null;
  /** O que vale: o individual se houver, senão o da equipa. Nulo = por configurar. */
  amountCents: number | null;
};

/** `GET /api/athletes/:id/fee`. */
export type PrecoDoAtletaApi = {
  /** A soma das modalidades — é o que a mensalidade cobra. */
  effectiveAmountCents: number | null;
  modalidades: PrecoNaModalidade[];
  /** O valor único de antes do preço por modalidade. Sobrepõe-se à soma. */
  valorUnicoCents: number | null;
};

/**
 * O preço de um atleta, uma linha por modalidade.
 *
 * ## Porque é que é um componente só
 *
 * Vive em dois sítios: no diálogo "Preço por atleta" das Mensalidades e no
 * separador Mensalidades da ficha do atleta. São a mesma pergunta — quanto paga
 * este atleta, e porquê — e duas respostas desenhadas à mão acabavam a dizer
 * coisas diferentes do mesmo miúdo.
 *
 * ## A regra que mostra
 *
 * Um atleta paga a soma das modalidades que pratica, e a família paga-a de uma
 * vez. Em cada modalidade vale o ajuste individual, se houver; senão o preço da
 * equipa. Quem decide é o servidor (`lerPrecosDetalhados`); isto só mostra e
 * grava.
 */
export function PrecoDoAtleta({
  athleteId,
  mayConfigure,
  aplicarEm,
  onSaved,
}: {
  athleteId: string;
  mayConfigure: boolean;
  /** Omitido é "atual": emite a mensalidade deste mês, como sempre fez na ficha. */
  aplicarEm?: AplicarEm;
  /** Gravou: quem está à volta relê o que mudou. */
  onSaved?: () => void;
}) {
  const [preco, setPreco] = useState<PrecoDoAtletaApi | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setPreco(await apiGet<PrecoDoAtletaApi>(`/api/athletes/${athleteId}/fee`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar.");
    }
  }, [athleteId]);

  useEffect(() => {
    setPreco(null);
    void carregar();
  }, [carregar]);

  async function depoisDeGravar() {
    await Promise.all([carregar(), reloadAcademy()]);
    onSaved?.();
  }

  if (erro) return <p className="text-meta text-risk">{erro}</p>;
  if (!preco) return <Spinner className="py-3" />;

  const semEquipa = preco.modalidades.length === 0;
  const varias = preco.modalidades.length > 1;

  return (
    <div>
      {preco.effectiveAmountCents === null ? (
        <p className="text-body text-ink-3">Ainda não há preço configurado para este atleta.</p>
      ) : (
        <>
          <div className="text-[36px] leading-none font-semibold text-ink tabular">{money(preco.effectiveAmountCents)}</div>
          <p className="mt-2 text-meta text-ink-3">
            {preco.valorUnicoCents !== null
              ? "Por mês, um valor único para o atleta."
              : varias
                ? "Por mês, a soma das modalidades. A família paga tudo de uma vez."
                : "Por mês."}
          </p>
        </>
      )}

      {/*
        O valor único de antes, num atleta que tem modalidades.

        A migração passou-os todos para a modalidade do atleta; isto só aparece
        a quem entrou numa segunda modalidade depois de ter um valor único, e
        diz porque é que a soma não conta.
      */}
      {preco.valorUnicoCents !== null && !semEquipa && (
        <ValorUnico
          athleteId={athleteId}
          amountCents={preco.valorUnicoCents}
          mayConfigure={mayConfigure}
          onSaved={depoisDeGravar}
        />
      )}

      {semEquipa ? (
        <div className="mt-4">
          <p className="mb-2 text-meta text-ink-3">
            Sem equipa, não há preço de equipa. O valor escreve-se aqui, e fica até o atleta entrar numa equipa.
          </p>
          <LinhaDePreco
            athleteId={athleteId}
            titulo="Valor individual"
            detalhe={null}
            individualAmountCents={preco.valorUnicoCents}
            teamAmountCents={null}
            sportId={null}
            mayConfigure={mayConfigure}
            aplicarEm={aplicarEm}
            onSaved={depoisDeGravar}
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {preco.modalidades.map((m) => (
            <li key={m.sportId} className="px-3.5 py-3">
              <LinhaDePreco
                athleteId={athleteId}
                titulo={m.sportName}
                detalhe={
                  m.teamAmountCents !== null
                    ? `${m.teamName} · preço da equipa ${money(m.teamAmountCents)}`
                    : `${m.teamName} · a equipa ainda não tem preço`
                }
                individualAmountCents={m.individualAmountCents}
                teamAmountCents={m.teamAmountCents}
                sportId={m.sportId}
                mayConfigure={mayConfigure && preco.valorUnicoCents === null}
                aplicarEm={aplicarEm}
                onSaved={depoisDeGravar}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Uma modalidade: o que vale, de onde vem, e o gesto para o mudar.
 *
 * O campo abre com o valor que está a valer e seleccionado: um preço troca-se,
 * não se edita. Sem isso, escrever "35" sobre "60.00" dava "60.0035" (arredonda
 * para o mesmo valor e parecia não gravar) ou "3560.00" (recusado). O mesmo que
 * nos preços por equipa.
 */
function LinhaDePreco({
  athleteId,
  titulo,
  detalhe,
  individualAmountCents,
  teamAmountCents,
  sportId,
  mayConfigure,
  aplicarEm,
  onSaved,
}: {
  athleteId: string;
  titulo: string;
  detalhe: string | null;
  individualAmountCents: number | null;
  teamAmountCents: number | null;
  /** Nulo = o valor único de um atleta sem equipa. */
  sportId: string | null;
  mayConfigure: boolean;
  aplicarEm?: AplicarEm;
  onSaved: () => Promise<void>;
}) {
  const valeCents = individualAmountCents ?? teamAmountCents;
  const [aEditar, setAEditar] = useState(false);
  const [valor, setValor] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function abrir() {
    setValor(valeCents !== null ? (valeCents / 100).toFixed(2) : "");
    setErro(null);
    setAEditar(true);
  }

  async function guardar() {
    const cents = Math.round(Number(valor.trim().replace(",", ".")) * 100);
    // 0 € é válido: o atleta isento nesta modalidade.
    if (!valor.trim() || !Number.isFinite(cents) || cents < 0 || (cents > 0 && cents < 50)) {
      setErro("Indica 0 €, ou um valor de pelo menos 0,50 €.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      await apiPut(`/api/athletes/${athleteId}/fee`, {
        amountCents: cents,
        ...(sportId ? { sportId } : {}),
        ...(aplicarEm ? { aplicarEm } : {}),
      });
      setAEditar(false);
      await onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function usarOdaEquipa() {
    setBusy(true);
    setErro(null);
    try {
      await apiDelete(`/api/athletes/${athleteId}/fee${sportId ? `?sportId=${encodeURIComponent(sportId)}` : ""}`);
      await onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível reverter.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-ink">{titulo}</span>
            {individualAmountCents !== null && sportId && <Pill tone="signal">Individual</Pill>}
          </div>
          {detalhe && <div className="truncate text-meta text-ink-3">{detalhe}</div>}
        </div>
        {!aEditar && (
          <span className={cx("shrink-0 text-body tabular", valeCents === null ? "text-ink-4" : "font-medium text-ink")}>
            {valeCents === null ? "por configurar" : money(valeCents)}
          </span>
        )}
      </div>

      {aEditar ? (
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <span className="text-body text-ink-3">€</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={valor}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void guardar()}
              aria-label={`Valor individual em ${titulo}, por mês`}
              aria-invalid={erro !== null}
              className={cx(
                "h-9 w-32 rounded-[var(--radius-control)] border bg-surface px-2.5 text-body tabular focus:outline-none",
                erro ? "border-risk" : "border-line focus:border-line-strong",
              )}
            />
            <button type="button" onClick={() => setAEditar(false)} disabled={busy} className="ctl-ghost">
              Cancelar
            </button>
            <button type="button" onClick={() => void guardar()} disabled={busy} className="ctl-primary">
              {busy ? "A guardar…" : "Guardar"}
            </button>
          </div>
          <CustoDoPagamento amountCents={paraCentimos(valor)} />
        </div>
      ) : (
        mayConfigure && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={abrir} disabled={busy} className="ctl-outline">
              {individualAmountCents !== null ? "Alterar valor" : "Ajustar individualmente"}
            </button>
            {individualAmountCents !== null && (
              <button type="button" onClick={() => void usarOdaEquipa()} disabled={busy} className="ctl-ghost">
                {busy ? "A reverter…" : sportId ? "Usar o preço da equipa" : "Tirar o valor"}
              </button>
            )}
          </div>
        )
      )}

      {erro && (
        <p role="alert" className="mt-1.5 text-meta text-risk">
          {erro}
        </p>
      )}
    </div>
  );
}

/** O valor único de antes, num atleta com modalidades: o que é, e como sair dele. */
function ValorUnico({
  athleteId,
  amountCents,
  mayConfigure,
  onSaved,
}: {
  athleteId: string;
  amountCents: number;
  mayConfigure: boolean;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function tirar() {
    setBusy(true);
    setErro(null);
    try {
      await apiDelete(`/api/athletes/${athleteId}/fee`);
      await onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mudar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-[var(--radius-control)] border border-line bg-sunken/40 px-3.5 py-3">
      <p className="text-meta text-ink-2">
        Este atleta tem um valor único de <span className="font-medium text-ink">{money(amountCents)}</span>, que vale
        por todas as modalidades. Enquanto existir, os preços de cada modalidade não contam.
      </p>
      {mayConfigure && (
        <button type="button" onClick={() => void tirar()} disabled={busy} className="ctl-outline mt-2.5">
          {busy ? "A mudar…" : "Passar a preço por modalidade"}
        </button>
      )}
      {erro && <p className="mt-1.5 text-meta text-risk">{erro}</p>}
    </div>
  );
}

/** O valor escrito no campo, em cêntimos — só para a linha de custo. */
function paraCentimos(v: string): number | null {
  const n = Number(v.trim().replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
