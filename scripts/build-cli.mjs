import { chmod } from 'node:fs/promises';
import { build } from 'esbuild';

const outfile = 'dist-electron/cli.js';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: {
    js: '#!/usr/bin/env node',
  },
  outfile,
});

// Keep the CLI executable on Unix-like systems without relying on shell utilities.
await chmod(outfile, 0o755);
