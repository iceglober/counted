import { toast } from "@/components/ui/sonner";

type ApiOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Suppress the automatic error toast (caller shows its own messaging). */
  silent?: boolean;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Fetch helper for client mutations. Sets JSON headers, stringifies the body,
 * and on a non-2xx response or network failure throws an ApiError while
 * surfacing the server's { error } message via a toast (unless `silent`). On
 * success it returns the parsed JSON body (or undefined for 204/empty).
 */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers, silent } = options;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    if (!silent) toast.error(message);
    throw new ApiError(message, 0);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    if (!silent) toast.error(message);
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}
