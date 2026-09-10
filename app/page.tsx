import { cn } from '@/lib/utils';

/**
 * Landing provisoria do T-001, so para conferencia visual no gate humano:
 * prova que o Tailwind compila e que os tokens de tema do shadcn/ui chegam
 * ao browser. O T-005 substitui esta pagina pelo shell real de navegacao.
 *
 * Identificadores em ingles, textos visiveis em pt-BR (CONVENTIONS §1).
 */

type Swatch = { label: string; className: string; token: string };

// `as const satisfies` fixa os literais como somente-leitura e ainda confere o
// formato contra `Swatch`: e conteudo fixo de exibicao, que nada altera em
// tempo de execucao (CONVENTIONS §6, justificativa do `as`).
const SWATCHES = [
  { label: 'Fundo', className: 'bg-background', token: 'bg-background' },
  { label: 'Cartão', className: 'bg-card', token: 'bg-card' },
  { label: 'Discreto', className: 'bg-muted', token: 'bg-muted' },
  { label: 'Primário', className: 'bg-primary', token: 'bg-primary' },
  { label: 'Destaque', className: 'bg-accent', token: 'bg-accent' },
  { label: 'Destrutivo', className: 'bg-destructive', token: 'bg-destructive' },
] as const satisfies readonly Swatch[];

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          APPFIN
        </h1>
        <p className="text-base text-muted-foreground">
          Controle e planejamento financeiro da família.
        </p>
      </header>

      <section
        aria-labelledby="theme-sample"
        className="rounded-lg border border-border bg-card p-4 sm:p-5"
      >
        <h2
          id="theme-sample"
          className="text-sm font-medium text-card-foreground"
        >
          Amostra de tema
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada quadro abaixo usa um token do shadcn/ui, nenhuma cor chumbada.
          Se os quadros aparecem distintos e a borda está visível, o Tailwind e
          os tokens estão funcionando.
        </p>

        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SWATCHES.map((swatch) => (
            <li key={swatch.token} className="flex flex-col gap-1.5">
              <div
                className={cn(
                  'h-12 w-full rounded-md border border-border',
                  swatch.className,
                )}
              />
              <span className="text-xs font-medium text-foreground">
                {swatch.label}
              </span>
              <code className="text-[11px] text-muted-foreground">
                {swatch.token}
              </code>
            </li>
          ))}
        </ul>

        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          Tipografia:{' '}
          <span className="text-foreground">text-foreground</span> para o texto
          principal e <span className="italic">text-muted-foreground</span>{' '}
          para o secundário. Valor monetário usa numeral tabular:{' '}
          <span className="tabular text-foreground">R$ 1.234,56</span>.
        </p>
      </section>

      <section className="rounded-lg border border-dashed border-border p-4 sm:p-5">
        <h2 className="text-sm font-medium text-foreground">
          Página provisória
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Esta tela existe apenas para a conferência visual do gate do T-001.
          Ela não faz parte do produto e será substituída pelo shell de
          navegação do T-005. Ainda não há banco, autenticação nem rota de
          aplicação.
        </p>
      </section>
    </main>
  );
}
