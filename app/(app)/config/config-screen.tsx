'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Tags,
  Trash2,
  Users,
  Workflow,
} from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader } from '@/components/ui-kit';
import { CategoryForm } from './category-form';
import { RuleForm, type CategoryOption } from './rule-form';
import { SettingsForm } from './settings-form';
import { natureLabel, matchTypeLabel } from './labels';
import {
  categoriesResponseSchema,
  rulesOnlyResponseSchema,
  rulesResponseSchema,
  settingsResponseSchema,
  type CategoryFormValues,
  type CategoryNode,
  type Member,
  type RuleFormValues,
  type RuleRecord,
  type SettingsRecord,
} from './schemas';

type DialogState =
  | { kind: 'root' }
  | { kind: 'leaf'; parent: CategoryNode }
  | { kind: 'editCategory'; record: CategoryNode; parent: CategoryNode | null }
  | { kind: 'rule'; record?: RuleRecord };

async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error('A resposta do servidor está inválida.');
  }
  return result.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível carregar as configurações.';
}

/**
 * Categorias **folha** numa lista plana, para o seletor de regra. Raiz com
 * filhas e agrupamento e nao recebe lancamento — a regra aponta para a folha
 * (DATA-MODEL §2). Raiz sem filhas funciona como folha e entra normalmente.
 */
function flattenCategories(nodes: CategoryNode[]): CategoryOption[] {
  const options: CategoryOption[] = [];
  for (const root of nodes) {
    if (root.children.length === 0) {
      options.push({ id: root.id, label: root.name });
      continue;
    }
    for (const child of root.children) {
      options.push({ id: child.id, label: `${root.name} · ${child.name}` });
    }
  }
  return options;
}

