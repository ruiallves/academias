import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Loading, cx } from "./primitives";
import { Check, Plus, Trash2, Users } from "@/lib/icons";
import { STAFF_ROLES, getMatch, saveMatchStaff, staffPool, type MatchStaffRow } from "@/lib/matches";

/**
 * A equipa de trabalho de um jogo — quem lá vai estar além dos atletas.
 *
 * ## Porque é que vive aqui, e não na página do jogo
 *
 * Vivia só na página do jogo. Só que quem escala o massagista e o delegado é
 * quem acabou de fechar a convocatória, no ecrã das Convocatórias — e para o
 * fazer tinha de sair, procurar o jogo no calendário e abri-lo. A equipa de
 * trabalho é parte da convocatória no papel (a folha em PDF imprime-a), e tem
 * de estar à mão no mesmo sítio.
 *
 * O editor é um só, usado pelos dois ecrãs. Ver `cabecalho` para a única coisa
 * que muda entre eles.
 */

/**
 * A equipa de trabalho do jogo.
 *
 * ## O texto muda com o relógio
 *
 * Dizia "Junta quem **esteve** no jogo" — num jogo marcado para sábado, a quem
 * está a escalar a equipa de trabalho com dias de antecedência. Escalar é quase
 * sempre um acto anterior ao jogo: o pretérito só é verdade na metade das vezes,
 * e na outra metade lê-se como se o produto não soubesse em que dia estamos.
 *
 * Antes do apito é "vai estar", depois é "esteve". A mesma regra que já decide se
 * a página mostra a convocatória ou a ficha.
 */
