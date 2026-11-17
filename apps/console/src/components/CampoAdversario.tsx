import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matches as jogosDaBase } from "@/lib/store";
import { carregarEmblema, clubeConhecido, emblemaDoNome, procurarClubes, type ClubeConhecido, type Emblema } from "@/lib/clubes";
import { ImagePlus, Loader2, Shield, X } from "@/lib/icons";
import { mostrarOk } from "@/lib/avisos";
import { cx, ListaDeEscolha } from "./primitives";
import { dialogInputClass } from "./Dialog";

/**
 * O campo do adversário: procura no diretório dos clubes federados (com o
 * emblema) e nos adversários que o clube já defrontou.
 *
 * ## Dois estados
 *
 * **A escrever:** um campo de texto com a lista por baixo. Primeiro os
 * adversários já defrontados que batem (vêm da consola, sem esperar), depois o
 * diretório da plataforma (FPF e FPB, ver `lib/clubes.ts`), pedido ao servidor
 * a partir de duas letras e meio segundo depois da última tecla. Cada linha
 * traz o emblema.
 *
 * **Escolhido:** um cartão com o emblema, o nome e a associação, e um botão
 * para trocar. É o que se vê ao abrir um jogo que já tem adversário do
 * diretório, e logo que se escolhe um da lista. Escolher liga o jogo ao clube
 * (`opponentClubId`): o emblema aparece na lista de jogos, na ficha e na app.
 *
 * Continua a poder escrever-se um nome livre. Sem emblema (um clube do
 * diretório sem emblema na federação, ou um nome livre), há um botão para
 * carregar um: fica logo a valer para este clube, e a plataforma revê-o por
 * fora, sem o clube saber.
 */
