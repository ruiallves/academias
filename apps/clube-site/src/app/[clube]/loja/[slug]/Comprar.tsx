"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import type { Produto } from "@/dados/tipos";
import { Botao, BotaoLink } from "@/componentes/Botao";

/**
 * Tamanho e encomendar. O tamanho é um grupo de botões e não um `<select>`:
 * num telemóvel vê-se tudo de uma vez e escolhe-se com um toque.
 *
 * A compra online ainda não está ligada à plataforma. Em vez de um botão de
 * carrinho que não leva a lado nenhum, a encomenda vai pelos contactos do
 * clube, com o assunto já escolhido.
 */
export function Comprar({ produto }: { produto: Produto }) {
  const [opcao, setOpcao] = useState<string | null>(null);

  return (
    <div className="mt-8">
      {produto.variants && (
        <fieldset>
          <legend className="text-sm font-semibold text-ink">{produto.variants.name}</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {produto.variants.options.map((o) => {
              const ativo = opcao === o;
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setOpcao(o)}
                  className={`inline-flex h-11 min-w-11 items-center justify-center rounded-control border px-3 text-sm font-semibold transition ${
                    ativo ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink hover:border-ink"
                  }`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="mt-6">
        {produto.soldOut ? (
          <Botao disabled variante="contorno" className="w-full sm:w-auto">
            Esgotado
          </Botao>
        ) : (
          <BotaoLink href="/contactos?assunto=Loja%20e%20encomendas" className="w-full sm:w-auto">
            <Mail size={18} aria-hidden />
            Encomendar pelos contactos
          </BotaoLink>
        )}
      </div>

      <p className="mt-4 text-sm text-ink-3">A compra online abre em breve. Até lá, encomenda pelos contactos do clube ou na sede.</p>
    </div>
  );
}
