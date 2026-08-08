import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        admin: fileURLToPath(new URL("./frontend/index.html", import.meta.url)),
        users: fileURLToPath(new URL("./frontend/users.html", import.meta.url)),
        vouchers: fileURLToPath(new URL("./frontend/vouchers.html", import.meta.url)),
        studio: fileURLToPath(new URL("./frontend/studio.html", import.meta.url)),
      },
    },
  },
});
