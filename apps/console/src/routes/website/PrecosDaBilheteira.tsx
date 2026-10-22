import { useState } from "react";
import { Ticket } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { mostrarOk } from "@/lib/avisos";
import { guardarPrecos, novoId, type CategoriaDeSocio, type ParaQuem, type Recinto, type TipoDeBilhete } from "@/lib/website";

/**
 * Os preços da bilheteira em grelha: uma linha por bancada, uma coluna por
 * público (o público geral, qualquer sócio, e cada categoria de sócio).
 *
 * ## Porquê uma grelha e não uma lista de tipos
 *
 * Um tipo de bilhete é sempre "um preço, numa bancada, para um público". Uma
 * lista de tipos soltos deixava escrever dois preços de público para a mesma
 * bancada, ou esquecer uma bancada, e só se via o buraco no site. Na grelha
 * cada combinação tem uma célula, e o que falta vê-se.
 *
 * Uma célula vazia quer dizer "não se vende a este público nesta bancada": é
 * assim que se faz uma bancada só de sócios, ou um preço só para uma
 * categoria. Os nomes dos tipos geram-se ("Norte · Público", "Norte · Sócio
 * Efetivo"), que é o que aparece no bilhete e na lista de vendas.
 *
 * Os ids dos tipos mantêm-se de uma gravação para a outra: as vendas contam-se
 * por tipo, e um id novo a cada gravação partia a contagem de um jogo a meio.
 */

/** Uma coluna da grelha: um público. */
export type Coluna = { key: string; rotulo: string; curto: string; para: ParaQuem; tierId: string | null };

/** Uma linha da grelha: uma bancada (ou "qualquer lugar", nos tipos antigos sem bancada). */
export type LinhaDaGrelha = { id: string | null; nome: string };

/** O que se escreveu em cada célula, com o id do tipo que lá estava. */
export type Grelha = Record<string, { id: string; texto: string }>;

const colunaDoTipo = (t: Pick<TipoDeBilhete, "para" | "tierId">) => (t.para === "publico" ? "publico" : t.tierId ? `tier:${t.tierId}` : "socios");
const chave = (bancadaId: string | null, coluna: string) => `${bancadaId ?? ""}|${coluna}`;

/**
 * As colunas: público, qualquer sócio, e uma por categoria. Uma categoria que
 * já não está na lista (arquivada) mas tem preços ganha coluna à mesma, para
 * esses preços não desaparecerem sem ninguém os ver.
 */
export function colunasDe(categorias: CategoriaDeSocio[], tipos: TipoDeBilhete[] = []): Coluna[] {
  const conhecidas = new Set(categorias.map((c) => c.id));
  const orfas = [...new Set(tipos.flatMap((t) => (t.para === "socios" && t.tierId && !conhecidas.has(t.tierId) ? [t.tierId] : [])))];
  return [
    { key: "publico", rotulo: "Público geral", curto: "Público", para: "publico", tierId: null },
    { key: "socios", rotulo: "Sócio (qualquer categoria)", curto: "Sócio", para: "socios", tierId: null },
    ...categorias.map((c) => ({ key: `tier:${c.id}`, rotulo: `Sócio ${c.nome}`, curto: `Sócio ${c.nome}`, para: "socios" as const, tierId: c.id })),
    ...orfas.map((id) => ({ key: `tier:${id}`, rotulo: "Categoria arquivada", curto: "Sócio", para: "socios" as const, tierId: id })),
  ];
}

/** As linhas: as bancadas do recinto, ou uma só sem bancada. */
export function linhasDe(recinto: Recinto | null): LinhaDaGrelha[] {
  return recinto?.bancadas.length ? recinto.bancadas.map((b) => ({ id: b.id, nome: b.nome || "Sem nome" })) : [{ id: null, nome: "Qualquer lugar" }];
}

const comVirgula = (n: number) => String(n).replace(".", ",");

/**
 * Os tipos em grelha. `foraDaGrelha` conta os que não cabem: dois preços para
 * o mesmo público na mesma bancada (os jogos de antes da grelha tinham "Geral"
 * e "Até 16 anos"), ou bancadas que já não são deste recinto. Ao gravar fica o
 * primeiro de cada célula.
 */
