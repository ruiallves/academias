import { useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { cx } from "./primitives";
import { Check, TriangleAlert, Upload } from "@/lib/icons";
import { reloadAcademy, useStore } from "@/lib/store";
import { addItem } from "@/lib/catalogs";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  SHEETS,
  downloadCalendarTemplate,
  ensaiarCalendario,
  importarCalendario,
  ligarProvas,
  parseCalendarFile,
  type LeituraDoCalendario,
  type ResultadoDoCalendario,
} from "@/lib/calendar-import";

/**
 * Importar o calendário de um ficheiro.
 *
 * ## Quatro momentos, e o terceiro é o que importa
 *
 * Escolher o ficheiro, decidir o que fazer com os nomes novos, **ver o ensaio**,
 * confirmar. O ensaio corre no servidor sem escrever nada e devolve quantos
 * eventos saem, quantos chocam e com quê — sem ele, uma importação de calendário
 * é a única que não se consegue verificar depois: os eventos ficam espalhados
 * por doze meses e ninguém os relê.
 *
 * ## Os nomes novos
 *
 * Um ficheiro de época traz quase sempre um local ou uma prova que ainda não
 * está nas Definições. Recusar a linha por isso mandava a pessoa a outro ecrã e
 * de volta; criá-los sem perguntar enchia os menus do clube com o que estava
 * escrito na folha. Por isso pergunta-se, uma vez, com a lista à frente.
 *
 * As equipas **não** entram nessa lista: uma equipa cria-se com modalidade e
 * escalão, e adivinhá-los a partir de uma linha de calendário era inventar.
 */