export function CampoAdversario({
  value,
  onChange,
  clubId,
  onClubChange,
  emblema,
  onEmblemaChange,
  modalidade,
  id,
}: {
  value: string;
  onChange: (nome: string) => void;
  /** O clube do diretório escolhido. Nulo = nome escrito à mão. */
  clubId: string | null;
  onClubChange: (id: string | null) => void;
  /** O emblema que está a valer para este adversário (do diretório ou carregado). */
  emblema: Emblema | null;
  onEmblemaChange: (e: Emblema | null) => void;
  /** Para a procura no diretório trazer primeiro os clubes da modalidade da equipa. */
  modalidade?: string;
  id?: string;
}) {
  const lista = useId();
  const ficheiro = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const [doDiretorio, setDoDiretorio] = useState<ClubeConhecido[]>([]);
  const [aProcurar, setAProcurar] = useState(false);
  const [aCarregar, setACarregar] = useState(false);
  /** O detalhe do clube escolhido (associação, localidade), para o cartão. */
  const [escolhido, setEscolhido] = useState<{ id: string; detalhe: string } | null>(null);
  /** O nome que já foi pedido ao servidor, para não repetir ao abrir a lista outra vez. */
  const pedido = useRef("");

  /** Cada adversário já defrontado uma vez, com quantos jogos, o mais recente primeiro, e o clube do diretório se o jogo o tinha. */
  const conhecidos = useMemo(() => {
    const porNome = new Map<string, { nome: string; jogos: number; ultimo: number; clubId: string | null; emblema: Emblema | null }>();
    for (const m of jogosDaBase) {
      const nome = m.opponent?.trim();
      if (!nome) continue;
      const chave = normalizar(nome);
      const quando = new Date(m.startsAt).getTime();
      const atual = porNome.get(chave);
      if (atual) {
        atual.jogos += 1;
        if (quando > atual.ultimo) {
          atual.ultimo = quando;
          atual.clubId = m.opponentClubId ?? atual.clubId;
          atual.emblema = m.opponentLogo ?? atual.emblema;
        }
      } else {
        porNome.set(chave, { nome, jogos: 1, ultimo: quando, clubId: m.opponentClubId ?? null, emblema: m.opponentLogo ?? null });
      }
    }
    return [...porNome.values()].sort((a, b) => b.ultimo - a.ultimo);
  }, [jogosDaBase]);

  // Um jogo aberto com o clube já escolhido: vai-se buscar a associação para o cartão.
  useEffect(() => {
    if (!clubId || escolhido?.id === clubId) return;
    let vivo = true;
    clubeConhecido(clubId)
      .then((c) => {
        if (!vivo) return;
        setEscolhido({ id: c.id, detalhe: detalheDe(c) });
        if (!emblema && c.emblema) onEmblemaChange(c.emblema);
      })
      .catch(() => vivo && setEscolhido({ id: clubId, detalhe: "Diretório dos clubes" }));
    return () => {
      vivo = false;
    };
    // Só quando o clube muda: o emblema e a função de o pôr são consequência.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const escrito = normalizar(value);
  const jaDefrontados = conhecidos
    .filter((c) => (escrito ? normalizar(c.nome).includes(escrito) : true))
    .sort((a, b) => Number(normalizar(b.nome) === escrito) - Number(normalizar(a.nome) === escrito))
    .slice(0, 4);

  // O diretório, a partir de duas letras, meio segundo depois da última tecla.
  useEffect(() => {
    if (!aberto || value.trim().length < 2) return;
    const termo = value.trim();
    if (pedido.current === termo) return;
    const t = setTimeout(() => {
      pedido.current = termo;
      setAProcurar(true);
      procurarClubes(termo, modalidade)
        .then((r) => setDoDiretorio(r))
        .catch(() => setDoDiretorio([]))
        .finally(() => setAProcurar(false));
    }, 450);
    return () => clearTimeout(t);
  }, [value, aberto, modalidade]);

  // Os já defrontados tapam o mesmo clube do diretório: um só de cada.
  const idsDefrontados = new Set(jaDefrontados.map((c) => c.clubId).filter(Boolean));
  const sugestoesDiretorio = doDiretorio.filter((c) => !idsDefrontados.has(c.id)).slice(0, 8);
  type Sugestao = { chave: string; nome: string; detalhe: string; clubId: string | null; emblema: Emblema | null };
  const sugestoes: Sugestao[] = [
    ...jaDefrontados.map((c) => ({ chave: `j:${c.nome}`, nome: c.nome, detalhe: `Já defrontado · ${c.jogos} ${c.jogos === 1 ? "jogo" : "jogos"}`, clubId: c.clubId, emblema: c.emblema })),
    ...sugestoesDiretorio.map((c) => ({ chave: `d:${c.id}`, nome: c.nome, detalhe: detalheDe(c), clubId: c.id, emblema: c.emblema })),
  ];
  const mostrar = aberto && (sugestoes.length > 0 || aProcurar);

  const escolher = (s: Sugestao) => {
    onChange(s.nome);
    onClubChange(s.clubId);
    onEmblemaChange(s.emblema);
    if (s.clubId) setEscolhido({ id: s.clubId, detalhe: s.detalhe.startsWith("Já defrontado") ? "Diretório dos clubes" : s.detalhe });
    setAberto(false);
  };

  /** Escrever à mão desliga o clube escolhido: o nome já não é o dele. */
  const escrever = (nome: string) => {
    onChange(nome);
    if (clubId) onClubChange(null);
    if (emblema) onEmblemaChange(null);
    setAberto(true);
    setMarcado(0);
  };

  /** Voltar ao campo de texto, com o nome, para escolher outro. */
  const trocar = () => {
    onClubChange(null);
    onEmblemaChange(null);
    setEscolhido(null);
    pedido.current = "";
    setAberto(true);
    // O campo só existe no render seguinte.
    setTimeout(() => campo.current?.focus(), 0);
  };

  // Um nome escrito à mão que já tem emblema carregado por este clube: aparece ao sair do campo.
  const procurarEmblemaDoNome = () => {
    if (clubId || emblema || value.trim().length < 2) return;
    void emblemaDoNome(value).then((e) => e && onEmblemaChange(e)).catch(() => undefined);
  };

  async function carregar(file: File) {
    if (value.trim().length < 2) return;
    setACarregar(true);
    try {
      const e = await carregarEmblema(file, { clubName: value, knownClubId: clubId });
      onEmblemaChange(e);
      mostrarOk("Emblema carregado.");
    } catch {
      // O aviso já está no cartão de erros.
    } finally {
      setACarregar(false);
      if (ficheiro.current) ficheiro.current.value = "";
    }
  }

  const botaoDeCarregar = (
    <>
      <button
        type="button"
        onClick={() => ficheiro.current?.click()}
        disabled={aCarregar || value.trim().length < 2}
        title="Carregar o emblema deste adversário"
        className="ctl-ghost h-8 shrink-0 text-meta text-ink-3"
      >
        {aCarregar ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} /> : <ImagePlus className="size-3.5" strokeWidth={1.75} />}
        Emblema
      </button>
      <input ref={ficheiro} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void carregar(e.target.files[0])} />
    </>
  );

  /* O cartão: um clube do diretório escolhido, ou um nome livre que já tem emblema. */
  if (clubId || emblema) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface py-1.5 pr-1.5 pl-2">
        {emblema ? (
          <img src={emblema.grande} alt="" className="size-10 shrink-0 rounded-[9px] border border-line bg-surface object-contain p-0.5" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[9px] bg-sunken text-ink-4">
            <Shield className="size-4.5" strokeWidth={1.5} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-ink">{value}</span>
          <span className="block truncate text-meta text-ink-3">{clubId ? (escolhido?.id === clubId ? escolhido.detalhe : "Diretório dos clubes") : "Nome escrito à mão · emblema do clube"}</span>
        </span>
        {!emblema && botaoDeCarregar}
        <button type="button" onClick={trocar} className="ctl-ghost size-8 shrink-0 justify-center px-0" aria-label="Trocar o adversário" title="Trocar o adversário">
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  return (
    // A lista abre por cima do resto do formulário, sem o empurrar para baixo.
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          ref={campo}
          id={id}
          value={value}
          onChange={(e) => escrever(e.target.value)}
          onFocus={() => setAberto(true)}
          onBlur={() => {
            setAberto(false);
            procurarEmblemaDoNome();
          }}
          onKeyDown={(e) => {
            if (!mostrar) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMarcado((i) => Math.min(sugestoes.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setMarcado((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (sugestoes.length > 0) escolher(sugestoes[Math.min(marcado, sugestoes.length - 1)]);
            } else if (e.key === "Escape") {
              // O Escape fecha a lista, e não o diálogo inteiro.
              e.stopPropagation();
              setAberto(false);
            }
          }}
          placeholder="Procura o clube ou escreve o nome"
          className={dialogInputClass}
          autoComplete="off"
          aria-label="Adversário"
          role="combobox"
          aria-expanded={mostrar}
          aria-controls={lista}
          aria-autocomplete="list"
          required
        />
        {value.trim().length >= 2 && botaoDeCarregar}
      </div>

      {mostrar && (
        <ListaDeEscolha
          id={lista}
          role="listbox"
          aria-label="Adversários"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[300px] overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          {sugestoes.map((s, i) => (
            <li key={s.chave} role="option" aria-selected={i === marcado}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => escolher(s)}
                onMouseEnter={() => setMarcado(i)}
                className={cx("flex w-full items-center gap-2.5 border-b border-line px-2.5 py-2 text-left last:border-0", i === marcado ? "bg-sunken/70" : "hover:bg-sunken/50")}
              >
                {s.emblema ? (
                  <img src={s.emblema.pequeno} alt="" loading="lazy" className="size-8 shrink-0 rounded-[7px] border border-line bg-surface object-contain p-px" />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-sunken text-ink-4">
                    <Shield className="size-3.5" strokeWidth={1.5} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{s.nome}</span>
                  <span className="block truncate text-meta text-ink-4">{s.detalhe}</span>
                </span>
              </button>
            </li>
          ))}
          {aProcurar && (
            <li className="flex items-center gap-2 px-2.5 py-2 text-meta text-ink-3">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              A procurar no diretório…
            </li>
          )}
        </ListaDeEscolha>
      )}
    </div>
  );
}

/** "A.F. Braga · Braga", ou "Diretório dos clubes" quando a fonte não diz mais. */
function detalheDe(c: ClubeConhecido): string {
  return [c.associacao, c.localidade].filter(Boolean).join(" · ") || "Diretório dos clubes";
}

/** "Vitória SC" e "vitoria sc" são o mesmo adversário. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
