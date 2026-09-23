const BASE_URL = "https://zernio.com/api";
const TIMEOUT_MS = 15_000;

export type ZernioError = {
  status: number;
  code?: string;
  message: string;
  body?: unknown;
};

export type Result<T> = { success: true; data: T } | { success: false; error: ZernioError };

type QueryValue = string | number | boolean | undefined | null;

export type RequestOptions = {
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string;
};

// Nunca tira: un canal caído no puede voltear el request entero.
export async function zernioRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<Result<T>> {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    return { success: false, error: { status: 0, message: "ZERNIO_API_KEY no está configurada" } };
  }

  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    return {
      success: false,
      error: { status: 0, message: err instanceof Error ? err.message : "Error de red" },
    };
  }

  const text = await res.text().catch(() => "");
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    const obj = (json && typeof json === "object" ? json : {}) as { code?: string; error?: string; message?: string };
    return {
      success: false,
      error: {
        status: res.status,
        code: obj.code,
        message: obj.error ?? obj.message ?? `HTTP ${res.status}`,
        body: json,
      },
    };
  }

  return { success: true, data: json as T };
}
