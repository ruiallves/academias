import { useMemo, useState } from "react";
import { cx } from "@/components/primitives";
import { mostrarErro, textoDoErro } from "@/lib/avisos";
import { enviarFormulario, type CampoDoFormulario, type Formulario as FormularioDoAdjunto } from "@/lib/adjunto";

/**
 * O formulário de uma ação, no meio da conversa.
 *
 * ## Porque é que existe
 *
 * O Adjunto não assume nada: "um jogo sábado às 4 contra os Amigos de
 * Quinchães" não diz o campo, a prova nem o balneário, e um modelo que os
 * escolhe sozinho marca o jogo errado. Em vez de perguntar um a um, mostra
 * todos os campos da ação de uma vez: o que a pessoa disse já preenchido, o
 * que falta à vista, com as escolhas do clube (equipas, locais, balneários,
 * provas) em listas. As sugestões (o local habitual da equipa, a hora de fim)
 * aparecem como sugestão: só ficam se a pessoa carregar nelas.
 *
 * Enviar não grava: dá o cartão de sempre, para confirmar.
 */
export function Formulario({
  formulario,
  messageId,
  enviado,
  compacto,
  onEnviar,
  onCancelar,
  embutido,
}: {
  formulario: FormularioDoAdjunto;
  messageId?: string;
  enviado?: boolean;
  compacto?: boolean;
  /** Em vez de criar uma proposta nova, faz isto (o "Editar" de um cartão). */
  onEnviar?: (valores: Record<string, string>) => Promise<void>;
  onCancelar?: () => void;
  /** Dentro de um cartão: sem moldura nem cabeçalho próprios. */
  embutido?: boolean;
}) {
  const inicial = useMemo(() => Object.fromEntries(formulario.campos.map((c) => [c.nome, c.valor ?? ""])), [formulario]);
  const [valores, setValores] = useState<Record<string, string>>(inicial);
  const [aEnviar, setAEnviar] = useState(false);
  const [feito, setFeito] = useState(Boolean(enviado));

  // Um campo condicional (balneários só em casa) só aparece, e só conta, com a condição cumprida.
  const visivel = (c: CampoDoFormulario) => !c.soSe || (valores[c.soSe.campo] ?? "") === c.soSe.igual;
  const campos = formulario.campos.filter(visivel);
  const faltam = campos.filter((c) => c.obrigatorio && !(valores[c.nome] ?? "").trim());
  const campoLocal = formulario.campos.find((c) => c.tipo === "local");
  const locaisDoClube = new Set((campoLocal?.opcoes ?? []).map((o) => o.valor));
  const mudar = (nome: string, valor: string) =>
    setValores((v) => {
      const novo = { ...v, [nome]: valor };
      /*
       * Casa ou fora muda o que o local é: em casa, um dos campos do clube; fora,
       * o campo do adversário, escrito. Trocar limpa o local que deixou de fazer
       * sentido (um campo do clube num jogo fora, ou uma morada num jogo em casa).
       */
      if (nome === "casa" && campoLocal) {
        const local = v[campoLocal.nome] ?? "";
        if (valor === "não" && locaisDoClube.has(local)) novo[campoLocal.nome] = "";
        if (valor === "sim" && local && !locaisDoClube.has(local)) novo[campoLocal.nome] = "";
      }
      return novo;
    });
  const fora = (valores.casa ?? "") === "não";

  const enviar = async () => {
    if (faltam.length) {
      mostrarErro(`Falta preencher: ${faltam.map((c) => c.rotulo.toLowerCase()).join(", ")}`);
      return;
    }
    setAEnviar(true);
    try {
      // Os campos escondidos (fora de condição) vão vazios: não se aplicam.
      const enviados = Object.fromEntries(formulario.campos.map((c) => [c.nome, visivel(c) ? (valores[c.nome] ?? "") : ""]));
      if (onEnviar) {
        await onEnviar(enviados);
        return;
      }
      await enviarFormulario(messageId ?? "", formulario, enviados);
      setFeito(true);
    } catch (e) {
      mostrarErro(textoDoErro(e));
    } finally {
      setAEnviar(false);
    }
  };

  return (
    <section className={cx(embutido ? "border-t border-line" : "panel overflow-hidden", !feito && !embutido && "border-signal-line")} aria-label={formulario.titulo}>
      {!embutido && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-group text-ink-4 uppercase">Faltam dados</div>
            <div className="text-body font-semibold text-ink">{formulario.titulo}</div>
          </div>
          {feito && <span className="text-meta text-ink-3">Enviado</span>}
        </header>
      )}

      <fieldset disabled={feito || aEnviar} className={cx("grid gap-x-3 gap-y-3 px-3.5 py-3", compacto ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
        {campos.map((c) =>
          c.tipo === "local" ? (
            <CampoLocal key={c.nome} campo={c} valor={valores[c.nome] ?? ""} onChange={(v) => mudar(c.nome, v)} fora={fora} temCasaFora={formulario.campos.some((x) => x.nome === "casa")} casaEscolhida={(valores.casa ?? "") !== ""} />
          ) : (
            <CampoDoForm key={c.nome} campo={c} valor={valores[c.nome] ?? ""} onChange={(v) => mudar(c.nome, v)} largo={c.tipo === "textoLongo" || c.multiplo} compacto={compacto} />
          ),
        )}
      </fieldset>

      {!feito && (
        <footer className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
          {/* Enquanto o servidor trabalha, diz-se o quê: o plano de treino leva um minuto ou mais, e um botão cinzento sozinho parecia parado. */}
          <span className="flex min-w-0 items-center gap-2 text-meta text-ink-3" aria-live="polite">
            {aEnviar && <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-signal-strong" aria-hidden />}
            {aEnviar
              ? formulario.acao === "planear_treino"
                ? `A montar o plano com os exercícios e os desenhos${valores.pesquisar === "sim" ? ", com pesquisa na internet" : ""}. Leva um a dois minutos.`
                : "A preparar…"
              : faltam.length
                ? `Obrigatórios por preencher: ${faltam.length}`
                : "Pronto para rever."}
          </span>
          <div className="flex items-center gap-2">
            {onCancelar && (
              <button type="button" onClick={onCancelar} disabled={aEnviar} className="ctl-ghost h-9">
                Cancelar
              </button>
            )}
            <button type="button" onClick={() => void enviar()} disabled={aEnviar} className="ctl-primary h-9">
              {onEnviar ? "Guardar alterações" : "Continuar"}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

/**
 * O local, que depende do resto:
 *
 * - **num jogo fora**, é o campo do adversário: escreve-se (nome ou morada),
 *   porque não está no catálogo do clube;
 * - **em casa, num treino ou num evento**, é um dos locais do clube, numa
 *   lista; "Outro local…" abre espaço para escrever um que lá não esteja;
 * - **num jogo sem casa/fora escolhido**, pede-se primeiro isso.
 */
function CampoLocal({ campo, valor, onChange, fora, temCasaFora, casaEscolhida }: { campo: CampoDoFormulario; valor: string; onChange: (v: string) => void; fora: boolean; temCasaFora: boolean; casaEscolhida: boolean }) {
  const id = `adj-${campo.nome}`;
  const opcoes = campo.opcoes ?? [];
  const doClube = opcoes.some((o) => o.valor === valor);
  const [outro, setOutro] = useState(!fora && valor !== "" && !doClube);
  const base = "h-9 w-full rounded-[var(--radius-control)] border bg-surface px-2.5 text-body text-ink outline-none focus:border-signal-strong";
  const borda = campo.obrigatorio && !valor.trim() ? "border-warn" : "border-line";

  let controlo: React.ReactNode;
  if (temCasaFora && !casaEscolhida) {
    controlo = <div className="flex h-9 items-center rounded-[var(--radius-control)] border border-dashed border-line px-2.5 text-meta text-ink-3">Escolhe primeiro se é em casa ou fora.</div>;
  } else if (fora) {
    controlo = <input id={id} type="text" value={valor} onChange={(e) => onChange(e.target.value)} placeholder="Campo do adversário (nome ou morada)" className={cx(base, borda)} />;
  } else {
    controlo = (
      <div className="flex flex-col gap-1.5">
        <select
          id={id}
          value={outro ? "__outro" : doClube ? valor : ""}
          onChange={(e) => {
            if (e.target.value === "__outro") {
              setOutro(true);
              onChange("");
            } else {
              setOutro(false);
              onChange(e.target.value);
            }
          }}
          className={cx(base, borda)}
        >
          <option value="">Escolher…</option>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>{o.label}</option>
          ))}
          <option value="__outro">Outro local…</option>
        </select>
        {outro && <input type="text" value={valor} onChange={(e) => onChange(e.target.value)} placeholder="Escreve o local" aria-label="Outro local" className={cx(base, borda)} />}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-1.5 text-meta font-medium text-ink-2">
        {fora ? "Local (campo do adversário)" : campo.rotulo}
        {campo.obrigatorio ? <span className="text-risk" aria-label="obrigatório">*</span> : <span className="text-ink-4">(opcional)</span>}
      </label>
      {controlo}
      {campo.sugestao && !valor && !fora && (
        <button type="button" onClick={() => onChange(campo.sugestao!)} className="self-start text-meta text-signal-ink">
          Sugestão: {campo.sugestao}
        </button>
      )}
    </div>
  );
}

function CampoDoForm({ campo, valor, onChange, largo, compacto }: { campo: CampoDoFormulario; valor: string; onChange: (v: string) => void; largo?: boolean; compacto?: boolean }) {
  const id = `adj-${campo.nome}`;
  const base = "h-9 w-full rounded-[var(--radius-control)] border bg-surface px-2.5 text-body text-ink outline-none focus:border-signal-strong";
  const borda = campo.obrigatorio && !valor.trim() ? "border-warn" : "border-line";

  let controlo: React.ReactNode;
  if (campo.multiplo && campo.opcoes?.length) {
    const escolhidos = valor.split(",").map((s) => s.trim()).filter(Boolean);
    const alternar = (v: string) => onChange((escolhidos.includes(v) ? escolhidos.filter((x) => x !== v) : [...escolhidos, v]).join(", "));
    controlo = (
      <div className="flex flex-wrap gap-1.5">
        {campo.opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => alternar(o.valor)}
            aria-pressed={escolhidos.includes(o.valor)}
            className={cx("h-8 rounded-full border px-3 text-meta font-medium", escolhidos.includes(o.valor) ? "border-signal-strong bg-signal-soft text-signal-ink" : "border-line bg-surface text-ink-2")}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  } else if (campo.tipo === "booleano") {
    controlo = (
      <div className="flex gap-1.5">
        {[
          { v: "sim", l: campo.nome === "casa" ? "Em casa" : "Sim" },
          { v: "não", l: campo.nome === "casa" ? "Fora" : "Não" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={valor === o.v}
            className={cx("h-9 flex-1 rounded-[var(--radius-control)] border px-3 text-body font-medium", valor === o.v ? "border-signal-strong bg-signal-soft text-signal-ink" : cx("bg-surface text-ink-2", borda))}
          >
            {o.l}
          </button>
        ))}
      </div>
    );
  } else if (campo.opcoes?.length && !campo.livre) {
    controlo = (
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} className={cx(base, borda)}>
        <option value="">Escolher…</option>
        {campo.opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.label}</option>
        ))}
      </select>
    );
  } else if (campo.tipo === "textoLongo") {
    controlo = <textarea id={id} value={valor} onChange={(e) => onChange(e.target.value)} rows={compacto ? 3 : 4} className={cx("w-full resize-y rounded-[var(--radius-control)] border bg-surface px-2.5 py-2 text-body text-ink outline-none focus:border-signal-strong", borda)} />;
  } else {
    const tipoHtml = campo.tipo === "data" ? "date" : campo.tipo === "hora" ? "time" : campo.tipo === "numero" ? "number" : campo.tipo === "email" ? "email" : campo.tipo === "telefone" ? "tel" : "text";
    controlo = (
      <>
        <input id={id} type={tipoHtml} value={valor} onChange={(e) => onChange(e.target.value)} list={campo.opcoes?.length ? `${id}-opcoes` : undefined} className={cx(base, borda)} />
        {campo.opcoes?.length ? (
          <datalist id={`${id}-opcoes`}>
            {campo.opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </datalist>
        ) : null}
      </>
    );
  }

  return (
    <div className={cx("flex min-w-0 flex-col gap-1", largo && "sm:col-span-2")}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-meta font-medium text-ink-2">
        {campo.rotulo}
        {campo.obrigatorio ? <span className="text-risk" aria-label="obrigatório">*</span> : <span className="text-ink-4">(opcional)</span>}
      </label>
      {controlo}
      {campo.sugestao && !valor && (
        <button type="button" onClick={() => onChange(campo.sugestao!)} className="self-start text-meta text-signal-ink">
          Sugestão: {campo.sugestao}
        </button>
      )}
    </div>
  );
}
