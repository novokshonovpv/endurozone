import type { ApiError, Session } from "@enduro/contracts";
let csrfToken = "";
export const setSessionToken = (session: Session | null) => {
  csrfToken = session?.csrfToken ?? "";
};
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers:
        method === "GET"
          ? {}
          : {
              ...(options.body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
              "X-Enduro-Client": "web",
              "X-CSRF-Token": csrfToken,
            },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new RequestError(
      "Сервер недоступен. Проверьте подключение и попробуйте снова.",
      0,
      "NETWORK_ERROR",
    );
  }
  if (response.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(
      "Сервер временно недоступен. Обновите страницу и попробуйте снова.",
      response.status,
      "SERVER_UNAVAILABLE",
    );
  }
  if (!response.ok) {
    const error = (data as ApiError).error;
    throw new RequestError(
      error?.message ?? "Не удалось выполнить запрос.",
      response.status,
      error?.code ?? "REQUEST_FAILED",
    );
  }
  return data as T;
}
