// Stripe credentials are Wrangler secrets, not vars, so `wrangler types` does
// not know about them and worker-configuration.d.ts (which it overwrites) is
// the wrong place to add them. Declaration merging on the global Env keeps them
// typed across regeneration.
//
// Set with: wrangler secret put STRIPE_SECRET_KEY --env staging
declare global {
  interface Env {
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
  }
}
export {};
