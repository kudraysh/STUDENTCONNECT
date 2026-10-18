export const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
let csrfToken = "";
export const getCsrf = () => csrfToken;
export const setCsrf = (value: string) => {
  csrfToken = value;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      signal: options.signal,
      headers: {
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      "Не удалось связаться с сервером. Проверьте подключение и повторите",
      0,
    );
  }
  const data = await response
    .json()
    .catch(() => ({ message: "Сервер вернул неожиданный ответ" }));
  if (!response.ok)
    throw new ApiError(
      data.message ?? "Не удалось выполнить запрос",
      response.status,
      data.fields,
    );
  return data as T;
}
export type Interest = { id: string; name: string; categoryId: string };
export type Category = { id: string; name: string; interests: Interest[] };
export type PublicUser = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  bio: string;
  avatar: string | null;
  course: number;
  group: string;
  interests: Interest[];
};
export type User = PublicUser & {
  email: string;
  phone: string | null;
  emailVerifiedAt: string | null;
};
export type Delivery = { mode: "console" | "smtp" | "brevo" | "manual"; sent: boolean };
export type Session = {
  user: User;
  csrfToken: string;
  mailMode?: "console" | "smtp" | "brevo" | "manual";
  delivery?: Delivery;
};
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";
