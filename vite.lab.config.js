import {defineConfig} from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'assets/lab',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: 'src/lab/main.js',
      formats: ['es'],
      fileName: () => 'lab.js',
    },
    rolldownOptions: {
      external: ['onnxruntime-web/all', 'onnxruntime-web/wasm', 'onnxruntime-web/webgpu', '@mediapipe/tasks-vision'],
      output: {
        codeSplitting: false,
      },
    },
  },
});
