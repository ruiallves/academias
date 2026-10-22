"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Botao } from "@/componentes/Botao";
import { CHAVE_TURNSTILE, Turnstile, type TurnstileHandle } from "@/componentes/Turnstile";

/**
 * O formulário de contacto. Etiquetas visíveis, e o assunto como lista para a
 * secretaria saber a quem encaminhar. A mensagem entra na consola do clube
 * pela API pública (`POST /api/clubes/:slug/contacto`); o clube responde
 * para o email de quem escreveu.
 *
 * ## Contra os robôs
 *
 * Ao abrir, o formulário pede uma ficha à API; só vale a partir de três
 * segundos depois, e vai com a mensagem. E há um campo-armadilha ("nota
 * extra") fora do ecrã, que uma pessoa nunca preenche: se vier cheio, a API
 * recusa. Em demonstração não se pede nada nem se envia nada: o clube não
 * existe na API.
 */

const ASSUNTOS = ["Inscrições e formação", "Sócios e quotas", "Bilhetes", "Loja e encomendas", "Patrocínios", "Outro"];

type Estado = { fase: "pronto" } | { fase: "a-enviar" } | { fase: "enviado" } | { fase: "erro"; mensagem: string };

export function FormularioContacto({
  slug,
  api,
  demonstracao,
  assuntoInicial,
}: {
  slug: string;
  api: string;
  demonstracao: boolean;
  /** Vem do `?assunto=` do endereço; só vale se for um da lista. */
  assuntoInicial?: string;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "pronto" });
  const ficha = useRef("");
  /** O desafio da Cloudflare. Ver `componentes/Turnstile`. */
  const desafio = useRef<TurnstileHandle | null>(null);

  const pedirFicha = useCallback(async () => {
    if (demonstracao) return;
    try {
      const r = await fetch(`${api}/api/clubes/${encodeURIComponent(slug)}/contacto/ficha`);
      const b = (await r.json().catch(() => ({}))) as { ficha?: string };
      ficha.current = r.ok && typeof b.ficha === "string" ? b.ficha : "";
    } catch {
      // Sem ficha, o envio falha e a resposta diz para recarregar: pede-se outra nessa altura.
      ficha.current = "";
    }
  }, [api, slug, demonstracao]);

  useEffect(() => {
    void pedirFicha();
  }, [pedirFicha]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (estado.fase === "a-enviar") return;
    const f = new FormData(e.currentTarget);
    const texto = (nome: string) => String(f.get(nome) ?? "").trim();
    if (!demonstracao && CHAVE_TURNSTILE && !desafio.current?.token()) {
      setEstado({ fase: "erro", mensagem: "Ainda estamos a confirmar que és uma pessoa. Espera um segundo e carrega outra vez." });
      return;
    }
    setEstado({ fase: "a-enviar" });
    try {
      if (demonstracao) {
        // O clube de demonstração não existe na API: finge-se o envio.
        await new Promise((ok) => setTimeout(ok, 700));
        setEstado({ fase: "enviado" });
        return;
      }
      const resposta = await fetch(`${api}/api/clubes/${encodeURIComponent(slug)}/contacto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: texto("nome"),
          email: texto("email"),
          telefone: texto("telefone") || undefined,
          assunto: texto("assunto"),
          mensagem: texto("mensagem"),
          notaExtra: texto("notaExtra"),
          ficha: ficha.current,
          turnstile: desafio.current?.token() || undefined,
        }),
      });
      const b = (await resposta.json().catch(() => ({}))) as { message?: string | string[] };
      if (!resposta.ok) {
        const mensagem = (Array.isArray(b.message) ? b.message[0] : b.message) || "Não foi possível enviar a mensagem. Tenta outra vez.";
        // "Recarrega a página": a ficha caducou ou faltou. Pede-se outra, e o segundo envio já vai com ela.
        if (/recarreg/i.test(mensagem)) void pedirFicha();
        // O token da Cloudflare foi gasto neste envio: o seguinte leva outro.
        desafio.current?.renovar();
        setEstado({ fase: "erro", mensagem });
        return;
      }
      setEstado({ fase: "enviado" });
    } catch {
      desafio.current?.renovar();
      setEstado({ fase: "erro", mensagem: "Falhou a ligação. Verifica a internet e tenta outra vez." });
    }
  };

  if (estado.fase === "enviado") {
    return (
      <div role="status" className="mt-6 rounded-card bg-sunken p-5 text-ink-2">
        <p className="font-semibold text-ink">Mensagem enviada. O clube responde para o teu email.</p>
        {demonstracao && <p className="mt-2 text-sm text-ink-3">Isto é uma demonstração: a mensagem não foi enviada a lado nenhum.</p>}
      </div>
    );
  }

  const aEnviar = estado.fase === "a-enviar";
  const campo = "mt-1.5 block h-12 w-full rounded-control border border-line-strong bg-surface px-3.5 text-ink placeholder:text-ink-4 focus:border-ink";
  const assuntoPorOmissao = assuntoInicial && ASSUNTOS.includes(assuntoInicial) ? assuntoInicial : "";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <label className="block text-sm font-semibold text-ink">
        Nome
        <input name="nome" required autoComplete="name" className={campo} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-ink">
          Email
          <input name="email" type="email" required autoComplete="email" className={campo} />
        </label>
        <label className="block text-sm font-semibold text-ink">
          Telefone <span className="font-normal text-ink-3">(opcional)</span>
          <input name="telefone" type="tel" autoComplete="tel" className={campo} />
        </label>
      </div>
      <label className="block text-sm font-semibold text-ink">
        Assunto
        <select name="assunto" required className={campo} defaultValue={assuntoPorOmissao}>
          <option value="" disabled>
            Escolhe um assunto
          </option>
          {ASSUNTOS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold text-ink">
        Mensagem
        <textarea name="mensagem" required rows={6} className={`${campo} h-auto py-3`} />
      </label>

      {/* O campo-armadilha: fora do ecrã e fora do teclado. Uma pessoa nunca o vê nem o preenche. */}
      <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          Nota extra
          <input name="notaExtra" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {estado.fase === "erro" && (
        <p role="alert" className="rounded-card bg-risk/10 p-4 text-sm font-semibold text-risk">
          {estado.mensagem}
        </p>
      )}

      {!demonstracao && <Turnstile ref={desafio} />}
      <Botao type="submit" disabled={aEnviar} className="w-full sm:w-auto">
        {aEnviar && <Loader2 size={18} className="animate-spin" aria-hidden />}
        {aEnviar ? "A enviar" : "Enviar mensagem"}
      </Botao>
      <p className="text-xs text-ink-3">
        Os dados que escreves aqui são tratados pelo clube.{" "}
        <Link href="/privacidade" className="font-semibold text-ink hover:underline">
          Ver a política de privacidade
        </Link>
        .
      </p>
    </form>
  );
}
