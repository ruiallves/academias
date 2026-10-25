"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, ChevronLeft, Loader2 } from "lucide-react";
import type { Adesao, CategoriaDeSocio } from "@/dados/tipos";
import { CartaoDeSocio } from "./CartaoDeSocio";

/**
 * "Faz-te sócio" dentro do site do clube.
 *
 * É a página `/ser-socio` da API (`landing/membership.template.ts`) passada
 * para o site: os mesmos ecrãs (apresentação, categoria, dados,
 * identificação, contacto, autorizações), as mesmas validações e o mesmo
 * pedido, `POST /api/clubes/:slug/socios`. O pedido fica pendente e aparece
 * no painel do clube, em Sócios, como os que chegam pela página da API.
 *
 * Vive na página `/ser-socio` do site. Os botões de sócio levam para lá
 * (antes abriam uma janela por cima; o Rui quis a página, a 24/10/2026).
 *
 * Os dados vivem no estado e nunca se limpam a meio: voltar atrás no
 * formulário encontra tudo como estava.
 */

type ClubeDaAdesao = { slug: string; name: string; shortName: string; logoUrl?: string };

type Ecra = "intro" | "categoria" | "dados" | "identificacao" | "contacto" | "autorizacoes" | "fim";

/** Os ecrãs numerados (os "1 2 3 4" de cima). */
const PASSOS: Ecra[] = ["dados", "identificacao", "contacto", "autorizacoes"];

const TITULOS: Record<Ecra, string> = {
  intro: "",
  categoria: "A tua categoria",
  dados: "Os teus dados",
  identificacao: "Identificação",
  contacto: "Contacto e morada",
  autorizacoes: "Antes de finalizar",
  fim: "",
};

type Campos = {
  tierId: string;
  name: string;
  email: string;
  bd: string;
  bm: string;
  by: string;
  sex: "FEMALE" | "MALE" | "UNSPECIFIED";
  taxId: string;
  docKind: "CC" | "PASSPORT" | "RESIDENCE" | "OTHER";
  docNumber: string;
  phoneCountry: string;
  phone: string;
  country: string;
  address: string;
  cp4: string;
  cp3: string;
  city: string;
  terms: boolean;
  comms: boolean;
  data: boolean;
};

const INDICATIVOS = ["+351", "+34", "+33", "+44", "+41", "+352", "+49", "+55"];
const PAISES: [string, string][] = [
  ["PT", "Portugal"],
  ["ES", "Espanha"],
  ["FR", "França"],
  ["GB", "Reino Unido"],
  ["CH", "Suíça"],
  ["LU", "Luxemburgo"],
  ["DE", "Alemanha"],
  ["BR", "Brasil"],
];
const DOCUMENTOS: [Campos["docKind"], string][] = [
  ["CC", "Cartão de cidadão"],
  ["PASSPORT", "Passaporte"],
  ["RESIDENCE", "Título de residência"],
  ["OTHER", "Outro"],
];

/** Os campos partidos em caixas mostram um erro só. */
const GRUPO: Partial<Record<keyof Campos, string>> = { bd: "birth", bm: "birth", by: "birth", cp4: "postal", cp3: "postal" };

const algarismos = (v: string) => v.replace(/\D/g, "");
const agrupar = (v: string, n: number) => (v.match(new RegExp(`.{1,${n}}`, "g")) ?? []).join(" ");

