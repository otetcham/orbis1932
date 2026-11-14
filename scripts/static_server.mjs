import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

export async function startStaticServer(root) {
  const base = path.resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const requested = decodeURIComponent(url.pathname);
      const target = path.resolve(base, `.${requested === '/' ? '/index.html' : requested}`);
      if (!target.startsWith(`${base}${path.sep}`) && target !== base) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const info = await stat(target);
      if (!info.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      createReadStream(target).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}
