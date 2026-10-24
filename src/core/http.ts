/**
 * Peticiones HTTP con el mismo criterio de timeout que `requests` en Python:
 * el timeout corta la espera de cabeceras (conexión + primer byte), no la
 * descarga completa. Así una playlist de 150.000 líneas no se corta a mitad.
 */
export async function fetchWithHeaderTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Descarga el cuerpo como texto y lanza HttpStatusError si la respuesta no es 2xx. */
export async function getText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchWithHeaderTimeout(url, timeoutMs);
  if (!response.ok) throw new HttpStatusError(response.status);
  return response.text();
}
