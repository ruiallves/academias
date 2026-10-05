import { cloneElement, type FormEvent, isValidElement, type ReactElement, type ReactNode, useId, useState } from "react";
import { API } from "@/lib/api";
import { cx, Seta } from "@/components/marca";
import { CONTACT_EMAIL } from "@/lib/content";

/**
 * Contacto.
 *
 * ## A composição
 *
 * Duas superfícies: à esquerda, o palco do lusco-fusco com o email direto e o
 * que acontece a seguir; à direita, cal com linhas para escrever. Os campos são
 * de filete, como uma ficha de inscrição.
 *
 * ## O assunto decide o formulário
 *
 * Três assuntos, em separadores de texto. "Experimentar" e "Marcar reunião"
 * pedem o contexto do clube; "Outro assunto" pede só a pergunta.
 *
 * ## Porque é que não abre o email
 *
 * O formulário fala com `POST /api/site/contacto`, que grava o pedido na
 * plataforma **antes** de a página dizer que está feito. O `mailto:` só aparece
 * como escolha explícita quando a API falha; nunca dispara sozinho.
 */

type Assunto = {
  id: string;
  label: string;
  /** Pede o contexto do clube. */
  clube: boolean;
  /** O que acontece depois de enviar, escrito para este assunto. */
  passos: [string, string][];
};

/** Os cargos que aparecem como sugestão. Não é uma lista fechada. */
const CARGOS = ["Presidente", "Vice-presidente", "Direção", "Coordenador", "Diretor desportivo", "Treinador", "Secretaria"];

const ASSUNTOS: Assunto[] = [
  {
    id: "experimentar",
    label: "Experimentar",
    clube: true,
    passos: [
      ["Recebes o link de acesso", "Assim que lermos o teu pedido, enviamos por email o acesso à plataforma com o teu clube já criado."],
      ["Entras e experimentas", "Trinta dias com tudo, sem cartão. Podes convidar a equipa técnica e as famílias desde o primeiro dia."],
      ["Ajudamos a montar, se quiseres", "Equipas, escalões, plantel por Excel e mensalidades. Dizes tu se preferes fazer sozinho ou connosco."],
    ],
  },
  {
    id: "reuniao",
    label: "Marcar reunião",
    clube: true,
    passos: [
      ["Combinamos uma hora", "Respondemos com duas ou três hipóteses. Vinte minutos chegam para a primeira conversa."],
      ["Falamos do clube", "Queremos perceber onde o trabalho custa mais antes de mostrar seja o que for."],
      ["Mostramos com o teu caso à frente", "E, se fizer sentido, deixamos-te a experimentar no fim."],
    ],
  },
  { id: "outro", label: "Outro assunto", clube: false, passos: [] },
];

