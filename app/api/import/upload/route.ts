import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { detectSource } from '@/lib/import/detect';
import { PdfPasswordError, extractPdfTextItems } from '@/lib/import/pdf/extract';
import { detectPdfIssuer } from '@/lib/import/pdf/detect';
import { groupIntoRows } from '@/lib/import/pdf/rows';
import { parseMercadoPagoPdf } from '@/lib/import/pdf/mercadopago';
import { parseNubankPdf } from '@/lib/import/pdf/nubank';
import { parseSantanderPdf, SANTANDER_X_BANDS } from '@/lib/import/pdf/santander';
import { parsePastedText } from '@/lib/import/text';
import { buildImportPreview } from '@/lib/import/pipeline';
import {
  ImportSourceNotFoundError,
  prepareImport,
} from '@/lib/db/queries/import';
import { uploadBodySchema, type UploadBody } from '../schemas';

class InvalidImportUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImportUploadError';
  }
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function defaultYear(competence: string | undefined): number | undefined {
  return competence === undefined ? undefined : Number(competence.slice(0, 4));
}

async function parsePdf(input: Extract<UploadBody, { inputType: 'pdf' }>) {
  const bytes = Uint8Array.from(Buffer.from(input.contentBase64, 'base64'));
  const detected = detectSource({ fileName: input.fileName, content: bytes });
  if (detected.format !== 'pdf') {
    throw new InvalidImportUploadError(detected.hint ?? 'Não foi possível reconhecer este PDF.');
  }

  const items = await extractPdfTextItems(bytes, { password: input.password });
  const plainRows = groupIntoRows(items);
  const issuer = detectPdfIssuer(plainRows);
  if (issuer === null) throw new InvalidImportUploadError('Não foi possível reconhecer o banco neste PDF.');

  if (issuer === 'santander') {
    return {
      parse: parseSantanderPdf(groupIntoRows(items, { xBands: SANTANDER_X_BANDS }), {
        defaultYear: defaultYear(input.defaultCompetence),
      }),
      bankKey: issuer,
      format: 'pdf' as const,
    };
  }
  if (issuer === 'nubank') {
    return {
      parse: parseNubankPdf(plainRows, { defaultYear: defaultYear(input.defaultCompetence) }),
      bankKey: issuer,
      format: 'pdf' as const,
    };
  }
  return {
    parse: parseMercadoPagoPdf(plainRows, { defaultYear: defaultYear(input.defaultCompetence) }),
    bankKey: issuer,
    format: 'pdf' as const,
  };
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = uploadBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados do upload inválidos.' }, { status: 400 });
    }
    const input = parsed.data;
    const content = input.inputType === 'text'
      ? new TextEncoder().encode(input.content)
      : Uint8Array.from(Buffer.from(input.contentBase64, 'base64'));
    const fileHash = sha256(content);
    const preparation = await prepareImport(
      householdId,
      input.sourceKind,
      input.sourceId,
      fileHash,
    );
    const parsedFile = input.inputType === 'text'
      ? {
          parse: parsePastedText(input.content, { defaultCompetence: input.defaultCompetence }),
          bankKey: null,
          format: 'text' as const,
        }
      : await parsePdf(input);
    const preview = buildImportPreview({
      parse: parsedFile.parse,
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      cardCycle: preparation.source.cardCycle,
      rules: preparation.rules,
      existingHashes: preparation.existingHashes,
      today: input.today,
    });

    return NextResponse.json({
      fileName: input.fileName,
      fileHash,
      format: parsedFile.format,
      bankKey: parsedFile.bankKey,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      cardCycle: preparation.source.cardCycle,
      preview,
      previousBatches: preparation.previousBatches,
    });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof ImportSourceNotFoundError) {
      return NextResponse.json({ error: 'Conta ou cartão inválido.' }, { status: 400 });
    }
    if (error instanceof PdfPasswordError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidImportUploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível processar o arquivo.' }, { status: 500 });
  }
}
