import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    reporter: 'src/reporter.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  shims: true,
  target: 'node18',
  external: ['@playwright/test'],
  banner: ({ format }) => {
    if (format === 'esm') {
      return {
        js: `import { createRequire as __pwhmCR } from 'module'; const require = __pwhmCR(import.meta.url);`,
      };
    }
    return {};
  },
});
