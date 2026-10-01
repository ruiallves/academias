import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "../styles.css";
import { PitchBoard, type PecaNoCampo } from "@/components/match/PitchBoard";
import { AbasDoJogo, Cartao } from "@/components/match/ui";
import { CabecalhoDoJogo, LinhaDeJogo, ProximoJogo, type JogoNaLista } from "@/components/match/views";
import { systemLineup } from "@/lib/training";
import { PreJogo, type JogadorNaLista } from "@/components/match/PreJogo";
import { VisaoGeral } from "@/components/match/VisaoGeral";
import { Analise } from "@/components/match/Analise";
import { LinhaDaFicha, ResumoDaFicha, type LinhaDaFichaDados } from "@/components/match/Ficha";
import { Adversario } from "@/components/match/Adversario";
import { CartaoTopo, Emblema } from "@/components/match/ui";

const nomes = ["M. Silva", "J. Costa", "R. Alves", "T. Rocha", "D. Pinto", "A. Melo", "P. Luz", "B. Santos", "F. Neves", "G. Lima", "H. Dias"];
const f11: PecaNoCampo[] = systemLineup("4-3-3", "f11").map((s, i) => ({ ...s, jogador: i < 9 ? { numero: [1, 2, 4, 5, 3, 6, 8, 10, 7][i], nome: nomes[i], marca: i === 2 ? "C" : i === 6 ? "SC" : null } : null }));
const f7: PecaNoCampo[] = systemLineup("2-3-1", "f7").map((s, i) => ({ ...s, jogador: i < 3 ? { numero: i + 1, nome: nomes[i] } : null }));
const d = (n: number, h = 15, m = 30) => { const x = new Date(); x.setDate(x.getDate() + n); x.setHours(h, m, 0, 0); return x; };
const jogos: JogoNaLista[] = [
  { id: "1", equipa: "Sub-15", adversario: "CD Loureiro", emCasa: true, prova: "Liga Sub-15", inicio: d(2), local: "Campo Principal", estado: { chave: "p", texto: "Em preparação", tom: "aviso" }, resultado: null, preparacao: [true, true, false, false], cancelado: false, passado: false },
  { id: "2", equipa: "Sub-13", adversario: "AD Fafe", emCasa: false, prova: "Taça AF", inicio: d(3, 11, 0), local: "Complexo Desportivo de Fafe", estado: { chave: "p", texto: "Pronto", tom: "ok" }, resultado: null, preparacao: [true, true, true, true], cancelado: false, passado: false, funcao: "Delegado" },
  { id: "3", equipa: "Sub-11", adversario: "Vitória SC", emCasa: true, prova: null, inicio: d(9, 10, 0), local: "Campo 2", estado: { chave: "p", texto: "Por preparar", tom: "neutro" }, resultado: null, preparacao: [false, false, false, false], cancelado: false, passado: false },
  { id: "4", equipa: "Sub-15", adversario: "FC Ferreirense", emCasa: false, prova: "Liga Sub-15", inicio: d(-5, 15, 0), local: "Estádio Municipal", estado: { chave: "p", texto: "Por analisar", tom: "aviso" }, resultado: { nos: 2, eles: 1, desfecho: "win" }, preparacao: [true, true, true, true], cancelado: false, passado: true },
  { id: "5", equipa: "Sub-13", adversario: "Life Club", emCasa: true, prova: "Amigável", inicio: d(-12, 10, 30), local: "Campo 2", estado: { chave: "p", texto: "Analisado", tom: "neutro" }, resultado: { nos: 0, eles: 3, desfecho: "loss" }, preparacao: [true, true, true, true], cancelado: false, passado: true },
];

