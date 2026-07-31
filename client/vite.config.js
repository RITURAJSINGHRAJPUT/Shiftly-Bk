import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  },
  build: {
    rollupOptions: {
      output: {
        // Recharts and its d3 dependencies are the bulk of the bundle and change
        // far less often than app code, so splitting them out keeps them cached
        // across deploys rather than re-downloaded on every app change.
        manualChunks: {
          recharts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  }
});
