import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { ApiError, storageError } from '../../api-error';

const uuidPattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const stagePattern = new RegExp(`^${uuidPattern}\\.upload$`);
const directoryPattern = new RegExp(`^${uuidPattern}$`);
const originalPattern = new RegExp(
  `^${uuidPattern}/original\\.(pdf|txt|md|markdown)$`,
);
export function assertOriginalPath(path: string): void {
  if (!originalPattern.test(path)) throw storageError();
}
function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

@Injectable()
export class LocalDocumentStore {
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}

  async ensureRoot(): Promise<void> {
    // Check every component before creating a child, including configured ancestors.
    const root = resolve(this.config.STORAGE_ROOT);
    let current = parse(root).root;
    for (const part of root.slice(current.length).split('/').filter(Boolean)) {
      current = join(current, part);
      let entry = await stat(current);
      if (!entry) {
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        entry = await lstat(current);
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw storageError();
    }
  }

  stageName(id: string): string {
    const name = `${id}.upload`;
    if (!stagePattern.test(name)) throw storageError();
    return name;
  }

  async writeStage(
    name: string,
    source: Readable,
    signal: AbortSignal,
  ): Promise<number> {
    if (!stagePattern.test(name)) throw storageError();
    await this.ensureRoot();
    let size = 0;
    const limit = this.config.MAX_UPLOAD_BYTES;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(
          size > limit
            ? new ApiError(
                413,
                'PAYLOAD_TOO_LARGE',
                'Document exceeds the upload size limit.',
              )
            : null,
          chunk,
        );
      },
    });
    const file = await open(
      join(this.config.STORAGE_ROOT, name),
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    await pipeline(source, counter, file.createWriteStream(), { signal });
    return size;
  }

  async readStage(name: string): Promise<Buffer> {
    if (!stagePattern.test(name)) throw storageError();
    await this.ensureRoot();
    const file = await open(
      join(this.config.STORAGE_ROOT, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > this.config.MAX_UPLOAD_BYTES)
        throw storageError();
      return await file.readFile();
    } finally {
      await file.close();
    }
  }

  async promote(stage: string, path: string): Promise<void> {
    assertOriginalPath(path);
    if (!stagePattern.test(stage)) throw storageError();
    await this.ensureRoot();
    const staged = await lstat(join(this.config.STORAGE_ROOT, stage));
    if (!staged.isFile() || staged.isSymbolicLink()) throw storageError();
    const directory = dirname(join(this.config.STORAGE_ROOT, path));
    await mkdir(directory, { mode: 0o700 }); // Exclusive generated directory; never overwrite.
    await rename(
      join(this.config.STORAGE_ROOT, stage),
      join(this.config.STORAGE_ROOT, path),
    );
  }

  async removeStage(name: string): Promise<void> {
    if (!stagePattern.test(name)) throw storageError();
    await this.ensureRoot();
    const path = join(this.config.STORAGE_ROOT, name);
    const info = await stat(path);
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink()) throw storageError();
    try {
      await unlink(path);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  async removeOriginal(path: string): Promise<void> {
    assertOriginalPath(path);
    await this.ensureRoot();
    const target = join(this.config.STORAGE_ROOT, path);
    const directory = dirname(target);
    const dirInfo = await stat(directory);
    if (!dirInfo) return;
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink())
      throw storageError();
    const info = await stat(target);
    if (info && (!info.isFile() || info.isSymbolicLink())) throw storageError();
    if (info) {
      try {
        await unlink(target);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    try {
      await rmdir(directory);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  async cleanupOrphans(
    referenced: ReadonlySet<string>,
    now = Date.now(),
  ): Promise<void> {
    await this.ensureRoot();
    const cutoff = now - 3600000;
    for (const name of await readdir(this.config.STORAGE_ROOT)) {
      const path = join(this.config.STORAGE_ROOT, name);
      const info = await stat(path);
      if (!info || info.isSymbolicLink()) continue;
      if (stagePattern.test(name) && info.isFile() && info.mtimeMs < cutoff) {
        await this.removeStage(name);
      } else if (directoryPattern.test(name) && info.isDirectory()) {
        for (const file of await readdir(path)) {
          const relative = `${name}/${file}`;
          if (!originalPattern.test(relative) || referenced.has(relative))
            continue;
          const entry = await stat(join(path, file));
          if (
            entry?.isFile() &&
            !entry.isSymbolicLink() &&
            entry.mtimeMs < cutoff
          ) {
            await unlink(join(path, file));
          }
        }
        // Do not recursively delete unknown entries or symlinks.
        if (info.mtimeMs < cutoff && (await readdir(path)).length === 0) {
          try {
            await rmdir(path);
          } catch (error) {
            if (!missing(error)) throw error;
          }
        }
      }
    }
  }
}
