const BASE_URL = '/api';

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

const qs = (query?: Query) => {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}${qs(opts.query)}`, { method, headers, body });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet e tente novamente.', 0);
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401 && localStorage.getItem('token') && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    throw new ApiError((data?.message as string) || 'Algo deu errado. Tente novamente.', res.status, data ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', path, { form });
  },
  /** Baixa um arquivo protegido (CSV, .ics) usando o token da sessão. */
  async download(path: string, filename: string, query?: Query) {
    const res = await fetch(`${BASE_URL}${path}${qs(query)}`, { headers: authHeaders() });
    if (!res.ok) throw new ApiError('Não foi possível baixar o arquivo.', res.status);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
