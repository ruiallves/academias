import { useState } from "react";
import { cx, Pill } from "@/components/primitives";
import { mostrarErro, mostrarOk, textoDoErro } from "@/lib/avisos";
import { confirmarImportacao, corrigirMapeamento, type FolhaDaImportacao, type Importacao } from "@/lib/adjunto";
import { reloadAcademy } from "@/lib/store";

/**
 * O ensaio de uma importação: o que entra, o que já existe, o que falha, e o
 * que cada coluna é. Nada está gravado até "Importar".
 *
 * As dúvidas da IA (uma data que tanto é dia/mês como mês/dia) aparecem com
 * botões; cada botão corrige o mapeamento e ensaia outra vez. A coluna "Fica
 * em" é um menu, para a pessoa corrigir à mão o que a IA não acertou.
 */

const DESTINOS: { valor: string; rotulo: string }[] = [
  { valor: "ignorar", rotulo: "Não importar" },
  { valor: "name", rotulo: "Nome" },
  { valor: "firstName", rotulo: "Primeiro nome" },
  { valor: "lastName", rotulo: "Apelido" },
  { valor: "birthdate", rotulo: "Data de nascimento" },
  { valor: "team", rotulo: "Equipa" },
  { valor: "taxId", rotulo: "NIF" },
  { valor: "citizenCardNumber", rotulo: "N.º do CC" },
  { valor: "idDocLabel", rotulo: "Outro documento (nome)" },
  { valor: "idDocNumber", rotulo: "N.º do documento" },
  { valor: "email", rotulo: "Email do atleta" },
  { valor: "phone", rotulo: "Telemóvel do atleta" },
  { valor: "position", rotulo: "Posição" },
  { valor: "squadNumber", rotulo: "Número" },
  { valor: "licenseNumber", rotulo: "N.º de licença" },
  { valor: "medicalValidUntil", rotulo: "Exame médico válido até" },
  { valor: "heightCm", rotulo: "Altura (cm)" },
  { valor: "weightKg", rotulo: "Peso (kg)" },
  { valor: "dominantSide", rotulo: "Lado dominante" },
  { valor: "sex", rotulo: "Sexo" },
  { valor: "address", rotulo: "Morada" },
  { valor: "postalCode", rotulo: "Código postal" },
  { valor: "city", rotulo: "Localidade" },
  { valor: "guardian1Name", rotulo: "Encarregado 1" },
  { valor: "guardian1Email", rotulo: "Email do encarregado 1" },
  { valor: "guardian1Phone", rotulo: "Telemóvel do encarregado 1" },
  { valor: "guardian2Name", rotulo: "Encarregado 2" },
  { valor: "guardian2Email", rotulo: "Email do encarregado 2" },
  { valor: "guardian2Phone", rotulo: "Telemóvel do encarregado 2" },
];

const TRANSFORMACOES: Record<string, string> = {
  nenhuma: "",
  data_dmy: "dia/mês/ano",
  data_mdy: "mês/dia/ano",
  data_ymd: "ano/mês/dia",
  ano_de_nascimento: "só o ano",
  apelido_nome: "Apelido, Nome",
  numero: "número",
  sexo: "sexo",
  lado: "lado",
  sim_nao: "sim/não",
};

const ENTIDADES: Record<string, string> = {
  atletas: "Atletas",
  staff: "Staff",
  socios: "Sócios",
  calendario: "Calendário",
  inventario: "Inventário",
  ignorar: "Ignorada",
};

