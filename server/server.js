import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { openDatabase, getProducts, completeSale, ValidationError } from './database.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/css/style.css', ['css/style.css', 'text/css; charset=utf-8']],
  ['/js/app.js', ['js/app.js', 'text/javascript; charset=utf-8']],
  ['/js/cart.js', ['js/cart.js', 'text/javascript; charset=utf-8']],
  ['/images/products.svg', ['images/products.svg', 'image/svg+xml']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ValidationError('Use JSON to submit a payment.', 415);
  if (req.body) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16_384) throw new ValidationError('The payment request is too large.', 413);
  }
  try { return JSON.parse(body); } catch { throw new ValidationError('Invalid JSON payment request.'); }
}

export function createApp({ databasePath = (process.env.VERCEL ? resolve(tmpdir(), 'pos.db') : resolve(root, 'database/pos.db')) } = {}) {
  const db = openDatabase(databasePath);
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === '/api/products') return sendJson(res, 200, { products: getProducts(db) });
      if (req.method === 'POST' && url.pathname === '/api/transactions') {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
          throw new ValidationError('Payment requests must come from this kiosk.', 403);
        }
        const result = completeSale(db, await readJson(req));
        return sendJson(res, result.created ? 201 : 200, { transaction: result.sale });
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const content = await readFile(resolve(root, 'public', file));
        res.writeHead(200, { 'Content-Type': type });
        res.end(content);
        return;
      }
      sendJson(res, 404, { error: 'Page or endpoint not found.' });
    } catch (error) {
      const status = error instanceof ValidationError ? error.status : 500;
      if (status === 500) console.error('Request failed:', error.code || error.name);
      sendJson(res, status, { error: status === 500 ? 'Unable to save your payment. Please try again.' : error.message });
    }
  };
  const server = createHttpServer(handler);
  server.on('close', () => db.close());
  return { server, db, handler };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createApp({ databasePath: process.env.POS_DB_PATH || resolve(root, 'database/pos.db') });
  server.listen(port, '127.0.0.1', () => console.log(`Campus Store POS ready at http://localhost:${server.address().port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
