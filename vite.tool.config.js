import {defineConfig} from 'vite';
export default defineConfig({
  define: {'import.meta.env.VITE_TOOL_BUILD': JSON.stringify(new Date().toISOString())},
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
  worker: {format: 'iife'},
});
