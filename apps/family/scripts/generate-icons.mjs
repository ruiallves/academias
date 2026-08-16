#!/usr/bin/env node
/**
 * Gera os ícones da PWA — placeholders reais, não ficheiros em falta.
 *
 * Sem estes ficheiros o manifest aponta para /icon-192.png e /icon-512.png que
 * devolvem 404, e o Chrome recusa-se a considerar a app instalável (sem ícone
 * válido de pelo menos 192px, não há `beforeinstallprompt`). Um quadrado liso na
 * cor de sinal é um ícone legítimo — muitas apps fazem exactamente isto — e serve
 * até cada academia carregar o logótipo próprio (Supabase Storage, branding
 * white-label). Escrito em PNG puro com `zlib` (só a biblioteca padrão do Node,
 * sem `sharp` nem `canvas`) para não introduzir uma dependência nativa só para
 * dois quadrados de cor.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const SIGNAL = [0x0f, 0x6b, 0x62]; // --color-signal, Academia Life Club

/** PNG RGB de cor sólida, sem dependências. https://www.w3.org/TR/png/ */
function encodeSolidPng(width, height, [r, g, b]) {
  const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidade de bit
  ihdr[9] = 2; // tipo de cor: RGB
  ihdr[10] = 0; // compressão
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sem entrelaçamento

  // Cada linha começa com um byte de filtro (0 = nenhum), seguido de RGB por pixel.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
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

for (const size of [192, 512]) {
  const png = encodeSolidPng(size, size, SIGNAL);
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`escrito ${file} (${png.length} bytes)`);
}
