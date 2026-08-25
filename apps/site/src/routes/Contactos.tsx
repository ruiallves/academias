import { useState, type FormEvent, type ReactNode } from "react";
import { Reveal, SectionMark } from "@/components/primitives";
import { CONTACT_EMAIL } from "@/lib/content";

/**
 * Contacto.
 *
 * ## O assunto decide o formulário
 *
 * Três opções, num menu — não seis cartões. "Experimentar a plataforma" e "Marcar
 * reunião" pedem o contexto do clube (é o que faz a resposta útil); "Outro
 * assunto" pede só a pergunta, para quem só quer saber alguma coisa sem estar a
 * decidir comprar.
 *
 * ## Porque é que já não abre o email
 *
 * Abria, e era o problema. Um botão que só faz `mailto:` não garante nada: não há
 * cliente de email configurado, o browser bloqueia o separador, a pessoa fecha a
 * janela antes de carregar em enviar — e nesse caso o contacto nunca chega a lado
 * nenhum, apesar de a página ter dito "aberto o teu email".
 *
 * Agora o formulário fala com `POST /api/site/contacto`, que grava o contacto
 * directamente na mesma tabela que a nossa plataforma de gestão lista em
 * "Contactos" — cai lá **antes** de a página dizer que está feito, por isso
 * "enviado" passa a ser verdade e não uma promessa que depende do computador de
 * quem está a escrever. O contacto do email directo continua ali para quem
 * preferir esse caminho, mas deixou de ser o único.
 */

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

type Subject = {
  id: string;
  label: string;
  /** Pede o contexto do clube — quem vem por negócio. */
  clube: boolean;
  /**
   * O que acontece depois de enviar, escrito para **este** assunto.
   *
   * Quem pede para experimentar recebe um link e entra sozinho; quem quer uma
   * reunião marca uma hora e fala com uma pessoa. São caminhos diferentes, e
   * descrever os dois com os mesmos três passos era prometer a marcação de uma
   * reunião a quem só queria a chave da porta.
   */
  steps: [string, string][];
};

