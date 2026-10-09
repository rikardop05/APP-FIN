import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * Mundo CARNÊ DE PRESTAÇÕES. Cores são os tokens de `app/globals.css` (triplos HSL, com opacidade
 * por `<alpha-value>`), cantos são retos e a escala de tipo é real. O modo escuro segue o sistema
 * é o PADRÃO; o claro entra por `data-theme="light"` no <html> (escolha da pessoa, cookie `theme`).
 * Os tokens trocam sozinhos, sem variantes `dark:`.
 */
const withAlpha = (token: string) => `hsl(var(${token}) / <alpha-value>)`;

/**
 * Telas anteriores ao redesenho ainda usam a paleta crua do Tailwind (red/amber/emerald). Em vez de
 * deixá-las com cores fixas (ilegíveis no escuro e fora do mundo), a paleta de ESTADO é remapeada para
 * os tokens: fundos claros (50 a 200) viram o tom suave, bordas (300 a 400) o tom a 50%, e texto e
 * sólidos (500 a 950) o tom pleno. Continua tudo coerente nos dois temas. Telas novas devem usar os
 * tokens (text-destructive, bg-warning-soft...) direto; este remapa é rede de segurança.
 */
function stateScale(token: string): Record<string, string> {
  const soft = withAlpha(`${token}-soft`);
  const edge = `hsl(var(${token}) / 0.5)`;
  const full = withAlpha(token);
  return {
    50: soft, 100: soft, 200: soft,
    300: edge, 400: edge,
    500: full, 600: full, 700: full, 800: full, 900: full, 950: full,
  };
}

const config: Config = {
  darkMode: ['selector', ':root:not([data-theme="light"])'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      container: {
        center: true,
        padding: '1rem',
        screens: {
          '2xl': '1400px',
        },
      },
      colors: {
        red: stateScale('--destructive'),
        amber: stateScale('--warning'),
        emerald: stateScale('--success'),
        border: withAlpha('--border'),
        input: withAlpha('--input'),
        ring: withAlpha('--ring'),
        background: withAlpha('--background'),
        foreground: withAlpha('--foreground'),
        primary: {
          DEFAULT: withAlpha('--primary'),
          foreground: withAlpha('--primary-foreground'),
        },
        secondary: {
          DEFAULT: withAlpha('--secondary'),
          foreground: withAlpha('--secondary-foreground'),
        },
        // Carimbo vermelho: perigo, erro e divergência. PAGO é verde (success). Despesa não é vermelha.
        destructive: {
          DEFAULT: withAlpha('--destructive'),
          foreground: withAlpha('--destructive-foreground'),
          soft: withAlpha('--destructive-soft'),
        },
        success: {
          DEFAULT: withAlpha('--success'),
          foreground: withAlpha('--success-foreground'),
          soft: withAlpha('--success-soft'),
        },
        warning: {
          DEFAULT: withAlpha('--warning'),
          foreground: withAlpha('--warning-foreground'),
          soft: withAlpha('--warning-soft'),
        },
        muted: {
          DEFAULT: withAlpha('--muted'),
          foreground: withAlpha('--muted-foreground'),
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          foreground: withAlpha('--accent-foreground'),
        },
        popover: {
          DEFAULT: withAlpha('--popover'),
          foreground: withAlpha('--popover-foreground'),
        },
        card: {
          DEFAULT: withAlpha('--card'),
          foreground: withAlpha('--card-foreground'),
        },
        sidebar: {
          DEFAULT: withAlpha('--sidebar'),
          foreground: withAlpha('--sidebar-foreground'),
          muted: withAlpha('--sidebar-muted'),
          accent: withAlpha('--sidebar-accent'),
          'accent-foreground': withAlpha('--sidebar-accent-foreground'),
          border: withAlpha('--sidebar-border'),
        },
      },
      // Uma face de trabalho para a interface e numerais condensados para valores e parcelas.
      fontFamily: {
        sans: ['var(--font-ui)', 'system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
        numeral: ['var(--font-numeral)', 'Arial Narrow', 'Roboto Condensed', 'sans-serif'],
      },
      // Escala de tipo real (razão ~1,25). 12px é o piso: nada de rótulo de 10 ou 11px.
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.625rem' }],
        xl: ['1.375rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.75rem', { lineHeight: '2rem' }],
        '3xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      // Cantos retos: régua de 1px, não cartão arredondado.
      borderRadius: {
        none: '0px',
        sm: '0px',
        DEFAULT: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '0px',
      },
      // Profundidade: sem halo difuso. Só o diálogo e o painel flutuante levam sombra (com deslocamento e desfoque).
      boxShadow: {
        sm: 'none',
        DEFAULT: 'none',
        md: '0 1px 0 hsl(var(--border))',
        lg: '0 0 0 1px hsl(var(--foreground) / 0.18), 0 10px 24px -10px hsl(var(--foreground) / 0.35)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
