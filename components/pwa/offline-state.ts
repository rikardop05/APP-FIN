/**
 * Estado e textos da faixa de offline (T-403). Puro: o componente (`pwa-register.tsx`) só liga
 * os eventos do navegador e do service worker a estas funções. Fora do .tsx porque o vitest não
 * transforma JSX.
 */

export type OfflineState = {
  /** A tela que se vê veio do cache (ou não há rede). */
  offline: boolean;
  /** Instante (ISO) em que o worker guardou o que está na tela; `null` se não se sabe. */
  cachedAt: string | null;
  /** A conexão voltou, mas a tela ainda mostra o dado guardado. */
  reconnected: boolean;
};

export const INITIAL_OFFLINE_STATE: OfflineState = { offline: false, cachedAt: null, reconnected: false };

export type OfflineEvent =
  | { type: 'went-offline' }
  | { type: 'went-online' }
  | { type: 'served-from-cache'; cachedAt: string | null }
  | { type: 'status'; fromCache: boolean; cachedAt: string | null }
  | { type: 'cache-cleared' };

export function reduceOffline(state: OfflineState, event: OfflineEvent): OfflineState {
  switch (event.type) {
    case 'went-offline':
      return { ...state, offline: true, reconnected: false };
    case 'went-online':
      // Só há o que oferecer (recarregar) se a tela estava mostrando dado guardado.
      return state.offline ? { ...state, offline: false, reconnected: true } : state;
    case 'served-from-cache':
      return { offline: true, cachedAt: event.cachedAt, reconnected: false };
    case 'status':
      return event.fromCache ? { offline: true, cachedAt: event.cachedAt, reconnected: false } : state;
    case 'cache-cleared':
      // Saiu da conta: nada guardado, nada a mostrar.
      return INITIAL_OFFLINE_STATE;
  }
}

/** "03/10/2026 14:32" no fuso de São Paulo, de um instante ISO. `null` se não for uma data. */
export function formatCachedAt(iso: string | null): string | null {
  if (iso === null || iso === '') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Texto da faixa; `null` = não mostra faixa. Sem data válida, não inventa uma. */
export function bannerText(state: OfflineState): string | null {
  if (state.offline) {
    const when = formatCachedAt(state.cachedAt);
    return when === null
      ? 'Sem conexão — mostrando os últimos dados carregados. Gravar exige internet.'
      : `Sem conexão — mostrando os dados de ${when}. Gravar exige internet.`;
  }
  if (state.reconnected) return 'A conexão voltou. Recarregue para ver os dados atuais.';
  return null;
}

/** Gravar exige internet; leitura cai no cache. Nunca se enfileira gravação para depois. */
export function blocksWrite(method: string, online: boolean): boolean {
  const upper = method.toUpperCase();
  return !online && upper !== 'GET' && upper !== 'HEAD' && upper !== 'OPTIONS';
}

export const OFFLINE_WRITE_MESSAGE = 'Sem conexão: é preciso internet para gravar.';

/**
 * Mensagem do service worker -> evento do estado. `null` para o que a faixa ignora (mensagem de
 * outra origem de dados, forma inesperada). Entrada `unknown`: vem de `postMessage`.
 */
export function parseWorkerMessage(data: unknown): OfflineEvent | null {
  if (typeof data !== 'object' || data === null || !('type' in data)) return null;
  const record = data as { type?: unknown; cachedAt?: unknown; fromCache?: unknown };
  const cachedAt = typeof record.cachedAt === 'string' ? record.cachedAt : null;
  if (record.type === 'served-from-cache') return { type: 'served-from-cache', cachedAt };
  if (record.type === 'status') return { type: 'status', fromCache: record.fromCache === true, cachedAt };
  if (record.type === 'cache-cleared') return { type: 'cache-cleared' };
  return null;
}