const SUBJECTS: Subject[] = [
  {
    id: "experimentar",
    label: "Experimentar a plataforma",
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
   * O `mailto:` de recurso, pronto mas nunca disparado sozinho.
   *
   * Só existe para dar um botão a quem quer mesmo escrever depois de a API
   * falhar — nunca corre `window.location.href` sozinho. Ver o porquê no `catch`
   * de `submit`.
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
          athletes: subject.clube ? athletes.trim() || undefined : undefined,
          message: message.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("done");
    } catch {
      /*
       * A API falhou — sem rede, ou o servidor em baixo. Isto **não** abre o
       * cliente de email sozinho.
       *
       * Abria, e era exactamente o problema que este formulário resolveu: um
       * `mailto:` automático dá a mesma cara de "falhou" a duas coisas
       * diferentes — não há cliente de email configurado (a maioria dos
       * computadores), ou há, mas a pessoa fecha o separador que se abriu sem
       * perceber porquê e sem carregar em enviar. Em nenhum dos dois casos o
       * contacto chega a nós, e a pessoa nunca sabe que falhou.
       *
       * Em vez disso: dizemos que falhou, a sério, e deixamos um botão para
       * quem quiser mesmo escrever à mão — uma escolha da pessoa, não um efeito
       * secundário do erro.
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
    <>
      <header className="border-b border-line">
        <div className="wrap pt-14 pb-12 sm:pt-20 sm:pb-14">
          <Reveal>
            <SectionMark n="—">Contacto</SectionMark>
            <h1 className="display d1 mt-6 max-w-[13ch]">Diz-nos o que precisas.</h1>
            <p className="lede mt-6">
              Queres experimentar, marcar uma reunião, ou só tirar uma dúvida? Escolhe o assunto — o formulário
              segue-te. Respondemos em dias úteis.
            </p>
          </Reveal>
        </div>
      </header>

      <div className="wrap band-tight grid gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-20">
        {status === "done" ? (
          <Reveal>
            <div className="rounded-[3px] border border-line-2 bg-chalk p-7 sm:p-9">
              <p className="eyebrow">Recebido</p>
              <h2 className="display d3 mt-3 max-w-[16ch]">Chegou-nos. Obrigado.</h2>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">
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
                className="btn btn-outline mt-7"
              >
                Enviar outra mensagem
              </button>
            </div>
          </Reveal>
        ) : (
        <Reveal>
          <form onSubmit={submit}>
            {/* O assunto primeiro: é ele que decide o resto do formulário. */}
            <Field label="Assunto">
              <div className="relative">
                <select
                  value={subject.id}
                  onChange={(e) => setSubject(SUBJECTS.find((s) => s.id === e.target.value) ?? SUBJECTS[0])}
                  className={`${INPUT} appearance-none pr-10`}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <svg
                  aria-hidden
                  viewBox="0 0 12 8"
                  className="pointer-events-none absolute top-1/2 right-3.5 size-2.5 -translate-y-1/2"
                >
                  <path
                    d="M1 1.5 6 6.5 11 1.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </Field>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="O teu nome" className="sm:col-span-2">
                <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="name" />
              </Field>

              {/* Só para quem vem por causa do clube. */}
              {subject.clube && (
                <>
                  <Field label="Clube ou academia" className="sm:col-span-2">
                    <input value={club} onChange={(e) => setClub(e.target.value)} className={INPUT} />
                  </Field>

                  <Field label="Quantos atletas" hint="mais ou menos">
                    <input
                      value={athletes}
                      onChange={(e) => setAthletes(e.target.value)}
                      className={INPUT}
                      inputMode="numeric"
                    />
                  </Field>

                  <Field label="Telefone" hint="opcional">
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={INPUT}
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
                  className={INPUT}
                  autoComplete="email"
                />
              </Field>

              {!subject.clube && (
                <Field label="Telefone" hint="opcional">
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={INPUT}
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
                  rows={5}
                  placeholder={
                    subject.clube
                      ? "Excel? Um software que não gostam? Nada ainda? Diz como é — é o que nos ajuda a responder."
                      : "Escreve à vontade. Respondemos com o que é verdade hoje, não com o que gostávamos que fosse."
                  }
                  className={`${INPUT} h-auto resize-y py-3`}
                />
              </Field>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={!valid || status === "sending"}
                  className="btn btn-ink w-full sm:w-auto disabled:opacity-40"
                >
                  {status === "sending" ? "A enviar…" : "Enviar"}
                </button>

                {status === "error" ? (
                  <div className="mt-3 rounded-[2px] border border-[#f0c9c2] bg-[#fdf3f1] px-3.5 py-3">
                    <p className="text-[13px] leading-relaxed text-[#a82a20]">
                      Não conseguimos entregar a tua mensagem agora — tenta outra vez daqui a um bocado, ou
                      escreve-nos directamente.
                    </p>
                    {fallbackMailto && (
                      <a href={fallbackMailto} className="link mt-2 inline-block text-[13px] font-semibold">
                        Escrever email agora →
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-[13px] text-ink-3">
                    Cai directamente na nossa lista de contactos, sem depender de teres email configurado.
                  </p>
                )}
              </div>
            </div>
          </form>
        </Reveal>
        )}

        <Reveal i={1}>
          <div className="border-t border-line pt-6">
            <p className="eyebrow">Directo</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="link mt-3 block text-[19px] font-semibold tracking-[-0.02em]">
              {CONTACT_EMAIL}
            </a>
          </div>

          {subject.clube ? (
            <div className="mt-10 border-t border-line pt-6">
              <p className="eyebrow">O que acontece a seguir</p>
              <ol className="mt-4 space-y-4">
                {subject.steps.map(([t, d], i) => (
                  <li key={t} className="flex gap-4">
                    <span className="mt-0.5 font-mono text-[12px] text-ink-4 tabular">0{i + 1}</span>
                    <span>
                      <span className="block text-[15.5px] font-semibold tracking-[-0.02em]">{t}</span>
                      <span className="mt-0.5 block max-w-[40ch] text-[14.5px] leading-relaxed text-ink-2">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="mt-10 border-t border-line pt-6">
              <p className="eyebrow">Uma pergunta é uma pergunta</p>
              <p className="mt-3 max-w-[40ch] text-[14.5px] leading-relaxed text-ink-2">
                Não é preciso ser de um clube nem estar a pensar comprar. Respondemos a quem quer perceber como
                funciona, a quem está a comparar com outra coisa, e a quem só quer saber se fazemos determinada coisa —
                e dizemos que não quando não fazemos.
              </p>
            </div>
          )}

          <div className="mt-10 border-t border-line pt-6">
            <p className="eyebrow">Segurança</p>
            <p className="mt-3 max-w-[40ch] text-[14.5px] leading-relaxed text-ink-2">
              Para perguntas sobre tratamento de dados, escolhe <span className="font-semibold text-ink">Outro assunto</span>{" "}
              e escreve-o — respondemos com detalhe técnico, e não com um folheto.
            </p>
          </div>
        </Reveal>
      </div>
    </>
  );
}

const INPUT =
  "h-12 w-full rounded-[2px] border border-line-2 bg-chalk px-3.5 text-[15.5px] text-ink placeholder:text-ink-4 transition-colors focus:border-ink focus:outline-none";

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
      <span className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-semibold">{label}</span>
        {hint && <span className="text-[12.5px] text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
