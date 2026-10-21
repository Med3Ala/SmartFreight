import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `--mode preview` bundles everything into one HTML file for a static, API-less preview.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "preview" ? [viteSingleFile()] : [])],
  build: { outDir: mode === "preview" ? "dist-preview" : "dist" },
  server: { proxy: { "/api": "http://localhost:8000" }, fs: { allow: [".."] } },
}));
