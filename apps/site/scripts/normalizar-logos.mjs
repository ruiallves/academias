#!/usr/bin/env node
/**
 * Normaliza os logótipos dos meios de pagamento.
 *
 * ## Porque é que os ficheiros originais não servem como estão
 *
 * Vêm de sítios diferentes e não têm nada em comum: o Apple Pay são 4096×4096
 * (128 KB) para uma marca que se mostra a 20 px, com a marca a ocupar um terço
 * do quadrado e o resto branco opaco; o Multibanco é vertical, 1693×2000; o MB
 * WAY é um wordmark apertado de 292×143. Postos lado a lado com `object-contain`
 * e a mesma altura, saem de tamanhos visuais completamente diferentes — e o
 * quadrado branco do Apple Pay aparece como um rectângulo branco sobre o papel.
 *
 * Este script resolve isso **no ficheiro**, e não com números mágicos no CSS:
 *
 *  1. **Recorta** ao conteúdo — a caixa exacta dos pixels que não são fundo.
 *  2. **Destranspara** o branco opaco quando o canto é branco (o caso do Apple
 *     Pay), para todos se comportarem da mesma maneira sobre qualquer fundo.
 *  3. **Reduz** para uma altura comum, com média de caixa (box filter): é o
 *     filtro certo para reduzir, e não precisa de biblioteca nenhuma.
 *
 * Os originais vivem em `logos-fonte/`, **fora** de `public/`: são entrada de
 * build, não recursos web. Enquanto lá estavam, o Vite copiava-os para o `dist`
 * — 216 KB de ficheiros que ninguém referencia, a ocupar espaço no CDN. O
 * resultado vai para `public/pagamentos/`, que é o que a página serve.
 *
 * Um logótipo novo entra em `logos-fonte/`, ganha uma linha em `FONTES`, e
 * corre-se isto outra vez.
 *
 * ## O que continua a ser trabalho de quem olha
 *
 * A altura comum iguala a **caixa**, não o peso visual: um wordmark largo e uma
 * marca quadrada com a mesma altura não pesam o mesmo aos olhos. Por isso
 * `PaymentIcons.tsx` ainda tem um ajuste por marca — mas agora é um ajuste fino
 * sobre ficheiros comparáveis, e não a compensação de um quadrado com dois
 * terços de vazio.
 *
 * Uso: node scripts/normalizar-logos.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FONTE = path.join(AQUI, "..", "logos-fonte");
const DESTINO = path.join(AQUI, "..", "public", "pagamentos");

/** A altura a que todos ficam. 64 chega para o dobro do maior tamanho de ecrã. */
const ALTURA = 64;

const FONTES = [
  { id: "mbway", ficheiro: "Logo_MBWay@.png" },
  { id: "multibanco", ficheiro: "multibanco-seeklogo.png" },
  { id: "applepay", ficheiro: "apple-pay.png" },
  { id: "googlepay", ficheiro: "googlepay.png" },
];

/** Um pixel é fundo se for transparente, ou se for branco num ficheiro sem alfa. */
const eFundo = (r, g, b, a, brancoEFundo) =>
  a < 12 || (brancoEFundo && r > 244 && g > 244 && b > 244);

mkdirSync(DESTINO, { recursive: true });

for (const { id, ficheiro } of FONTES) {
  const png = PNG.sync.read(readFileSync(path.join(FONTE, ficheiro)));
  const { width: W, height: H, data } = png;
  const em = (x, y) => (W * y + x) << 2;

  // O canto diz se o ficheiro tem fundo branco opaco (Apple Pay) ou alfa.
  const canto = em(0, 0);
  const brancoEFundo = data[canto + 3] > 250 && data[canto] > 244 && data[canto + 1] > 244 && data[canto + 2] > 244;

  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = em(x, y);
      if (eFundo(data[i], data[i + 1], data[i + 2], data[i + 3], brancoEFundo)) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error(`${ficheiro}: não encontrei conteúdo nenhum`);

  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const escala = ALTURA / ch;
  const nw = Math.max(1, Math.round(cw * escala));
  const saida = new PNG({ width: nw, height: ALTURA });

  /*
   * Média de caixa: cada pixel de saída é a média da área de origem que lhe
   * corresponde. A cor é ponderada pelo alfa — sem isso, os pixels
   * transparentes (que costumam ser preto-transparente) escurecem as bordas e
   * a marca ganha uma auréola suja.
   */
  for (let y = 0; y < ALTURA; y++) {
    for (let x = 0; x < nw; x++) {
      const sx0 = x0 + Math.floor((x * cw) / nw);
      const sx1 = x0 + Math.max(Math.floor(((x + 1) * cw) / nw), Math.floor((x * cw) / nw) + 1);
      const sy0 = y0 + Math.floor((y * ch) / ALTURA);
      const sy1 = y0 + Math.max(Math.floor(((y + 1) * ch) / ALTURA), Math.floor((y * ch) / ALTURA) + 1);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < Math.min(sy1, H); sy++) {
        for (let sx = sx0; sx < Math.min(sx1, W); sx++) {
          const i = em(sx, sy);
          // O branco de fundo passa a transparente, para o logótipo se portar
          // igual sobre papel, sobre pinheiro ou sobre uma pastilha branca.
          const opaco = brancoEFundo && data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244 ? 0 : data[i + 3];
          r += data[i] * opaco;
          g += data[i + 1] * opaco;
          b += data[i + 2] * opaco;
          a += opaco;
          n++;
        }
      }

      const j = (nw * y + x) << 2;
      if (a === 0) {
        saida.data[j] = saida.data[j + 1] = saida.data[j + 2] = saida.data[j + 3] = 0;
      } else {
        saida.data[j] = Math.round(r / a);
        saida.data[j + 1] = Math.round(g / a);
        saida.data[j + 2] = Math.round(b / a);
        saida.data[j + 3] = Math.round(a / n);
      }
    }
  }

  const destino = path.join(DESTINO, `${id}.png`);
  const bytes = PNG.sync.write(saida);
  writeFileSync(destino, bytes);

  console.log(
    `${id.padEnd(12)} ${String(W).padStart(4)}×${String(H).padEnd(4)} → conteúdo ${cw}×${ch} ` +
      `(${Math.round((cw / W) * 100)}%×${Math.round((ch / H) * 100)}% do ficheiro) ` +
      `→ ${nw}×${ALTURA}  rácio ${(nw / ALTURA).toFixed(2)}  ${(bytes.length / 1024).toFixed(1)} KB` +
      (brancoEFundo ? "  [branco → transparente]" : ""),
  );
}