export function grelhaDe(tipos: TipoDeBilhete[], linhas: LinhaDaGrelha[], colunas: Coluna[]): { grelha: Grelha; foraDaGrelha: number } {
  const grelha: Grelha = {};
  const linhasOk = new Set(linhas.map((l) => l.id ?? ""));
  const colunasOk = new Set(colunas.map((c) => c.key));
  let foraDaGrelha = 0;
  for (const t of tipos) {
    const k = chave(t.bancadaId, colunaDoTipo(t));
    if (!linhasOk.has(t.bancadaId ?? "") || !colunasOk.has(colunaDoTipo(t)) || grelha[k]) {
      foraDaGrelha++;
      continue;
    }
    grelha[k] = { id: t.id, texto: comVirgula(t.preco) };
  }
  return { grelha, foraDaGrelha };
}

/** O preço de uma célula, em euros. Nulo = vazia; NaN = escrita mal. */
function precoDe(texto: string): number | null {
  const s = texto.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const n = Number(s);
  return n > 10_000 ? Number.NaN : n;
}

export const celulaValida = (texto: string) => !Number.isNaN(precoDe(texto) ?? 0);

export function grelhaValida(g: Grelha): boolean {
  return Object.values(g).every((c) => celulaValida(c.texto));
}

/** De volta a tipos, com os nomes gerados. Só as células escritas. */
export function tiposDe(g: Grelha, linhas: LinhaDaGrelha[], colunas: Coluna[]): TipoDeBilhete[] {
  const tipos: TipoDeBilhete[] = [];
  const umaSoLinha = linhas.length === 1 && linhas[0].id === null;
  for (const l of linhas) {
    for (const c of colunas) {
      const celula = g[chave(l.id, c.key)];
      const preco = celula ? precoDe(celula.texto) : null;
      if (preco === null || Number.isNaN(preco)) continue;
      tipos.push({
        id: celula!.id,
        // O servidor guarda até 60 caracteres no nome.
        nome: (umaSoLinha ? c.curto : `${l.nome} · ${c.curto}`).slice(0, 60),
        preco,
        bancadaId: l.id,
        para: c.para,
        tierId: c.tierId,
      });
    }
  }
  return tipos;
}

export const contarPrecos = (g: Grelha) => Object.values(g).filter((c) => precoDe(c.texto) !== null).length;

/**
 * A grelha desenhada. Rola de lado quando há muitas categorias: a primeira
 * coluna (a bancada) fica presa à esquerda para se saber sempre em que linha
 * se está.
 */
