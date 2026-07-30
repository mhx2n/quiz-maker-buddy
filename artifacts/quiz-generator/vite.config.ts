import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT: required for Replit dev server, optional for production builds (Vercel/Netlify).
// Never throw — just fall back to 3000 so `vite build` always works.
const port = Number(process.env.PORT ?? "3000");

// BASE_PATH: "/" for Vercel/static deploys; Replit workflow always sets this.
const basePath = process.env.BASE_PATH ?? "/";

const isReplit = Boolean(process.env.REPL_ID);

// Dev-only: forward /api to the Express API server so the frontend and backend
// share one origin during development. Override with API_PROXY_TARGET.
// In production set VITE_API_URL instead (see src/lib/api-base.ts).
const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:10000";
const apiProxy: Record<string, ProxyOptions> = {
  "/api": {
    target: apiTarget,
    changeOrigin: true,
    // Never crash the dev server when the API is not running.
    configure: (proxy) => {
      proxy.on("error", (_err, _req, res) => {
        const socket = res as unknown as { writableEnded?: boolean; writeHead?: Function; end?: Function };
        if (socket.writableEnded || typeof socket.writeHead !== "function") return;
        socket.writeHead(503, { "Content-Type": "application/json" });
        socket.end!(
          JSON.stringify({
            error: `API server not running at ${apiTarget}. Start it with "pnpm run dev:api" (needs DATABASE_URL), or set VITE_API_URL to a deployed API.`,
          }),
        );
      });
    },
  },
};



export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(isReplit
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy,
    fs: {
      strict: true,
    },
  },

  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
