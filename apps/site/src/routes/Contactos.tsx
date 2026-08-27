import { useState, type FormEvent, type ReactNode } from "react";
import { Reveal, cx } from "@/components/primitives";
import { CONTACT_EMAIL } from "@/lib/content";

/**
 * Contacto.
 *
 * ## A composição
 *
 * Duas superfícies: à esquerda, a casa — um painel verde-pinheiro com o canto
 * da marca, o email directo e o que acontece a seguir; à direita, papel com
 * linhas para escrever. O formulário não é um cartão branco com oito caixas:
 * são campos de filete, como uma ficha de inscrição de um clube a sério.
 *
 * ## O assunto decide o formulário
 *
 * Três assuntos, em separadores de texto — não seis cartões. "Experimentar" e
 * "Marcar reunião" pedem o contexto do clube; "Outro assunto" pede só a
 * pergunta.
 *
 * ## Porque é que não abre o email
 *
 * O formulário fala com `POST /api/site/contacto`, que grava o contacto na
 * mesma tabela que a plataforma lista em "Contactos" — cai lá **antes** de a
 * página dizer que está feito. O `mailto:` só aparece como escolha explícita
 * quando a API falha; nunca dispara sozinho (ver o `catch`).
 */

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

type Subject = {
  id: string;
  label: string;
  /** Pede o contexto do clube — quem vem por negócio. */
  clube: boolean;
  /** O que acontece depois de enviar, escrito para este assunto. */
  steps: [string, string][];
};

const SUBJECTS: Subject[] = [
  {
    id: "experimentar",
    label: "Experimentar",
    clube: true,
    steps: [
      ["Recebes o link de acesso", "Assim que lermos o teu pedido, enviamos por email o acesso à plataforma com o teu clube já criado."],
      ["Entras e experimentas", "Trinta dias com tudo, sem cartão. Podes convidar a equipa técnica e as famílias desde o primeiro dia."],
      ["Ajudamos a montar, se quiseres", "Equipas, escalões, plantel por Excel e mensalidades. Dizes tu se preferes fazer sozinho ou connosco."],
    ],
  },
  {
    id: "reuniao",
    label: "Marcar reunião",
    clube: true,
    steps: [
      ["Combinamos uma hora", "Respondemos com duas ou três hipóteses. Vinte minutos chegam para a primeira conversa."],
      ["Falamos do clube", "Não do software. Queremos perceber onde é que o trabalho está a doer antes de mostrar seja o que for."],
      ["Mostramos com o teu caso à frente", "E, se fizer sentido, deixamos-te a experimentar no fim."],
    ],
  },
  { id: "outro", label: "Outro assunto", clube: false, steps: [] },
];

