import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
const chromiumPath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : {};
const projects = [
  {
    name: "chromium-desktop",
    use: { ...devices["Desktop Chrome"], launchOptions },
  },
  {
    name: "chromium-phone",
    use: {
      ...devices["iPhone 13"],
      defaultBrowserType: "chromium",
      launchOptions,
    },
  },
  {
    name: "chromium-tablet",
    use: {
      ...devices["iPad Pro 11"],
      defaultBrowserType: "chromium",
      launchOptions,
    },
  },
];
if (process.env.TEST_WEBKIT === "1")
  projects.push(
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
    { name: "webkit-ipad", use: { ...devices["iPad Pro 11"] } },
  );
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects,
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
