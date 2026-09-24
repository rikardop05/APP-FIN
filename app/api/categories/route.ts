import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  CategoryDepthError,
  CategoryNatureRequiredError,
  createCategory,
  InvalidCategoryParentError,
  listCategories,
  type CategoryCreate,
} from '@/lib/db/queries/categories';
import { categoryCreateSchema } from './schemas';

export async function GET() {
  try {
    const { householdId } = await requireSession();
    const categories = await listCategories(householdId);
    return NextResponse.json({ categories });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar as categorias.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = categoryCreateSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da categoria inválidos.' }, { status: 400 });
    }
    const input: CategoryCreate = result.data;
    await createCategory(householdId, input);
    const categories = await listCategories(householdId);
    return NextResponse.json({ categories }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (
      error instanceof CategoryDepthError ||
      error instanceof InvalidCategoryParentError ||
      error instanceof CategoryNatureRequiredError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível criar a categoria.' }, { status: 500 });
  }
}
