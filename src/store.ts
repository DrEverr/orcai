import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Read a JSON file, returning `fallback` if it does not exist. */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) return fallback;
  return (await file.json()) as T;
}

/** Write a JSON file, creating parent directories as needed. */
export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}
