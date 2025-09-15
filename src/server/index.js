import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { initializeEnv, getConfig } from '../config/env.js';
import { initWebSocketServer } from './websocket.js';
import { handleDownloadEpisode, handleDownloadShow, handleDownloadSeason, handleBatchDownload, handleStatus } from './routes/downloads.js';
import { handleGetShowsHierarchy, handleListDownloads, handleStreamVideo } from './routes/library.js';
import { handleGetConfig, handleUpdateConfig, handleTestConnection, handleGetProfiles, handleSetProfile } from './routes/config.js';
import { sendFail } from './http/response.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize environment
await initializeEnv();

const config = getConfig();
const PORT = config.PORT;
const PUBLIC_DIR = join(__dirname, '../../public');

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Serve static files
async function serveStatic(req, res) {
  try {
    let filePath = join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || 'text/plain';

    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

// Main server
const server = createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // Route requests
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === '/api/download/episode' && req.method === 'POST') {
    await handleDownloadEpisode(req, res);
  } else if (path === '/api/download/show' && req.method === 'POST') {
    await handleDownloadShow(req, res);
  } else if (path === '/api/download/season' && req.method === 'POST') {
    await handleDownloadSeason(req, res);
  } else if (path === '/api/download/batch' && req.method === 'POST') {
    await handleBatchDownload(req, res);
  } else if (path === '/api/status' && req.method === 'GET') {
    await handleStatus(req, res);
  } else if (path === '/api/downloads' && req.method === 'GET') {
    await handleListDownloads(req, res);
  } else if (path === '/api/shows' && req.method === 'GET') {
    await handleGetShowsHierarchy(req, res);
  } else if (path === '/api/config' && req.method === 'GET') {
    await handleGetConfig(req, res);
  } else if (path === '/api/config' && req.method === 'POST') {
    await handleUpdateConfig(req, res);
  } else if (path === '/api/test-connection' && req.method === 'POST') {
    await handleTestConnection(req, res);
  } else if (path === '/api/profiles' && req.method === 'GET') {
    await handleGetProfiles(req, res);
  } else if (path === '/api/profiles/set' && req.method === 'POST') {
    await handleSetProfile(req, res);
  } else if (path.startsWith('/api/')) {
    sendFail(res, 'Endpoint not found', 404);
  } else if (path.startsWith('/videos/') && req.method === 'GET') {
    await handleStreamVideo(req, res);
  } else {
    await serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`NPO Downloader Web UI running at http://localhost:${PORT}`);
  console.log(`Downloads will be saved to: ./videos/`);

  // Initialize WebSocket server
  initWebSocketServer(server);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});