export function MatchStaffEditor({
  matchId,
  staff,
  passou,
  mayRecord,
  onSaved,
  cabecalho,
}: {
  matchId: string;
  staff: MatchStaffRow[];
  passou: boolean;
  mayRecord: boolean;
  onSaved: () => void;
  /**
   * O topo, desenhado por quem usa o editor.
   *
   * Na página do jogo é o cabeçalho do painel, com o "Juntar" à direita; no
   * diálogo das Convocatórias é uma faixa por cima da lista. O botão e a
   * contagem são do editor — só a moldura muda —, e é isso que deixa os dois
   * ecrãs usarem o mesmo código em vez de duas cópias que divergem ao terceiro
   * retoque.
   */
  cabecalho: (juntar: ReactNode, contagem: number) => ReactNode;
}) {
  const [pool, setPool] = useState<{ membershipId: string; name: string; role: string | null }[]>([]);
  const [rows, setRows] = useState(staff.map((s) => ({ membershipId: s.membershipId, role: s.role })));
  const [aAdicionar, setAAdicionar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * Quem acabou de ser juntado, por dois segundos.
   *
   * Sem isto, juntar alguém era mudo: o formulário fechava-se e aparecia mais uma
   * linha numa lista — e uma linha a mais numa lista de três não é um sinal, é uma
   * coisa que se descobre a contar. Quem carrega num botão precisa de saber se ele
   * fez alguma coisa, e a resposta tem de chegar onde o olho já está: na linha da
   * pessoa que acabou de escolher.
   *
   * Dois segundos e volta ao botão de apagar. Um visto permanente seria uma
   * segunda coluna de ruído em cada linha, e ao fim de um minuto ninguém saberia
   * o que ele quer dizer.
   */
  const [acabado, setAcabado] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRows(staff.map((s) => ({ membershipId: s.membershipId, role: s.role })));
  }, [staff]);

  // Um temporizador pendente quando o painel desaparece deixava um `setState` a
  // apontar para um componente que já não existe.
  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current);
    },
    [],
  );

  useEffect(() => {
    if (!mayRecord) return;
    staffPool()
      .then(setPool)
      .catch(() => {
        /* sem pool: o painel mostra o que está e não deixa acrescentar */
      });
  }, [mayRecord]);

  const nome = (id: string) =>
    pool.find((p) => p.membershipId === id)?.name ?? staff.find((s) => s.membershipId === id)?.name ?? "—";
  const disponivel = pool.filter((p) => !rows.some((r) => r.membershipId === p.membershipId));

  /**
   * Grava a lista inteira.
   *
   * `juntou` é o id de quem entrou agora, quando foi uma adição — é ele que
   * acende o visto. Numa remoção fica em branco: a linha desaparece, e o
   * desaparecimento **é** a confirmação.
   */
  async function gravar(next: { membershipId: string; role: string }[], juntou?: string) {
    setRows(next);
    setBusy(true);
    setErro(null);
    try {
      await saveMatchStaff(matchId, next);

      /*
       * O visto só acende **depois** de o servidor confirmar.
       *
       * Acendê-lo ao carregar seria mentir metade das vezes: se a gravação
       * falhasse, a pessoa tinha visto um certo e a linha desaparecia a seguir.
       */
      if (juntou) {
        if (relogio.current) clearTimeout(relogio.current);
        setAcabado(juntou);
        relogio.current = setTimeout(() => setAcabado(null), 2000);
      }

      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
      setRows(staff.map((s) => ({ membershipId: s.membershipId, role: s.role })));
    } finally {
      setBusy(false);
    }
  }

  const juntar =
    mayRecord && disponivel.length > 0 && !aAdicionar ? (
      <button type="button" className="ctl-ghost" onClick={() => setAAdicionar(true)}>
        <Plus className="size-3.5" strokeWidth={2} />
        Juntar
      </button>
    ) : null;

  return (
    <>
      {cabecalho(juntar, rows.length)}

      {rows.length === 0 && !aAdicionar ? (
        <p className="px-5 py-4 text-meta leading-relaxed text-ink-3">
          Ninguém atribuído. Junta quem {passou ? "esteve" : "vai estar"} no jogo — treinadores,
          massagista, delegado.
        </p>
      ) : (
        <ul>
          {rows.map((r) => {
            const novo = acabado === r.membershipId;
            return (
              <li
                key={r.membershipId}
                className={cx(
                  "flex min-h-12 items-center gap-3 border-b border-line px-5 py-2 transition-colors duration-300 last:border-b-0 motion-reduce:transition-none",
                  // A linha inteira acende, e não só o canto: é o que faz o olho
                  // aterrar na pessoa certa sem a procurar.
                  novo && "bg-ok-soft",
                )}
              >
                <Monograma nome={nome(r.membershipId)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{nome(r.membershipId)}</div>
                  <div className="text-meta text-ink-3">{r.role}</div>
                </div>

                {novo ? (
                  /*
                   * Ocupa o mesmo lugar do botão de apagar, com a mesma medida.
                   * Se fosse um elemento a mais, a linha mexia-se ao acender e
                   * outra vez ao apagar — e o salto rouba a atenção ao sinal.
                   */
                  <span
                    role="status"
                    className="flex size-8 shrink-0 items-center justify-center text-ok"
                    aria-label={`${nome(r.membershipId)} juntado ao jogo`}
                  >
                    <Check className="size-4" strokeWidth={2.5} />
                  </span>
                ) : (
                  mayRecord && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void gravar(rows.filter((x) => x.membershipId !== r.membershipId))}
                      className="ctl-ghost shrink-0 text-ink-3 hover:text-risk"
                      aria-label={`Tirar ${nome(r.membershipId)}`}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {aAdicionar && (
        <AddStaff
          pool={disponivel}
          passou={passou}
          onCancel={() => setAAdicionar(false)}
          onAdd={(membershipId, role) => {
            setAAdicionar(false);
            void gravar([...rows, { membershipId, role }], membershipId);
          }}
        />
      )}

      {erro && (
        <p role="alert" className="border-t border-line px-5 py-2.5 text-meta text-risk">
          {erro}
        </p>
      )}
    </>
  );
}

/** As iniciais num círculo da cor do clube. Um rosto sem precisar de fotografia. */
function Monograma({ nome }: { nome: string }) {
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-signal-on"
      style={{ background: "var(--color-signal-strong)" }}
    >
      {iniciais || "?"}
    </span>
  );
}

function AddStaff({
  pool,
  passou,
  onAdd,
  onCancel,
}: {
  pool: { membershipId: string; name: string; role: string | null }[];
  passou: boolean;
  onAdd: (membershipId: string, role: string) => void;
  onCancel: () => void;
}) {
  const [quem, setQuem] = useState("");
  const [role, setRole] = useState("");

  const escolhido = pool.find((p) => p.membershipId === quem);

  return (
    <div className="space-y-2 border-t border-line bg-sunken/40 px-5 py-3">
      <label className="block">
        <span className="mb-1 block text-meta font-medium text-ink-2">
          {passou ? "Quem esteve no jogo?" : "Quem vai estar no jogo?"}
        </span>
        <select
          autoFocus
          value={quem}
          onChange={(e) => {
            setQuem(e.target.value);
            const p = pool.find((x) => x.membershipId === e.target.value);
            if (p?.role) setRole(p.role);
          }}
          className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none focus:border-line-strong"
        >
          <option value="">Escolher…</option>
          {pool.map((p) => (
            <option key={p.membershipId} value={p.membershipId}>
              {p.name}
              {p.role ? ` — ${p.role}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-meta font-medium text-ink-2">A fazer o quê?</span>
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          list="funcoes-jogo"
          placeholder="Massagista, delegado ao jogo…"
          className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none placeholder:text-ink-4 focus:border-line-strong"
        />
      </label>
      <datalist id="funcoes-jogo">
        {STAFF_ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <div className="flex gap-2 pt-1">
        <button type="button" className="ctl-ghost h-10" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="ctl-primary h-10"
          disabled={!escolhido || role.trim().length === 0}
          onClick={() => onAdd(quem, role.trim())}
        >
          Juntar ao jogo
        </button>
      </div>
    </div>
  );
}

/**
 * A equipa de trabalho num diálogo — o gesto das Convocatórias.
 *
 * ## Lê o jogo ao abrir
 *
 * A lista de jogos não traz a equipa de trabalho, de propósito: o servidor só
 * manda a **minha** linha dela (ver `listIn`), porque trazer a equipa inteira de
 * cada jogo eram dezenas de objectos a mais por leitura para mostrar um rótulo.
 * Por isso o diálogo pede o jogo quando abre, e outra vez depois de cada
 * gravação — a lista que se vê é sempre a que ficou no servidor.
 */
export function MatchStaffDialog({
  matchId,
  subtitulo,
  onClose,
}: {
  matchId: string;
  subtitulo: string;
  onClose: () => void;
}) {
  const [staff, setStaff] = useState<MatchStaffRow[] | null>(null);
  /* A equipa técnica da equipa — é a que a folha usa enquanto esta estiver vazia. */
  const [daEquipa, setDaEquipa] = useState<{ name: string; role: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    getMatch(matchId)
      .then((m) => {
        setStaff(m.staff);
        setDaEquipa(m.teamStaff ?? []);
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível carregar o jogo."));
  }, [matchId]);

  useEffect(carregar, [carregar]);

  return (
    <Dialog
      labelledBy="equipa-de-trabalho"
      title="Equipa de trabalho"
      subtitle={subtitulo}
      icon={<Users className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {/* Dito aqui porque é a pergunta que se faz a seguir a juntar alguém. */}
          <span className="text-meta text-ink-3">Grava ao juntar. Sai na folha em PDF da convocatória.</span>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Fechar
          </button>
        </div>
      }
    >
      {erro ? (
        <p role="alert" className="px-5 py-4 text-meta text-risk">
          {erro}
        </p>
      ) : staff === null ? (
        <div className="py-8">
          <Loading size="panel" />
        </div>
      ) : (
        <MatchStaffEditor
          matchId={matchId}
          staff={staff}
          // As Convocatórias só mostram jogos por disputar: é sempre "vai estar".
          passou={false}
          mayRecord
          onSaved={carregar}
          cabecalho={(juntar, n) => (
            <div className="flex min-h-12 items-center gap-3 border-b border-line px-5 py-2">
              <span className="flex-1 text-meta text-ink-3">
                {/*
                  Vazio não quer dizer "a folha sai sem equipa": sai com a da
                  ficha da equipa. Dizê-lo aqui evita escalar a mesma gente à
                  mão só para ela aparecer no papel.
                */}
                {n > 0
                  ? `${n} ${n === 1 ? "pessoa" : "pessoas"} no jogo`
                  : daEquipa.length > 0
                    ? `Ninguém escalado — a folha usa a equipa técnica da equipa (${daEquipa.map((s) => s.name.split(/\s+/)[0]).join(", ")}).`
                    : "Treinadores, massagista, delegado ao jogo."}
              </span>
              {juntar}
            </div>
          )}
        />
      )}
    </Dialog>
  );
}
