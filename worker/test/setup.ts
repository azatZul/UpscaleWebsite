import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.ACCOUNTS_DB, env.TEST_ACCOUNTS_MIGRATIONS);
