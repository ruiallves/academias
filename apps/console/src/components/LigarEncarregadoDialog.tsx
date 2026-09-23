import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ListaDeEscolha, Monogram, Pill, cx } from "@/components/primitives";
import { Check, Link2, Loader2, Search } from "@/lib/icons";
import {
  RELACOES,
  candidatosAEncarregado,
  ligarEncarregado,
  type CandidatoAEncarregado,
} from "@/lib/encarregados";

/**
 * Dar a alguém que já tem conta no clube o lugar de encarregado deste atleta.
 *
 * ## Quem isto serve
 *
 * O pai que é sócio há quinze anos. O treinador do escalão acima, com a filha
 * nos sub-12. A tesoureira, que é mãe de dois. Todos já entram na app — e
 * nenhum deles conseguia dizer que tem um filho aqui: o registo de família
 * começa por criar conta, e quem já tem uma não tinha onde meter a segunda
 * vida. Ficavam à espera de uma chamada para a secretaria, que também não tinha
 * botão nenhum.
 *
 * ## Escolhe-se uma pessoa, não um vínculo
 *
 * A lista é de **contas**. Quem é treinador e sócio aparecia duas vezes, e
 * escolher uma das duas não queria dizer nada: o que passa a ser encarregado é
 * a pessoa. As etiquetas dizem o que ela já é no clube, para a secretaria
 * reconhecer o nome certo entre dois parecidos.
 *
 * ## Sem fila de aprovação
 *
 * Um pai que se regista pelo link fica à espera de o clube o aprovar — ninguém
 * garantiu que aquela pessoa é mesmo encarregada daquela criança. Aqui é o
 * clube que está a ligar, com a ficha do atleta à frente: pôr em fila um pedido
 * que a própria secretaria acabou de fazer era pedir-lhe que se aprovasse a si
 * mesma. Fica ligado, e a área de Família aparece-lhe na app a seguir.
 */
export function LigarEncarregadoDialog({
  athleteId,
  athleteName,
  onClose,
  onDone,
}: {
  athleteId: string;
  athleteName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [procura, setProcura] = useState("");
  const [lista, setLista] = useState<CandidatoAEncarregado[] | null>(null);
  const [escolhido, setEscolhido] = useState<CandidatoAEncarregado | null>(null);
  const [relacao, setRelacao] = useState<string>("Encarregado");
  const [busy, setBusy] = useState(false);

  /*
   * A procura vai ao servidor, com uma pausa pelo meio.
   *
   * Filtrar no cliente obrigava a trazer o clube inteiro para a janela — e um
   * clube com seiscentos sócios não cabe numa lista que se percorre com os
   * olhos. O atraso é o que separa "escrever" de "procurar": sem ele, escrever
   * "Marta" eram cinco pedidos e a lista piscava a cada letra.
   */
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      candidatosAEncarregado(athleteId, procura.trim())
        .then((r) => vivo && setLista(r))
        .catch(() => vivo && setLista([]));
    }, procura ? 400 : 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [athleteId, procura]);

  const podeGravar = escolhido !== null && !escolhido.jaDesteAtleta && relacao.trim().length > 0 && !busy;

  const gravar = async () => {
    if (!escolhido || busy) return;
    setBusy(true);
    try {
      await ligarEncarregado(athleteId, { userId: escolhido.userId, relation: relacao.trim() });
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      labelledBy="ligar-encarregado"
      title="Associar uma conta"
      subtitle={athleteName}
      icon={<Link2 className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {/*
            O nome e a relação lado a lado, e não uma frase.

            Era "X passa a mãe" — que sai torto em metade dos casos ("André
            Peixoto passa a mãe") e obrigava a escolher um artigo que o campo,
            sendo texto livre, não consegue prever. Isto lê-se na mesma e não
            tem como sair mal.
          */}
          <span className="truncate text-meta text-ink-3">
            {escolhido ? `${escolhido.name} · ${relacao.trim()}` : "Escolhe uma conta do clube."}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="button" onClick={gravar} className="ctl-primary" disabled={!podeGravar}>
              <Check className="size-3.5" strokeWidth={1.75} />
              {busy ? "A associar…" : "Associar"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
          <input
            autoFocus
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            placeholder="Procurar por nome ou email"
            className={cx(dialogInputClass, "pl-8")}
          />
        </div>

        <ListaDeContas
          lista={lista}
          escolhido={escolhido}
          temProcura={procura.trim().length > 0}
          onEscolher={(c) => {
            setEscolhido(c);
            // Quem já é encarregado de outro filho mantém a relação que tem; a
            // secretaria só a escreve quando é a primeira vez.
            if (!c.jaEncarregado) setRelacao("Encarregado");
          }}
        />

        <DialogField label="Relação" hint="como aparece na ficha">
          <div className="flex flex-wrap items-center gap-1.5">
            {RELACOES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRelacao(r)}
                className={cx(
                  "h-8 rounded-[var(--radius-control)] border px-2.5 text-meta",
                  relacao === r ? "border-line-strong bg-sunken text-ink" : "border-line text-ink-3",
                )}
              >
                {r}
              </button>
            ))}
            <input
              value={RELACOES.includes(relacao as (typeof RELACOES)[number]) ? "" : relacao}
              onChange={(e) => setRelacao(e.target.value)}
              maxLength={40}
              placeholder="Avó, tio, tutor…"
              className={cx(dialogInputClass, "h-8 w-auto flex-1")}
            />
          </div>
        </DialogField>

        <p className="text-meta leading-relaxed text-ink-3">
          A pessoa passa a ver <strong className="text-ink-2">{athleteName}</strong> na área de Família da app, com as
          convocatórias, os treinos e as mensalidades. O que já lá faz continua igual.
        </p>
      </div>
    </Dialog>
  );
}

