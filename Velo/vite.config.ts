import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

const deploymentPath = path.resolve(
  __dirname,
  "../deployments/somniaTestnet.json",
);

let deploymentJson: unknown = null;
if (fs.existsSync(deploymentPath)) {
  try {
    deploymentJson = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  } catch (err) {
    console.warn("[velo-web] Failed to parse somniaTestnet.json", err);
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
    port: 5173,
    fs: {
      strict: false,
    },
  },
});