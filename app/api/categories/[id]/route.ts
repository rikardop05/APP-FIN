import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  CategoryHasChildrenError,
  CategoryInUseError,
  CategoryNotFoundError,
  deleteCategory,
  listCategories,
  updateCategory,
  type CategoryUpdate,
} from '@/lib/db/queries/categories';
import { categoryIdSchema, categoryUpdateSchema } from '../schemas';

type RouteContext = { params: Promise<{ id: string }> };

async function getId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  const result = categoryIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (id === null) {
      return NextResponse.json({ error: 'Categoria inválida.' }, { status: 400 });
    }
    const payload: unknown = await request.json().catch(() => null);
    const result = categoryUpdateSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da categoria inválidos.' }, { status: 400 });
    }
    const input: CategoryUpdate = result.data;
    await updateCategory(session.householdId, id, input);
    const categories = await listCategories(session.householdId);
    return NextResponse.json({ categories });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Não foi possível atualizar a categoria.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (id === null) {
      return NextResponse.json({ error: 'Categoria inválida.' }, { status: 400 });
    }
    await deleteCategory(session.householdId, id);
    const categories = await listCategories(session.householdId);
    return NextResponse.json({ categories });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof CategoryHasChildrenError || error instanceof CategoryInUseError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível excluir a categoria.' }, { status: 500 });
  }
}
