export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json() as Promise<T>;
}

export function formatBytes(bytes: number) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1_024) return `${Math.round(bytes / 1_024)} KB`;
  return `${bytes} B`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}
