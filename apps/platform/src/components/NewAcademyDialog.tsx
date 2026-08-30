import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, ImagePlus, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/http";
import { euros } from "@/lib/format";
import type { Plan } from "@/lib/types";
import { cx } from "./primitives";

/**
 * Criar academia e convidar o diretor.
 *
 * Um formulário só. Um assistente de vários passos para isto seria cerimónia: o
 * que a academia precisa de saber sobre si própria — modalidades, equipas — é o
 * diretor que preenche no onboarding dele, com conhecimento de causa.
 *
 * ## Porque é que a cor e o símbolo estão aqui, se são do clube
 *
 * Continuam a ser do clube e continuam editáveis nas Definições — isto não os
 * tira de lá. Mas quem abre um clube tem quase sempre o emblema à frente na
 * altura em que o abre, e o presidente recebe um convite que já mostra o símbolo
 * dele. A alternativa era o clube nascer verde-genérico e alguém ter de se
 * lembrar de o arranjar depois. Ficam os dois opcionais, e escondidos atrás de
 * um resumo, para não engordarem o caminho de quem não os tem.
 *
 * O endereço é derivado do nome enquanto ninguém lhe tocar. É o que faz o campo
 * desaparecer para quem não se importa e continuar lá para quem se importa.
 */
type Created = {
  academy: { id: string; slug: string; name: string };
  inviteLink: string;
  trialEndsAt: string;
  /** O cargo com que a pessoa vai entrar. Vem do servidor — ver `initialRoles`. */
  roleName: string;
  /** Se o convite já saiu por email. Ver `sendOwnerInvite` no servidor. */
  emailed: boolean;
  emailError?: string;
};

/** Os departamentos, para o cargo que não é o de presidente. */
const DEPARTAMENTOS = [
  { value: "", label: "Sem departamento" },
  { value: "DIRECTION", label: "Direção" },
  { value: "TECHNICAL", label: "Equipa técnica" },
  { value: "CLINICAL", label: "Departamento clínico" },
  { value: "SCOUTING", label: "Departamento de scouting" },
  { value: "OPERATIONS", label: "Secretaria e operações" },
] as const;

/** 2 MB — o mesmo tecto do servidor. Ver `club-logo.service.ts`. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/webp", "image/jpeg"];

/** O verde por omissão do `schema.prisma`. Aqui só para o campo abrir nele. */
const COR_OMISSAO = "#0f6b62";

/** "Presidente" em qualquer grafia. Gémeo de `isPresidente` no servidor. */
function ehPresidente(nome: string): boolean {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return limpo === "presidente" || limpo === "presidencia" || limpo === "president";
}