export function FluxoDeSocio({
  clube,
  adesao,
  api,
  demonstracao,
  quadrado = false,
  idTitulo = "adesao-titulo",
}: {
  clube: ClubeDaAdesao;
  adesao: Adesao;
  api: string;
  demonstracao: boolean;
  /** O tema Holofote: cantos direitos. */
  quadrado?: boolean;
  idTitulo?: string;
}) {
  const ecras = useMemo<Ecra[]>(
    () => ["intro", ...(adesao.tiers.length ? (["categoria"] as Ecra[]) : []), ...PASSOS, "fim"],
    [adesao.tiers.length],
  );
  const [em, setEm] = useState(0);
  const ecra = ecras[em];

  const [c, setC] = useState<Campos>(() => ({
    tierId: adesao.tiers[0]?.id ?? "",
    name: "",
    email: "",
    bd: "",
    bm: "",
    by: "",
    sex: "UNSPECIFIED",
    taxId: "",
    docKind: "CC",
    docNumber: "",
    phoneCountry: "+351",
    phone: "",
    country: "PT",
    address: "",
    cp4: "",
    cp3: "",
    city: "",
    terms: false,
    comms: false,
    data: false,
  }));
  const [erros, setErros] = useState<Partial<Record<string, string>>>({});
  const [falha, setFalha] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [bemVindo, setBemVindo] = useState("");

  const corpo = useRef<HTMLDivElement | null>(null);
  const titulo = useRef<HTMLHeadingElement | null>(null);
  const refs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const r = (k: string) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    refs.current[k] = el;
  };

  const mudar = <K extends keyof Campos>(k: K, v: Campos[K]) => {
    setC((x) => ({ ...x, [k]: v }));
    // O erro sai assim que a pessoa mexe no campo: manter o vermelho enquanto
    // alguém está a corrigir é ralhar duas vezes pelo mesmo.
    const chave = GRUPO[k] ?? (k as string);
    setErros((e) => (e[chave] ? { ...e, [chave]: undefined } : e));
  };

  const categoria = adesao.tiers.find((t) => t.id === c.tierId);
  const desde = maisBarato(adesao.tiers);

  /* ---------------------------------------------------------------- validar */

  const nascimento = () => {
    if (c.bd.length !== 2 || c.bm.length !== 2 || c.by.length !== 4) return null;
    const dt = new Date(Date.UTC(+c.by, +c.bm - 1, +c.bd));
    if (dt.getUTCFullYear() !== +c.by || dt.getUTCMonth() !== +c.bm - 1 || dt.getUTCDate() !== +c.bd) return null;
    if (dt.getTime() > Date.now() || +c.by < new Date().getFullYear() - 110) return null;
    return `${c.by}-${c.bm}-${c.bd}`;
  };

  /** Os erros de um ecrã, por ordem: o primeiro é o que recebe o foco. */
  const errosDe = (e: Ecra): [string, string, string][] => {
    const out: [string, string, string][] = [];
    if (e === "dados") {
      if (c.name.trim().length < 3) out.push(["name", "name", "Escreve o nome completo, como está no documento."]);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(c.email.trim())) out.push(["email", "email", "Este e-mail não parece válido. Confere a escrita."]);
      if (!nascimento()) out.push(["birth", "bd", "Essa data não existe. Escreve dia, mês e ano."]);
    }
    if (e === "identificacao") {
      if (algarismos(c.taxId).length !== 9) out.push(["taxId", "taxId", "O contribuinte tem nove dígitos."]);
      if (c.docNumber.trim().length < 4) out.push(["docNumber", "docNumber", "Falta o número do documento."]);
    }
    if (e === "contacto") {
      if (algarismos(c.phone).length < 9) out.push(["phone", "phone", "O número de telemóvel parece curto."]);
      if (c.address.trim().length < 3) out.push(["address", "address", "Falta a morada."]);
      if (c.cp4.length !== 4 || c.cp3.length !== 3) out.push(["postal", "cp4", "O código postal tem o formato 0000-000."]);
      if (c.city.trim().length < 2) out.push(["city", "city", "Falta a cidade."]);
    }
    return out;
  };

  const validar = (e: Ecra) => {
    const lista = errosDe(e);
    setErros(Object.fromEntries(lista.map(([k, , m]) => [k, m])));
    if (lista.length) refs.current[lista[0][1]]?.focus();
    return lista.length === 0;
  };

  /** Ao sair de um campo já preenchido: o erro aparece junto dele, sem esperar pelo "Seguinte". */
  const aoSair = (chave: string) => {
    const e = errosDe(ecra).find(([k]) => k === chave);
    if (e) setErros((x) => ({ ...x, [chave]: e[2] }));
  };

  /* ---------------------------------------------------------------- navegar */

  const ir = (i: number) => setEm(Math.max(0, Math.min(ecras.length - 1, i)));
  const seguinte = () => {
    if (validar(ecra)) ir(em + 1);
  };

  const primeiraVez = useRef(true);
  useEffect(() => {
    // O primeiro desenho fica onde está: saltar para o formulário ao abrir o
    // link era tirar a pessoa do topo sem ela pedir.
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    primeiraVez.current = false;
    // Cada ecrã começa em cima, e o título recebe o foco (é o que um leitor de
    // ecrã anuncia). O primeiro campo só ganha foco em ecrã grande: no
    // telemóvel o teclado tapava a pergunta antes de a pessoa a ler.
    corpo.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    const primeiro = corpo.current?.querySelector<HTMLInputElement>("[data-ecra] input:not([type=checkbox]), [data-ecra] select");
    if (primeiro && window.matchMedia("(min-width: 1024px)").matches && ecra !== "intro") primeiro.focus({ preventScroll: true });
    else titulo.current?.focus({ preventScroll: true });
  }, [em]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- enviar */

  const enviar = async () => {
    if (aEnviar) return;
    setFalha("");
    if (!c.terms) {
      setFalha("Para concluir a adesão é preciso aceitar os termos do sócio.");
      refs.current.terms?.focus();
      return;
    }
    // Uma última passagem: alguém pode ter voltado atrás e apagado um campo.
    for (const e of PASSOS) {
      if (errosDe(e).length) {
        ir(ecras.indexOf(e));
        setTimeout(() => validar(e), 0);
        return;
      }
    }
    setAEnviar(true);
    try {
      if (demonstracao) {
        // O clube de demonstração não existe na API: finge-se o envio.
        await new Promise((ok) => setTimeout(ok, 700));
        setBemVindo(c.name.trim());
      } else {
        const resposta = await fetch(`${api}/api/clubes/${encodeURIComponent(clube.slug)}/socios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tierId: c.tierId || undefined,
            name: c.name.trim(),
            email: c.email.trim(),
            birthdate: nascimento(),
            country: c.country,
            address: c.address.trim(),
            postalCode: `${c.cp4}-${c.cp3}`,
            city: c.city.trim(),
            phoneCountry: c.phoneCountry,
            phone: algarismos(c.phone),
            sex: c.sex,
            documentKind: c.docKind,
            documentNumber: c.docNumber.trim(),
            taxId: algarismos(c.taxId),
            acceptTerms: true,
            partnerComms: c.comms,
            partnerData: c.data,
          }),
        });
        const b = (await resposta.json().catch(() => ({}))) as { message?: string | string[]; name?: string };
        if (!resposta.ok) {
          setFalha(Array.isArray(b.message) ? b.message[0] : b.message || "Não foi possível enviar. Tenta outra vez.");
          return;
        }
        setBemVindo(b.name ?? c.name.trim());
      }
      ir(ecras.length - 1);
    } catch {
      setFalha("Falhou a ligação. Verifica a internet e tenta outra vez.");
    } finally {
      setAEnviar(false);
    }
  };

  /* ---------------------------------------------------------------- desenho */

  const canto = quadrado ? "" : "rounded-control";
  const passo = PASSOS.indexOf(ecra);
  const campo = `h-12 w-full border border-line-strong bg-surface px-3.5 text-[1rem] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-4 hover:border-ink-3 focus:border-signal-line focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-signal)_22%,transparent)] aria-[invalid=true]:border-risk ${canto}`;
  const botaoPrincipal = `inline-flex h-12 min-w-[10rem] items-center justify-center gap-2 bg-signal-strong px-7 text-sm font-bold uppercase tracking-[0.08em] text-signal-on transition hover:brightness-110 active:translate-y-px disabled:cursor-wait disabled:opacity-70 ${canto}`;

  const rotulo = (para: string, texto: ReactNode) => (
    <label htmlFor={para} className="mb-2 block text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-ink-2">
      {texto}
    </label>
  );
  const erro = (k: string) =>
    erros[k] ? (
      <p id={`erro-${k}`} className="mt-1.5 text-sm font-medium text-risk" role="alert">
        {erros[k]}
      </p>
    ) : null;
  const inv = (k: string) => ({ "aria-invalid": erros[k] ? true : undefined, "aria-describedby": erros[k] ? `erro-${k}` : undefined });

  const acoes = (principal: ReactNode) => (
    <div className="mt-8 flex flex-col-reverse items-stretch gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      {em > 0 && ecra !== "fim" ? (
        <button type="button" onClick={() => ir(em - 1)} className="inline-flex h-11 items-center justify-center gap-1.5 px-1 text-sm font-medium text-ink-3 transition hover:text-ink sm:justify-start">
          <ChevronLeft size={16} aria-hidden />
          Voltar
        </button>
      ) : (
        <span />
      )}
      {principal}
    </div>
  );

  /** Uma lista de escolha com a seta da casa (o `appearance-none` tira a do sistema). */
  const selecao = (props: React.ComponentProps<"select">, opcoes: [string, string][]) => (
    <div className="relative">
      <select {...props} className={`${campo} appearance-none pr-9 ${props.className ?? ""}`}>
        {opcoes.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
    </div>
  );

  const cartao = (
    <CartaoDeSocio nome={c.name} categoria={categoria?.name ?? "Sócio"} clube={clube} className="lg:[transform:perspective(1100px)_rotateY(-9deg)_rotateX(4deg)]" />
  );

  return (
    <div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16">
        <div ref={corpo} className="min-w-0 scroll-mt-28">
          {/* Os passos: 1 2 3 4, com o traço da cor do clube por baixo do atual. */}
          <div className={`mb-7 flex h-6 items-center gap-4 ${passo < 0 ? "invisible" : ""}`} aria-hidden={passo < 0}>
            <p className="sr-only" aria-live="polite">
              {passo >= 0 ? `Passo ${passo + 1} de ${PASSOS.length}` : ""}
            </p>
            {PASSOS.map((p, i) => (
              <span
                key={p}
                className={`relative pb-1.5 text-sm font-bold tabular transition-colors duration-200 ${i === passo ? "text-ink" : i < passo ? "text-ink-2" : "text-ink-4"}`}
                aria-hidden
              >
                {i < passo ? <Check size={14} strokeWidth={3} className="inline -translate-y-px" /> : i + 1}
                <span className={`absolute inset-x-0 -bottom-0.5 h-[3px] rounded-full bg-signal transition-transform duration-300 ${i === passo ? "scale-x-100" : "scale-x-0"}`} />
              </span>
            ))}
          </div>

          <div key={ecra} data-ecra className="animate-[socio-entrar_260ms_var(--ease-out)]">
            {/* ---------------------------------------------------------- Apresentação */}
            {ecra === "intro" && (
              <>
                <p className="eyebrow text-signal-ink">Faz-te sócio</p>
                <h2 id={idTitulo} ref={titulo} tabIndex={-1} className="display mt-3 text-[2.5rem] text-ink outline-none sm:text-[3.25rem]">
                  {adesao.headline}
                </h2>
                {adesao.intro && <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">{adesao.intro}</p>}
                {adesao.points.length > 0 && (
                  <ul className="mt-8 divide-y divide-line border-y border-line">
                    {adesao.points.map((p) => (
                      <li key={p} className="flex items-center gap-3.5 py-3.5 text-ink">
                        <svg width="11" height="12" viewBox="0 0 11 12" className="shrink-0 text-signal" aria-hidden>
                          <path d="M0 0 11 6 0 12Z" fill="currentColor" />
                        </svg>
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-6 lg:hidden">{cartao}</div>
                <div className="mt-8 flex justify-end">
                  <button type="button" onClick={() => ir(1)} className={`${botaoPrincipal} w-full sm:w-auto`}>
                    Começar{desde ? ` · desde ${dinheiro(desde.cents)}${desde.anual ? "/ano" : "/mês"}` : ""}
                    <ArrowRight size={17} aria-hidden />
                  </button>
                </div>
              </>
            )}

            {/* ---------------------------------------------------------- Categoria */}
            {ecra === "categoria" && (
              <>
                <Cabeca titulo={TITULOS.categoria} refTitulo={titulo} id={idTitulo} />
                <p className="mt-3 text-ink-2">Podes mudar mais tarde, falando com o clube.</p>
                <div role="radiogroup" aria-label="Categoria de sócio" className="mt-7 grid gap-3 sm:grid-cols-2">
                  {adesao.tiers.map((t) => {
                    const sim = t.id === c.tierId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={sim}
                        onClick={() => mudar("tierId", t.id)}
                        className={`relative flex min-h-[8.5rem] flex-col items-start border bg-surface p-5 text-left transition-[border-color,box-shadow,background-color] duration-200 hover:border-ink-3 ${canto} ${
                          sim ? "border-signal-line bg-signal-soft/40 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-signal)_20%,transparent)]" : "border-line-strong"
                        }`}
                      >
                        <span className={`absolute right-4 top-4 grid size-5 place-items-center rounded-full border-2 transition ${sim ? "border-signal-strong bg-signal-strong text-signal-on" : "border-line-strong"}`} aria-hidden>
                          {sim && <Check size={12} strokeWidth={3.5} />}
                        </span>
                        <span className="pr-8 font-bold text-ink">{t.name}</span>
                        {idade(t) && <span className="mt-0.5 text-xs text-ink-3">{idade(t)}</span>}
                        <span className="display mt-auto pt-4 text-[1.75rem] text-ink">
                          {t.feeCents === null ? <span className="text-base normal-case">a definir</span> : dinheiro(t.feeCents)}
                          {t.feeCents !== null && <span className="ml-1 text-sm font-semibold normal-case tracking-normal text-ink-3">{t.billing === "ANNUAL" ? "/ano" : "/mês"}</span>}
                        </span>
                        {t.description && <span className="mt-2 text-sm text-ink-2">{t.description}</span>}
                        {t.benefits.length > 0 && (
                          <span className="mt-3 flex flex-col gap-1">
                            {t.benefits.map((b) => (
                              <span key={b} className="flex items-start gap-2 text-sm text-ink-2">
                                <Check size={14} className="mt-1 shrink-0 text-signal-ink" aria-hidden />
                                {b}
                              </span>
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {acoes(
                  <button type="button" onClick={seguinte} className={botaoPrincipal}>
                    Seguinte
                  </button>
                )}
              </>
            )}

            {/* ---------------------------------------------------------- 1 · Os teus dados */}
            {ecra === "dados" && (
              <>
                <Cabeca titulo={TITULOS.dados} refTitulo={titulo} id={idTitulo} />
                <p className="mt-3 text-sm text-signal-ink">Todos os campos são obrigatórios.</p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    {rotulo("s-name", "Nome completo")}
                    <input ref={r("name")} id="s-name" className={campo} autoComplete="name" autoCapitalize="words" maxLength={120} placeholder="Como no documento" value={c.name} onChange={(e) => mudar("name", e.target.value)} onBlur={() => c.name && aoSair("name")} {...inv("name")} />
                    {erro("name")}
                  </div>
                  <div>
                    {rotulo("s-email", "E-mail")}
                    <input ref={r("email")} id="s-email" type="email" inputMode="email" autoComplete="email" className={campo} placeholder="nome@exemplo.pt" value={c.email} onChange={(e) => mudar("email", e.target.value)} onBlur={() => c.email && aoSair("email")} {...inv("email")} />
                    {erro("email")}
                  </div>
                  <fieldset>
                    <legend className="mb-2 block text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-ink-2">Data de nascimento</legend>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.5fr)] items-center gap-2">
                      <input ref={r("bd")} aria-label="Dia" inputMode="numeric" maxLength={2} placeholder="DD" className={`${campo} text-center`} value={c.bd}
                        onChange={(e) => { const v = algarismos(e.target.value).slice(0, 2); mudar("bd", v); if (v.length === 2) refs.current.bm?.focus(); }} {...inv("birth")} />
                      <span className="text-ink-4" aria-hidden>/</span>
                      <input ref={r("bm")} aria-label="Mês" inputMode="numeric" maxLength={2} placeholder="MM" className={`${campo} text-center`} value={c.bm}
                        onChange={(e) => { const v = algarismos(e.target.value).slice(0, 2); mudar("bm", v); if (v.length === 2) refs.current.by?.focus(); }}
                        onKeyDown={(e) => { if (e.key === "Backspace" && !c.bm) refs.current.bd?.focus(); }} {...inv("birth")} />
                      <span className="text-ink-4" aria-hidden>/</span>
                      <input ref={r("by")} aria-label="Ano" inputMode="numeric" maxLength={4} placeholder="AAAA" className={`${campo} text-center`} value={c.by}
                        onChange={(e) => mudar("by", algarismos(e.target.value).slice(0, 4))}
                        onKeyDown={(e) => { if (e.key === "Backspace" && !c.by) refs.current.bm?.focus(); }}
                        onBlur={() => c.by.length === 4 && aoSair("birth")} {...inv("birth")} />
                    </div>
                    {erro("birth")}
                  </fieldset>
                </div>
                <div className="mt-8 lg:hidden">{cartao}</div>
                {acoes(
                  <button type="button" onClick={seguinte} className={botaoPrincipal}>
                    Seguinte
                  </button>
                )}
              </>
            )}

            {/* ---------------------------------------------------------- 2 · Identificação */}
            {ecra === "identificacao" && (
              <>
                <Cabeca titulo={TITULOS.identificacao} refTitulo={titulo} id={idTitulo} />
                <p className="mt-3 text-sm text-signal-ink">Todos os campos são obrigatórios.</p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-2 block text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-ink-2">Sexo</legend>
                    <div role="radiogroup" aria-label="Sexo" className="flex flex-wrap gap-2">
                      {([["FEMALE", "Feminino"], ["MALE", "Masculino"], ["UNSPECIFIED", "Prefiro não dizer"]] as const).map(([v, l]) => (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={c.sex === v}
                          onClick={() => mudar("sex", v)}
                          className={`h-11 border px-4 text-sm font-semibold transition ${quadrado ? "" : "rounded-full"} ${
                            c.sex === v ? "border-signal-strong bg-signal-strong text-signal-on" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    {rotulo("s-nif", "N.º de contribuinte")}
                    <input ref={r("taxId")} id="s-nif" inputMode="numeric" maxLength={11} autoComplete="off" placeholder="000 000 000" className={`${campo} tabular`} value={c.taxId}
                      onChange={(e) => mudar("taxId", agrupar(algarismos(e.target.value).slice(0, 9), 3))} onBlur={() => c.taxId && aoSair("taxId")} {...inv("taxId")} />
                    {erro("taxId")}
                  </div>
                  <div>
                    {rotulo("s-dk", "Tipo de documento")}
                    {selecao({ ref: r("docKind"), id: "s-dk", value: c.docKind, onChange: (e) => mudar("docKind", e.target.value as Campos["docKind"]) }, DOCUMENTOS)}
                  </div>
                  <div className="sm:col-span-2">
                    {rotulo("s-dn", "N.º de documento")}
                    <input ref={r("docNumber")} id="s-dn" autoCapitalize="characters" autoComplete="off" placeholder="00000000 0 AA0" className={campo} value={c.docNumber}
                      onChange={(e) => mudar("docNumber", e.target.value.toUpperCase())} onBlur={() => c.docNumber && aoSair("docNumber")} {...inv("docNumber")} />
                    {erro("docNumber")}
                  </div>
                </div>
                {acoes(
                  <button type="button" onClick={seguinte} className={botaoPrincipal}>
                    Seguinte
                  </button>
                )}
              </>
            )}

            {/* ---------------------------------------------------------- 3 · Contacto */}
            {ecra === "contacto" && (
              <>
                <Cabeca titulo={TITULOS.contacto} refTitulo={titulo} id={idTitulo} />
                <p className="mt-3 text-sm text-signal-ink">Todos os campos são obrigatórios.</p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    {rotulo("s-tel", "Telemóvel")}
                    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                      {selecao({ "aria-label": "Indicativo", className: "px-2.5", value: c.phoneCountry, onChange: (e) => mudar("phoneCountry", e.target.value) }, INDICATIVOS.map((i) => [i, i]))}
                      <input ref={r("phone")} id="s-tel" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="900 000 000" className={`${campo} tabular`} value={c.phone}
                        onChange={(e) => mudar("phone", agrupar(algarismos(e.target.value).slice(0, 12), 3))} onBlur={() => c.phone && aoSair("phone")} {...inv("phone")} />
                    </div>
                    {erro("phone")}
                  </div>
                  <div>
                    {rotulo("s-pais", "País")}
                    {selecao({ id: "s-pais", value: c.country, onChange: (e) => mudar("country", e.target.value) }, PAISES)}
                  </div>
                  <div className="sm:col-span-2">
                    {rotulo("s-morada", "Morada")}
                    <input ref={r("address")} id="s-morada" autoComplete="street-address" placeholder="Rua, número e andar" className={campo} value={c.address}
                      onChange={(e) => mudar("address", e.target.value)} onBlur={() => c.address && aoSair("address")} {...inv("address")} />
                    {erro("address")}
                  </div>
                  <fieldset>
                    <legend className="mb-2 block text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-ink-2">Código postal</legend>
                    <div className="grid grid-cols-[minmax(0,4fr)_auto_minmax(0,3fr)] items-center gap-2">
                      <input ref={r("cp4")} aria-label="Código postal" inputMode="numeric" maxLength={4} placeholder="0000" className={`${campo} text-center tabular`} value={c.cp4}
                        onChange={(e) => { const v = algarismos(e.target.value).slice(0, 4); mudar("cp4", v); if (v.length === 4) refs.current.cp3?.focus(); }} {...inv("postal")} />
                      <span className="text-ink-4" aria-hidden>–</span>
                      <input ref={r("cp3")} aria-label="Extensão do código postal" inputMode="numeric" maxLength={3} placeholder="000" className={`${campo} text-center tabular`} value={c.cp3}
                        onChange={(e) => mudar("cp3", algarismos(e.target.value).slice(0, 3))}
                        onKeyDown={(e) => { if (e.key === "Backspace" && !c.cp3) refs.current.cp4?.focus(); }}
                        onBlur={() => c.cp3.length === 3 && aoSair("postal")} {...inv("postal")} />
                    </div>
                    {erro("postal")}
                  </fieldset>
                  <div>
                    {rotulo("s-cidade", "Cidade")}
                    <input ref={r("city")} id="s-cidade" autoComplete="address-level2" placeholder="Braga" className={campo} value={c.city}
                      onChange={(e) => mudar("city", e.target.value)} onBlur={() => c.city && aoSair("city")} {...inv("city")} />
                    {erro("city")}
                  </div>
                </div>
                {acoes(
                  <button type="button" onClick={seguinte} className={botaoPrincipal}>
                    Seguinte
                  </button>
                )}
              </>
            )}

            {/* ---------------------------------------------------------- 4 · Autorizações */}
            {ecra === "autorizacoes" && (
              <>
                <Cabeca titulo={TITULOS.autorizacoes} refTitulo={titulo} id={idTitulo} />
                <div className="mt-6 divide-y divide-line border-y border-line">
                  {(
                    [
                      ["terms", <b key="t" className="font-semibold text-ink">Concordo com os termos do sócio do {clube.shortName}.</b>],
                      ["comms", <>Autorizo que o {clube.shortName} envie comunicações comerciais dos Parceiros Oficiais.</>],
                      ["data", <>Autorizo a partilha dos meus dados com os Parceiros Oficiais do {clube.shortName} para envio de comunicações comerciais.</>],
                    ] as const
                  ).map(([k, texto]) => (
                    <label key={k} className="group flex cursor-pointer items-start gap-3.5 py-4">
                      <input
                        ref={k === "terms" ? r("terms") : undefined}
                        type="checkbox"
                        checked={c[k]}
                        onChange={(e) => { mudar(k, e.target.checked); if (k === "terms") setFalha(""); }}
                        className="peer sr-only"
                      />
                      <span
                        className={`mt-0.5 grid size-6 shrink-0 place-items-center border-2 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal-line ${quadrado ? "" : "rounded-[6px]"} ${
                          c[k] ? "border-signal-strong bg-signal-strong text-signal-on" : "border-line-strong bg-surface group-hover:border-ink-3"
                        }`}
                        aria-hidden
                      >
                        {c[k] && <Check size={14} strokeWidth={3.5} />}
                      </span>
                      <span className="text-[0.95rem] leading-relaxed text-ink-2">{texto}</span>
                    </label>
                  ))}
                </div>
                {/* Fora das caixas: um link dentro de um <label> marcava a caixa ao tocar. Abrem noutro separador para não se perder o formulário. */}
                <p className="mt-4 text-sm leading-relaxed text-ink-3">
                  Lê os{" "}
                  <a href="/termos-do-socio" target="_blank" rel="noopener" className="font-semibold text-ink underline-offset-2 hover:underline">
                    termos do sócio
                  </a>{" "}
                  e a{" "}
                  <a href="/privacidade" target="_blank" rel="noopener" className="font-semibold text-ink underline-offset-2 hover:underline">
                    política de privacidade
                  </a>
                  .
                </p>
                {falha && (
                  <p className="mt-4 text-sm font-medium text-risk" role="alert">
                    {falha}
                  </p>
                )}
                {acoes(
                  <button type="button" onClick={enviar} disabled={aEnviar} className={botaoPrincipal}>
                    {aEnviar ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
                    {aEnviar ? "A enviar" : "Concluir adesão"}
                  </button>
                )}
              </>
            )}

            {/* ---------------------------------------------------------- Fim */}
            {ecra === "fim" && (
              <>
                <p className="eyebrow text-signal-ink">Está feito</p>
                <h2 id={idTitulo} ref={titulo} tabIndex={-1} className="display mt-3 text-[2.5rem] text-ink outline-none sm:text-[3.25rem]">
                  {bemVindo ? `Bem-vindo, ${bemVindo.split(/\s+/)[0]}.` : "Bem-vindo."}
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">Recebemos a tua adesão. A direção do {clube.shortName} vai analisá-la e entra em contacto contigo.</p>
                <ol className="mt-8 space-y-3">
                  {[
                    ["Inscrição recebida", true],
                    ["Dados enviados ao clube", true],
                    ["Aprovação pela direção", false],
                    ["Número de sócio e cartão digital", false],
                  ].map(([t, feito]) => (
                    <li key={t as string} className="flex items-center gap-3 text-ink">
                      <span className={`grid size-7 shrink-0 place-items-center rounded-full ${feito ? "bg-signal-strong text-signal-on" : "border-2 border-dashed border-line-strong text-ink-4"}`} aria-hidden>
                        {feito ? <Check size={15} strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />}
                      </span>
                      <span className={feito ? "" : "text-ink-3"}>{t}</span>
                      <span className="sr-only">{feito ? "(feito)" : "(por fazer)"}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-8 lg:hidden">{cartao}</div>
                <div className="mt-10">
                  <a href="/" className={botaoPrincipal}>
                    Voltar ao site
                  </a>
                </div>
              </>
            )}
          </div>
        </div>

        {/* O cartão, ao lado, em ecrã grande. */}
        <aside className={`relative hidden overflow-hidden lg:sticky lg:top-28 lg:flex lg:flex-col lg:items-center lg:justify-center lg:self-start bg-sunken px-8 py-14 ${quadrado ? "" : "rounded-card"}`}>
          <Estilhacos />
          <div className="relative w-full max-w-[17rem]">{cartao}</div>
          <p className="relative mt-6 max-w-[16rem] text-center text-sm text-ink-3">O teu cartão fica ativo assim que a direção aprovar a adesão.</p>
        </aside>
      </div>
    </div>
  );
}

function Cabeca({ titulo, refTitulo, id }: { titulo: string; refTitulo: React.RefObject<HTMLHeadingElement | null>; id: string }) {
  return (
    <>
      <p className="eyebrow text-signal-ink">Faz-te sócio</p>
      <h2 id={id} ref={refTitulo} tabIndex={-1} className="display mt-3 text-[2rem] text-ink outline-none sm:text-[2.5rem]">
        {titulo}
      </h2>
    </>
  );
}

/** Os estilhaços da página de adesão, na cor do clube, por trás do cartão. */
function Estilhacos() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full text-signal" viewBox="0 0 340 640" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <polygon points="250,40 340,10 340,150" fill="currentColor" opacity="0.28" />
      <polygon points="270,170 340,215 220,330" fill="currentColor" opacity="0.2" />
      <polygon points="0,470 70,500 30,600" fill="currentColor" opacity="0.24" />
      <polygon points="40,520 120,540 0,640" fill="currentColor" opacity="0.14" />
      <polygon points="300,560 340,540 340,620" fill="currentColor" opacity="0.18" />
    </svg>
  );
}

/** O mais barato, e em que unidade: compara-se dentro de cada periodicidade, e prefere-se a mensal. */
function maisBarato(tiers: CategoriaDeSocio[]): { cents: number; anual: boolean } | null {
  const menor = (anual: boolean) => {
    const p = tiers.filter((t) => (t.billing === "ANNUAL") === anual && t.feeCents !== null).map((t) => t.feeCents as number);
    return p.length ? Math.min(...p) : null;
  };
  const mensal = menor(false);
  if (mensal !== null) return { cents: mensal, anual: false };
  const anual = menor(true);
  return anual !== null ? { cents: anual, anual: true } : null;
}

function idade(t: CategoriaDeSocio): string | null {
  if (t.minAge != null && t.maxAge != null) return `Dos ${t.minAge} aos ${t.maxAge} anos`;
  if (t.minAge != null) return `A partir dos ${t.minAge} anos`;
  if (t.maxAge != null) return `Até aos ${t.maxAge} anos`;
  return null;
}

function dinheiro(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