export function GrelhaDePrecos({
  linhas,
  colunas,
  grelha,
  onChange,
  realce,
  soLeitura,
}: {
  linhas: LinhaDaGrelha[];
  colunas: Coluna[];
  grelha: Grelha;
  onChange: (g: Grelha) => void;
  /** A bancada escolhida no mapa, para a linha se destacar. */
  realce?: string | null;
  soLeitura?: boolean;
}) {
  const escrever = (bancadaId: string | null, coluna: string, texto: string) => {
    const k = chave(bancadaId, coluna);
    onChange({ ...grelha, [k]: { id: grelha[k]?.id ?? novoId(), texto } });
  };

  return (
    <div className="overflow-x-auto rounded-[10px] border border-line">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="bg-sunken/50">
            <th scope="col" className="sticky left-0 z-[1] min-w-[120px] bg-sunken px-3 py-2 text-left text-meta font-medium text-ink-2">
              Bancada
            </th>
            {colunas.map((c) => (
              <th key={c.key} scope="col" className="min-w-[104px] px-2 py-2 text-right text-meta font-medium text-ink-2">
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id ?? "qualquer"} className={cx("border-t border-line", realce && l.id === realce && "bg-signal-soft/50")}>
              <th scope="row" className="sticky left-0 z-[1] bg-surface px-3 py-1.5 text-left text-body font-medium text-ink">
                {l.nome}
              </th>
              {colunas.map((c) => {
                const texto = grelha[chave(l.id, c.key)]?.texto ?? "";
                const ok = celulaValida(texto);
                return (
                  <td key={c.key} className="px-2 py-1.5">
                    <div className="relative">
                      <input
                        className={cx(dialogInputClass, "pr-6 text-right tabular-nums placeholder:text-ink-4", !ok && "border-risk")}
                        aria-label={`Preço para ${c.rotulo} na bancada ${l.nome}, em euros`}
                        aria-invalid={!ok || undefined}
                        inputMode="decimal"
                        placeholder="Não vende"
                        disabled={soLeitura}
                        value={texto}
                        onChange={(e) => escrever(l.id, c.key, e.target.value)}
                      />
                      {texto.trim() && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-meta text-ink-3">€</span>}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A legenda por baixo da grelha: a mesma nos dois sítios onde ela aparece. */
export function LegendaDaGrelha() {
  return (
    <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
      Uma célula vazia não vende a esse público nessa bancada. 0 € é um bilhete gratuito. Um sócio com a quota em dia vê os preços do público, os de qualquer
      sócio e os da sua categoria, e leva um bilhete de sócio por jogo.
    </p>
  );
}

/**
 * Os preços por omissão: o que um jogo novo em cada recinto traz. Mudam-se
 * depois jogo a jogo, na bilheteira de cada um; mudar aqui não mexe nos jogos
 * que já têm preços.
 */
export function PrecosPorOmissao({
  recintos,
  precos,
  categorias,
  onClose,
  onIrParaEstadio,
}: {
  recintos: Recinto[];
  precos: Record<string, TipoDeBilhete[]>;
  categorias: CategoriaDeSocio[];
  onClose: () => void;
  onIrParaEstadio: () => void;
}) {
  const [recintoId, setRecintoId] = useState(recintos[0]?.id ?? "");
  // Uma grelha por recinto: trocar de recinto no seletor não perde o que se escreveu no outro.
  const [grelhas, setGrelhas] = useState<Record<string, Grelha>>({});
  const [aGravar, setAGravar] = useState(false);

  const recinto = recintos.find((r) => r.id === recintoId) ?? null;
  const tiposDoRecinto = (r: Recinto) => precos[r.id] ?? [];
  const colunasDo = (r: Recinto) => colunasDe(categorias, tiposDoRecinto(r));
  const grelhaDo = (r: Recinto) => grelhas[r.id] ?? grelhaDe(tiposDoRecinto(r), linhasDe(r), colunasDo(r)).grelha;

  const tudoValido = recintos.every((r) => grelhaValida(grelhaDo(r)));

  const gravar = async () => {
    setAGravar(true);
    try {
      const porRecinto: Record<string, TipoDeBilhete[]> = {};
      for (const r of recintos) porRecinto[r.id] = grelhas[r.id] ? tiposDe(grelhas[r.id], linhasDe(r), colunasDo(r)) : tiposDoRecinto(r);
      await guardarPrecos(porRecinto);
      mostrarOk("Preços por omissão guardados.");
      onClose();
    } catch {
      // O erro aparece no cartão de erros; o diálogo fica aberto com o que se escreveu.
    } finally {
      setAGravar(false);
    }
  };

  return (
    <Dialog
      title="Preços por omissão"
      subtitle="O que um jogo novo traz. Depois mudam-se jogo a jogo."
      icon={<Ticket className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={860}
      footer={
        recinto ? (
          <>
            <button type="button" className="ctl-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="ctl-primary" disabled={!tudoValido || aGravar} onClick={() => void gravar()}>
              Guardar
            </button>
          </>
        ) : undefined
      }
    >
      {!recinto ? (
        <Empty icon={Ticket} title="Ainda não há recintos" detail="Os preços são por bancada. Desenha primeiro o estádio, com as bancadas." compact>
          <button
            type="button"
            className="ctl-primary"
            onClick={() => {
              onClose();
              onIrParaEstadio();
            }}
          >
            Desenhar o estádio
          </button>
        </Empty>
      ) : (
        <div className="space-y-4 px-5 py-4">
          {recintos.length > 1 && (
            <DialogField label="Recinto">
              <select className={dialogInputClass} value={recinto.id} onChange={(e) => setRecintoId(e.target.value)}>
                {recintos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                  </option>
                ))}
              </select>
            </DialogField>
          )}
          {recinto.bancadas.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-center text-meta text-ink-3">
              {recinto.nome} ainda não tem bancadas. Acrescenta-as no Estádio.
            </p>
          ) : (
            <div>
              <GrelhaDePrecos
                linhas={linhasDe(recinto)}
                colunas={colunasDo(recinto)}
                grelha={grelhaDo(recinto)}
                onChange={(g) => setGrelhas({ ...grelhas, [recinto.id]: g })}
              />
              <LegendaDaGrelha />
            </div>
          )}
          {categorias.length === 0 && (
            <p className="text-meta text-ink-3">O clube ainda não tem categorias de sócio. Com elas, cada categoria pode ter um preço próprio (nas Definições, Sócios).</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
