import type { components } from "./schema";
export type Game = components["schemas"]["Game"];
export type Page = components["schemas"]["GamePage"];
export type Capabilities = components["schemas"]["Capabilities"];
export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, cache: "no-store" });
  if (!response.ok)
    throw new Error(
      "Sem conexão com a biblioteca. Verifique o servidor e tente novamente.",
    );
  return response.json() as Promise<T>;
}
