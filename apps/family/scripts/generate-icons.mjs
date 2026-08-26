#!/usr/bin/env node
/**
 * Gera os ícones de recurso da PWA — a bandeirola sobre o verde da casa.
 *
 * ## O que estes ficheiros são
 *
 * O ícone de **quem ainda não carregou emblema**. Um clube que tenha o seu vê o
 * seu: o `manifest.webmanifest` é gerado por academia e põe o `logoUrl` à frente
 * destes (ver `api/src/tenant/tenant-assets.controller.ts`). Estes são a garantia
 * de que existe sempre um ícone com medida declarada e verdadeira — sem um de
 * pelo menos 192px o Chrome nem considera a app instalável.
 *
 * ## Porque é que deixaram de ser um quadrado de cor
 *
 * Porque um quadrado de cor sólida não é uma marca: no ecrã inicial, ao lado do
 * WhatsApp e do Instagram, lê-se como um ícone que não carregou. Levam agora a
 * bandeirola de canto — o símbolo da Academias, o mesmo do site.
 *
 * O desenho fica dentro dos **60% centrais**. Um ícone maskable é recortado pelo
 * Android na forma que o fabricante escolher (círculo, quadrado redondo,
 * gota-de-água), e só a zona segura interior sobrevive de certeza a todas elas.
 *
 * Continua escrito em PNG puro com `zlib` — só a biblioteca padrão do Node, sem
 * `sharp` nem `canvas`. A anti-serrilha é feita por sobre-amostragem de 3×3 por
 * pixel, que para duas formas geométricas chega e sobra.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const PINE = [0x0e, 0x33, 0x2d]; // o verde da casa — o fundo
const MINT = [0x8f, 0xdc, 0xca]; // a bandeirola

/* --------------------------------------------------------------------------
   A bandeirola, nas mesmas coordenadas do SVG do site (grelha de 24).
   Ver `apps/site/src/components/primitives.tsx`.
   -------------------------------------------------------------------------- */

const FLAG = [
  [6.9, 2.6],
  [19.6, 7.0],
  [6.9, 11.4],
];
const POLE = { x: 6.9, y0: 2.6, y1: 21.2, r: 1.0 };
const ARC = { cx: 12.5, cy: 15.6, r: 5.6, w: 0.85 };

/** Caixa do desenho na grelha de 24, com folga para o mastro. */
const BOX = { x: 5.9, y: 2.6, w: 13.7, h: 18.6 };

function inTriangle(px, py, [[ax, ay], [bx, by], [cx, cy]]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Distância a um segmento — é o que dá ao mastro as pontas redondas. */
function distToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/**
 * Quanta bandeirola há neste ponto da grelha de 24: 0 nenhuma, 1 cheia.
 * O arco devolve 0.45 — está lá para quem olhe duas vezes.
 */
function markAt(x, y) {
  if (inTriangle(x, y, FLAG)) return 1;
  if (distToSegment(x, y, POLE.x, POLE.y0, POLE.x, POLE.y1) <= POLE.r) return 1;

  const d = Math.hypot(x - ARC.cx, y - ARC.cy);
  if (Math.abs(d - ARC.r) <= ARC.w / 2 && x <= ARC.cx && y >= ARC.cy) return 0.45;

  return 0;
}

/** PNG RGB, escrito à mão. https://www.w3.org/TR/png/ */
function encodeIconPng(size) {
  const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profundidade de bit
  ihdr[9] = 2; // tipo de cor: RGB
  ihdr[10] = 0; // compressão
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sem entrelaçamento

  // O desenho ocupa 60% da altura, centrado — a zona segura de um maskable.
  const scale = (size * 0.6) / BOX.h;
  const offX = (size - BOX.w * scale) / 2 - BOX.x * scale;
  const offY = (size - BOX.h * scale) / 2 - BOX.y * scale;

  const SS = 3; // sobre-amostragem por eixo

  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // byte de filtro
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const gx = (x + (sx + 0.5) / SS - offX) / scale;
          const gy = (y + (sy + 0.5) / SS - offY) / scale;
          cover += markAt(gx, gy);
        }
      }
      cover /= SS * SS;

      const px = rowStart + 1 + x * 3;
      for (let c = 0; c < 3; c++) {
        raw[px + c] = Math.round(PINE[c] + (MINT[c] - PINE[c]) * cover);
      }
    }
  }

  const idat = deflateSync(raw);

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT_DIR, { recursive: true });

// 180 é o do iOS: o `apple-touch-icon` de um clube sem emblema. O iOS ignora o
// manifest por completo ao adicionar ao ecrã inicial e lê só aquela tag.
for (const size of [180, 192, 512]) {
  const png = encodeIconPng(size);
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`escrito ${file} (${png.length} bytes)`);
}
