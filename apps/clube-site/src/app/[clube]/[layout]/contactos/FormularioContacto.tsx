"use client";

import { useState } from "react";
import { Botao } from "@/componentes/Botao";

/**
 * O formulário de contacto. Etiquetas visíveis, erro junto ao campo, e o
 * assunto como lista para a secretaria saber a quem encaminhar.
 *
 * Vai criar um `Ticket` na consola do clube, como o formulário do site
 * academias.pt já faz para a plataforma. Até lá, confirma localmente.
 */
export function FormularioContacto() {
  const [estado, setEstado] = useState<"a-escrever" | "a-enviar" | "enviado">("a-escrever");

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEstado("a-enviar");
    setTimeout(() => setEstado("enviado"), 600);
  };

  if (estado === "enviado") {
    return (
      <p role="status" className="mt-6 rounded-card bg-signal-soft p-5 text-signal-ink">
        <span className="block font-semibold">Mensagem enviada.</span>
        Obrigado. O clube responde para o email que indicaste.
      </p>
    );
  }

  const campo = "mt-1.5 block h-12 w-full rounded-control border border-line-strong bg-surface px-3.5 text-ink placeholder:text-ink-4 focus:border-ink";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-ink">
          Nome
          <input name="nome" required autoComplete="name" className={campo} />
        </label>
        <label className="block text-sm font-semibold text-ink">
          Email
          <input name="email" type="email" required autoComplete="email" className={campo} />
        </label>
      </div>
      <label className="block text-sm font-semibold text-ink">
        Assunto
        <select name="assunto" required className={campo} defaultValue="">
          <option value="" disabled>
            Escolhe um assunto
          </option>
          <option>Inscrições e formação</option>
          <option>Sócios e quotas</option>
          <option>Bilhetes</option>
          <option>Loja e encomendas</option>
          <option>Patrocínios</option>
          <option>Outro</option>
        </select>
      </label>
      <label className="block text-sm font-semibold text-ink">
        Mensagem
        <textarea name="mensagem" required rows={6} className={`${campo} h-auto py-3`} />
      </label>
      <p className="text-xs text-ink-3">Os dados servem só para responder a esta mensagem.</p>
      <Botao type="submit" disabled={estado === "a-enviar"} className="w-full sm:w-auto">
        {estado === "a-enviar" ? "A enviar…" : "Enviar mensagem"}
      </Botao>
    </form>
  );
}
