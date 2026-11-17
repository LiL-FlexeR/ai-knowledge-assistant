import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('../apps/web/.next/static/', import.meta.url);
const forbidden = [
  process.env.OPENAI_API_KEY,
  process.env.DATABASE_URL,
  process.env.STORAGE_ROOT,
  process.env.API_INTERNAL_URL,
].filter((value) => value && value.length > 8);
let count = 0;
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await scan(file);
    else {
      const text = await readFile(file, 'utf8');
      if (forbidden.some((secret) => text.includes(secret)))
        throw new Error(
          'Server configuration appeared in a public build asset.',
        );
      count++;
    }
  }
}
await scan(root.pathname);
console.log(
  `Public bundle scan passed (${count} assets; server-only configuration absent).`,
);
