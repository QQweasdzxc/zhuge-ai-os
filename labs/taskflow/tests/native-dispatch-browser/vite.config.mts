import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const requireWeb = createRequire(path.resolve(root, "../../../apps/web/package.json"));
const tailwind = requireWeb("@tailwindcss/postcss");
export default defineConfig({ root, plugins: [react()], css: { postcss: { plugins: [tailwind()] } }, server: { host: "0.0.0.0", port: 4173, strictPort: true }, resolve: { dedupe: ["react", "react-dom"] } });
