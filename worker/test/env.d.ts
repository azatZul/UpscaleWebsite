import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      TEST_ACCOUNTS_MIGRATIONS: D1Migration[];
      // Secrets in real deployments; vitest.config.ts supplies test values.
      MEDIA_SIGNING_KEY?: string;
    }
  }

  interface Env {
    TEST_MIGRATIONS: D1Migration[];
    TEST_ACCOUNTS_MIGRATIONS: D1Migration[];
  }
}

export {};