export function NewAcademyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [directorName, setDirectorName] = useState("");
  const [directorEmail, setDirectorEmail] = useState("");
  const [planId, setPlanId] = useState("");
  const [roleName, setRoleName] = useState("Presidente");
  const [roleDepartment, setRoleDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  /*
   * A identidade, opcional e fechada por omissão.
   *
   * `corTocada` distingue "escolheu o verde" de "não escolheu nada" — sem isso,
   * o campo de cor abre num valor e o formulário não tem como saber se aquilo é
   * uma escolha ou o estado inicial, e acabava a gravar à mão a cor que o schema
   * já punha sozinho.
   */
  const [identidadeAberta, setIdentidadeAberta] = useState(false);
  const [cor, setCor] = useState(COR_OMISSAO);
  const [corTocada, setCorTocada] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Um `blob:` que ninguém liberta é memória presa enquanto o separador viver.
  useEffect(() => {
    if (!logo) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  useEffect(() => {
    /*
     * Sem plano escolhido à partida.
     *
     * Pré-seleccionava o primeiro da lista, e isso fazia com que criar um clube
     * sem plano fosse impossível sem reparar que havia ali um botão já marcado.
     * A maior parte dos clubes entra em experimental sem saber o que quer — o
     * plano associa-se depois. "Sem plano" passou a ser a opção por omissão, e
     * escolher um é um gesto deliberado.
     */
    apiGet<Plan[]>("/plans")
      .then(setPlans)
      .catch(() => setPlans([]));

  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (created ? onCreated() : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onCreated, created]);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  // O campo de texto da cor deixa escrever "#0f6" a caminho de "#0f6b62". Enquanto
  // não estiver completo, o botão espera — em vez de o servidor devolver 400 com o
  // clube por criar.
  const corValida = !corTocada || /^#[0-9a-f]{6}$/i.test(cor);
  const valid =
    name.trim().length >= 3 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(directorEmail.trim()) &&
    effectiveSlug.length >= 3 &&
    corValida;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await apiPost<Created>("/academies", {
        name: name.trim(),
        slug: effectiveSlug,
        directorName: directorName.trim(),
        directorEmail: directorEmail.trim(),
        roleName: roleName.trim() || "Presidente",
        ...(roleDepartment ? { roleDepartment } : {}),
        ...(corTocada ? { signalColor: cor } : {}),
        /*
         * Com símbolo, o convite espera por ele.
         *
         * O email leva o emblema do clube no cabeçalho, e o emblema só se carrega
         * depois de a academia ter id — é a pasta dele no armazenamento. Enviar
         * o convite já fazia sair sempre um email com as iniciais em vez do
         * símbolo que a pessoa acabou de escolher. Sem símbolo não há nada por
         * que esperar, e o convite sai no mesmo pedido da criação — que é a
         * garantia mais forte de que sai de todo.
         */
        ...(logo ? { deferInvite: true } : {}),
        planId: planId || undefined,
      });

      /*
       * O símbolo depois do clube, e nunca a bloqueá-lo.
       *
       * Carrega-se para o Supabase directamente, em duas fases. Se falhar, o
       * clube fica aberto e o convite gerado: dizer "não foi possível criar" a
       * quem já tem um clube criado seria mentira, e mandá-lo tentar outra vez
       * criava um segundo clube. Diz-se o que faltou e segue-se.
       */
      let comSimbolo = result;
      if (logo) {
        let subiu = true;
        try {
          await enviarSimbolo(result.academy.id, logo);
        } catch {
          subiu = false;
          setError("O símbolo não subiu — o convite segue sem ele. Carrega-o depois nas Definições do clube.");
        }

        /*
         * O convite adiado, agora. Sai mesmo que o símbolo tenha falhado: um
         * clube sem emblema abre na mesma, um presidente sem convite não.
         */
        try {
          const convite = await apiPost<{ inviteLink: string; emailed: boolean; emailError?: string }>(
            `/academies/${result.academy.id}/convite`,
            {},
          );
          comSimbolo = { ...result, ...convite };
          if (subiu && convite.emailError) setError(`O convite não saiu por email: ${convite.emailError}`);
        } catch (err) {
          comSimbolo = { ...result, emailed: false };
          setError(err instanceof Error ? err.message : "O convite não saiu por email. Envia o link à mão.");
        }
      }

      setCreated(comSimbolo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  }

  function escolherFicheiro(file: File) {
    setError(null);
    if (!LOGO_TYPES.includes(file.type)) {
      setError("O símbolo tem de ser PNG, WebP ou JPEG.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("O símbolo tem de ter menos de 2 MB.");
      return;
    }
    setLogo(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && (created ? onCreated() : onClose())}
    >
      <div role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <h2 className="text-panel text-ink">{created ? "Academia criada" : "Nova academia"}</h2>
          <button type="button" onClick={created ? onCreated : onClose} className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        {created ? <Result created={created} aviso={error} onDone={onCreated} /> : (
          <form onSubmit={submit} className="space-y-4 p-5">
            <Field label="Nome da academia">
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Academia Life Club" autoFocus />
            </Field>

            <Field label="Endereço" hint="onde o clube vive">
              <div className="flex items-center gap-1.5">
                <input
                  className={cx(INPUT, "font-mono text-[13px]")}
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                  placeholder="life-club"
                />
                <span className="shrink-0 font-mono text-meta text-ink-3">.academias.pt</span>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome do diretor">
                <input className={INPUT} value={directorName} onChange={(e) => setDirectorName(e.target.value)} placeholder="Helena Sá Pereira" />
              </Field>
              <Field label="E-mail do diretor" hint="recebe o convite">
                <input type="email" className={INPUT} value={directorEmail} onChange={(e) => setDirectorEmail(e.target.value)} placeholder="direcao@clube.pt" />
              </Field>
            </div>

            {/*
              O cargo de quem recebe o convite — escrito, não escolhido.

              Era uma lista de seis opções, e a lista estava errada por
              construção: os nomes que os clubes usam para os seus cargos não são
              adivinháveis ("Diretor-Geral", "Presidente da Direção", "Vogal").
              Escrever é o único que os cobre todos.

              "Presidente" vem preenchido porque é o caso normal, e é reconhecido
              em qualquer grafia — Presidente, presidente, PRESIDENTE são o mesmo
              cargo, e o clube não abre com dois a dizer o mesmo.
            */}
            <div>
              <Field label="Cargo de quem recebe o convite" hint="escreve o que o clube usa">
                <input
                  className={INPUT}
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="Presidente"
                />
              </Field>

              {ehPresidente(roleName) ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
                  O clube abre só com o cargo de <strong className="font-medium text-ink-3">Presidente</strong>,
                  com todas as permissões.
                </p>
              ) : (
                <>
                  <div className="mt-2">
                    <Field label="Departamento" hint="onde este cargo vive">
                      <select
                        className={INPUT}
                        value={roleDepartment}
                        onChange={(e) => setRoleDepartment(e.target.value)}
                      >
                        {DEPARTAMENTOS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
                    O clube abre com <strong className="font-medium text-ink-3">{roleName.trim() || "este cargo"}</strong>{" "}
                    e com o de <strong className="font-medium text-ink-3">Presidente</strong>, por preencher. Esta
                    primeira pessoa entra com todas as permissões — é ela que monta o clube.
                  </p>
                </>
              )}
            </div>

            {/*
              A identidade do clube, atrás de um resumo.

              Fechada por omissão porque a maior parte dos clubes abre sem o
              emblema à mão, e dois campos abertos que ficam vazios são dois
              campos que fazem o formulário parecer maior do que é. O resumo na
              linha diz o que já está escolhido, para não ser preciso abrir para
              saber.
            */}
            <div className="rounded-[var(--radius-control)] border border-line">
              <button
                type="button"
                onClick={() => setIdentidadeAberta((v) => !v)}
                aria-expanded={identidadeAberta}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <span
                  aria-hidden
                  className="size-6 shrink-0 overflow-hidden rounded-[5px] border border-line"
                  style={{ background: logoPreview ? "var(--color-sunken)" : corTocada ? cor : COR_OMISSAO }}
                >
                  {logoPreview && <img src={logoPreview} alt="" className="size-full object-contain" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-meta font-medium text-ink">Cor e símbolo do clube</span>
                  <span className="block text-[11px] text-ink-4">
                    {logo || corTocada
                      ? [logo ? "símbolo escolhido" : null, corTocada ? cor : null].filter(Boolean).join(" · ")
                      : "opcional — o clube também os define nas Definições"}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-4">{identidadeAberta ? "Fechar" : "Definir"}</span>
              </button>

              {identidadeAberta && (
                <div className="space-y-3 border-t border-line px-3 py-3">
                  <div>
                    <span className="mb-1.5 block text-meta font-medium text-ink">Cor</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={cor}
                        onChange={(e) => {
                          setCor(e.target.value);
                          setCorTocada(true);
                        }}
                        className="h-9 w-12 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-line bg-surface p-1"
                        aria-label="Cor do clube"
                      />
                      <input
                        className={cx(INPUT, "font-mono text-[13px]")}
                        value={cor}
                        onChange={(e) => {
                          const v = e.target.value.trim().toLowerCase();
                          setCor(v.startsWith("#") ? v : `#${v}`);
                          setCorTocada(true);
                        }}
                        placeholder={COR_OMISSAO}
                      />
                      {corTocada && (
                        <button
                          type="button"
                          onClick={() => {
                            setCor(COR_OMISSAO);
                            setCorTocada(false);
                          }}
                          className="ctl-ghost shrink-0"
                        >
                          Repor
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
                      Sem escolha, o clube abre no verde da plataforma.
                    </p>
                  </div>

                  <div>
                    <span className="mb-1.5 block text-meta font-medium text-ink">Símbolo</span>
                    <input
                      ref={fileInput}
                      type="file"
                      accept={LOGO_TYPES.join(",")}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) escolherFicheiro(f);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => fileInput.current?.click()} className="ctl-outline">
                        <ImagePlus className="size-3.5" strokeWidth={1.75} />
                        {logo ? "Trocar" : "Escolher ficheiro"}
                      </button>
                      {logo && (
                        <>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{logo.name}</span>
                          <button type="button" onClick={() => setLogo(null)} className="ctl-ghost shrink-0">
                            Tirar
                          </button>
                        </>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
                      Quadrado e com pelo menos 512 px de lado dá o melhor resultado. PNG, WebP ou JPEG até 2 MB.
                      Sobe depois de a academia estar criada.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <span className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-meta font-medium text-ink">Plano</span>
                <span className="text-meta text-ink-3">opcional</span>
              </span>
              <div className="space-y-1.5">
                {/*
                  Sem plano, primeiro — é o caminho mais comum.

                  Um clube que abre hoje entra em período experimental e decide o
                  plano no fim dele, com a coisa já a funcionar. Obrigar a escolher
                  agora é pedir uma decisão que ninguém tem para dar — e um plano
                  marcado por omissão criava uma subscrição que o cliente nunca viu.
                */}
                <label
                  className={cx(
                    "block cursor-pointer rounded-[var(--radius-control)] border px-3 py-3 transition-colors duration-[120ms]",
                    planId === ""
                      ? "border-signal bg-signal-soft/40"
                      : "border-line hover:bg-sunken",
                  )}
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="plano"
                      checked={planId === ""}
                      onChange={() => setPlanId("")}
                      className="mt-1 size-3.5 shrink-0 accent-[var(--color-signal)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium text-ink">Só período experimental</span>
                      <span className="mt-0.5 block text-meta text-ink-3">
                        O clube abre com 30 dias de teste e sem subscrição. O plano associa-se
                        depois, quando o clube decidir.
                      </span>
                    </span>
                  </span>
                </label>
                {/*
                  O plano por inteiro, e não só o preço.

                  Mostrava o nome e um número. Quem abre um clube tinha de saber
                  de cor o que cada plano traz — e a diferença entre os dois é
                  precisamente a app das famílias e os pagamentos, que é a
                  conversa toda da venda. A lista do que **não** inclui está cá
                  pela mesma razão: uma ausência descoberta depois de assinar é
                  uma chamada de reclamação.
                */}
                {plans.map((p) => {
                  const escolhido = planId === p.id;
                  return (
                    <label
                      key={p.id}
                      className={cx(
                        "block cursor-pointer rounded-[var(--radius-control)] border px-3 py-3 transition-colors duration-[120ms]",
                        escolhido ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
                      )}
                    >
                      <span className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="plano"
                          checked={escolhido}
                          onChange={() => setPlanId(p.id)}
                          className="mt-1 size-3.5 shrink-0 accent-[var(--color-signal)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-body font-medium text-ink">{p.name}</span>
                            <span className="text-body font-semibold text-ink tabular">{euros(p.amountCents)}</span>
                            <span className="text-meta text-ink-3">/mês</span>
                            {p.isRecommended && (
                              <span className="rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                Recomendado
                              </span>
                            )}
                          </span>
                          {p.tagline && <span className="mt-0.5 block text-meta text-ink-3">{p.tagline}</span>}
                          <span className="mt-0.5 block text-[11px] text-ink-4">{p.trialDays} dias grátis</span>
                        </span>
                      </span>

                      {/* As listas só no plano escolhido: os dois abertos ao
                          mesmo tempo davam trinta linhas num diálogo. */}
                      {escolhido && (p.features.length > 0 || p.excludes.length > 0) && (
                        <span className="mt-2.5 block border-t border-line pt-2.5 pl-6">
                          <ul className="space-y-1">
                            {p.features.map((f) => (
                              <li key={f} className="flex items-start gap-1.5 text-meta text-ink-2">
                                <Check className="mt-0.5 size-3 shrink-0 text-signal" strokeWidth={2.5} />
                                {f}
                              </li>
                            ))}
                          </ul>
                          {p.excludes.length > 0 && (
                            <>
                              <span className="mt-2 block text-[11px] font-medium text-ink-4">Não inclui</span>
                              <ul className="mt-1 space-y-1">
                                {p.excludes.map((f) => (
                                  <li key={f} className="flex items-start gap-1.5 text-meta text-ink-4">
                                    <X className="mt-0.5 size-3 shrink-0" strokeWidth={2.5} />
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="ctl-ghost">Cancelar</button>
              <button type="submit" className="ctl-primary" disabled={!valid || busy}>
                {busy ? "A criar…" : "Criar e enviar convite"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * O símbolo, em duas fases.
 *
 * Igual ao da consola: pedir autorização, carregar directamente para o Supabase,
 * confirmar que chegou. O ficheiro não passa pela nossa API — ver
 * `club-logo.service.ts`. A porta é que é outra: aqui é a da plataforma, porque
 * o clube ainda não tem ninguém lá dentro para o fazer.
 */
async function enviarSimbolo(academyId: string, file: File) {
  const { url, token, key } = await apiPost<{ url: string; token: string; key: string }>(
    `/academies/${academyId}/simbolo/upload`,
    { contentType: file.type },
  );

  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type, Authorization: `Bearer ${token}` },
    body: file,
  });
  if (!res.ok) throw new Error("O carregamento falhou.");

  await apiPost(`/academies/${academyId}/simbolo`, { key });
}

/**
 * O link, uma vez.
 *
 * Na base guarda-se só o hash do token — ninguém, nem nós, o consegue reconstruir.
 * Quem perder o link revoga e emite outro, e é dito aqui para não parecer falha da
 * interface.
 */
function Result({ created, aviso, onDone }: { created: Created; aviso: string | null; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão: o link está à vista para copiar à mão */
    }
  }

  return (
    <div className="space-y-4 p-5">
      {/* O símbolo pode ter falhado sem que o clube tenha falhado. Dizê-lo aqui,
          e não em vez do resultado, é a diferença entre um aviso e uma mentira. */}
      {aviso && (
        <p className="rounded-[var(--radius-control)] bg-[#fdf3e3] px-3 py-2 text-meta text-[#8a5a10]">{aviso}</p>
      )}

      <p className="text-body leading-relaxed text-ink-2">
        <strong className="font-medium text-ink">{created.academy.name}</strong> está criada em{" "}
        <span className="font-mono text-[13px]">{created.academy.slug}.academias.pt</span>, com o cargo de{" "}
        <strong className="font-medium text-ink">{created.roleName}</strong>.{" "}
        {/*
          O que a página diz depende de o email ter saído.

          Dizia sempre "envia este link", porque não havia email nenhum. Agora
          que há, insistir nisso levava alguém a mandar uma segunda mensagem com
          um link que a pessoa já tinha recebido — ou, pior, a ficar descansado
          quando o envio falhou.
        */}
        {created.emailed
          ? "O convite já seguiu por email. O link fica aqui para o caso de precisares de o mandar por outra via."
          : "O convite não saiu por email — envia este link, que é a única porta que essa pessoa tem."}
      </p>

      <div className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
        <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">{created.inviteLink}</code>
        <button type="button" onClick={copy} className="ctl-outline mt-2.5 w-full justify-center">
          {copied ? <><Check className="size-3.5" strokeWidth={2} /> Copiado</> : <><Copy className="size-3.5" strokeWidth={1.75} /> Copiar link</>}
        </button>
      </div>

      <ul className="space-y-1.5 text-meta leading-relaxed text-ink-3">
        <li>· Válido 7 dias e só pode ser usado uma vez.</li>
        <li>· Avaliação até {new Date(created.trialEndsAt).toLocaleDateString("pt-PT")}.</li>
        <li>· Guarda-o agora: por segurança, o link não volta a ser mostrado.</li>
      </ul>

      <div className="flex justify-end">
        <button type="button" onClick={onDone} className="ctl-primary">Concluído</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const INPUT =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Gémeo do `slugify` do servidor. O servidor é que decide; isto é a pré-visualização. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
