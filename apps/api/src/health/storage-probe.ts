import { Inject, Injectable } from '@nestjs/common';
import {
  mkdtemp,
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { API_CONFIG } from '../config/config.module';
import type { Environment } from '../config/environment';

@Injectable()
export class StorageProbe {
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}

  async check(): Promise<void> {
    const root = this.config.STORAGE_ROOT;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(root, '.readiness-'));
    const file = join(directory, 'probe');
    try {
      await writeFile(file, 'ready', { flag: 'wx', mode: 0o600 });
      if ((await readFile(file, 'utf8')) !== 'ready') {
        throw new Error('Storage probe failed.');
      }
    } finally {
      await unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await rmdir(directory);
    }
  }
}
