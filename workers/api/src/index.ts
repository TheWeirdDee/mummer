import { createApp } from './app.js';
import type { Env } from './env.js';
import { purgeExpired } from './purge.js';
import { defaultDeps } from './services.js';

const app = createApp(defaultDeps);

export { createApp };
export type { Env };

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(purgeExpired(env, defaultDeps));
  },
} satisfies ExportedHandler<Env>;
