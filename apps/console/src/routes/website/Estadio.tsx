import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Porta as IconePorta, Recinto as LandPlot, Trash2 } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Interruptor } from "@/components/definicoes/ui";
import { LADOS, MapaDoRecinto, comFracao, fracaoNoLado, moverBancada, recintoDePartida } from "@academia/ui/estadio";
import { useStore } from "@/lib/store";
import { guardarBilheteira, guardarConfig, guardarPrecos, novoId, useSite, type Bancada, type Lado, type Porta, type Recinto } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";

/**
 * O estádio visto de cima. O clube diz de que lado fica cada bancada e
 * quantos lugares tem; o desenho sai daí (ver `packages/ui/src/estadio.tsx`).
 *
 * O mapa é o editor: toca-se numa bancada para a escolher, arrasta-se para a
 * mudar de lado ou de posição, e arrasta-se o separador entre duas vizinhas
 * para repartir o lado (dois terços e um terço). O formulário ao lado faz o
 * mesmo por escrito, para quem prefere o teclado.
 */
export function Estadio() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [recintoId, setRecintoId] = useState<string | null>(site.recintos[0]?.id ?? null);
  const [bancadaId, setBancadaId] = useState<string | null>(null);
  const [apagar, setApagar] = useState<Recinto | null>(null);

  const recinto = site.recintos.find((r) => r.id === recintoId) ?? site.recintos[0] ?? null;
  const bancada = recinto?.bancadas.find((b) => b.id === bancadaId) ?? null;

  const mudarRecinto = (id: string, f: (r: Recinto) => Recinto) =>
    void guardarConfig({ recintos: site.recintos.map((r) => (r.id === id ? f(r) : r)) });

  const mudarBancada = (b: Bancada, f: (b: Bancada) => Bancada) =>
    recinto && mudarRecinto(recinto.id, (r) => ({ ...r, bancadas: r.bancadas.map((x) => (x.id === b.id ? f(x) : x)) }));

  const novoRecinto = () => {
    const id = novoId();
    const nome = site.recintos.length ? "Pavilhão" : "Estádio";
    void guardarConfig({ recintos: [...site.recintos, recintoDePartida(id, nome, novoId)] }, { imediato: true });
    setRecintoId(id);
    setBancadaId(null);
    mostrarOk(`${nome} criado com duas bancadas de partida.`);
  };

  const novaBancada = (lado: Lado) => {
    if (!recinto) return;
    const id = novoId();
    const ordem = Math.max(-1, ...recinto.bancadas.filter((b) => b.lado === lado).map((b) => b.ordem)) + 1;
    // Nunca sem nome: uma bancada sem nome era o que rebentava o mapa.
    const nomeDoLado =
      ({ norte: "Topo Norte", sul: "Topo Sul" } as Partial<Record<Lado, string>>)[lado] ?? LADOS.find((l) => l.key === lado)?.curto ?? "Bancada";
    mudarRecinto(recinto.id, (r) => ({ ...r, bancadas: [...r.bancadas, { id, nome: nomeDoLado, lado, ordem, peso: 1, lotacao: null, coberta: false }] }));
    setBancadaId(id);
  };

  /** Troca a bancada com a vizinha do mesmo lado. */
  const mover = (b: Bancada, delta: -1 | 1) => {
    if (!recinto) return;
    const doLado = recinto.bancadas.filter((x) => x.lado === b.lado).sort((x, y) => x.ordem - y.ordem);
    const i = doLado.findIndex((x) => x.id === b.id);
    const outra = doLado[i + delta];
    if (!outra) return;
    mudarRecinto(recinto.id, (r) => ({
      ...r,
      bancadas: r.bancadas.map((x) => (x.id === b.id ? { ...x, ordem: outra.ordem } : x.id === outra.id ? { ...x, ordem: b.ordem } : x)),
    }));
  };

  if (!recinto) {
    return (
      <Empty icon={LandPlot} title="Ainda não há recintos" detail="Desenha o estádio visto de cima. Na bilheteira cada bilhete fica ligado a uma bancada, e quem compra vê no mapa onde vai ficar.">
        <button type="button" className="ctl-primary" onClick={novoRecinto}>
          <Plus className="size-4" strokeWidth={2} />
          Desenhar o estádio
        </button>
      </Empty>
    );
  }

  const total = recinto.bancadas.reduce((s, b) => s + (b.lotacao ?? 0), 0);
  const semLotacao = recinto.bancadas.some((b) => b.lotacao == null);
  const doLado = bancada ? recinto.bancadas.filter((x) => x.lado === bancada.lado).sort((x, y) => x.ordem - y.ordem) : [];
  const posicao = bancada ? doLado.findIndex((x) => x.id === bancada.id) : -1;

  return (
    <div className="space-y-5">
      {/* Os recintos do clube, em separadores. */}
      <div className="flex flex-wrap items-center gap-2">
        {site.recintos.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={r.id === recinto.id}
            onClick={() => {
              setRecintoId(r.id);
              setBancadaId(null);
            }}
            className={cx(
              "h-9 rounded-full border px-3.5 text-meta font-medium transition-colors",
              r.id === recinto.id ? "border-signal/30 bg-signal-soft text-signal-ink" : "border-line text-ink-2 hover:border-line-strong",
            )}
          >
            {r.nome}
          </button>
        ))}
        <button type="button" className="ctl-ghost" onClick={novoRecinto}>
          <Plus className="size-4" strokeWidth={2} />
          Outro recinto
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* O mapa. */}
        <div>
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface p-3">
            <MapaDoRecinto
              recinto={recinto}
              className="w-full"
              selecionada={bancadaId}
              onEscolher={(id) => setBancadaId(id === bancadaId ? null : id)}
              onMudar={(r) => mudarRecinto(recinto.id, () => r)}
              rotulo={(b) => (b.lotacao ? `${b.lotacao.toLocaleString("pt-PT")} lugares` : undefined)}
            />
          </div>
          <p className="mt-2 text-meta text-ink-3">
            {recinto.bancadas.length} {recinto.bancadas.length === 1 ? "bancada" : "bancadas"}
            {total > 0 && ` · ${total.toLocaleString("pt-PT")} lugares`}
            {semLotacao && recinto.bancadas.length > 0 && " · há bancadas sem lotação"}
          </p>
          <ul className="mt-2 space-y-1 text-meta text-ink-3">
            <li>Toca numa bancada para a editar.</li>
            <li>Arrasta uma bancada para a levar para outro lado, para um canto, ou para outra posição.</li>
            <li>Arrasta a pega entre duas bancadas do mesmo lado para repartir o espaço.</li>
          </ul>
        </div>

        {/* O recinto e a bancada escolhida. */}
        <div className="space-y-5">
          <div className="space-y-3 rounded-[12px] border border-line bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <label htmlFor="recinto-nome" className="mb-1.5 block text-meta font-medium text-ink-2">
                  Nome do recinto
                </label>
                <input
                  id="recinto-nome"
                  className={dialogInputClass}
                  value={recinto.nome}
                  onChange={(e) => mudarRecinto(recinto.id, (r) => ({ ...r, nome: e.target.value }))}
                />
              </div>
              <div>
                <p className="mb-1.5 text-meta font-medium text-ink-2">Tipo</p>
                <div className="flex gap-1" role="radiogroup" aria-label="Tipo de recinto">
                  {(["campo", "pavilhao"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={recinto.tipo === t}
                      onClick={() => mudarRecinto(recinto.id, (r) => ({ ...r, tipo: t }))}
                      className={cx(
                        "h-9 rounded-[var(--radius-control)] border px-3 text-meta font-medium",
                        recinto.tipo === t ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-line-strong",
                      )}
                    >
                      {t === "campo" ? "Campo" : "Pavilhão"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-meta font-medium text-ink-2">Acrescentar bancada</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {LADOS.map((l) => (
                  <button key={l.key} type="button" title={l.nome} className="ctl-outline justify-center" onClick={() => novaBancada(l.key)}>
                    <Plus className="size-3.5" strokeWidth={2} />
                    {l.curto}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {bancada ? (
            <div className="space-y-3 rounded-[12px] border border-signal-line/40 bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-panel text-ink">Bancada</h3>
                <div className="flex items-center gap-1">
                  <button type="button" className="ctl-ghost size-9 justify-center px-0" disabled={posicao <= 0} aria-label="Mover para antes" onClick={() => mover(bancada, -1)}>
                    <ChevronLeft className="size-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="ctl-ghost size-9 justify-center px-0"
                    disabled={posicao < 0 || posicao >= doLado.length - 1}
                    aria-label="Mover para depois"
                    onClick={() => mover(bancada, 1)}
                  >
                    <ChevronRight className="size-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="ctl-ghost size-9 justify-center px-0 text-risk"
                    aria-label={`Tirar ${bancada.nome}`}
                    onClick={() => {
                      // A bancada sai também das portas por onde entrava.
                      mudarRecinto(recinto.id, (r) => ({
                        ...r,
                        bancadas: r.bancadas.filter((x) => x.id !== bancada.id),
                        portas: (r.portas ?? []).map((p) => ({ ...p, bancadaIds: p.bancadaIds.filter((id) => id !== bancada.id) })),
                      }));
                      setBancadaId(null);
                      mostrarOk(`${bancada.nome} tirada.`);
                    }}
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="bancada-nome" className="mb-1.5 block text-meta font-medium text-ink-2">
                  Nome
                </label>
                <input id="bancada-nome" className={dialogInputClass} value={bancada.nome} onChange={(e) => mudarBancada(bancada, (b) => ({ ...b, nome: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="bancada-lado" className="mb-1.5 block text-meta font-medium text-ink-2">
                    Lado
                  </label>
                  <select
                    id="bancada-lado"
                    className={dialogInputClass}
                    value={bancada.lado}
                    onChange={(e) => {
                      const lado = e.target.value as Lado;
                      // Vai para o fim do lado novo, com o tamanho médio das que lá estão.
                      mudarRecinto(recinto.id, (r) => moverBancada(r, bancada.id, lado, Number.MAX_SAFE_INTEGER));
                    }}
                  >
                    {LADOS.map((l) => (
                      <option key={l.key} value={l.key}>
                        {l.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="bancada-lotacao" className="mb-1.5 block text-meta font-medium text-ink-2">
                    Lugares
                  </label>
                  <input
                    id="bancada-lotacao"
                    className={dialogInputClass}
                    inputMode="numeric"
                    placeholder="Sem limite"
                    value={bancada.lotacao ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      mudarBancada(bancada, (b) => ({ ...b, lotacao: v ? Number(v) : null }));
                    }}
                  />
                </div>
              </div>
              {doLado.length > 1 && <TamanhoNoLado recinto={recinto} bancada={bancada} onMudar={(r) => mudarRecinto(recinto.id, () => r)} />}
              <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2.5">
                <span className="text-body text-ink">Coberta</span>
                <Interruptor ligado={bancada.coberta} onChange={() => mudarBancada(bancada, (b) => ({ ...b, coberta: !b.coberta }))} label="Bancada coberta" />
              </div>
            </div>
          ) : (
            <p className="rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-meta text-ink-3">
              Escolhe uma bancada no mapa para lhe mudar o nome, o lado e os lugares.
            </p>
          )}

          <Portas recinto={recinto} onMudar={(f) => mudarRecinto(recinto.id, f)} />

          {site.recintos.length > 1 && (
            <button type="button" className="ctl-ghost text-risk" onClick={() => setApagar(recinto)}>
              <Trash2 className="size-4" strokeWidth={1.75} />
              Apagar {recinto.nome}
            </button>
          )}
        </div>
      </div>

      {apagar && (
        <ConfirmDialog
          title={`Apagar ${apagar.nome}?`}
          onClose={() => setApagar(null)}
          onConfirm={async () => {
            await guardarConfig({ recintos: site.recintos.filter((r) => r.id !== apagar.id) }, { imediato: true });
            // Os preços por omissão do recinto apagado deixam de ter onde se aplicar.
            if (site.precosBilheteira[apagar.id]) {
              const { [apagar.id]: _fora, ...resto } = site.precosBilheteira;
              void _fora;
              await guardarPrecos(resto).catch(() => undefined);
            }
            // Os jogos que se jogavam aqui ficam sem mapa e com a venda fechada: um bilhete sem bancada não se vende.
            for (const [matchId, b] of Object.entries(site.bilheteira)) {
              if (b.recintoId !== apagar.id) continue;
              await guardarBilheteira(matchId, { ...b, aberta: false, recintoId: null, tipos: b.tipos.map((t) => ({ ...t, bancadaId: null })) }).catch(() => undefined);
            }
            setRecintoId(null);
            setBancadaId(null);
            setApagar(null);
            mostrarOk("Recinto apagado.");
          }}
        >
          Os jogos com bilheteira neste recinto ficam sem mapa e com a venda fechada, até lhes escolheres outro recinto. Os lugares anuais neste recinto deixam de
          contar.
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * Quanto do lado a bancada ocupa, em percentagem, mais três atalhos para as
 * divisões que os clubes pedem (metade, dois terços, três quartos). As
 * outras bancadas do lado repartem o resto na proporção em que estavam.
 *
 * O texto é um rascunho: grava ao sair do campo ou com Enter, para escrever
 * "66" não passar por "6" e esmagar as vizinhas pelo caminho.
 */
function TamanhoNoLado({ recinto, bancada, onMudar }: { recinto: Recinto; bancada: Bancada; onMudar: (r: Recinto) => void }) {
  const atual = Math.round(fracaoNoLado(recinto, bancada.id) * 100);
  const [texto, setTexto] = useState<string | null>(null);

  const aplicar = (pct: number) => onMudar(comFracao(recinto, bancada.id, pct / 100));
  const gravar = () => {
    if (texto == null) return;
    const v = Number(texto.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100) aplicar(v);
    setTexto(null);
  };

  return (
    <div>
      <label htmlFor="bancada-tamanho" className="mb-1.5 block text-meta font-medium text-ink-2">
        Tamanho no lado
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-24">
          <input
            id="bancada-tamanho"
            className={cx(dialogInputClass, "pr-7 text-right tabular-nums")}
            inputMode="numeric"
            value={texto ?? String(atual)}
            onChange={(e) => setTexto(e.target.value.replace(/[^\d,.]/g, ""))}
            onBlur={gravar}
            onKeyDown={(e) => e.key === "Enter" && gravar()}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-meta text-ink-3">%</span>
        </div>
        {[
          { l: "1/3", v: 100 / 3 },
          { l: "1/2", v: 50 },
          { l: "2/3", v: 200 / 3 },
          { l: "3/4", v: 75 },
        ].map((o) => (
          <button
            key={o.l}
            type="button"
            onClick={() => aplicar(o.v)}
            aria-pressed={Math.abs(atual - o.v) < 1}
            className={cx(
              "h-9 rounded-full border px-3 text-meta font-medium tabular-nums transition-colors",
              Math.abs(atual - o.v) < 1 ? "border-signal/30 bg-signal-soft text-signal-ink" : "border-line text-ink-2 hover:border-line-strong",
            )}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * As portas do recinto e as bancadas que entram por cada uma.
 *
 * O leitor dos seguranças abre numa porta e só aceita os bilhetes das bancadas
 * dela; um bilhete na porta errada diz qual é a certa. Um clube pequeno não
 * precisa disto: sem portas, há uma entrada só ("Todas as portas") e o leitor
 * aceita tudo. Uma bancada pode entrar por mais de uma porta (a central com
 * duas entradas, por exemplo).
 *
 * Grava como o resto do recinto, pelo `guardarConfig`: as portas vivem dentro
 * do recinto (`SiteConfig.venues[].portas`).
 */
function Portas({ recinto, onMudar }: { recinto: Recinto; onMudar: (f: (r: Recinto) => Recinto) => void }) {
  const [apagar, setApagar] = useState<Porta | null>(null);
  const portas = recinto.portas ?? [];
  const comPorta = new Set(portas.flatMap((p) => p.bancadaIds));
  const semPorta = recinto.bancadas.filter((b) => !comPorta.has(b.id));
  // O servidor guarda até 20 portas por recinto.
  const MAX = 20;

  const mudarPorta = (id: string, f: (p: Porta) => Porta) => onMudar((r) => ({ ...r, portas: (r.portas ?? []).map((p) => (p.id === id ? f(p) : p)) }));

  /** A porta nova leva as bancadas que ainda não tinham porta: a primeira fica logo com o recinto todo. */
  const nova = () =>
    onMudar((r) => {
      const atuais = r.portas ?? [];
      const usadas = new Set(atuais.flatMap((p) => p.bancadaIds));
      const nome = `Porta ${atuais.length < 26 ? String.fromCharCode(65 + atuais.length) : atuais.length + 1}`;
      return { ...r, portas: [...atuais, { id: novoId(), nome, bancadaIds: r.bancadas.filter((b) => !usadas.has(b.id)).map((b) => b.id) }] };
    });

  const alternarBancada = (p: Porta, bancadaId: string) =>
    mudarPorta(p.id, (x) => ({ ...x, bancadaIds: x.bancadaIds.includes(bancadaId) ? x.bancadaIds.filter((id) => id !== bancadaId) : [...x.bancadaIds, bancadaId] }));

  return (
    <div className="space-y-3 rounded-[12px] border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-panel text-ink">
          <IconePorta className="size-4 text-ink-3" strokeWidth={1.75} />
          Portas
        </h3>
        <button type="button" className="ctl-ghost" onClick={nova} disabled={portas.length >= MAX}>
          <Plus className="size-4" strokeWidth={2} />
          Nova porta
        </button>
      </div>
      <p className="text-meta leading-relaxed text-ink-3">
        O leitor dos seguranças abre numa porta e só aceita os bilhetes das bancadas dela. Uma bancada pode entrar por mais de uma porta.
      </p>

      {portas.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line-strong px-3 py-4 text-center text-meta text-ink-3">
          Sem portas, o leitor tem uma entrada só, Todas as portas, e aceita os bilhetes de todas as bancadas.
        </p>
      ) : (
        <ul className="space-y-2">
          {portas.map((p) => (
            <li key={p.id} className="space-y-2.5 rounded-[10px] border border-line p-3">
              <div className="flex items-center gap-2">
                <input
                  className={dialogInputClass}
                  aria-label="Nome da porta"
                  placeholder="Porta A, Portão Norte…"
                  maxLength={60}
                  value={p.nome}
                  onChange={(e) => mudarPorta(p.id, (x) => ({ ...x, nome: e.target.value }))}
                />
                <button type="button" className="ctl-ghost size-9 shrink-0 justify-center px-0 text-risk" aria-label={`Apagar ${p.nome}`} onClick={() => setApagar(p)}>
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </div>
              {recinto.bancadas.length === 0 ? (
                <p className="text-meta text-ink-3">O recinto ainda não tem bancadas.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Bancadas que entram pela ${p.nome}`}>
                  {recinto.bancadas.map((b) => {
                    const dentro = p.bancadaIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={dentro}
                        onClick={() => alternarBancada(p, b.id)}
                        className={cx(
                          "h-8 rounded-full border px-3 text-meta font-medium transition-colors",
                          dentro ? "border-signal/30 bg-signal-soft text-signal-ink" : "border-line text-ink-3 hover:border-line-strong",
                        )}
                      >
                        {b.nome || "Sem nome"}
                      </button>
                    );
                  })}
                </div>
              )}
              {p.bancadaIds.length === 0 && recinto.bancadas.length > 0 && (
                <p className="text-meta text-warn">Sem bancadas, esta porta não deixa entrar ninguém. Escolhe as bancadas que entram por ela.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {portas.length > 0 && semPorta.length > 0 && (
        <p className="rounded-[8px] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-warn">
          Sem porta: {semPorta.map((b) => b.nome || "Sem nome").join(", ")}. Os bilhetes {semPorta.length === 1 ? "desta bancada" : "destas bancadas"} só entram pelo leitor
          de Todas as portas.
        </p>
      )}

      {apagar && (
        <ConfirmDialog
          title={`Apagar ${apagar.nome || "a porta"}?`}
          onClose={() => setApagar(null)}
          onConfirm={() => {
            onMudar((r) => ({ ...r, portas: (r.portas ?? []).filter((x) => x.id !== apagar.id) }));
            setApagar(null);
            mostrarOk("Porta apagada.");
          }}
        >
          Os acessos de segurança já criados para esta porta deixam de aceitar bilhetes. Os bilhetes continuam a valer pelas outras portas da bancada, ou pelo
          leitor de Todas as portas.
        </ConfirmDialog>
      )}
    </div>
  );
}
