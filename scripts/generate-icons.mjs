/**
 * Gera os ícones do PWA (T-403) em `public/icons/`, sem dependência: o PNG é escrito à mão com o
 * `zlib` do Node. Rodar com `node scripts/generate-icons.mjs`; o resultado é commitado, então
 * isto só roda quando o desenho mudar.
 *
 * Desenho: fundo grafite (o `--primary` do tema) e três barras crescentes (a última em verde):
 * "dinheiro que cresce". Simples de propósito, legível em 192 px e menor.
 *
 *  - icon-192.png / icon-512.png: quadrado de cantos arredondados, fundo transparente nos cantos;
 *  - icon-maskable-512.png: fundo até a borda e desenho dentro da zona segura (80 %), porque o
 *    Android recorta o ícone em círculo/gota;
 *  - apple-touch-icon.png (180): fundo até a borda, sem transparência (o iOS arredonda sozinho).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BACKGROUND = [24, 24, 27, 255]; // #18181b
const BAR = [250, 250, 250, 255];
const ACCENT = [52, 211, 153, 255]; // #34d399

function inRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - 1 - radius);
  const cy = Math.min(Math.max(y, radius), size - 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** `content` = fração do lado que o desenho ocupa; `rounded` = cantos transparentes. */
function render(size, { content, rounded }) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = rounded ? Math.round(size * 0.22) : 0;
  const box = size * content;
  const barW = box * 0.2;
  const gap = box * 0.1;
  const total = barW * 3 + gap * 2;
  const left = (size - total) / 2;
  const baseline = size / 2 + box * 0.45;
  const heights = [box * 0.35, box * 0.62, box * 0.9];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = [0, 0, 0, 0];
      if (!rounded || inRoundedSquare(x, y, size, radius)) {
        color = BACKGROUND;
        for (let i = 0; i < 3; i += 1) {
          const x0 = left + i * (barW + gap);
          if (x >= x0 && x < x0 + barW && y <= baseline && y > baseline - heights[i]) {
            color = i === 2 ? ACCENT : BAR;
          }
        }
      }
      pixels.set(color, (y * size + x) * 4);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro "nenhum"
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  ['icon-192.png', 192, { content: 0.66, rounded: true }],
  ['icon-512.png', 512, { content: 0.66, rounded: true }],
  ['icon-maskable-512.png', 512, { content: 0.5, rounded: false }],
  ['apple-touch-icon.png', 180, { content: 0.6, rounded: false }],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, options] of ICONS) {
  writeFileSync(join(OUT, name), png(size, render(size, options)));
  console.log(`public/icons/${name} (${size}x${size})`);
}
