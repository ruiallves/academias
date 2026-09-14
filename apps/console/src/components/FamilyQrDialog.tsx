import { useEffect, useState } from "react";
import { academy } from "@/lib/api";
import { descarregarCartaz, descarregarQrPng, qrPng } from "@/lib/qr-cartaz";
import { Download, Link2, QrCode, TriangleAlert } from "@/lib/icons";
import { Dialog } from "./Dialog";
import { cx } from "./primitives";

/**
 * O código QR que traz as famílias para a app.
 *
 * ## Porque é que um link não chega
 *
 * O link serve o WhatsApp, onde há onde carregar. Não serve a reunião de pais, o
 * balcão da secretaria, a porta do pavilhão nem a folha que vai na mochila — e é
 * aí que a conversa acontece. Ninguém escreve um endereço com um token de trinta
 * caracteres à mão a partir de um papel.
 *
 * É o mesmo raciocínio do QR de adesão a sócio (`lib/adesao.ts`), e usa a mesma
 * mecânica (`lib/qr-cartaz.ts`): PNG para o digital, cartaz A4 para a parede.
 *
 * ## O código carrega o convite, e não só o endereço do clube
 *
 * Isto é a decisão que importa e não é evidente. Um QR que levasse só à página
 * do clube parecia equivalente — instala a app do mesmo modo — e era uma
 * armadilha: a app **só oferece "Criar conta" a quem chega com um convite**
 * (ver `Entrar.tsx`). Sem o token, a família instalava a app, encontrava um
 * ecrã de "Entrar" para uma conta que não tem, e ligava para a secretaria.
 *
 * Por isso o código é o link de convite que já existe — o mesmo que se copia
 * para o WhatsApp. Pode ser afixado à vontade pela mesma razão que pode ser
 * partilhado num grupo: sozinho não liga criança nenhuma, porque a ligação
 * exige o NIF e a data de nascimento do educando.
 *
 * ## E por isso o prazo passa a ser um aviso
 *
 * Um link com prazo de sete dias impresso num cartaz é um cartaz que deixa de
 * funcionar na parede, em silêncio, e ninguém liga a dizer que o código falhou
 * — desiste-se dele. Aqui diz-se antes de imprimir: com prazo, quanto falta; e
 * a recomendação de gerar sem prazo para o que vai para papel.
 */

export type ConviteVivo = { link: string; expiresAt: string | null };

