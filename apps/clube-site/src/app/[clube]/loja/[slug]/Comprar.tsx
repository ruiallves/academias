"use client";

import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import type { Produto } from "@/dados/tipos";
import { Botao } from "@/componentes/Botao";

/**
 * Tamanho e comprar. O tamanho é um grupo de botões e não um `<select>`: num
 * telemóvel vê-se tudo de uma vez e escolhe-se com um toque.
 *
 * O carrinho e o pagamento ligam-se à plataforma depois; por agora o botão
 * diz isso mesmo.
 */
export function Comprar({ produto }: { produto: Produto }) {
  const [opcao, setOpcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState(false);
  const precisaDeOpcao = !!produto.variants && !opcao;

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
          <Botao disabled={precisaDeOpcao} onClick={() => setAviso(true)} className="w-full sm:w-auto">
            <ShoppingBag size={18} aria-hidden />
            {precisaDeOpcao ? `Escolhe o ${produto.variants!.name.toLowerCase()}` : "Adicionar ao carrinho"}
          </Botao>
        )}
      </div>

      {aviso && (
        <p role="status" className="mt-4 rounded-card bg-sunken p-4 text-sm text-ink-2">
          O carrinho e o pagamento ligam-se à plataforma do clube e ainda não estão ativos nesta pré-visualização.
        </p>
      )}
    </div>
  );
}
