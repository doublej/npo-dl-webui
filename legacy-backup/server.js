import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { getEpisode, getAllEpisodesFromShow, getAllEpisodesFromSeason, getEpisodesInOrder } from './npo-dl.js';
import { downloadFromID } from './download.js';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;
const PUBLIC_DIR = join(__dirname, 'public');

// Store active downloads
const activeDownloads = new Map();

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

// Helper to send JSON response
function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

// Helper to send error
function sendError(res, message, statusCode = 400) {
  sendJSON(res, { error: message }, statusCode);
}

// Parse request body
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

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

// API handlers
async function handleDownloadEpisode(req, res) {
  try {
    const { url } = await parseBody(req);
    if (!url) {
      return sendError(res, 'URL is required');
    }

    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: 'processing', url });

    // Start download asynchronously
    (async () => {
      try {
        const information = await getEpisode(url);
        if (!information) {
          activeDownloads.set(downloadId, { status: 'error', error: 'Failed to get episode information' });
          return;
        }

        activeDownloads.set(downloadId, { status: 'downloading', filename: information.filename });
        const result = await downloadFromID(information);
        activeDownloads.set(downloadId, { status: 'completed', result, filename: information.filename });
      } catch (error) {
        activeDownloads.set(downloadId, { status: 'error', error: error.message });
      }
    })();

    sendJSON(res, { downloadId, message: 'Download started' });
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

async function handleDownloadShow(req, res) {
  try {
    const { url, seasons, reverse } = await parseBody(req);
    if (!url) {
      return sendError(res, 'URL is required');
    }

    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: 'processing', url, type: 'show' });

    (async () => {
      try {
        const urls = await getAllEpisodesFromShow(url, seasons || -1, reverse || false);
        activeDownloads.set(downloadId, { status: 'downloading', totalEpisodes: urls.length });

        // Download episodes
        for (let i = 0; i < urls.length; i++) {
          activeDownloads.set(downloadId, {
            status: 'downloading',
            totalEpisodes: urls.length,
            currentEpisode: i + 1
          });
          const information = await getEpisode(urls[i]);
          if (information) {
            await downloadFromID(information);
          }
        }

        activeDownloads.set(downloadId, { status: 'completed', totalEpisodes: urls.length });
      } catch (error) {
        activeDownloads.set(downloadId, { status: 'error', error: error.message });
      }
    })();

    sendJSON(res, { downloadId, message: 'Show download started' });
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

async function handleDownloadSeason(req, res) {
  try {
    const { url, reverse } = await parseBody(req);
    if (!url) {
      return sendError(res, 'URL is required');
    }

    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: 'processing', url, type: 'season' });

    (async () => {
      try {
        const urls = await getAllEpisodesFromSeason(url, reverse || false);
        activeDownloads.set(downloadId, { status: 'downloading', totalEpisodes: urls.length });

        // Download episodes
        for (let i = 0; i < urls.length; i++) {
          activeDownloads.set(downloadId, {
            status: 'downloading',
            totalEpisodes: urls.length,
            currentEpisode: i + 1
          });
          const information = await getEpisode(urls[i]);
          if (information) {
            await downloadFromID(information);
          }
        }

        activeDownloads.set(downloadId, { status: 'completed', totalEpisodes: urls.length });
      } catch (error) {
        activeDownloads.set(downloadId, { status: 'error', error: error.message });
      }
    })();

    sendJSON(res, { downloadId, message: 'Season download started' });
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

async function handleBatchDownload(req, res) {
  try {
    const { urls } = await parseBody(req);
    if (!urls || !Array.isArray(urls)) {
      return sendError(res, 'URLs array is required');
    }

    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: 'processing', type: 'batch', totalUrls: urls.length });

    (async () => {
      try {
        for (let i = 0; i < urls.length; i++) {
          activeDownloads.set(downloadId, {
            status: 'downloading',
            totalUrls: urls.length,
            currentUrl: i + 1,
            currentFile: urls[i]
          });

          const information = await getEpisode(urls[i]);
          if (information) {
            await downloadFromID(information);
          }
        }

        activeDownloads.set(downloadId, { status: 'completed', totalUrls: urls.length });
      } catch (error) {
        activeDownloads.set(downloadId, { status: 'error', error: error.message });
      }
    })();

    sendJSON(res, { downloadId, message: 'Batch download started' });
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

