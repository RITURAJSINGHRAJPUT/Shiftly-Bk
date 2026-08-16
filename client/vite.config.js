import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 57935,
    host: true,
    // The client calls /api relatively so the same code works on any host, which
    // means the dev server has to forward those calls to the API on its own
    // port. It also keeps everything same-origin, so CORS never applies.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    },
    // Vite refuses requests whose Host header it does not recognise — without
    // this a tunnelled request gets "Blocked request. This host is not allowed."
    // A leading dot matches all subdomains, which covers the random hostname
    // ngrok mints on each run without allowing everything.
    // .dev first because that is what ngrok mints today; the .app forms are kept
    // for older/reserved domains.
    allowedHosts: ['.ngrok-free.dev', '.ngrok.dev', '.ngrok-free.app', '.ngrok.app']
  },
  // `vite preview` serves the production build, and is what to expose over a
  // tunnel. The dev server ships unbundled ES modules — hundreds of separate
  // requests per page — which measured at roughly 4 seconds each through a free
  // ngrok tunnel: 55 requests in 240s and the page still had not loaded. The
  // build is about six files.
  //
  // These repeat rather than share a constant because `preview` does not inherit
  // from `server`; both extend CommonServerOptions independently.
  preview: {
    port: 57936,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    },
    allowedHosts: ['.ngrok-free.dev', '.ngrok.dev', '.ngrok-free.app', '.ngrok.app']
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
