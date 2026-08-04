import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "OPENAI_API_KEY=test-key DATABASE_PATH=:memory: PORT=4173 npm run dev",
    port: 4173,
    reuseExistingServer: true,
  },
  reporter: "list",
});