async function handleStatus(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const downloadId = url.searchParams.get('id');

  if (downloadId && activeDownloads.has(downloadId)) {
    sendJSON(res, activeDownloads.get(downloadId));
  } else if (downloadId) {
    sendError(res, 'Download not found', 404);
  } else {
    // Return all downloads
    const allDownloads = {};
    for (const [id, status] of activeDownloads) {
      allDownloads[id] = status;
    }
    sendJSON(res, allDownloads);
  }
}

// Load environment variables from .env file
function loadEnvFile() {
  const envPath = join(__dirname, '.env');
  const envVars = {};

  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
          const value = valueParts.join('=').trim();
          envVars[key.trim()] = value;
        }
      }
    });
  }

  return envVars;
}

// Save environment variables to .env file
async function saveEnvFile(envVars) {
  const envPath = join(__dirname, '.env');
  const lines = [];

  for (const [key, value] of Object.entries(envVars)) {
    lines.push(`${key} = ${value}`);
  }

  await writeFile(envPath, lines.join('\n'), 'utf-8');

  // Update process.env with new values
  for (const [key, value] of Object.entries(envVars)) {
    process.env[key] = value;
  }
}

// Get current configuration
async function handleGetConfig(req, res) {
  try {
    const envVars = loadEnvFile();

    // Return config with masked sensitive values
    const config = {
      NPO_EMAIL: envVars.NPO_EMAIL || '',
      NPO_PASSW: envVars.NPO_PASSW ? '********' : '',
      GETWVKEYS_API_KEY: envVars.GETWVKEYS_API_KEY ? '********' : '',
      HEADLESS: envVars.HEADLESS === 'true',
      hasPassword: !!envVars.NPO_PASSW,
      hasApiKey: !!envVars.GETWVKEYS_API_KEY
    };

    sendJSON(res, config);
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

// Update configuration
async function handleUpdateConfig(req, res) {
  try {
    const updates = await parseBody(req);
    const currentEnv = loadEnvFile();

    // Only update provided fields
    if (updates.NPO_EMAIL !== undefined) {
      currentEnv.NPO_EMAIL = updates.NPO_EMAIL;
    }

    // Only update password if it's not the masked value
    if (updates.NPO_PASSW && updates.NPO_PASSW !== '********') {
      currentEnv.NPO_PASSW = updates.NPO_PASSW;
    }

    // Only update API key if it's not the masked value
    if (updates.GETWVKEYS_API_KEY && updates.GETWVKEYS_API_KEY !== '********') {
      currentEnv.GETWVKEYS_API_KEY = updates.GETWVKEYS_API_KEY;
    }

    if (updates.HEADLESS !== undefined) {
      currentEnv.HEADLESS = updates.HEADLESS ? 'true' : 'false';
    }

    await saveEnvFile(currentEnv);

    sendJSON(res, { success: true, message: 'Configuration updated successfully' });
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

// Test NPO connection
async function handleTestConnection(req, res) {
  try {
    const envVars = loadEnvFile();

    if (!envVars.NPO_EMAIL || !envVars.NPO_PASSW) {
      return sendJSON(res, {
        success: false,
        message: 'NPO credentials not configured'
      });
    }

    if (!envVars.GETWVKEYS_API_KEY) {
      return sendJSON(res, {
        success: false,
        message: 'GetWVKeys API key not configured'
      });
    }

    // Basic validation passed
    sendJSON(res, {
      success: true,
      message: 'Configuration appears valid. Test download to verify credentials.'
    });
  } catch (error) {
    sendError(res, error.message, 500);
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
  } else if (path === '/api/config' && req.method === 'GET') {
    await handleGetConfig(req, res);
  } else if (path === '/api/config' && req.method === 'POST') {
    await handleUpdateConfig(req, res);
  } else if (path === '/api/test-connection' && req.method === 'POST') {
    await handleTestConnection(req, res);
  } else if (path.startsWith('/api/')) {
    sendError(res, 'Endpoint not found', 404);
  } else {
    await serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`NPO Downloader Web UI running at http://localhost:${PORT}`);
  console.log(`Downloads will be saved to: ./videos/`);
});