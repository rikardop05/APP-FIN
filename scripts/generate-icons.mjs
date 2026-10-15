/**
 * Geração de ícones do APPFIN a partir da marca final do Ricardo:
 *  - public/icons/logo.svg  → canhoto com picote e CONFERE, sobre a mesa #0A1414 (fundo até a borda);
 *  - app/icon.svg           → o mesmo canhoto sem fundo, largura toda (a variante de favicon).
 * Uso: `node scripts/generate-icons.mjs`. Rasteriza com o `sharp` que o Next já instala —
 * nenhuma dependência nova em produção. A geometria NÃO é editada aqui: só se rasteriza.
 *
 * Saídas em public/icons/:
 *  - favicon-32.png          → favicon PNG (navegadores antigos), a partir de app/icon.svg.
 *  - icon-192.png / 512.png  → instalável (manifest, purpose "any"), a partir de logo.svg.
 *  - icon-maskable-512.png   → o fundo #0A1414 até a borda e o canhoto reduzido a ~78% e centrado
 *                              (caber no círculo de 80% de diâmetro do Android).
 *  - apple-touch-icon.png    → 180 px, sem transparência (logo.svg já cobre o tile inteiro).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const logoPath = join(root, 'public', 'icons', 'logo.svg');
const faviconPath = join(root, 'app', 'icon.svg');

/** O fundo (a mesa) fica até a borda; o conteúdo inteiro de logo.svg entra a 78%, centrado. */
function maskableSvg() {
  const text = readFileSync(logoPath, 'utf8');
  const aberto = text.replace(
    /(<rect width="512" height="512" fill="#0A1414"\/>)/,
    '$1<g transform="translate(56.32 56.32) scale(0.78)">',
  );
  return Buffer.from(aberto.replace(/<\/svg>\s*$/, '</g></svg>'));
}

async function rasterize(source, size, file) {
  await sharp(source, { density: 72 })
    .resize(size, size, { fit: 'contain', background: { r: 10, g: 20, b: 20, alpha: 0 } })
    .png()
    .toFile(join(root, 'public', 'icons', file));
}

const logo = readFileSync(logoPath);
const favicon = readFileSync(faviconPath);

await rasterize(favicon, 32, 'favicon-32.png');
await rasterize(logo, 180, 'apple-touch-icon.png');
await rasterize(logo, 192, 'icon-192.png');
await rasterize(logo, 512, 'icon-512.png');
await rasterize(maskableSvg(), 512, 'icon-maskable-512.png');

console.log('icones gerados em public/icons/ (logo.svg para tiles, app/icon.svg para o favicon)');
