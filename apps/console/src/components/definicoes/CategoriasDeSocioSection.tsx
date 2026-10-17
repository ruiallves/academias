import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Loading, Pill } from "@/components/primitives";
import { Bloco, Erro, Linha, Lista, ListaTopo } from "@/components/definicoes/ui";
import { TiersDialog } from "@/routes/director/Members";
import { Plus, Trash2 } from "@/lib/icons";
import { money } from "@/lib/format";
import { deleteTier, janelaDoPeriodoAnual, listTiers, type MemberTier } from "@/lib/members";
import { useStore } from "@/lib/store";

/**
 * As categorias de sócio, nas Definições.
 *
 * ## Porque é que estão em dois sítios
 *
 * Pedido do Rui (17/10/2026): as categorias criavam-se só no Livro de sócios,
 * no botão "Categorias", e quem as procurava nas Definições não as encontrava.
 * Agora estão nos dois. **É a mesma coisa nos dois sítios**: esta secção mostra
 * a lista e abre o mesmo popup do Livro de sócios (`TiersDialog`), com o mesmo
 * formulário, o mesmo Guardar e os mesmos avisos (preço novo, apagar com
 * sócios). Não há um segundo formulário para manter.
 *
 * ## Quem vê e quem mexe
 *
 * Ler pede `member:read` e mexer pede `member:write`, como no Livro de sócios,
 * e não `settings:write`: quem gere os sócios gere as categorias, esteja onde
 * estiver. O servidor decide o mesmo nas rotas `/api/members/tiers`.
 */
export function CategoriasDeSocioSection({ mayWrite }: { mayWrite: boolean }) {
  const { academy } = useStore();
  const [tiers, setTiers] = useState<MemberTier[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** O popup aberto: na lista, numa categoria nova, ou numa existente. */
  const [aberto, setAberto] = useState<{ abrir?: MemberTier | "new" } | null>(null);
  /** A categoria a apagar, à espera da confirmação. */
  const [apagar, setApagar] = useState<MemberTier | null>(null);

  const carregar = useCallback(() => {
    setErro(null);
    listTiers()
      .then(setTiers)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível carregar as categorias."));
  }, []);

  useEffect(carregar, [carregar]);

  const novaCategoria = mayWrite && (
    <button type="button" className="ctl-primary" onClick={() => setAberto({ abrir: "new" })}>
      <Plus className="size-3.5" strokeWidth={2} />
      Nova categoria
    </button>
  );

  return (
    <>
      <Bloco
        titulo="Categorias"
        estado={tiers && tiers.length > 0 ? <Pill>{tiers.length}</Pill> : undefined}
        descricao={
          <>
            <p>As categorias que um sócio pode ter, com o valor da quota de cada uma.</p>
            <p>
              São as mesmas do <Link to="/socios" className="font-medium text-ink-2 hover:text-ink hover:underline">Livro de sócios</Link>:
              criar ou mudar uma aqui é criá-la ou mudá-la lá. As que não estão marcadas como “não listada” aparecem na
              página de inscrição.
            </p>
          </>
        }
      >
        {erro && (
          <div className="mb-3">
            <Erro>{erro}</Erro>
          </div>
        )}

        {!tiers && !erro ? (
          <Loading size="panel" />
        ) : tiers && tiers.length === 0 ? (
          <Lista>
            <div className="px-4 py-6">
              <p className="text-body font-medium text-ink">Ainda não há categorias</p>
              <p className="mt-1 max-w-[56ch] text-meta leading-relaxed text-ink-3">
                Sem categorias, a página de inscrição continua a funcionar, mas não há nada para escolher e os sócios não
                recebem quota automaticamente.
              </p>
              {novaCategoria && <div className="mt-4">{novaCategoria}</div>}
            </div>
          </Lista>
        ) : tiers ? (
          <Lista>
            <ListaTopo>
              <span className="text-meta font-medium text-ink-2">
                {tiers.length} {tiers.length === 1 ? "categoria" : "categorias"}
              </span>
              {novaCategoria}
            </ListaTopo>
            <ul>
              {tiers.map((t) => (
                <Linha key={t.id}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium text-ink">{t.name}</span>
                      {t.billing === "ANNUAL" && <Pill>anual</Pill>}
                      {!t.isPublic && <Pill>não listada</Pill>}
                    </div>
                    <p className="mt-0.5 text-meta text-ink-3">
                      {t.feeCents !== null
                        ? `${money(t.feeCents)} ${t.billing === "ANNUAL" ? `por ano · ${janelaDoPeriodoAnual(academy.memberAnnualStartMonth)}` : "por mês"}`
                        : "preço por definir"}
                      {(t.minAge != null || t.maxAge != null) &&
                        ` · ${
                          t.minAge != null && t.maxAge != null
                            ? `${t.minAge}–${t.maxAge} anos`
                            : t.minAge != null
                              ? `${t.minAge}+ anos`
                              : `até ${t.maxAge} anos`
                        }`}
                    </p>
                  </div>
                  <span className="shrink-0 text-meta tabular text-ink-3">
                    {t.members} {t.members === 1 ? "sócio" : "sócios"}
                  </span>
                  {mayWrite && (
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" className="ctl-ghost" onClick={() => setAberto({ abrir: t })}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="ctl-ghost"
                        aria-label={`Apagar a categoria ${t.name}`}
                        onClick={() => setApagar(t)}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  )}
                </Linha>
              ))}
            </ul>
          </Lista>
        ) : null}

        {tiers && tiers.length > 0 && !mayWrite && (
          <p className="mt-2 text-meta text-ink-4">Só quem gere os sócios pode criar e mudar categorias.</p>
        )}
      </Bloco>

      {/*
        O mesmo aviso do Livro de sócios (`TiersList` em routes/director/Members.tsx):
        a segunda consequência é a que ninguém adivinha, um sócio sem categoria
        deixa de ter quota lançada automaticamente.
      */}
      {apagar && (
        <ConfirmDialog
          title={`Apagar "${apagar.name}"?`}
          confirmLabel="Apagar categoria"
          onClose={() => setApagar(null)}
          onConfirm={async () => {
            await deleteTier(apagar.id);
            setApagar(null);
            carregar();
          }}
        >
          {apagar.members === 0 ? (
            <>Esta categoria não tem sócios. Apagá-la não mexe em mais nada.</>
          ) : (
            <>
              <strong className="font-medium text-ink">
                {apagar.members} {apagar.members === 1 ? "sócio fica" : "sócios ficam"} sem categoria.
              </strong>{" "}
              {apagar.members === 1 ? "A ficha dele continua" : "As fichas deles continuam"} com tudo o resto, e as
              quotas já lançadas não mudam. Mas, enquanto {apagar.members === 1 ? "estiver" : "estiverem"} sem
              categoria, {apagar.members === 1 ? "não recebe" : "não recebem"} quota nova automaticamente; atribui-lhes
              outra para voltar a cobrar.
            </>
          )}
        </ConfirmDialog>
      )}

      {aberto && (
        <TiersDialog
          mayWrite={mayWrite}
          abrir={aberto.abrir}
          onClose={() => {
            setAberto(null);
            carregar();
          }}
        />
      )}
    </>
  );
}
