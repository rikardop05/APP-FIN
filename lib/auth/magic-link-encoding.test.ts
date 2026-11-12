import { createTransport } from 'nodemailer';
import { describe, expect, it } from 'vitest';

import { buildMagicLinkEmail } from './magic-link';

/** Decodifica o corpo de uma parte MIME em quoted-printable ou base64, como UTF-8. */
function decodePart(part: string): string {
  const [head = '', ...rest] = part.split(/\r?\n\r?\n/);
  const body = rest.join('\n\n');
  if (/content-transfer-encoding:\s*base64/i.test(head)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    const bytes = body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}

describe('e-mail do link mágico: acentos saem em UTF-8', () => {
  it('texto e HTML com acento chegam intactos e com charset utf-8', async () => {
    const content = buildMagicLinkEmail('https://exemplo.invalid/entrar?t=1', 'exemplo.invalid');
    expect(content.text).toContain('Alguém pediu');
    expect(content.text).toContain('Se não foi você');
    const transport = createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail({ to: 'a@exemplo.invalid', from: 'b@exemplo.invalid', ...content });
    const raw = (info.message as Buffer).toString('latin1');
    expect(raw.toLowerCase()).toContain('charset=utf-8');
    expect(raw).not.toMatch(/charset=(iso-8859-1|us-ascii)/i);
    const parts = raw.split(/--[^\r\n]+\r?\n/).filter((part) => /content-type:\s*text\//i.test(part));
    const decoded = parts.map(decodePart).join('\n');
    expect(decoded).toContain('Alguém pediu um link de acesso ao APPFIN para este endereço.');
    expect(decoded).toContain('só pode ser usado uma vez');
    expect(decoded).toContain('Se não foi você, ignore este e-mail');
  });
});