export function PainelImportacao({ imp }: { imp: Importacao }) {
  const [folhaAberta, setFolhaAberta] = useState(imp.folhas.find((f) => f.entidade === "atletas")?.nome ?? imp.folhas[0]?.nome ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [convites, setConvites] = useState(false);
  const [verExistentes, setVerExistentes] = useState(false);
  const [verErros, setVerErros] = useState(false);
  const folha = imp.folhas.find((f) => f.nome === folhaAberta) ?? imp.folhas[0];

  const patch = async (muda: (f: FolhaDaImportacao) => Partial<FolhaDaImportacao>) => {
    if (!folha) return;
    setOcupado(true);
    try {
      const mapping = {
        folhas: imp.folhas.map((f) => {
          const base = { nome: f.nome, entidade: f.entidade, confianca: f.confianca, colunas: f.colunas, equipas: f.equipas, duvidas: f.duvidas };
          return f.nome === folha.nome ? { ...base, ...muda(f) } : base;
        }),
        resumo: imp.resumo,
      };
      await corrigirMapeamento(imp.id, mapping);
    } catch (e) {
      mostrarErro(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async (sobrescrever: boolean) => {
    setOcupado(true);
    try {
      await confirmarImportacao(imp.id, { sobrescrever, enviarConvites: convites });
      mostrarOk("Importação feita.");
      await reloadAcademy();
    } catch (e) {
      mostrarErro(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  if (imp.status === "FAILED") {
    return (
      <section className="panel px-4 py-3.5">
        <div className="text-group text-ink-4 uppercase">Importação</div>
        <div className="mt-0.5 text-body font-semibold text-ink">{imp.fileName}</div>
        <div className="mt-1 text-body text-risk">{imp.error}</div>
      </section>
    );
  }

  if (imp.status === "IMPORTED") {
    const r = (imp.result ?? {}) as { folhas?: { nome: string; enviadas: number; resultado: { created: number; updated: number; errors: { row: number; name: string; error: string }[] } | null }[]; equipasCriadas?: string[] };
    return (
      <section className="panel overflow-hidden">
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
          <div>
            <div className="text-group text-ink-4 uppercase">Importação feita</div>
            <div className="mt-0.5 text-body font-semibold text-ink">{imp.fileName}</div>
          </div>
          <Pill tone="ok">Gravado</Pill>
        </header>
        <div className="border-t border-line px-4 py-3 text-body text-ink-2">
          {(r.folhas ?? []).map((f) => (
            <div key={f.nome}>
              Folha "{f.nome}": {f.resultado?.created ?? 0} novos{f.resultado?.updated ? `, ${f.resultado.updated} atualizados` : ""}{f.resultado?.errors.length ? `, ${f.resultado.errors.length} com erro` : ""}.
            </div>
          ))}
          {(r.equipasCriadas ?? []).length > 0 && <div className="mt-1 text-meta text-ink-3">Equipas criadas: {(r.equipasCriadas ?? []).join(", ")}.</div>}
        </div>
      </section>
    );
  }

  const e = folha?.ensaio ?? null;
  const atletas = imp.folhas.filter((f) => f.ensaio?.suportada);
  const totalEntram = atletas.reduce((n, f) => n + (f.ensaio?.entram ?? 0), 0);
  const totalExistem = atletas.reduce((n, f) => n + (f.ensaio?.jaExistiam ?? 0), 0);

  return (
    <section className="panel overflow-hidden" aria-label={`Ensaio da importação de ${imp.fileName}`}>
      <header className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <div className="text-group text-ink-4 uppercase">Ensaio · nada gravado ainda</div>
          <div className="mt-0.5 truncate text-body font-semibold text-ink">{imp.fileName}</div>
        </div>
        {imp.folhas.length > 1 && (
          <div className="scroll-x-clean flex gap-1.5 overflow-x-auto">
            {imp.folhas.map((f) => (
              <button
                key={f.nome}
                type="button"
                onClick={() => setFolhaAberta(f.nome)}
                className={cx("h-8 shrink-0 rounded-full border px-3 text-meta font-medium whitespace-nowrap", f.nome === folha?.nome ? "border-ink bg-ink text-surface" : "border-line-strong bg-surface text-ink")}
              >
                {f.nome} · {f.linhas}
              </button>
            ))}
          </div>
        )}
      </header>

      {folha && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-meta text-ink-3">
            <span>Esta folha:</span>
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">Entidade</span>
              <select
                value={folha.entidade}
                disabled={ocupado}
                onChange={(ev) => void patch(() => ({ entidade: ev.target.value }))}
                className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink"
              >
                {Object.entries(ENTIDADES).map(([v, r]) => (
                  <option key={v} value={v}>{r}</option>
                ))}
              </select>
            </label>
            {folha.entidade !== "atletas" && folha.entidade !== "ignorar" && <span>Por agora o Adjunto só importa atletas; esta folha fica mapeada para depois.</span>}
            <span className="ml-auto">Confiança da leitura: {folha.confianca}</span>
          </div>

          {e?.suportada && (
            <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
              <Numero rotulo="Entram novos" valor={e.entram} nota={e.entramEmEquipaNova ? `${e.entramEmEquipaNova} em equipa nova` : undefined} />
              <Numero rotulo="Já existiam" valor={e.jaExistiam} nota={e.jaExistiam ? "com dados a mudar" : undefined} />
              <Numero rotulo="Equipas novas" valor={e.equipasNovas.length} nota={e.equipasNovas.map((q) => q.name).join(", ") || undefined} />
              <Numero rotulo="Com problemas" valor={e.erros.length} tom={e.erros.length ? "risk" : undefined} nota={e.erros.length ? "ficam de fora" : undefined} />
            </div>
          )}

          {folha.duvidas.length > 0 && (
            <div className="flex flex-col gap-2.5 border-t border-line bg-warn-soft/40 px-4 py-3">
              {folha.duvidas.map((d) => (
                <div key={d.coluna} className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-ink">{d.texto}</span>
                  {d.opcoes.map((o) => (
                    <button
                      key={o.transformacao}
                      type="button"
                      disabled={ocupado}
                      onClick={() => void patch((f) => ({ colunas: f.colunas.map((c) => (c.origem === d.coluna ? { ...c, transformacao: o.transformacao } : c)), duvidas: f.duvidas.filter((x) => x.coluna !== d.coluna) }))}
                      className="ctl-outline h-8"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-line">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_96px] items-center gap-3 bg-sunken px-4 py-2 text-group text-ink-4 uppercase max-md:hidden">
              <span>No ficheiro</span><span>Exemplo</span><span>Fica em</span><span>Estado</span>
            </div>
            {folha.colunas.map((c) => {
              const i = folha.headers.indexOf(c.origem);
              const exemplo = folha.amostra.map((l) => l[i]).find((v) => v !== null && v !== undefined && v !== "");
              const duvida = folha.duvidas.some((d) => d.coluna === c.origem);
              return (
                <div key={c.origem} className="grid grid-cols-1 gap-1.5 border-t border-line px-4 py-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_96px] md:items-center md:gap-3">
                  <span className="truncate text-body font-medium text-ink">{c.origem}</span>
                  <span className="truncate font-mono text-meta text-ink-3">{exemplo === undefined ? "" : String(exemplo)}</span>
                  <span className="flex items-center gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Destino de {c.origem}</span>
                      <select
                        value={c.destino}
                        disabled={ocupado || folha.entidade !== "atletas"}
                        onChange={(ev) => void patch((f) => ({ colunas: f.colunas.map((x) => (x.origem === c.origem ? { ...x, destino: ev.target.value } : x)) }))}
                        className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink"
                      >
                        {DESTINOS.map((d) => (
                          <option key={d.valor} value={d.valor}>{d.rotulo}</option>
                        ))}
                        {!DESTINOS.some((d) => d.valor === c.destino) && <option value={c.destino}>{c.destino}</option>}
                      </select>
                    </label>
                    {TRANSFORMACOES[c.transformacao] && <span className="shrink-0 text-meta text-ink-3">{TRANSFORMACOES[c.transformacao]}</span>}
                  </span>
                  <span>{duvida ? <Pill tone="warn">Confirmar</Pill> : c.destino === "ignorar" ? <Pill tone="neutral">Ignorada</Pill> : <Pill tone="ok">Certo</Pill>}</span>
                </div>
              );
            })}
          </div>

          {e?.suportada && e.equipasNovas.length > 0 && (
            <div className="border-t border-line px-4 py-3 text-body text-ink-2">
              Equipas que não existem e ficam criadas ao importar: {e.equipasNovas.map((q) => `${q.name} (Sub-${q.maxAge}, ${q.sportName}, ${q.linhas} ${q.linhas === 1 ? "atleta" : "atletas"})`).join("; ")}.
              {folha.equipas.length > 0 && <span className="text-ink-3"> Correspondências: {folha.equipas.map((q) => `${q.origem} → ${q.destino}`).join(", ")}.</span>}
            </div>
          )}

          {e?.suportada && e.jaExistiam > 0 && (
            <div className="border-t border-line px-4 py-2.5">
              <button type="button" onClick={() => setVerExistentes((v) => !v)} className="text-body font-medium text-signal-ink">
                {verExistentes ? "Esconder" : "Ver"} os {e.jaExistiam} que já existiam
              </button>
              {verExistentes && (
                <ul className="mt-2 flex flex-col gap-1.5 text-meta text-ink-2">
                  {e.existentes.map((x) => (
                    <li key={x.line}>
                      Linha {x.line}: {x.name}{x.matchedName !== x.name ? ` (na ficha: ${x.matchedName})` : ""} · {x.changes.join("; ")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {e?.suportada && e.erros.length > 0 && (
            <div className="border-t border-line px-4 py-2.5">
              <button type="button" onClick={() => setVerErros((v) => !v)} className="text-body font-medium text-signal-ink">
                {verErros ? "Esconder" : "Ver"} as {e.erros.length} linhas com problemas
              </button>
              {verErros && (
                <ul className="mt-2 flex flex-col gap-1.5 text-meta text-ink-2">
                  {e.erros.map((x, i) => (
                    <li key={`${x.line}-${i}`}>
                      {x.line ? `Linha ${x.line}: ` : ""}{x.name ? `${x.name} · ` : ""}{x.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {atletas.length > 0 && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <label className="inline-flex items-center gap-2 text-meta text-ink-2">
            <input type="checkbox" checked={convites} onChange={(ev) => setConvites(ev.target.checked)} className="size-4 accent-[var(--color-signal)]" />
            Enviar o convite da app a quem tiver email
          </label>
          <div className="flex flex-wrap gap-2">
            {totalExistem > 0 && (
              <button type="button" disabled={ocupado} onClick={() => void confirmar(true)} className="ctl-outline h-9">
                Importar e atualizar os {totalExistem} que já existem
              </button>
            )}
            <button type="button" disabled={ocupado || totalEntram === 0} onClick={() => void confirmar(false)} className="ctl-primary h-9">
              Importar {totalEntram} {totalEntram === 1 ? "atleta" : "atletas"}{totalExistem ? " novos" : ""}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function Numero({ rotulo, valor, nota, tom }: { rotulo: string; valor: number; nota?: string; tom?: "risk" }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-meta text-ink-3">{rotulo}</div>
      <div className={cx("mt-0.5 text-metric tabular-nums", tom === "risk" ? "text-risk" : "text-ink")}>{valor}</div>
      {nota && <div className="truncate text-[11px] text-ink-3" title={nota}>{nota}</div>}
    </div>
  );
}