export default function Contactos() {
  const [assunto, setAssunto] = useState<Assunto>(ASSUNTOS[0]);
  const [name, setName] = useState("");
  const [club, setClub] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [athletes, setAthletes] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  /** O `mailto:` de recurso, pronto mas nunca disparado sozinho. */
  const [fallbackMailto, setFallbackMailto] = useState<string | null>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = name.trim().length >= 2 && emailOk && (assunto.clube ? club.trim().length >= 2 : message.trim().length >= 5);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || status === "sending") return;

    setStatus("sending");
    try {
      const res = await fetch(`${API}/api/site/contacto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          club: assunto.clube ? club.trim() || undefined : undefined,
          role: assunto.clube ? role.trim() || undefined : undefined,
          subject: assunto.label,
          // O id estável, a par do rótulo: é por ele que a plataforma filtra.
          subjectId: assunto.id,
          athletes: assunto.clube ? athletes.trim() || undefined : undefined,
          message: message.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("done");
    } catch {
      // A API falhou. Diz-se que falhou e deixa-se um botão para quem quiser
      // escrever à mão: uma escolha da pessoa, e não um efeito do erro.
      setStatus("error");
      const body = [
        `Assunto: ${assunto.label}`,
        `Nome: ${name.trim()}`,
        assunto.clube && club.trim() && `Clube: ${club.trim()}`,
        assunto.clube && role.trim() && `Cargo: ${role.trim()}`,
        `Email: ${email.trim()}`,
        phone.trim() && `Telefone: ${phone.trim()}`,
        assunto.clube && athletes.trim() && `Atletas: ${athletes.trim()}`,
        "",
        message.trim(),
      ]
        .filter(Boolean)
        .join("\n");
      const titulo = assunto.clube && club.trim() ? `${assunto.label}: ${club.trim()}` : assunto.label;
      setFallbackMailto(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(titulo)}&body=${encodeURIComponent(body)}`);
    }
  }

  return (
    <div className="palco-cal sob-o-topo">
      <div className="wrap grid items-start gap-10 pb-[clamp(56px,8vw,120px)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <aside className="palco-noite flex flex-col rounded-(--raio-g) p-8 sm:p-10 lg:sticky lg:top-[calc(var(--topo)+24px)] lg:min-h-[560px]">
          <h1 className="titulo t2 max-w-[11ch]">Diz-nos o que precisas<span className="ponto">.</span></h1>
          <p className="mt-5 max-w-[36ch] text-[0.98rem] leading-relaxed text-texto-2">
            Experimentar, marcar uma reunião ou só tirar uma dúvida. Respondemos em dias úteis, com o que é verdade hoje.
          </p>

          <div className="fio-cima mt-8 pt-6">
            <p className="rotulo text-texto-3">Direto</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="ligacao mt-2.5 inline-block text-[1.1rem]">
              {CONTACT_EMAIL}
            </a>
          </div>

          {assunto.clube && assunto.passos.length > 0 ? (
            <div className="fio-cima mt-8 pt-6">
              <p className="rotulo text-texto-3">O que acontece a seguir</p>
              <ol className="mt-4 space-y-4">
                {assunto.passos.map(([t, d], i) => (
                  <li key={t} className="flex gap-4">
                    <span className="titulo text-[1.2rem] leading-[1.25] text-texto" aria-hidden>
                      {i + 1}
                    </span>
                    <span>
                      <span className="block font-semibold">{t}</span>
                      <span className="mt-0.5 block max-w-[38ch] text-[0.88rem] leading-relaxed text-texto-2">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="fio-cima mt-8 pt-6">
              <p className="rotulo text-texto-3">Qualquer pergunta serve</p>
              <p className="mt-3 max-w-[38ch] text-[0.88rem] leading-relaxed text-texto-2">
                Não é preciso ser de um clube nem estar a pensar comprar. Respondemos a quem quer perceber como funciona
                e a quem está a comparar com outra coisa. Quando não fazemos, dizemos que não.
              </p>
            </div>
          )}

          <p className="fio-cima mt-8 pt-6 text-[0.82rem] leading-relaxed text-texto-3 lg:mt-auto">
            Perguntas sobre tratamento de dados? Escolhe <span className="font-semibold text-texto">Outro assunto</span> e
            escreve. Respondemos com detalhe técnico.
          </p>
        </aside>

        {status === "done" ? (
          <div className="pt-2 lg:pt-6">
            <h2 className="titulo t2 max-w-[14ch]">Chegou-nos. Obrigado<span className="ponto">.</span></h2>
            <p className="corpo mt-5">
              {assunto.id === "experimentar" ? (
                <>
                  Enviamos o link de acesso à plataforma para <span className="font-semibold text-texto">{email.trim()}</span>{" "}
                  em dias úteis, com o teu clube já criado.
                </>
              ) : (
                <>
                  A tua mensagem já está na nossa lista de pedidos. Respondemos a{" "}
                  <span className="font-semibold text-texto">{email.trim()}</span> em dias úteis.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setName("");
                setClub("");
                setPhone("");
                setAthletes("");
                setMessage("");
              }}
              className="btn btn-fio mt-8"
            >
              Enviar outra mensagem
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="pt-2 lg:pt-6">
            {/* O assunto primeiro: é ele que decide o resto do formulário. */}
            <p className="rotulo campo-rotulo">Assunto</p>
            <div role="tablist" aria-label="Assunto" className="mt-3 flex flex-wrap gap-x-7 gap-y-2 border-b border-fio">
              {ASSUNTOS.map((s) => {
                const on = assunto.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setAssunto(s)}
                    className={cx(
                      "titulo t4 -mb-px border-b-2 pb-3 transition-colors",
                      on ? "border-texto text-texto" : "border-transparent text-texto-3 hover:text-texto",
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2">
              <Field label="O teu nome" className="sm:col-span-2">
                <input value={name} onChange={(e) => setName(e.target.value)} className="campo" autoComplete="name" />
              </Field>

              {assunto.clube && (
                <>
                  <Field label="Clube ou academia">
                    <input value={club} onChange={(e) => setClub(e.target.value)} className="campo" />
                  </Field>

                  {/* Texto livre com sugestões: "Vice-presidente para a formação" é um cargo a sério. */}
                  <Field label="O teu cargo" hint="opcional">
                    <input
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="campo"
                      list="cargos-no-clube"
                      autoComplete="organization-title"
                    />
                    <datalist id="cargos-no-clube">
                      {CARGOS.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </Field>

                  <Field label="Quantos atletas" hint="mais ou menos">
                    <input value={athletes} onChange={(e) => setAthletes(e.target.value)} className="campo" inputMode="numeric" />
                  </Field>

                  <Field label="Telefone" hint="opcional">
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} className="campo" inputMode="tel" autoComplete="tel" />
                  </Field>
                </>
              )}

              <Field label="Email" className={assunto.clube ? "sm:col-span-2" : ""}>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="campo" autoComplete="email" />
              </Field>

              {!assunto.clube && (
                <Field label="Telefone" hint="opcional">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className="campo" inputMode="tel" autoComplete="tel" />
                </Field>
              )}

              <Field
                label={assunto.clube ? "Como está o clube hoje" : "A tua pergunta"}
                hint={assunto.clube ? "opcional" : undefined}
                className="sm:col-span-2"
              >
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder={
                    assunto.clube
                      ? "Excel? Um software de que não gostam? Nada ainda? Diz como é."
                      : "Escreve à vontade."
                  }
                  className="campo"
                />
              </Field>

              <div className="sm:col-span-2">
                <button type="submit" disabled={!valid || status === "sending"} className="btn btn-cheio w-full disabled:opacity-40 sm:w-auto">
                  {status === "sending" ? "A enviar…" : "Enviar"}
                  <Seta />
                </button>

                {status === "error" ? (
                  <div className="mt-4 border border-[#e5b8ae] bg-[#fdf3f0] px-4 py-3.5">
                    <p className="text-[0.88rem] leading-relaxed text-[#a82a20]">
                      Não conseguimos entregar a tua mensagem agora. Tenta outra vez daqui a um bocado, ou escreve-nos
                      diretamente.
                    </p>
                    {fallbackMailto && (
                      <a href={fallbackMailto} className="mt-2 inline-block text-[0.88rem] font-semibold text-[#a82a20] underline">
                        Escrever email agora
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-[0.85rem] text-texto-3">Respondemos em até dois dias úteis.</p>
                )}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  const id = useId();
  // A ligação ao campo, quando é um só e não traz `id` seu: o rótulo foca o
  // campo sem o envolver.
  const soUmCampo =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) &&
    !(children.props as { id?: string }).id;

  return (
    <div className={className}>
      <label {...(soUmCampo ? { htmlFor: id } : {})} className="mb-1 flex items-baseline justify-between gap-3">
        <span className="rotulo campo-rotulo">{label}</span>
        {hint && <span className="text-[0.75rem] text-texto-3">{hint}</span>}
      </label>
      {soUmCampo ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
    </div>
  );
}
