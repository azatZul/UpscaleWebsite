import {defineConfig} from 'vite';
export default defineConfig({
  base: '/assets/processor/app/',
  publicDir: false,
  build: {
    outDir: 'assets/processor/app', emptyOutDir: true,
    manifest: true,
    rolldownOptions: {
      input: 'src/tool/main.js',
      output: {entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js'},
    },
  },
  worker: {format: 'es'},
});
