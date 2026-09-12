import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // Stripe credentials are secrets in real deployments; tests supply
          // fakes so the billing paths are exercised without a live account.
          STRIPE_SECRET_KEY: "sk_test_fake",
          STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          TEST_ACCOUNTS_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations-accounts")),
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