export function ImportCalendarDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const { academy } = useStore();
  const { session } = useSession();
  const input = useRef<HTMLInputElement>(null);

  const [lido, setLido] = useState<LeituraDoCalendario | null>(null);
  const [criarNovos, setCriarNovos] = useState(true);
  const [ensaio, setEnsaio] = useState<ResultadoDoCalendario | null>(null);
  const [feito, setFeito] = useState<ResultadoDoCalendario | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const podeLigarProvas = can(session, "team:write");
  const novos = lido?.novos;
  const quantosNovos = novos
    ? novos.venues.length + novos.dressingRooms.length + novos.competitions.length + novos.eventTypes.length
    : 0;
  const provasPorLigar = lido?.provasPorLigar ?? [];

  async function escolher(file: File) {
    setErro(null);
    setEnsaio(null);
    setFeito(null);
    setBusy("A ler o ficheiro…");
    try {
      setLido(await parseCalendarFile(file));
    } catch {
      setErro("Não foi possível ler o ficheiro. Confirma que é o modelo em .xlsx.");
      setLido(null);
    } finally {
      setBusy(null);
    }
  }

  /**
   * O ensaio, depois de criar o que faltava.
   *
   * Os nomes novos criam-se **antes** do ensaio de propósito: o servidor só
   * conhece o que está nas Definições, e ensaiar antes disso devolvia dez linhas
   * recusadas por uma prova que a pessoa já disse que queria criar.
   */
  async function verificar() {
    if (!lido) return;
    setErro(null);
    setBusy("A verificar…");
    try {
      if (criarNovos && novos) {
        setBusy("A criar o que faltava…");
        for (const label of novos.venues) await addItem("venues", label);
        for (const label of novos.dressingRooms) await addItem("dressingRooms", label);
        for (const label of novos.eventTypes) await addItem("eventTypes", label);
        for (const label of novos.competitions) await addItem("competitions", label);
        if (podeLigarProvas && provasPorLigar.length) {
          setBusy("A ligar as provas às equipas…");
          await ligarProvas(provasPorLigar);
          await reloadAcademy();
        }
        setLido({ ...lido, novos: { venues: [], dressingRooms: [], competitions: [], eventTypes: [] }, provasPorLigar: [] });
      }
      setBusy("A verificar…");
      setEnsaio(await ensaiarCalendario(lido.rows));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível verificar.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmar() {
    if (!lido) return;
    setErro(null);
    setBusy("A importar…");
    try {
      const r = await importarCalendario(lido.rows);
      await reloadAcademy();
      setFeito(r);
      setLido(null);
      setEnsaio(null);
      onDone?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(null);
    }
  }

  const problemasNaLeitura = (lido?.erros.length ?? 0) + (lido?.colunasEmFalta.length ?? 0);

  return (
    <Dialog
      labelledBy="importar-calendario"
      title="Importar calendário"
      subtitle={academy.name}
      onClose={onClose}
      width={620}
      footer={
        feito ? (
          <button type="button" onClick={onClose} className="ctl-primary">
            Concluído
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={Boolean(busy)}>
              Cancelar
            </button>
            {ensaio ? (
              <button
                type="button"
                onClick={() => void confirmar()}
                className="ctl-primary"
                disabled={Boolean(busy) || ensaio.total - ensaio.conflitos.length <= 0}
              >
                {busy ?? `Criar ${ensaio.total - ensaio.conflitos.length} eventos`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void verificar()}
                className="ctl-primary"
                disabled={Boolean(busy) || !lido || lido.rows.length === 0}
              >
                {busy ?? "Verificar"}
              </button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4 p-5">
        {feito ? (
          <Concluido r={feito} />
        ) : (
          <>
            {!lido && (
              <>
                <div className="rounded-[var(--radius-control)] border border-line p-3.5">
                  <p className="text-body font-medium text-ink">Uma folha por tipo de evento</p>
                  <p className="mt-1 text-meta leading-relaxed text-ink-3">
                    O modelo traz três folhas — Treinos, Jogos e Outros — porque cada tipo pede campos diferentes.
                    Preenche só as que precisares. Traz também a lista das equipas, locais, balneários e provas do
                    clube, para os nomes baterem certo.
                  </p>
                  <button type="button" onClick={() => void downloadCalendarTemplate()} className="ctl-outline mt-2.5">
                    Descarregar modelo
                  </button>
                </div>

                <div className="space-y-3">
                  {SHEETS.map((f) => (
                    <div key={f.key}>
                      <span className="mb-1 block text-meta font-medium text-ink">{f.nome}</span>
                      <p className="text-meta leading-relaxed text-ink-3">
                        {f.colunas.map((c, i) => (
                          <span key={c.header}>
                            {i > 0 && " · "}
                            <span className={c.required ? "text-ink-2" : undefined}>{c.header}</span>
                            {c.required && <span className="text-ink-4">*</span>}
                          </span>
                        ))}
                      </p>
                    </div>
                  ))}
                  <p className="text-[11px] leading-relaxed text-ink-4">
                    * obrigatória. Nos treinos e nos eventos, "Repetir até" com "Dias da semana" marca todas as
                    semanas nesses dias — terças e quintas até ao fim da época numa linha só.
                  </p>
                </div>
              </>
            )}

            <div>
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="ctl-outline w-full justify-center"
                disabled={Boolean(busy)}
              >
                <Upload className="size-3.5" strokeWidth={1.75} />
                {lido ? "Escolher outro ficheiro" : "Escolher ficheiro"}
              </button>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.xls"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void escolher(f);
                  e.target.value = "";
                }}
              />
            </div>

            {lido?.semFolhas && (
              <Aviso tom="risk">
                O ficheiro não tem nenhuma das folhas Treinos, Jogos ou Outros. Descarrega o modelo e preenche-o.
              </Aviso>
            )}

            {lido?.colunasEmFalta.map((c) => (
              <Aviso key={c.folha} tom="risk">
                Na folha <strong className="font-medium">{c.folha}</strong> faltam colunas obrigatórias:{" "}
                {c.colunas.join(", ")}.
              </Aviso>
            ))}

            {lido && !ensaio && lido.rows.length > 0 && (
              <>
                <p className="text-body text-ink">
                  <strong className="font-medium">{lido.rows.length}</strong>{" "}
                  {lido.rows.length === 1 ? "linha lida" : "linhas lidas"}
                  {lido.rows.some((r) => r.repeatUntil) && ", algumas a repetir"}. Verifica para saber quantos eventos
                  são e o que choca.
                </p>

                {/* --- Os nomes que a academia ainda não tem ------------------ */}
                {(quantosNovos > 0 || provasPorLigar.length > 0) && novos && (
                  <div
                    className={cx(
                      "rounded-[var(--radius-control)] border p-3.5",
                      criarNovos ? "border-signal-line bg-signal-soft/25" : "border-line",
                    )}
                  >
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={criarNovos}
                        onChange={(e) => setCriarNovos(e.target.checked)}
                        className="mt-0.5 size-3.5 accent-[var(--color-signal)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-body text-ink">Criar o que o ficheiro traz de novo</span>
                        <span className="mt-1 block space-y-0.5 text-meta leading-relaxed text-ink-3">
                          {novos.venues.length > 0 && <span className="block">Locais: {novos.venues.join(", ")}</span>}
                          {novos.dressingRooms.length > 0 && (
                            <span className="block">Balneários: {novos.dressingRooms.join(", ")}</span>
                          )}
                          {novos.competitions.length > 0 && (
                            <span className="block">Competições: {novos.competitions.join(", ")}</span>
                          )}
                          {novos.eventTypes.length > 0 && (
                            <span className="block">Tipos de evento: {novos.eventTypes.join(", ")}</span>
                          )}
                          {provasPorLigar.length > 0 && (
                            <span className="block">
                              {podeLigarProvas
                                ? "E estas equipas passam a disputar as provas do ficheiro: "
                                : "Estas equipas não disputam as provas do ficheiro (sem permissão para as ligar): "}
                              {provasPorLigar.map((p) => `${p.teamName} (${p.competicoes.join(", ")})`).join("; ")}
                            </span>
                          )}
                        </span>
                      </span>
                    </label>
                    {!criarNovos && (
                      <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
                        Sem isto, as linhas que os usam vão ser recusadas pelo servidor. Os locais e os balneários
                        entram na mesma — são texto, e só a lista das Definições fica por actualizar.
                      </p>
                    )}
                  </div>
                )}

                {problemasNaLeitura > 0 && <Linhas titulo="Linhas que ficaram de fora" erros={lido.erros} />}
              </>
            )}

            {lido && !ensaio && lido.rows.length === 0 && !lido.semFolhas && lido.colunasEmFalta.length === 0 && (
              <>
                <Aviso tom="warn">Nenhuma linha aproveitável no ficheiro.</Aviso>
                {lido.erros.length > 0 && <Linhas titulo="Porquê" erros={lido.erros} />}
              </>
            )}

            {/* --- O ensaio ------------------------------------------------- */}
            {ensaio && <Ensaio r={ensaio} />}
          </>
        )}

        {erro && <Aviso tom="risk">{erro}</Aviso>}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function Aviso({ tom, children }: { tom: "risk" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={cx(
        "rounded-[var(--radius-control)] px-3.5 py-2.5 text-meta leading-relaxed",
        tom === "risk" ? "bg-risk-soft text-risk" : "bg-warn-soft text-warn",
      )}
    >
      {children}
    </p>
  );
}

/**
 * O que o servidor diria se fosse a sério.
 *
 * Os números primeiro, porque é o que responde à pergunta de quem está a olhar
 * ("quantos eventos é que isto cria?"), e o que choca a seguir, linha a linha e
 * com o dia — é isso que se leva de volta para o ficheiro.
 */
function Ensaio({ r }: { r: ResultadoDoCalendario }) {
  const entram = r.total - r.conflitos.length;
  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-control)] border border-line p-3.5">
        <p className="text-body text-ink">
          <strong className="font-medium">{entram}</strong> {entram === 1 ? "evento entra" : "eventos entram"}
          {r.total !== entram && <span className="text-ink-3"> de {r.total}</span>}.
        </p>
        <p className="mt-1 text-meta text-ink-3">
          {r.porTipo.treinos} treinos · {r.porTipo.jogos} jogos · {r.porTipo.outros} outros
        </p>
      </div>

      {r.conflitos.length > 0 && (
        <div>
          <span className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
            <TriangleAlert className="size-3.5 text-warn" strokeWidth={1.75} />
            {r.conflitos.length} {r.conflitos.length === 1 ? "choca e é saltado" : "chocam e são saltados"}
          </span>
          <ul className="max-h-44 space-y-1 overflow-y-auto">
            {r.conflitos.slice(0, 60).map((c, i) => (
              <li key={i} className="flex items-baseline gap-2 text-meta">
                <span className="shrink-0 font-mono text-[11px] text-ink-4">
                  {c.folha} L{c.linha}
                </span>
                <span className="shrink-0 text-ink-2 tabular">{c.quando}</span>
                <span className="min-w-0 text-ink-3">{c.motivo}</span>
              </li>
            ))}
          </ul>
          {r.conflitos.length > 60 && (
            <p className="mt-1 text-[11px] text-ink-4">e mais {r.conflitos.length - 60}.</p>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
            O resto entra à mesma. Um choque é a equipa já ter alguma coisa àquela hora, ou o balneário estar ocupado.
          </p>
        </div>
      )}

      {r.erros.length > 0 && (
        <Linhas titulo="Recusadas pelo servidor" erros={r.erros.map((e) => ({ ...e, erro: e.erro }))} />
      )}
    </div>
  );
}

function Concluido({ r }: { r: ResultadoDoCalendario }) {
  return (
    <>
      <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] bg-ok-soft px-3.5 py-3">
        <Check className="size-4 shrink-0 text-ok" strokeWidth={2.25} />
        <span className="text-body text-ink">
          {r.criados} {r.criados === 1 ? "evento criado" : "eventos criados"} —{" "}
          <span className="text-ink-3">
            {r.porTipo.treinos} treinos, {r.porTipo.jogos} jogos, {r.porTipo.outros} outros
          </span>
          .
        </span>
      </div>
      {r.conflitos.length > 0 && (
        <p className="text-meta leading-relaxed text-ink-3">
          {r.conflitos.length} {r.conflitos.length === 1 ? "foi saltado" : "foram saltados"} por chocarem com o que já
          estava marcado. Marca-os no calendário se ainda fizerem falta.
        </p>
      )}
      {r.erros.length > 0 && <Linhas titulo="Recusadas" erros={r.erros} />}
    </>
  );
}

/** As linhas que falharam, com a folha e o número — é isso que se leva ao ficheiro. */
function Linhas({ titulo, erros }: { titulo: string; erros: { folha: string; linha: number; erro: string }[] }) {
  return (
    <div>
      <span className="mb-1.5 block text-meta font-medium text-ink">{titulo}</span>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {erros.slice(0, 60).map((e, i) => (
          <li key={i} className="flex items-baseline gap-2 text-meta">
            <span className="shrink-0 font-mono text-[11px] text-ink-4">
              {e.folha} L{e.linha}
            </span>
            <span className="min-w-0 text-risk">{e.erro}</span>
          </li>
        ))}
      </ul>
      {erros.length > 60 && <p className="mt-1 text-[11px] text-ink-4">e mais {erros.length - 60}.</p>}
    </div>
  );
}
