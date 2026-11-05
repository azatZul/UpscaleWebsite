import {defineConfig} from 'vite';
export default defineConfig({
  base:'/assets/marketing/', publicDir:false,
  build:{outDir:'assets/marketing',emptyOutDir:true,manifest:true,
    rolldownOptions:{input:'src/marketing/main.js',output:{entryFileNames:'[name]-[hash].js',chunkFileNames:'[name]-[hash].js'}}},
});
