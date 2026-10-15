"use client";

import { Botao } from "@/componentes/Botao";

/**
 * O formulário de contacto. Etiquetas visíveis, e o assunto como lista para a
 * secretaria saber a quem encaminhar.
 *
 * ## Abre o email, não envia
 *
 * Ainda não há caixa de mensagens na consola do clube. Em vez de fingir que
 * envia (uma mensagem que não chega a lado nenhum é pior do que nenhuma),
 * o formulário prepara o email para o endereço do clube, com o assunto e o
 * texto já escritos, e abre-o no programa de email de quem escreve. Sem email
 * do clube, não há formulário: só a morada e o telefone.
 */
export function FormularioContacto({ email, clube }: { email?: string; clube: string }) {
  if (!email) {
    return <p className="mt-6 rounded-card bg-sunken p-5 text-ink-2">O {clube} ainda não indicou um email para contacto. Usa o telefone ou passa pela sede.</p>;
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const assunto = `${String(f.get("assunto") ?? "Contacto")}: ${String(f.get("nome") ?? "")}`.trim();
    const corpo = `${String(f.get("mensagem") ?? "")}\n\n${String(f.get("nome") ?? "")}`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  };

  const campo = "mt-1.5 block h-12 w-full rounded-control border border-line-strong bg-surface px-3.5 text-ink placeholder:text-ink-4 focus:border-ink";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <label className="block text-sm font-semibold text-ink">
        Nome
        <input name="nome" required autoComplete="name" className={campo} />
      </label>
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
      <p className="text-xs text-ink-3">Abre o teu programa de email com a mensagem pronta, para {email}.</p>
      <Botao type="submit" className="w-full sm:w-auto">
        Escrever ao clube
      </Botao>
    </form>
  );
}
