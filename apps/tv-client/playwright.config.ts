import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:8788",
    viewport: { width: 1920, height: 1080 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "uv run --directory ../../server python ../scripts/diagnose/test-server.py",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
