import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

// O navegador dispara o evento uma única vez e pode ser antes de o React montar: guardamos aqui, fora dos componentes.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = isStandalone();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

// Snapshot estável: só muda quando o estado muda.
let snapshot = { installed, canPrompt: false };
const getSnapshot = () => {
  if (snapshot.installed !== installed || snapshot.canPrompt !== !!deferred) snapshot = { installed, canPrompt: !!deferred };
  return snapshot;
};

export type Platform = 'ios' | 'android' | 'desktop';
export const detectPlatform = (): Platform => {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
};

export function usePwaInstall() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => ({ installed: false, canPrompt: false }));
  /** Abre o diálogo nativo de instalação. Devolve `false` quando o navegador não oferece (aí mostramos o passo a passo). */
  const install = async () => {
    if (!deferred) return false;
    const evt = deferred;
    deferred = null;
    notify();
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === 'accepted') {
      installed = true;
      notify();
    }
    return true;
  };
  return { ...state, install };
}