export function ConfigScreen() {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [categoriesResponse, rulesResponse, settingsResponse] = await Promise.all([
        fetch('/api/categories', { cache: 'no-store' }),
        fetch('/api/rules', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
      ]);
      const categoryData = await readResponse(categoriesResponse, categoriesResponseSchema);
      const ruleData = await readResponse(rulesResponse, rulesResponseSchema);
      const settingsData = await readResponse(settingsResponse, settingsResponseSchema);
      setCategories(categoryData.categories);
      setRules(ruleData.rules);
      setMembers(ruleData.members);
      setSettings(settingsData.settings);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryOptions = useMemo(() => flattenCategories(categories), [categories]);

  const isRuleDialog = dialog?.kind === 'rule';
  const dialogRule = dialog?.kind === 'rule' ? (dialog.record ?? null) : null;
  const dialogCategory = dialog !== null && dialog.kind !== 'rule' ? dialog : null;
  const categoryMode: 'root' | 'leaf' =
    dialogCategory?.kind === 'leaf'
      ? 'leaf'
      : dialogCategory?.kind === 'editCategory'
        ? dialogCategory.record.parentId === null
          ? 'root'
          : 'leaf'
        : 'root';
  const categoryInitial =
    dialogCategory?.kind === 'editCategory'
      ? {
          name: dialogCategory.record.name,
          nature: dialogCategory.record.nature,
          color: dialogCategory.record.color,
          sortOrder: dialogCategory.record.sortOrder,
        }
      : undefined;
  const dialogTitle =
    dialog === null
      ? ''
      : dialog.kind === 'root'
        ? 'Nova categoria'
        : dialog.kind === 'leaf'
          ? `Nova subcategoria de ${dialog.parent.name}`
          : dialog.kind === 'editCategory'
            ? 'Editar categoria'
            : dialog.record
              ? 'Editar regra'
              : 'Nova regra';

  async function saveCategory(values: CategoryFormValues, current: DialogState) {
    let parentId: string | null = null;
    let id: string | undefined;
    if (current.kind === 'root') {
      parentId = null;
    } else if (current.kind === 'leaf') {
      parentId = current.parent.id;
    } else if (current.kind === 'editCategory') {
      parentId = current.record.parentId;
      id = current.record.id;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(id ? `/api/categories/${id}` : '/api/categories', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          id
            ? {
                name: values.name,
                nature: parentId === null ? null : values.nature === '' ? null : values.nature,
                color: values.color === '' ? null : values.color,
                sortOrder: Number(values.sortOrder),
              }
            : {
                name: values.name,
                parentId,
                nature: parentId === null ? null : values.nature === '' ? null : values.nature,
                color: values.color === '' ? null : values.color,
                sortOrder: Number(values.sortOrder),
              },
        ),
      });
      const data = await readResponse(response, categoriesResponseSchema);
      setCategories(data.categories);
      setDialog(null);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(category: CategoryNode) {
    if (!window.confirm(`Excluir a categoria "${category.name}"?`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' });
      const data = await readResponse(response, categoriesResponseSchema);
      setCategories(data.categories);
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  }

  async function saveRule(values: RuleFormValues, id?: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(id ? `/api/rules/${id}` : '/api/rules', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern: values.pattern,
          matchType: values.matchType,
          categoryId: values.categoryId,
          memberId: values.memberId === '' ? null : values.memberId,
          active: values.active,
          priority: null,
        }),
      });
      const data = await readResponse(response, rulesOnlyResponseSchema);
      setRules(data.rules);
      setDialog(null);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: RuleRecord) {
    setError(null);
    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern: rule.pattern,
          matchType: rule.matchType,
          categoryId: rule.categoryId,
          memberId: rule.memberId,
          active: !rule.active,
          priority: null,
        }),
      });
      const data = await readResponse(response, rulesOnlyResponseSchema);
      setRules(data.rules);
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    }
  }

  async function removeRule(rule: RuleRecord) {
    if (!window.confirm(`Excluir a regra "${rule.pattern}"?`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/rules/${rule.id}`, { method: 'DELETE' });
      const data = await readResponse(response, rulesOnlyResponseSchema);
      setRules(data.rules);
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  }

  async function moveRule(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/rules/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((rule) => rule.id) }),
      });
      const data = await readResponse(response, rulesOnlyResponseSchema);
      setRules(data.rules);
    } catch (moveError) {
      setError(errorMessage(moveError));
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings(values: {
    emergencyFundMonths: number;
    budgetWarnBp: number;
    projectionMonths: number;
    commitmentMonths: number;
  }) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await readResponse(response, settingsResponseSchema);
      setSettings(data.settings);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Categorias, regras de categorização, membros e premissas globais."
      />

      {error ? (
        <div
          role="alert"
          className="mt-4 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          Carregando configurações…
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          {/* Categorias */}
          <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="categories-heading" className="text-lg font-semibold tracking-tight">
                  Categorias
                </h2>
                <p className="text-sm text-muted-foreground">
                  Duas camadas: a raiz agrupa, a subcategoria recebe o lançamento e a natureza.
                </p>
              </div>
              <Button onClick={() => setDialog({ kind: 'root' })}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Nova categoria
              </Button>
            </div>

            {categories.length === 0 ? (
              <EmptyState
                icon={Tags}
                title="Nenhuma categoria cadastrada"
                description="Crie a primeira categoria para classificar seus lançamentos."
                action={{ label: 'Nova categoria', onClick: () => setDialog({ kind: 'root' }) }}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {categories.map((root) => (
                  <li key={root.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium">{root.name}</h3>
                        {/* A natureza da raiz nao e exibida: ela e um default do
                            servidor, nao classificacao real (a natureza pertence
                            a folha). */}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {root.children.length === 0
                            ? 'Sem subcategorias — recebe lançamentos direto.'
                            : `${String(root.children.length)} subcategoria(s)`}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDialog({ kind: 'leaf', parent: root })}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          Subcategoria
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar ${root.name}`}
                          onClick={() => setDialog({ kind: 'editCategory', record: root, parent: null })}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Excluir ${root.name}`}
                          onClick={() => void removeCategory(root)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    {root.children.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                        {root.children.map((child) => (
                          <li
                            key={child.id}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                              <span className="truncate">{child.name}</span>
                              <Badge variant="neutral">{natureLabel[child.nature]}</Badge>
                            </span>
                            <span className="flex shrink-0 gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Editar ${child.name}`}
                                onClick={() =>
                                  setDialog({ kind: 'editCategory', record: child, parent: root })
                                }
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Excluir ${child.name}`}
                                onClick={() => void removeCategory(child)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                              </Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Regras */}
          <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="rules-heading" className="text-lg font-semibold tracking-tight">
                  Regras de categorização
                </h2>
                <p className="text-sm text-muted-foreground">
                  A primeira regra que casa a descrição, de cima para baixo, define a categoria.
                </p>
              </div>
              <Button
                onClick={() => setDialog({ kind: 'rule' })}
                disabled={categoryOptions.length === 0}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Nova regra
              </Button>
            </div>

            {rules.length === 0 ? (
              <EmptyState
                icon={Workflow}
                title="Nenhuma regra cadastrada"
                description="Regras categorizam lançamentos automaticamente na importação."
                action={
                  categoryOptions.length === 0
                    ? { label: 'Criar categoria primeiro', onClick: () => setDialog({ kind: 'root' }) }
                    : { label: 'Nova regra', onClick: () => setDialog({ kind: 'rule' }) }
                }
              />
            ) : (
              <ol className="flex flex-col gap-3">
                {rules.map((rule, index) => (
                  <li
                    key={rule.id}
                    className="rounded-lg border border-border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium"
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="break-words font-medium">{rule.pattern}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="neutral">{matchTypeLabel[rule.matchType]}</Badge>
                            <span>{rule.categoryName}</span>
                            <span>· {rule.memberName ?? 'Família'}</span>
                            <Badge variant={rule.hits > 0 ? 'success' : 'neutral'}>
                              {rule.hits} {rule.hits === 1 ? 'uso' : 'usos'}
                            </Badge>
                            {rule.active ? null : <Badge variant="warning">Inativa</Badge>}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Mover para cima"
                          onClick={() => void moveRule(index, -1)}
                          disabled={index === 0 || saving}
                        >
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Mover para baixo"
                          onClick={() => void moveRule(index, 1)}
                          disabled={index === rules.length - 1 || saving}
                        >
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void toggleRule(rule)}
                        >
                          {rule.active ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar regra ${rule.pattern}`}
                          onClick={() => setDialog({ kind: 'rule', record: rule })}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Excluir regra ${rule.pattern}`}
                          onClick={() => void removeRule(rule)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Membros */}
          <section aria-labelledby="members-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="members-heading" className="text-lg font-semibold tracking-tight">
                Membros
              </h2>
              <p className="text-sm text-muted-foreground">
                Quem gasta. O responsável de uma regra é uma sugestão, não uma obrigação.
              </p>
            </div>
            {members.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum membro cadastrado.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {member.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Premissas globais */}
          <section aria-labelledby="settings-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="settings-heading" className="text-lg font-semibold tracking-tight">
                Premissas globais
              </h2>
              <p className="text-sm text-muted-foreground">
                Valores que as telas de orçamento, fluxo e metas usam como padrão.
              </p>
            </div>
            {settings === null ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Premissas indisponíveis.
              </p>
            ) : (
              <div className="rounded-lg border border-border bg-card p-4">
                <SettingsForm initial={settings} busy={saving} onSubmit={(values) => void saveSettings(values)} />
              </div>
            )}
          </section>
        </div>
      )}

      {dialog ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <div
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-lg border border-border bg-background p-4 shadow-lg sm:max-w-xl sm:rounded-lg sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-dialog-title"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 id="config-dialog-title" className="text-lg font-semibold">
                {dialogTitle}
              </h2>
              <Button variant="ghost" size="sm" aria-label="Fechar" onClick={() => setDialog(null)}>
                Fechar
              </Button>
            </div>

            {isRuleDialog ? (
              <RuleForm
                key={dialogRule?.id ?? 'new-rule'}
                initial={dialogRule ?? undefined}
                categories={categoryOptions}
                members={members}
                busy={saving}
                onCancel={() => setDialog(null)}
                onSubmit={(values) => void saveRule(values, dialogRule?.id)}
              />
            ) : dialogCategory !== null ? (
              <CategoryForm
                key={
                  dialogCategory.kind === 'editCategory'
                    ? dialogCategory.record.id
                    : `new-${categoryMode}-${dialogCategory.kind === 'leaf' ? dialogCategory.parent.id : 'root'}`
                }
                mode={categoryMode}
                initial={categoryInitial}
                busy={saving}
                onCancel={() => setDialog(null)}
                onSubmit={(values) => void saveCategory(values, dialogCategory)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
