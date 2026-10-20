import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Carrega dados assíncronos e ignora respostas "velhas" quando as dependências mudam rápido.
 * `fn` é chamada de novo sempre que `deps` mudar ou `reload()` for usado.
 */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useRef(0);

  const load = useCallback(async (silent = false) => {
    const id = ++run.current;
    if (!silent) setLoading(true);
    try {
      const result = await fnRef.current();
      if (id !== run.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (id !== run.current) return;
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      if (id === run.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: () => load(true), refetch: () => load(false), setData };
}

export function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