function ListaDeContas({
  lista,
  escolhido,
  temProcura,
  onEscolher,
}: {
  lista: CandidatoAEncarregado[] | null;
  escolhido: CandidatoAEncarregado | null;
  temProcura: boolean;
  onEscolher: (c: CandidatoAEncarregado) => void;
}) {
  const vazio = useMemo(
    () =>
      temProcura
        ? "Ninguém com esse nome tem conta no clube. Quem ainda não tem entra pelo link das famílias."
        : "Ainda ninguém tem conta neste clube.",
    [temProcura],
  );

  if (lista === null) {
    return (
      <div className="flex h-40 items-center justify-center rounded-[var(--radius-control)] border border-line">
        <Loader2 className="size-4 animate-spin text-ink-4" strokeWidth={1.75} />
      </div>
    );
  }

  if (lista.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-[var(--radius-control)] border border-line px-6 text-center text-meta leading-relaxed text-ink-3">
        {vazio}
      </div>
    );
  }

  return (
    <ListaDeEscolha className="max-h-60 overflow-y-auto rounded-[var(--radius-control)] border border-line">
      {lista.map((c) => {
        const escolhida = escolhido?.userId === c.userId;
        return (
          <li key={c.userId} className="border-b border-line last:border-0">
            <button
              type="button"
              disabled={c.jaDesteAtleta}
              onClick={() => onEscolher(c)}
              className={cx(
                "flex w-full items-center gap-2.5 px-3 py-2.5 text-left",
                escolhida && "bg-sunken",
                c.jaDesteAtleta ? "opacity-55" : "hover:bg-sunken",
              )}
            >
              <Monogram name={c.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body text-ink">{c.name}</div>
                <div className="truncate text-meta text-ink-3">
                  {c.papeis.join(" · ")}
                  {c.educandos > 0 && ` · ${c.educandos} ${c.educandos === 1 ? "educando" : "educandos"}`}
                </div>
              </div>
              {c.jaDesteAtleta ? (
                <Pill tone="ok">Já associado</Pill>
              ) : escolhida ? (
                <Check className="size-4 shrink-0 text-ink" strokeWidth={2} />
              ) : null}
            </button>
          </li>
        );
      })}
    </ListaDeEscolha>
  );
}
