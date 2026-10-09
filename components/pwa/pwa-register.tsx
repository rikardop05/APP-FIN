'use client';

import { useEffect, useReducer } from 'react';

import {
  bannerText,
  blocksWrite,
  INITIAL_OFFLINE_STATE,
  OFFLINE_WRITE_MESSAGE,
  parseWorkerMessage,
  reduceOffline,
} from './offline-state';

/** Quanto esperar o worker confirmar a limpeza antes de seguir com a saída da conta. */
const CLEAR_TIMEOUT_MS = 1500;

/**
 * Pede ao service worker que apague todo o cache do app e ESPERA a confirmação (ou o tempo
 * esgotar, o que vier primeiro; sem worker, volta na hora). O worker também apaga sozinho ao ver
 * o pedido de saída da conta ou uma sessão que acabou, mas o botão Sair chama esta função para
 * não depender disso (T-403, decisão 4: celular emprestado não pode mostrar as finanças depois
 * do logout).
 */
export function clearOfflineCache(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve();
  const worker = navigator.serviceWorker.controller;
  if (worker === null) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve();
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (parseWorkerMessage(event.data)?.type === 'cache-cleared') finish();
    };
    const timer = window.setTimeout(finish, CLEAR_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'clear' });
  });
}

/**
 * Registra o service worker e mostra a faixa de offline (T-403). Montado UMA vez, no layout raiz.
 *
 * - Só em produção: em `next dev` o worker não registra, para o cache não brigar com o hot reload.
 * - A faixa aparece quando a tela veio do cache (o worker avisa por mensagem, e responde se
 *   perguntado, para a página que ainda estava carregando) ou quando o navegador fica offline.
 * - Gravar exige internet: sem conexão, `fetch` de escrita falha na hora com uma mensagem clara
 *   (as telas mostram `error.message`). Nada é enfileirado para depois.
 */
export function PwaRegister() {
  const [state, dispatch] = useReducer(reduceOffline, INITIAL_OFFLINE_STATE);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;

    let offline = !navigator.onLine;
    if (offline) dispatch({ type: 'went-offline' });

    const onOffline = () => {
      offline = true;
      dispatch({ type: 'went-offline' });
    };
    const onOnline = () => {
      offline = false;
      dispatch({ type: 'went-online' });
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    const onMessage = (event: MessageEvent<unknown>) => {
      const parsed = parseWorkerMessage(event.data);
      if (parsed === null) return;
      if (parsed.type === 'served-from-cache') offline = true;
      if (parsed.type === 'cache-cleared') offline = false;
      dispatch(parsed);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    // Gravação sem internet: falha na hora e diz por quê (nunca fica pendurada nem vai para fila).
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (blocksWrite(method, navigator.onLine && !offline)) {
        return Promise.reject(new TypeError(OFFLINE_WRITE_MESSAGE));
      }
      return originalFetch(input, init);
    };

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        // A página que acabou de carregar pergunta se veio do cache (a mensagem do worker pode ter
        // saído antes de este componente existir).
        const target = navigator.serviceWorker.controller ?? registration.active;
        target?.postMessage({ type: 'status', path: window.location.pathname + window.location.search });
      })
      .catch(() => {
        // Sem worker o app segue normal, só que sem leitura offline.
      });

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.fetch = originalFetch;
    };
  }, []);

  const text = bannerText(state);
  if (text === null) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/50 bg-warning-soft px-4 py-2 text-center text-sm text-foreground"
    >
      <span>{text}</span>
      {state.reconnected ? (
        <button
          type="button"
          className="inline-flex min-h-11 items-center border border-warning/50 bg-card px-3 text-xs font-medium hover:bg-secondary sm:min-h-8"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
      ) : null}
    </div>
  );
}
