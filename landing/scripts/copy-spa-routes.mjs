import { cpSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const dist = 'dist';
const routes = ['/docs', '/demo', '/demo/stripe-success', '/demo/stripe-cancel'];

for (const route of routes) {
  const dir = join(dist, route);
  mkdirSync(dir, { recursive: true });
  cpSync(join(dist, 'index.html'), join(dir, 'index.html'));
}

console.log(`Copied index.html to ${routes.length} SPA routes`);
