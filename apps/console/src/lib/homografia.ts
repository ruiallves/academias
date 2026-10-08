/**
 * A homografia imagem → campo, a partir dos pontos que o treinador clicou.
 *
 * Quatro ou mais pares (píxel, metros) dão uma matriz 3×3 que leva qualquer
 * ponto da imagem ao campo — enquanto a câmara não se mexer; a partir daí é o
 * worker que a arrasta com a compensação de câmara. Resolve-se por mínimos
 * quadrados com `h33 = 1` (oito incógnitas), com os pontos normalizados antes,
 * que é o que torna o sistema bem condicionado com píxeis aos milhares e
 * metros às dezenas. Sem biblioteca: são oito equações.
 */

export type Par = { img: [number, number]; pitch: [number, number] };

/** A matriz por linhas (9 números), ou `null` quando os pontos não a determinam. */
export function homografia(pares: Par[]): number[] | null {
  if (pares.length < 4) return null;
  const nImg = normalizacao(pares.map((p) => p.img));
  const nPitch = normalizacao(pares.map((p) => p.pitch));
  const A: number[][] = [];
  const b: number[] = [];
  for (const p of pares) {
    const [x, y] = aplicar(nImg, p.img);
    const [X, Y] = aplicar(nPitch, p.pitch);
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = minimosQuadrados(A, b);
  if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // Desnormalizar: H = T_pitch⁻¹ · Hn · T_img.
  const H = multiplicar(multiplicar(inversa(nPitch), Hn), nImg);
  if (!H || H.some((v) => !Number.isFinite(v))) return null;
  const escala = H[8] !== 0 ? H[8] : 1;
  return H.map((v) => v / escala);
}

/** Um ponto da imagem no campo, em metros. */
export function paraCampo(H: number[], x: number, y: number): [number, number] | null {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-9) return null;
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/**
 * Quase em linha? Quatro pontos na linha de meio-campo dão um ajuste com erro
 * zero e um campo torto: a homografia precisa de pontos que formem área. O
 * maior triângulo entre os pontos do campo tem de ter mais de `MIN_AREA_M2`.
 */
export function quaseEmLinha(pitch: [number, number][]): boolean {
  const MIN_AREA_M2 = 40;
  let maior = 0;
  for (let i = 0; i < pitch.length; i++) {
    for (let j = i + 1; j < pitch.length; j++) {
      for (let k = j + 1; k < pitch.length; k++) {
        const [ax, ay] = pitch[i], [bx, by] = pitch[j], [cx, cy] = pitch[k];
        const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
        if (area > maior) maior = area;
      }
    }
  }
  return maior < MIN_AREA_M2;
}

/** A inversa de uma 3×3 por linhas — campo → imagem, para desenhar o campo por cima do vídeo. */
export function inverter(H: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

/**
 * A geometria faz sentido? O horizonte (onde a homografia vai ao infinito)
 * tem de ficar **acima** de todos os pontos clicados: o campo está no chão,
 * à frente da câmara. Uma matriz com o horizonte a atravessar o relvado vem
 * de um clique no sítio errado, mesmo que o erro dê zero.
 */
export function geometriaPlausivel(H: number[], pontos: [number, number][]): boolean {
  const sinais = pontos.map(([x, y]) => Math.sign(H[6] * x + H[7] * y + H[8]));
  return sinais.every((s) => s !== 0 && s === sinais[0]);
}

/** As linhas do campo como polilinhas em metros — para as projectar no vídeo. */
export function linhasDoCampo(L: number, W: number): [number, number][][] {
  const m = W / 2;
  const rect = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const circulo: [number, number][] = Array.from({ length: 49 }, (_, k) => {
    const t = (k / 48) * Math.PI * 2;
    return [L / 2 + 9.15 * Math.cos(t), m + 9.15 * Math.sin(t)];
  });
  return [
    rect(0, 0, L, W),
    [[L / 2, 0], [L / 2, W]],
    circulo,
    rect(0, m - 20.16, 16.5, 40.32),
    rect(L - 16.5, m - 20.16, 16.5, 40.32),
    rect(0, m - 9.16, 5.5, 18.32),
    rect(L - 5.5, m - 9.16, 5.5, 18.32),
  ];
}

/** O pior erro de reprojecção dos pares, em metros — o que diz se os cliques batem certo. */
export function erroMaximo(H: number[], pares: Par[]): number {
  let pior = 0;
  for (const p of pares) {
    const q = paraCampo(H, p.img[0], p.img[1]);
    const e = q ? Math.hypot(q[0] - p.pitch[0], q[1] - p.pitch[1]) : Infinity;
    if (e > pior) pior = e;
  }
  return pior;
}

/* -------------------------------------------------------------------------- */

/** A transformação que centra os pontos e os põe à distância média √2 da origem. */
function normalizacao(pontos: [number, number][]): number[] {
  const n = pontos.length;
  const cx = pontos.reduce((s, p) => s + p[0], 0) / n;
  const cy = pontos.reduce((s, p) => s + p[1], 0) / n;
  const media = pontos.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1;
  const s = Math.SQRT2 / media;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

function aplicar(T: number[], p: [number, number]): [number, number] {
  return [T[0] * p[0] + T[1] * p[1] + T[2], T[3] * p[0] + T[4] * p[1] + T[5]];
}

function multiplicar(A: number[], B: number[]): number[] {
  const C = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
}

function inversa(T: number[]): number[] {
  // Só para as transformações de normalização (semelhanças sem rotação): inverter é dividir.
  const s = T[0];
  return [1 / s, 0, -T[2] / s, 0, 1 / s, -T[5] / s, 0, 0, 1];
}

/** `x` que minimiza ‖Ax − b‖, pelas equações normais com eliminação de Gauss. */
function minimosQuadrados(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M: number[][] = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M[i][j] += A[r][i] * A[r][j];
      M[i][n] += A[r][i] * b[r];
    }
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/* -------------------------------------------------------------------------- */
/* Os pontos do campo                                                          */
/* -------------------------------------------------------------------------- */

export type Landmark = { key: string; label: string; x: number; y: number };

/**
 * Os pontos conhecidos de um campo de onze, em metros, com a origem no canto
 * superior esquerdo do desenho e o X ao comprimento. As áreas têm as medidas
 * das leis do jogo (16,5 m e 5,5 m, 40,32 m e 18,32 m de largura, penálti a
 * 11 m, círculo de 9,15 m); o comprimento e a largura são os do campo.
 */
export function pontosDoCampo(L: number, W: number): Landmark[] {
  const m = W / 2;
  const pts: Landmark[] = [
    { key: "corner_tl", label: "Canto superior esquerdo", x: 0, y: 0 },
    { key: "corner_tr", label: "Canto superior direito", x: L, y: 0 },
    { key: "corner_bl", label: "Canto inferior esquerdo", x: 0, y: W },
    { key: "corner_br", label: "Canto inferior direito", x: L, y: W },
    { key: "half_t", label: "Meio-campo, linha de cima", x: L / 2, y: 0 },
    { key: "half_b", label: "Meio-campo, linha de baixo", x: L / 2, y: W },
    { key: "centre", label: "Ponto central", x: L / 2, y: m },
    { key: "circle_t", label: "Círculo central, topo", x: L / 2, y: m - 9.15 },
    { key: "circle_b", label: "Círculo central, fundo", x: L / 2, y: m + 9.15 },
    // Os lados do círculo: fora da linha de meio-campo, que é o que faltava
    // num frame centrado no meio-campo — quatro pontos em linha não calibram.
    { key: "circle_l", label: "Círculo central, esquerda", x: L / 2 - 9.15, y: m },
    { key: "circle_r", label: "Círculo central, direita", x: L / 2 + 9.15, y: m },
    // Os postes: 7,32 m entre eles, e são o que melhor se vê num jogo filmado de longe.
    { key: "post_l_t", label: "Baliza esquerda, poste de cima", x: 0, y: m - 3.66 },
    { key: "post_l_b", label: "Baliza esquerda, poste de baixo", x: 0, y: m + 3.66 },
    { key: "post_r_t", label: "Baliza direita, poste de cima", x: L, y: m - 3.66 },
    { key: "post_r_b", label: "Baliza direita, poste de baixo", x: L, y: m + 3.66 },
  ];
  for (const [lado, x0, sinal] of [["l", 0, 1], ["r", L, -1]] as const) {
    const nome = lado === "l" ? "esquerda" : "direita";
    pts.push(
      { key: `pa_${lado}_t`, label: `Grande área ${nome}, canto de cima`, x: x0 + sinal * 16.5, y: m - 20.16 },
      { key: `pa_${lado}_b`, label: `Grande área ${nome}, canto de baixo`, x: x0 + sinal * 16.5, y: m + 20.16 },
      { key: `pa_${lado}_gt`, label: `Grande área ${nome}, na linha de fundo, cima`, x: x0, y: m - 20.16 },
      { key: `pa_${lado}_gb`, label: `Grande área ${nome}, na linha de fundo, baixo`, x: x0, y: m + 20.16 },
      { key: `ga_${lado}_t`, label: `Pequena área ${nome}, canto de cima`, x: x0 + sinal * 5.5, y: m - 9.16 },
      { key: `ga_${lado}_b`, label: `Pequena área ${nome}, canto de baixo`, x: x0 + sinal * 5.5, y: m + 9.16 },
      { key: `ga_${lado}_gt`, label: `Pequena área ${nome}, na linha de fundo, cima`, x: x0, y: m - 9.16 },
      { key: `ga_${lado}_gb`, label: `Pequena área ${nome}, na linha de fundo, baixo`, x: x0, y: m + 9.16 },
      { key: `pen_${lado}`, label: `Marca de penálti ${nome}`, x: x0 + sinal * 11, y: m },
    );
  }
  return pts;
}
