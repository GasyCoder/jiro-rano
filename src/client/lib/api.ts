import type { ApiError, UploadResultDto } from '@shared/api';
import type { FileKind } from '@shared/domain';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function handle<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as ApiError | null)?.error;
    throw new ApiClientError(response.status, error?.code ?? 'HTTP_ERROR', error?.message ?? `Erreur ${response.status}`, error?.issues ?? []);
  }
  return data as T;
}

/** Appel JSON de l'API. Le cookie de session est envoyé automatiquement (même origine). */
export async function api<T>(path: string, options: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return handle<T>(response);
}

export async function uploadFile(buildingId: string, kind: FileKind, file: File): Promise<UploadResultDto> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`/api/buildings/${buildingId}/files?kind=${kind}`, { method: 'POST', body: form, credentials: 'same-origin' });
  return handle<UploadResultDto>(response);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.issues.length > 0) return `${error.message} : ${error.issues.map((i) => i.message).join(' · ')}`;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Erreur inattendue';
}
