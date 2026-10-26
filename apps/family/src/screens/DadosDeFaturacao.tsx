import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, Info, Receipt } from "lucide-react";
import { apiGet, apiPut } from "@/lib/http";
import { cx } from "@/ui";

/**
 * Os dados que vão na fatura de quem paga pela app.
 *
 * ## Porque é que isto existe
 *
 * Cada pagamento feito aqui (mensalidade, cobrança avulsa, quota de sócio)
 * gera uma fatura no programa de faturação do clube, e o PDF segue por email
 * para quem pagou. O clube não sabe o NIF nem a morada de quem paga, e não
 * tem de saber: quem paga é que diz o que quer ver na fatura. Sem NIF, a
 * fatura sai como consumidor final, e isso também é uma escolha legítima.
 *
 * ## O que o ecrã faz
 *
 * Lê o que está guardado, deixa mudar e grava tudo de uma vez. Todos os
 * campos são opcionais: uma string vazia limpa o campo no servidor. O NIF é
 * validado lá, e a recusa chega como erro do pedido; aqui só se para o estado
 * "a guardar" e se mostra a mensagem.
 *
 * O formulário existe mesmo quando o clube ainda não ligou a faturação
 * automática: os dados ficam guardados para quando ligar, e a nota em cima
 * diz isso mesmo.
 */

type Dados = {
  nome?: string | null;
  nif?: string | null;
  morada?: string | null;
  codigoPostal?: string | null;
  localidade?: string | null;
  faturaLigada: boolean;
};

type Campos = {
  nome: string;
  nif: string;
  morada: string;
  codigoPostal: string;
  localidade: string;
};

const VAZIO: Campos = { nome: "", nif: "", morada: "", codigoPostal: "", localidade: "" };

function paraCampos(d: Dados): Campos {
  return {
    nome: d.nome ?? "",
    nif: d.nif ?? "",
    morada: d.morada ?? "",
    codigoPostal: d.codigoPostal ?? "",
    localidade: d.localidade ?? "",
  };
}

export default function DadosDeFaturacao() {
  const navigate = useNavigate();
  /* `null` até o servidor responder: o formulário fica vazio e o botão desligado. */
  const [dados, setDados] = useState<Dados | null>(null);
  const [campos, setCampos] = useState<Campos>(VAZIO);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    apiGet<Dados>("/api/faturacao/dados")
      .then((d) => {
        setDados(d);
        setCampos(paraCampos(d));
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  const muda = (campo: keyof Campos) => (e: { target: { value: string } }) => {
    setGuardado(false);
    setCampos((c) => ({ ...c, [campo]: e.target.value }));
  };

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!dados || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const novo = await apiPut<Dados>("/api/faturacao/dados", {
        nome: campos.nome.trim(),
        nif: campos.nif.trim(),
        morada: campos.morada.trim(),
        codigoPostal: campos.codigoPostal.trim(),
        localidade: campos.localidade.trim(),
      });
      setDados(novo);
      setCampos(paraCampos(novo));
      setGuardado(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={guardar} className="pt-2" noValidate>
      <button type="button" onClick={() => navigate(-1)} className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2">
        <ChevronLeft className="size-4" strokeWidth={2.2} />
        Voltar
      </button>

      <header className="px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Conta</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">Dados para faturas</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
          Quando pagas pela app, o clube passa a fatura e envia-a para o teu email. Sem NIF, sai como consumidor final.
        </p>
      </header>

      {dados && !dados.faturaLigada && (
        <div className="mt-4 flex items-start gap-3 rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
            <Info className="size-[18px]" strokeWidth={1.9} />
          </span>
          <p className="min-w-0 text-[13px] leading-relaxed text-ink-2">
            Este clube ainda não liga a faturação automática. Os dados ficam guardados para quando ligar.
          </p>
        </div>
      )}

      <section className="mt-5 space-y-3">
        <Campo id="fat-nome" rotulo="Nome na fatura" ajuda="Se for diferente do teu">
          <input id="fat-nome" value={campos.nome} onChange={muda("nome")} maxLength={100} autoComplete="name" className={FIELD} />
        </Campo>
        <Campo id="fat-nif" rotulo="NIF" ajuda="Opcional">
          <input id="fat-nif" value={campos.nif} onChange={muda("nif")} inputMode="numeric" maxLength={9} autoComplete="off" className={cx(FIELD, "num")} />
        </Campo>
        <Campo id="fat-morada" rotulo="Morada">
          <input id="fat-morada" value={campos.morada} onChange={muda("morada")} maxLength={200} autoComplete="street-address" className={FIELD} />
        </Campo>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
          <Campo id="fat-cp" rotulo="Código postal">
            <input id="fat-cp" value={campos.codigoPostal} onChange={muda("codigoPostal")} inputMode="numeric" maxLength={12} autoComplete="postal-code" placeholder="0000-000" className={cx(FIELD, "num")} />
          </Campo>
          <Campo id="fat-localidade" rotulo="Localidade">
            <input id="fat-localidade" value={campos.localidade} onChange={muda("localidade")} maxLength={80} autoComplete="address-level2" className={FIELD} />
          </Campo>
        </div>
      </section>

      {erro && (
        <p role="alert" className="mt-4 rounded-[var(--radius-md)] bg-risk-soft px-4 py-3 text-[13px] leading-relaxed text-risk">
          {erro}
        </p>
      )}

      <div className="mt-6 space-y-3">
        <button type="submit" disabled={!dados || busy} className="cta w-full">
          {busy ? (
            "A guardar…"
          ) : guardado ? (
            <>
              <Check className="size-[18px]" strokeWidth={2.4} />
              Guardado
            </>
          ) : (
            <>
              <Receipt className="size-[18px]" strokeWidth={2} />
              Guardar
            </>
          )}
        </button>
        <p className="px-2 text-center text-[12px] leading-relaxed text-ink-4">
          Podes mudar estes dados quando quiseres. Valem para os pagamentos seguintes.
        </p>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Rótulo por cima do campo, com o campo ao lado e não lá dentro: num telemóvel
 * o toque dentro de um `<label>` vai parar ao sítio errado. Ver `check-toque`.
 */
function Campo({ id, rotulo, ajuda, children }: { id: string; rotulo: string; ajuda?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block px-1 text-[13px] font-medium text-ink-2">
        {rotulo}
        {ajuda && <span className="font-normal text-ink-4"> · {ajuda}</span>}
      </label>
      {children}
    </div>
  );
}

const FIELD =
  "w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3.5 py-3 text-[16px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none";