const plantel = ["Miguel Silva","João Costa","Rui Alves","Tiago Rocha","Diogo Pinto","André Melo","Pedro Luz","Bruno Santos","Filipe Neves","Gonçalo Lima","Hugo Dias","Ivo Matos","Luís Faria","Nuno Reis","Óscar Teles","Paulo Vaz"];
const pos = ["Guarda-redes","Lateral","Defesa central","Defesa central","Lateral","Médio defensivo","Médio centro","Médio ofensivo","Extremo","Avançado","Extremo","Guarda-redes","Defesa central","Médio centro","Extremo","Avançado"];
const ordem = ["Guarda-redes","Defesa central","Lateral","Médio defensivo","Médio centro","Médio ofensivo","Extremo","Avançado"];
function PreDemo({ sel }: { sel: boolean }) {
  const pecas = f11;
  const jog: JogadorNaLista[] = plantel.map((n, i) => ({ id: String(i), nome: n, curto: n[0] + ". " + n.split(" ")[1], numero: i + 1, foto: null, posicao: pos[i],
    onde: i < 9 ? { tipo: "campo", sigla: pecas[i].label } : i < 13 ? { tipo: "banco" } : { tipo: "fora" }, aviso: i === 14 ? "de baixa" : i === 6 ? "condicionado" : null, indisponivel: i === 14, marca: i === 2 ? "C" : i === 6 ? "SC" : null,
    motivos: sel ? (i === 14 ? null : i % 3 === 0 ? ["posição dele", "titular em 4 dos últimos 5", "92% de presenças"] : ["adapta-se", "78% de presenças"]) : undefined }));
  const nada = () => {};
  return <PreJogo podeEditar formato="f11" formatos={["f11","f9","f7"]} sistema="4-3-3" sistemas={["4-3-3","4-4-2","4-2-3-1"]} modelos={[{ id: "m", nome: "Pressão alta" }]} modeloId={null}
    pecas={pecas} escolhida={sel ? pecas[9].id : null} jogadores={sel ? [jog[9], jog[10], ...jog.filter((_, i) => i !== 9 && i !== 10)] : [...jog].sort((a, b) => ordem.indexOf(a.posicao!) - ordem.indexOf(b.posicao!))} banco={jog.slice(9, 13)}
    objetivos={[{ id: "a", text: "Sair a jogar pelo corredor direito" }, { id: "b", text: "Pressionar o médio defensivo deles" }]} notas="" deConvocatoria
    estadoDeGravar={{ mexido: true, aGuardar: false, guardado: false, erro: null, autor: "Rui", temPlano: true }} aExportar={false}
    onFormato={nada} onSistema={nada} onModelo={nada} onSugerir={nada} onEscolher={nada} onMover={nada} onPor={nada} onTirar={nada} onBanco={nada} onSubir={nada} onParaBanco={nada} onParaFora={nada} onMarca={nada} onObjetivoNovo={nada} onObjetivoApagar={nada} onNotas={nada} onGuardar={nada} onExportar={nada} />;
}
function FichaDemo() {
  const base: LinhaDaFichaDados = { papel: "titular", tally: 0, assists: 0, yellowCards: 0, redCard: false, onMinute: null, offMinute: null, yellowAt: [], redAt: null, tallyAt: [], assistsAt: [] };
  const [ls, setLs] = useState<LinhaDaFichaDados[]>([
    { ...base }, { ...base, tally: 2, tallyAt: [12], assists: 1 }, { ...base, yellowCards: 1, offMinute: 63 }, { ...base, redCard: true, redAt: 80, yellowCards: 2 },
    { ...base, papel: "entrou", onMinute: 63, tally: 1 }, { ...base, papel: "entrou" }, { ...base, papel: "nao" }, { ...base, papel: "nao" },
  ]);
  return (
    <Cartao className="overflow-hidden">
      <CartaoTopo titulo="Ficha de jogo" apoio="Diz de cada um se foi titular, se entrou do banco ou se não jogou. O resto é opcional." />
      <div className="px-5 pb-4"><ResumoDaFicha itens={[{ valor: 4, rotulo: "titulares" }, { valor: 2, rotulo: "suplentes utilizados" }, { valor: 3, rotulo: "golos", tom: "ok" }, { valor: "3 · 1", rotulo: "amarelos · vermelhos" }]} /></div>
      <ul className="border-t border-line">
        {ls.map((l, i) => <LinhaDaFicha key={i} nome={plantel[i]} numero={i + 1} apoio={pos[i]} linha={l} golo="golo" duracao={70} minutos={l.papel === "nao" ? null : l.papel === "entrou" ? (l.onMinute == null ? null : 70 - l.onMinute) : (l.offMinute ?? 70)} problemas={[]} podeEditar substituicao={l.papel === "entrou" ? { opcoes: plantel.slice(0, 4).map((n, k) => ({ id: String(k), nome: n })), valor: i === 4 ? "2" : null, onChange: () => {} } : undefined}
          onPapel={(papel) => setLs((x) => x.map((y, j) => (j === i ? { ...y, papel } : y)))} onChange={(patch) => setLs((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)))} />)}
      </ul>
    </Cartao>
  );
}
function Tudo() {
  const [aba, setAba] = useState("geral");
  const q = new URLSearchParams(location.search).get("v") ?? "campo";
  return (
    <div className="min-h-dvh bg-canvas p-8">
      {q === "campo" && (
        <div className="flex gap-8">
          <div className="w-[440px]"><PitchBoard format="f11" pecas={f11} escolhida={f11[9].id} onEscolher={() => {}} /></div>
          <div className="w-[380px]"><PitchBoard format="f7" pecas={f7} escolhida={f7[4].id} onEscolher={() => {}} /></div>
          <div className="w-[260px]"><PitchBoard format="futsal" pecas={systemLineup("3-1 (pivô)", "futsal").map((s, i) => ({ ...s, jogador: i < 4 ? { numero: i + 1, nome: nomes[i] } : null }))} /></div>
          <div className="w-[520px]"><PitchBoard format="basket" pecas={systemLineup("5-out", "basket").map((s, i) => ({ ...s, jogador: i < 4 ? { numero: i + 4, nome: nomes[i] } : null }))} /></div>
        </div>
      )}
      {q === "jogo" && (
        <div className="mx-auto max-w-[1100px] space-y-4">
          <CabecalhoDoJogo equipa="Academia Life Club" adversario="CD Loureiro" emCasa contexto="Sub-15 · Liga Sub-15 · Jornada 4" estado={{ chave: "x", texto: "Em preparação", tom: "aviso" }}
            centro={<><span className="placar text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">15:30</span><span className="text-meta text-ink-3">sábado, 3 de outubro</span></>}
            rodape={<><span>Campo Principal</span><span>Convocatória enviada</span><span>Onze 9 de 11</span></>} />
          <AbasDoJogo abas={[{ key: "geral", label: "Visão geral" }, { key: "pre", label: "Pré-jogo", nota: "9/11" }, { key: "vivo", label: "Ao vivo" }, { key: "pos", label: "Pós-jogo" }, { key: "analise", label: "Análise" }, { key: "adv", label: "Adversário", feito: true }]} ativa={aba} onIr={setAba} />
          <CabecalhoDoJogo equipa="Academia Life Club" adversario="FC Ferreirense" emCasa={false} contexto="Sub-15 · Liga Sub-15" estado={{ chave: "x", texto: "Por analisar", tom: "aviso" }}
            centro={<><span className="placar text-[52px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">1 – 2</span><span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-meta font-medium text-ok">Vitória</span></>} />
        </div>
      )}
      {q === "pre" && <div className="mx-auto max-w-[1180px]"><PreDemo sel={new URLSearchParams(location.search).get("sel") === "1"} /></div>}
      {q === "geral" && (
        <div className="mx-auto max-w-[1280px]">
          <VisaoGeral passos={[
            { feito: true, texto: "Convocatória enviada", area: "pre", areaNome: "pré-jogo" },
            { feito: false, texto: "Onze escolhido (9 de 11)", area: "pre", areaNome: "pré-jogo" },
            { feito: true, texto: "Suplentes escolhidos", area: "pre", areaNome: "pré-jogo" },
            { feito: false, texto: "Capitão definido", area: "pre", areaNome: "pré-jogo" },
            { feito: false, texto: "Notas sobre o adversário", area: "adv", areaNome: "adversário" },
            { feito: false, texto: "Resultado registado", area: "pos", areaNome: "pós-jogo", bloqueado: true },
            { feito: false, texto: "Análise escrita", area: "an", areaNome: "análise", bloqueado: true },
          ]} onIr={() => {}} onze={<PitchBoard format="f11" pecas={f11} className="rounded-[18px]" />} onzeApoio="4-3-3 · 9 titulares · 4 suplentes" onzeArea="pre"
            factos={[{ rotulo: "Quando", valor: "Sábado, 3 de outubro, 15:30" }, { rotulo: "Onde", valor: "Campo Principal · em casa" }, { rotulo: "Equipa", valor: "Sub-15" }, { rotulo: "Prova", valor: "Liga Sub-15 · Jornada 4" }, { rotulo: "Convocatória", valor: "Enviada · 16 convocados" }]}
            adversario={<Cartao><CartaoTopo titulo="CD Loureiro" apoio="3 jogos anteriores" /><div className="flex items-center gap-3 px-5 pb-5"><Emblema nome="CD Loureiro" tamanho={44} /><span className="text-meta text-ink-3">2 V · 0 E · 1 D</span></div></Cartao>} />
        </div>
      )}
      {q === "adv" && (
        <div className="mx-auto max-w-[1280px]">
          <Adversario nome="CD Loureiro" podeEditar registo={null} onGuardar={async () => {}} historico={[
            { matchId: "a", startsAt: "2026-05-12T15:00:00Z", teamName: "Sub-15", competition: "Liga Sub-15", isHome: false, ourScore: 2, theirScore: 1, report: { formation: "4-4-2", style: "Bloco baixo, saem em transição pelo corredor esquerdo.", strengths: "Bolas paradas ofensivas.", weaknesses: "Espaço nas costas dos laterais.", keyPlayers: "O 10 organiza tudo.", setPieces: null, notes: null, updatedAt: "2026-05-13T10:00:00Z", authorName: "Rui Marques" } },
            { matchId: "b", startsAt: "2025-11-02T11:00:00Z", teamName: "Sub-14", competition: "Taça AF", isHome: true, ourScore: 0, theirScore: 2, report: { formation: "4-3-3", style: "Pressão alta nos primeiros 20 minutos.", strengths: null, weaknesses: null, keyPlayers: null, setPieces: null, notes: null, updatedAt: "2025-11-03T09:00:00Z", authorName: "Ana Sousa" } },
            { matchId: "c", startsAt: "2025-03-09T10:00:00Z", teamName: "Sub-14", competition: null, isHome: true, ourScore: 3, theirScore: 0, report: null },
          ]} />
        </div>
      )}
      {q === "ficha" && <div className="mx-auto max-w-[1180px]"><FichaDemo /></div>}
      {q === "analise" && <div className="mx-auto max-w-[1180px]"><Analise podeEditar onGuardar={async () => {}} contexto={<span className="rounded-full bg-ok-soft px-3 py-1 text-meta font-semibold text-ok">Vitória 2–1</span>} relatorio={{ summary: "Entrámos bem, com bola. Depois do golo recuámos demasiado.", positives: "Saída a três resultou.", negatives: null, toImprove: null, difficulties: null, videos: [{ url: "https://youtu.be/abc", label: "1.ª parte" }], updatedAt: "2026-10-04T10:00:00Z", authorName: "Rui Marques" }} /></div>}
      {q === "lista" && (
        <div className="mx-auto max-w-[1100px] space-y-4">
          <ProximoJogo jogo={jogos[0]} />
          <Cartao className="overflow-hidden"><ul>{jogos.map((j) => <LinhaDeJogo key={j.id} jogo={j} />)}</ul></Cartao>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><Tudo /></BrowserRouter>);
