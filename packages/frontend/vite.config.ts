import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const frontendPort = Number(env.FRONTEND_PORT || 5173);
  const backendPort = Number(env.BACKEND_PORT || env.PORT || 3000);
  const apiOrigin = (env.VITE_API_BASE_URL || `http://127.0.0.1:${backendPort}`).replace(
    /\/$/,
    "",
  );

  return {
    plugins: [react()],
    envDir: repoRoot,
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiOrigin),
    },
    resolve: {
      alias: {
        "@dsa/intelligence": path.resolve(rootDir, "../intelligence/src/index.ts"),
      },
    },
    server: {
      host: true,
      port: frontendPort,
      proxy: {
        "/api": apiOrigin,
        "/health": apiOrigin,
      },
    },
    preview: {
      host: true,
      port: 4173,
      proxy: {
        "/api": apiOrigin,
        "/health": apiOrigin,
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            d3: [
              "d3-drag",
              "d3-ease",
              "d3-force",
              "d3-selection",
              "d3-transition",
              "d3-zoom",
            ],
            vendor: ["react", "react-dom"],
          },
        },
      },
    },
  };
});