export default function Contactos() {
  const [subject, setSubject] = useState<Subject>(SUBJECTS[0]);
  const [name, setName] = useState("");
  const [club, setClub] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [athletes, setAthletes] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  /**
   * O `mailto:` de recurso, pronto mas nunca disparado sozinho — só existe para
   * dar um botão a quem quer mesmo escrever depois de a API falhar.
   */
  const [fallbackMailto, setFallbackMailto] = useState<string | null>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid =
    name.trim().length >= 2 &&
    emailOk &&
    (subject.clube ? club.trim().length >= 2 : message.trim().length >= 5);

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
          club: subject.clube ? club.trim() || undefined : undefined,
          subject: subject.label,
          // O id estável, a par do rótulo: é por ele que a plataforma filtra.
          subjectId: subject.id,
          athletes: subject.clube ? athletes.trim() || undefined : undefined,
          message: message.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("done");
    } catch {
      /*
       * A API falhou — sem rede, ou o servidor em baixo. Não se abre o cliente
       * de email sozinho: diz-se que falhou, a sério, e deixa-se um botão para
       * quem quiser mesmo escrever à mão — uma escolha da pessoa, não um
       * efeito secundário do erro.
       */
      setStatus("error");
      const body = [
        `Assunto: ${subject.label}`,
        `Nome: ${name.trim()}`,
        subject.clube && club.trim() && `Clube: ${club.trim()}`,
        `Email: ${email.trim()}`,
        phone.trim() && `Telefone: ${phone.trim()}`,
        subject.clube && athletes.trim() && `Atletas: ${athletes.trim()}`,
        "",
        message.trim(),
      ]
        .filter(Boolean)
        .join("\n");
      const assunto = subject.clube && club.trim() ? `${subject.label} — ${club.trim()}` : subject.label;
      setFallbackMailto(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(body)}`);
    }
  }

  return (
    <div className="wrap band-tight">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        {/* A casa — o painel escuro */}
        <Reveal>
          <aside className="dark canto flex flex-col p-8 sm:p-10 lg:sticky lg:top-24 lg:min-h-[560px]">
            <h1 className="display d2 max-w-[12ch]">
              Diz-nos o que <em>precisas.</em>
            </h1>
            <p className="mt-5 max-w-[36ch] text-[15px] leading-relaxed text-ink-2">
              Experimentar, marcar uma reunião, ou só tirar uma dúvida. Respondemos em dias úteis — com o que é verdade
              hoje, não com o que gostávamos que fosse.
            </p>

            <div className="mt-8 border-t border-line pt-6">
              <p className="field-label">Directo</p>
              <a href={`mailto:${CONTACT_EMAIL}`} className="link mt-2.5 inline-block text-[17px] font-semibold tracking-[-0.02em] text-white">
                {CONTACT_EMAIL}
              </a>
            </div>

            {subject.clube && subject.steps.length > 0 ? (
              <div className="mt-8 border-t border-line pt-6">
                <p className="field-label">O que acontece a seguir</p>
                <ol className="mt-4 space-y-4">
                  {subject.steps.map(([t, d], i) => (
                    <li key={t} className="flex gap-4">
                      <span className="display mt-px text-[17px] leading-[1.4] text-mint" aria-hidden>
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-[15px] font-semibold tracking-[-0.02em]">{t}</span>
                        <span className="mt-0.5 block max-w-[38ch] text-[13.5px] leading-relaxed text-ink-2">{d}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="mt-8 border-t border-line pt-6">
                <p className="field-label">Uma pergunta é uma pergunta</p>
                <p className="mt-3 max-w-[38ch] text-[13.5px] leading-relaxed text-ink-2">
                  Não é preciso ser de um clube nem estar a pensar comprar. Respondemos a quem quer perceber como
                  funciona, a quem está a comparar com outra coisa — e dizemos que não quando não fazemos.
                </p>
              </div>
            )}

            <p className="mt-8 border-t border-line pt-6 text-[12.5px] leading-relaxed text-ink-3 lg:mt-auto lg:pt-6">
              Perguntas sobre tratamento de dados? Escolhe <span className="font-semibold text-white">Outro assunto</span> e
              escreve — respondemos com detalhe técnico, não com um folheto.
            </p>
          </aside>
        </Reveal>

        {/* O papel — o formulário */}
        {status === "done" ? (
          <Reveal>
            <div className="pt-2 lg:pt-6">
              <h2 className="display d2 max-w-[14ch]">Chegou-nos. Obrigado.</h2>
              <p className="mt-5 max-w-[48ch] text-[15.5px] leading-relaxed text-ink-2">
                {subject.id === "experimentar" ? (
                  <>
                    Enviamos o link de acesso à plataforma para{" "}
                    <span className="font-semibold text-ink">{email.trim()}</span> em dias úteis, com o teu clube já
                    criado.
                  </>
                ) : (
                  <>
                    A tua mensagem já está na nossa lista de contactos — não depende de teres um email aberto neste
                    computador. Respondemos a <span className="font-semibold text-ink">{email.trim()}</span> em dias
                    úteis.
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
                className="btn btn-outline mt-8"
              >
                Enviar outra mensagem
              </button>
            </div>
          </Reveal>
        ) : (
          <Reveal i={1}>
            <form onSubmit={submit} className="pt-2 lg:pt-6">
              {/* O assunto primeiro: é ele que decide o resto do formulário. */}
              <p className="field-label">Assunto</p>
              <div role="tablist" aria-label="Assunto" className="mt-3 flex flex-wrap gap-x-7 gap-y-2 border-b border-line">
                {SUBJECTS.map((s) => {
                  const on = subject.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setSubject(s)}
                      className={cx(
                        "-mb-px border-b-2 pb-3 text-[15px] font-semibold tracking-[-0.01em] transition-colors",
                        on ? "border-field text-ink" : "border-transparent text-ink-3 hover:text-ink",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2">
                <Field label="O teu nome" className="sm:col-span-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input-line" autoComplete="name" />
                </Field>

                {/* Só para quem vem por causa do clube. */}
                {subject.clube && (
                  <>
                    <Field label="Clube ou academia" className="sm:col-span-2">
                      <input value={club} onChange={(e) => setClub(e.target.value)} className="input-line" />
                    </Field>

                    <Field label="Quantos atletas" hint="mais ou menos">
                      <input
                        value={athletes}
                        onChange={(e) => setAthletes(e.target.value)}
                        className="input-line"
                        inputMode="numeric"
                      />
                    </Field>

                    <Field label="Telefone" hint="opcional">
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="input-line"
                        inputMode="tel"
                        autoComplete="tel"
                      />
                    </Field>
                  </>
                )}

                <Field label="Email" className={subject.clube ? "sm:col-span-2" : ""}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-line"
                    autoComplete="email"
                  />
                </Field>

                {!subject.clube && (
                  <Field label="Telefone" hint="opcional">
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="input-line"
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </Field>
                )}

                <Field
                  label={subject.clube ? "Como está o clube hoje" : "A tua pergunta"}
                  hint={subject.clube ? "opcional" : undefined}
                  className="sm:col-span-2"
                >
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    placeholder={
                      subject.clube
                        ? "Excel? Um software que não gostam? Nada ainda? Diz como é — é o que nos ajuda a responder."
                        : "Escreve à vontade. Respondemos com o que é verdade hoje, não com o que gostávamos que fosse."
                    }
                    className="input-line"
                  />
                </Field>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={!valid || status === "sending"}
                    className="btn btn-primary w-full sm:w-auto disabled:opacity-40"
                  >
                    {status === "sending" ? "A enviar…" : "Enviar"}
                    <span aria-hidden className="arr">→</span>
                  </button>

                  {status === "error" ? (
                    <div className="canto-sm mt-4 border border-[#e5b8ae] bg-[#fdf3f0] px-4 py-3.5">
                      <p className="text-[13.5px] leading-relaxed text-[#a82a20]">
                        Não conseguimos entregar a tua mensagem agora — tenta outra vez daqui a um bocado, ou
                        escreve-nos directamente.
                      </p>
                      {fallbackMailto && (
                        <a href={fallbackMailto} className="link mt-2 inline-block text-[13.5px] font-semibold text-[#a82a20]">
                          Escrever email agora →
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="mt-4 text-[13px] text-ink-3">
                      Respondemos em até dois dias úteis.
                    </p>
                  )}
                </div>
              </div>
            </form>
          </Reveal>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <span className="mb-1 flex items-baseline justify-between gap-3">
        <span className="field-label">{label}</span>
        {hint && <span className="text-[12px] text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
