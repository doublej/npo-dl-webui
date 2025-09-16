import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { initializeEnv, getConfig } from '../config/env.js';
import { initWebSocketServer, simulateDownloadProgress } from './websocket.js';
import { handleDownloadEpisode, handleDownloadShow, handleDownloadSeason, handleBatchDownload, handleStatus } from './routes/downloads.js';
import { handleGetShowsHierarchy, handleListDownloads, handleStreamVideo, handleGetRecentDownloads } from './routes/library.js';
import { handleGetConfig, handleUpdateConfig, handleTestConnection, handleGetProfiles, handleSetProfile } from './routes/config.js';
import { sendFail } from './http/response.js';
import { ensureVideoDirectories } from '../lib/utils/fs.js';
import logger from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize environment
await initializeEnv();

// Ensure video directories exist
await ensureVideoDirectories();

const config = getConfig();
const PORT = config.PORT;
const PUBLIC_DIR = join(__dirname, '../../public');

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

// Client-side routes that should serve index.html
const clientRoutes = ['/', '/episode', '/show', '/season', '/batch', '/downloads', '/settings'];

// Serve static files
async function serveStatic(req, res) {
  try {
    // Check if this is a client-side route
    const urlPath = req.url.split('?')[0]; // Remove query string

    // Determine the file path
    let filePath;

    // Check if this is a request for a static file (has extension)
    if (extname(urlPath)) {
      // Serve the actual file
      filePath = join(PUBLIC_DIR, urlPath);
    } else {
      // Check if it's a downloads deep link or client route
      const isDownloadsDeepLink = urlPath.startsWith('/downloads');
      const isClientRoute = clientRoutes.includes(urlPath) || isDownloadsDeepLink;

      if (isClientRoute || urlPath === '/') {
        // Serve index.html for client-side routes
        filePath = join(PUBLIC_DIR, 'index.html');
      } else {
        // Default to trying the URL path
        filePath = join(PUBLIC_DIR, urlPath);
      }
    }

    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || 'text/plain';

    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    // If file not found and no extension, try serving index.html (for client routes)
    if (!extname(req.url)) {
      try {
        const content = await readFile(join(PUBLIC_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
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
  } else if (path === '/api/downloads/recent' && req.method === 'GET') {
    await handleGetRecentDownloads(req, res);
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
  } else if (path === '/api/test/websocket' && req.method === 'GET') {
    // Test WebSocket download simulation
    simulateDownloadProgress();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      success: true,
      message: 'WebSocket download simulation started. Check WebSocket connection for progress updates.'
    }));
  } else if (path.startsWith('/api/')) {
    sendFail(res, 'Endpoint not found', 404);
  } else if (path.startsWith('/videos/') && req.method === 'GET') {
    await handleStreamVideo(req, res);
  } else {
    await serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  logger.info('Server', `NPO Downloader Web UI running at http://localhost:${PORT}`);
  logger.info('Server', `Downloads will be saved to: ./videos/`);

  // Initialize WebSocket server
  initWebSocketServer(server);
  logger.info('WebSocket', `Server running on ws://localhost:${PORT}`);
});

