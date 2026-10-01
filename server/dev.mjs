// A private test copy of the world, for working on the page without touching the real one:
// port 5183, its own save folder (server/data-dev), never published to the public site.
// The first run copies the real world in, so the page has something to show.
import { copyFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, 'data-dev');
process.env.PORT ||= '5183';
process.env.DOTHOME_DATA = data;
process.env.DOTHOME_PUBLISH = '0';
await mkdir(data, { recursive: true });
try { await access(path.join(data, 'world.json')); } catch {
  try { await copyFile(path.join(here, 'data', 'world.json'), path.join(data, 'world.json')); } catch { /* no real world yet: start fresh */ }
}
await import('./server.js');
