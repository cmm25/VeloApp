import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

// Resolve the on-chain deployment manifest. Prefer a copy vendored inside Velo/
// (so a Vercel build whose root is Velo/ is self-contained) and fall back to the
// monorepo-root copy for local/CI builds run from the repo root.
const deploymentCandidates = [
  path.resolve(__dirname, "deployments/somniaTestnet.json"),
  path.resolve(__dirname, "../deployments/somniaTestnet.json"),
];

let deploymentJson: unknown = null;
for (const deploymentPath of deploymentCandidates) {
  if (!fs.existsSync(deploymentPath)) continue;
  try {
    deploymentJson = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
    break;
  } catch (err) {
    console.warn("[velo-web] Failed to parse", deploymentPath, err);
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],

  define: {
    __VELO_DEPLOYMENT__: JSON.stringify(deploymentJson),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "../attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },

  root: path.resolve(__dirname),

  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("@reown") ||
            id.includes("@walletconnect") ||
            id.includes("@wagmi") ||
            id.includes("/wagmi") ||
            id.includes("/viem")
          ) {
            return "web3-vendor";
          }
          if (
            id.includes("framer-motion") ||
            id.includes("motion-dom") ||
            id.includes("motion-utils")
          ) {
            return "motion-vendor";
          }
          if (id.includes("lucide-react")) return "icons-vendor";
          if (id.includes("@radix-ui")) return "radix-vendor";
        },
      },
    },
  },

  server: {
    host: "0.0.0.0",
    port: 5000,
    // Replit serves the preview through a proxied iframe on a different host.
    allowedHosts: true,
    fs: {
      strict: false,
    },
    // Dev-only: the uploader (uploader.ts) calls relative `/api/...` which is
    // served by the velo-agents runner. Proxy those to it so SIWE auth + Pinata
    // sign-upload work in local dev. Override the target with VELO_API_TARGET.
    proxy: {
      "/api": {
        target: process.env.VELO_API_TARGET || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});