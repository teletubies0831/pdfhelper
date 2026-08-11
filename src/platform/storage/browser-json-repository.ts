export function readJsonValue<T>(storageKey: string, fallback: T): T {
  try {
    const serializedValue = localStorage.getItem(storageKey);
    return serializedValue === null ? fallback : JSON.parse(serializedValue) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonValue(storageKey: string, value: unknown): void {
  localStorage.setItem(storageKey, JSON.stringify(value));
}
