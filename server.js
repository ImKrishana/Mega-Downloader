// ==========================================================================
// Local Development Server (Zero-Dependency Node.js 20+)
// Serves static assets and maps API handlers identically to Vercel
// ==========================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import * as megaHandler from './api/mega/index.js';
import * as statusHandler from './api/mega/status.js';
import * as downloadHandler from './api/mega/download.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
  const pathname = parsedUrl.pathname;

  // 1. API: /api/mega/download
  if (pathname === '/api/mega/download') {
    return handleWebRoute(downloadHandler, req, res);
  }

  // 2. API: /api/mega/status
  if (pathname === '/api/mega/status') {
    return handleWebRoute(statusHandler, req, res);
  }

  // 3. API: /api/mega
  if (pathname === '/api/mega') {
    return handleWebRoute(megaHandler, req, res);
  }

  // 4. Static Files
  let staticPath = pathname === '/' ? '/index.html' : pathname;
  if (!staticPath.startsWith('/static/')) {
    staticPath = path.join('/static', staticPath);
  }

  const filePath = path.join(__dirname, staticPath);
  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    return res.end('Access denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

async function handleWebRoute(moduleHandler, req, res) {
  try {
    const fullUrl = `http://${req.headers.host || 'localhost:' + PORT}${req.url}`;
    const webReq = new Request(fullUrl, {
      method: req.method,
      headers: req.headers
    });

    const webRes = await moduleHandler.GET(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (webRes.body) {
      const nodeStream = Readable.fromWeb(webRes.body);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'server_error', message: err.message }));
  }
}

server.listen(PORT, () => {
  console.log(`\n  MEGA Downloader Server listening on http://localhost:${PORT}\n`);
});
