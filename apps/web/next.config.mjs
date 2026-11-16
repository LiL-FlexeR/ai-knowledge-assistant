import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const config = {
  ...(process.env.AKA_CONTAINER_BUILD === '1'
    ? {
        output: 'standalone',
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      }
    : {}),
};

export default config;