export function FamilyQrDialog({
  invite,
  mayWrite,
  onGerar,
  onClose,
}: {
  /** O convite a circular, ou `null` quando não há nenhum. */
  invite: ConviteVivo | null;
  mayWrite: boolean;
  /** Abrir o diálogo de convites — o único sítio que cria links. */
  onGerar: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Código QR para as famílias"
      subtitle="Para a reunião de pais, o balcão, a parede"
      icon={<QrCode className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      labelledBy="qr-familias"
      footer={
        <button type="button" className="ctl-outline" onClick={onClose}>
          Fechar
        </button>
      }
    >
      {invite ? <ComConvite invite={invite} /> : <SemConvite mayWrite={mayWrite} onGerar={onGerar} />}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function ComConvite({ invite }: { invite: ConviteVivo }) {
  const [qr, setQr] = useState<string | null>(null);
  const [aGerar, setAGerar] = useState<null | "png" | "pdf">(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // Pequeno: é uma pré-visualização. O que se descarrega é gerado de novo, grande.
    qrPng(invite.link, 320)
      .then((d) => vivo && setQr(d))
      .catch(() => vivo && setQr(null));
    return () => {
      vivo = false;
    };
  }, [invite.link]);

  async function descarregar(qual: "png" | "pdf") {
    if (aGerar) return;
    setAGerar(qual);
    setErro(null);
    try {
      const ficheiro = `App do clube — ${academy.shortName} (${qual === "pdf" ? "cartaz" : "QR"})`;
      await (qual === "png"
        ? descarregarQrPng(invite.link, ficheiro)
        : descarregarCartaz({
            link: invite.link,
            assunto: "APP DO CLUBE",
            chamada: "Aponta a câmara do telemóvel e instala a app",
            ficheiro,
          }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o ficheiro.");
    } finally {
      setAGerar(null);
    }
  }

  const dias = invite.expiresAt ? Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start gap-4">
        {/* Fundo branco sempre: um QR desenhado sobre o creme da consola perde
            contraste, e é a mesma imagem que vai para o cartaz. */}
        <div className="flex size-[132px] shrink-0 items-center justify-center rounded-[10px] border border-line bg-white p-1.5">
          {qr ? (
            <img src={qr} alt={`Código QR do convite para a app de ${academy.shortName}`} className="size-full" />
          ) : (
            <QrCode className="size-8 text-ink-4" strokeWidth={1.5} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">Leva à página do clube, que instala a app</p>
          <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
            É o convite que já anda a circular, no formato que se aponta. O cartaz sai em A4 — o emblema, o assunto e
            o código, para imprimir e pendurar.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className="ctl-outline" disabled={aGerar !== null} onClick={() => void descarregar("pdf")}>
              <Download className="size-3.5" strokeWidth={1.75} />
              {aGerar === "pdf" ? "A gerar…" : "Cartaz A4"}
            </button>
            <button type="button" className="ctl-outline" disabled={aGerar !== null} onClick={() => void descarregar("png")}>
              <QrCode className="size-3.5" strokeWidth={1.75} />
              {aGerar === "png" ? "A gerar…" : "Só o código (PNG)"}
            </button>
          </div>
          {erro && <p className="mt-2 text-meta text-risk">{erro}</p>}
        </div>
      </div>

      {/*
        O prazo, antes de imprimir e não depois.

        Um cartaz com um link de sete dias para de funcionar na parede sem avisar
        ninguém — e quem aponta a câmara e não acontece nada não liga para a
        secretaria, desiste. Sem prazo é a única forma de um papel durar a época.
      */}
      <p
        className={cx(
          "flex items-start gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-meta leading-relaxed",
          dias === null ? "bg-sunken text-ink-3" : "bg-warn-soft text-warn",
        )}
      >
        {dias === null ? (
          <>
            <Link2 className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              O convite não tem prazo — o código serve até alguém o fechar ou trocar em{" "}
              <strong className="font-medium text-ink-2">Convidar para a app</strong>. É o que se quer num papel.
            </span>
          </>
        ) : (
          <>
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.9} />
            <span>
              Este convite {dias <= 0 ? "expira hoje" : dias === 1 ? "expira amanhã" : `expira em ${dias} dias`}, e o
              código deixa de funcionar com ele. Para imprimir, gera um{" "}
              <strong className="font-medium">sem prazo</strong> em "Convidar para a app" — um cartaz que caduca na
              parede falha em silêncio.
            </span>
          </>
        )}
      </p>

      {/*
        O que acontece a quem o aponta. É a mesma explicação do diálogo de
        convite, e está aqui pela mesma razão: é o que a secretaria precisa de
        saber para responder ao pai que pergunta "e agora?".
      */}
      <ol className="space-y-1.5 border-t border-line pt-3.5 text-meta leading-relaxed text-ink-3">
        <li>1. O pai aponta a câmara e cai na página do clube, que instala a app.</li>
        <li>2. Dentro da app, cria conta — nome, telemóvel, email e palavra-passe.</li>
        <li>
          3. Identifica o filho pelo <strong className="font-medium text-ink-2">NIF e data de nascimento</strong>. Sem
          esses dois, o código não liga criança nenhuma — por isso pode ficar afixado à vista.
        </li>
      </ol>
    </div>
  );
}

/**
 * Sem convite vivo não há código.
 *
 * Não se gera um aqui: quem cria um link escolhe a duração, e essa escolha vive
 * num sítio só (`FamilyInviteDialog`). Dois sítios a abrir portas é não saber
 * quantas estão abertas — a regra que o servidor já impõe ao fechar o anterior.
 */
function SemConvite({ mayWrite, onGerar }: { mayWrite: boolean; onGerar: () => void }) {
  return (
    <div className="space-y-3 p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-[132px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-line bg-sunken">
          <QrCode className="size-8 text-ink-4" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">Ainda não há convite a circular</p>
          <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
            O código é o link de convite, no formato que se aponta — sem link não há o que gerar. Para um cartaz,
            escolhe <strong className="font-medium text-ink-2">sem prazo</strong>: um papel na parede dura mais do que
            sete dias.
          </p>
          {mayWrite && (
            <button type="button" className="ctl-primary mt-2.5" onClick={onGerar}>
              <Link2 className="size-3.5" strokeWidth={1.75} />
              Gerar o link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
