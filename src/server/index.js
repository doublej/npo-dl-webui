import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { getEpisode, getAllEpisodesFromShow, getAllEpisodesFromSeason, getEpisodesInOrder, npoLogin, getCachedProfiles } from '../providers/npo/index.js';
import { downloadFromID } from '../services/download/downloader.js';
import { initializeEnv, getConfig } from '../config/env.js';
import { initWebSocketServer, broadcastProgress, broadcastStatus } from './websocket.js';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize environment
await initializeEnv();

const config = getConfig();
const PORT = config.PORT;
const PUBLIC_DIR = join(__dirname, '../../public');
const VIDEOS_DIR = join(__dirname, '../../videos/final');

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
    const { url, profile } = await parseBody(req);

    // If no profile provided, try to use the one from environment
    const envVars = loadEnvFile();
    const profileToUse = profile || envVars.NPO_PROFILE || null;

    console.log("\n=== DOWNLOAD EPISODE REQUEST ===");
    console.log("URL:", url);
    console.log("Profile from request:", profile || 'NONE');
    console.log("Profile from env:", envVars.NPO_PROFILE || 'NONE');
    console.log("Profile to use:", profileToUse || 'NONE');

    if (!url) {
      return sendError(res, 'URL is required');
    }

    const downloadId = Date.now().toString();
    console.log("Download ID:", downloadId);
    activeDownloads.set(downloadId, { status: 'processing', url });

    // Start download asynchronously
    (async () => {
      try {
        // Broadcast fetching info phase
        activeDownloads.set(downloadId, { status: 'fetching_info' });
        broadcastStatus(downloadId, 'fetching_info', { url });

        console.log("Calling getEpisode...");
        const information = await getEpisode(url, profileToUse);
        console.log("getEpisode returned:", information ? 'data' : 'null');

        // Check if profile selection is needed
        if (information && information.needsProfileSelection) {
          console.log("⚠️ Profile selection needed - updating status");
          activeDownloads.set(downloadId, {
            status: 'needs_profile',
            profiles: information.profiles,
            message: information.message,
            url
          });
          return;
        }

        if (!information) {
          activeDownloads.set(downloadId, { status: 'error', error: 'Failed to get episode information' });
          broadcastStatus(downloadId, 'error', { error: 'Failed to get episode information' });
          return;
        }

        activeDownloads.set(downloadId, { status: 'downloading', filename: information.filename });
        broadcastStatus(downloadId, 'downloading', { filename: information.filename });

        // Create progress callback for WebSocket updates
        let progressCounter = 0;
        const progressCallback = (progress) => {
          // Only log every 25th update to reduce console spam
          if (progressCounter % 25 === 0) {
            console.log(`Progress for ${downloadId}:`, progress);
          }
          progressCounter++;

          // Always broadcast to WebSocket for smooth UI
          broadcastProgress(downloadId, progress);

          // Update active downloads with progress
          const current = activeDownloads.get(downloadId);
          if (current) {
            activeDownloads.set(downloadId, { ...current, progress });
          }
        };

        const result = await downloadFromID(information, progressCallback);
        activeDownloads.set(downloadId, { status: 'completed', result, filename: information.filename });
        broadcastStatus(downloadId, 'completed', { filename: information.filename, result });
      } catch (error) {
        activeDownloads.set(downloadId, { status: 'error', error: error.message });
        broadcastStatus(downloadId, 'error', { error: error.message });
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

    // Get profile from environment
    const envVars = loadEnvFile();
    const profileToUse = envVars.NPO_PROFILE || null;

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
          const information = await getEpisode(urls[i], profileToUse);
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

    // Get profile from environment
    const envVars = loadEnvFile();
    const profileToUse = envVars.NPO_PROFILE || null;

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
          const information = await getEpisode(urls[i], profileToUse);
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

    // Get profile from environment
    const envVars = loadEnvFile();
    const profileToUse = envVars.NPO_PROFILE || null;

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

          const information = await getEpisode(urls[i], profileToUse);
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

// Get hierarchical show/season/episode structure
async function handleGetShowsHierarchy(req, res) {
  try {
    const METADATA_DIR = join(__dirname, '../../videos/metadata');
    const entries = await readdir(VIDEOS_DIR, { withFileTypes: true });
    const shows = new Map();

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.mkv') || entry.name.endsWith('.mp4'))) {
        const fullPath = join(VIDEOS_DIR, entry.name);
        const info = await stat(fullPath);

        // Try to load metadata
        let metadata = {};
        const baseName = entry.name.replace(/\.(mkv|mp4)$/, '');
        const metadataPath = join(METADATA_DIR, `${baseName}.json`);

        if (existsSync(metadataPath)) {
          try {
            const metadataContent = readFileSync(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
          } catch (e) {
            console.error(`Failed to parse metadata for ${baseName}:`, e);
          }
        }

        // Parse filename to extract show info if not in metadata
        let showTitle = metadata.seriesTitle;
        let seasonNumber = metadata.seasonNumber || 1;
        let episodeNumber = metadata.episodeNumber || 1;
        let episodeTitle = metadata.title || baseName;

        // If no seriesTitle but we have a title field, that's likely the show name
        // (based on the current metadata structure where title = "De week van Merijn")
        if (!showTitle && metadata.title) {
          showTitle = metadata.title;
          // The episode title might be in the filename
          const episodeMatch = baseName.match(/E\d+\s*-\s*(.+)/i);
          if (episodeMatch) {
            episodeTitle = episodeMatch[1] || metadata.title;
          }
        }

        // Try to parse from filename pattern like "S01E01 - Title" or "E01 - Title"
        const episodeMatch = baseName.match(/(?:S(\d+))?E(\d+)\s*-\s*(.+)/i);
        if (episodeMatch) {
          seasonNumber = episodeMatch[1] ? parseInt(episodeMatch[1]) : seasonNumber;
          episodeNumber = parseInt(episodeMatch[2]);
          if (!showTitle) {
            // Use the title after the episode number as show title if we don't have one
            showTitle = episodeMatch[3];
          }
        }

        // Fallback to Unknown Show if still no title
        if (!showTitle) {
          showTitle = 'Unknown Show';
        }

        // Get or create show
        if (!shows.has(showTitle)) {
          shows.set(showTitle, {
            title: showTitle,
            seasons: new Map()
          });
        }
        const show = shows.get(showTitle);

        // Get or create season
        if (!show.seasons.has(seasonNumber)) {
          show.seasons.set(seasonNumber, {
            number: seasonNumber,
            episodes: []
          });
        }
        const season = show.seasons.get(seasonNumber);

        // Add episode
        season.episodes.push({
          filename: entry.name,
          episodeNumber: episodeNumber,
          title: episodeTitle,
          description: metadata.description,
          airing: metadata.airing,
          duration: metadata.duration,
          size: info.size,
          mtime: info.mtimeMs,
          fullMetadata: metadata
        });
      }
    }

    // Convert to array format
    const result = Array.from(shows.values()).map(show => ({
      title: show.title,
      seasons: Array.from(show.seasons.values()).map(season => ({
        number: season.number,
        episodes: season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber)
      })).sort((a, b) => a.number - b.number)
    }));

    sendJSON(res, { shows: result });
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

// List downloaded episodes (files in videos/final)
async function handleListDownloads(req, res) {
  try {
    const METADATA_DIR = join(__dirname, '../../videos/metadata');
    const entries = await readdir(VIDEOS_DIR, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.mkv') || entry.name.endsWith('.mp4'))) {
        const fullPath = join(VIDEOS_DIR, entry.name);
        const info = await stat(fullPath);

        // Try to load metadata
        let metadata = {};
        const baseName = entry.name.replace(/\.(mkv|mp4)$/, '');
        const metadataPath = join(METADATA_DIR, `${baseName}.json`);

        if (existsSync(metadataPath)) {
          try {
            const metadataContent = readFileSync(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
          } catch (e) {
            console.error(`Failed to parse metadata for ${baseName}:`, e);
          }
        }

        files.push({
          name: entry.name,
          size: info.size,
          mtime: info.mtimeMs,
          metadata: {
            title: metadata.title || baseName,
            episodeNumber: metadata.episodeNumber,
            seasonNumber: metadata.seasonNumber,
            seriesTitle: metadata.seriesTitle,
            description: metadata.description,
            airing: metadata.airing,
            duration: metadata.duration
          }
        });
      }
    }
    // Sort by modified time desc
    files.sort((a, b) => b.mtime - a.mtime);
    sendJSON(res, { files });
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

// Load environment variables from .env file (for settings management)
function loadEnvFile() {
  const envPath = join(__dirname, '../../.env');
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
  const envPath = join(__dirname, '../../.env');
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
      NPO_PROFILE: envVars.NPO_PROFILE || '',
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

// Get available NPO profiles
async function handleGetProfiles(req, res) {
  console.log("\n=== GET PROFILES REQUEST ===");
  try {
    // First try to get cached profiles
    console.log("Checking for cached profiles...");
    const cachedProfiles = await getCachedProfiles();

    if (cachedProfiles && cachedProfiles.length > 0) {
      console.log(`✓ Found ${cachedProfiles.length} cached profiles`);
      const envVars = loadEnvFile();
      sendJSON(res, {
        success: true,
        profiles: cachedProfiles,
        selectedProfile: envVars.NPO_PROFILE || null,
        fromCache: true
      });
      return;
    }

    console.log("No cached profiles found, fetching from NPO...");
    // If no cached profiles, try to fetch them
    const loginResult = await npoLogin();

    if (loginResult && loginResult.needsProfileSelection) {
      sendJSON(res, {
        success: true,
        profiles: loginResult.profiles,
        message: loginResult.message,
        fromCache: false
      });
    } else if (loginResult && loginResult.success) {
      sendJSON(res, {
        success: true,
        profiles: loginResult.profiles || [],
        selectedProfile: loginResult.selectedProfile,
        fromCache: false
      });
    } else {
      sendError(res, 'Failed to retrieve profiles', 500);
    }
  } catch (error) {
    sendError(res, error.message, 500);
  }
}

// Set selected NPO profile
async function handleSetProfile(req, res) {
  console.log("\n=== SET PROFILE REQUEST ===");
  try {
    const { profile } = await parseBody(req);
    console.log("Profile to set:", profile);

    if (!profile) {
      return sendError(res, 'Profile name is required');
    }

    // Update the .env file with the selected profile
    console.log("Loading current env file...");
    const currentEnv = loadEnvFile();
    currentEnv.NPO_PROFILE = profile;

    console.log("Saving profile to .env file...");
    await saveEnvFile(currentEnv);
    console.log(`✓ Profile "${profile}" saved to .env`);

    sendJSON(res, {
      success: true,
      message: `Profile set to: ${profile}`
    });
  } catch (error) {
    console.error("✗ Error setting profile:", error.message);
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
    sendError(res, 'Endpoint not found', 404);
  } else if (path.startsWith('/videos/') && req.method === 'GET') {
    // Stream downloaded video files with Range support
    try {
      const filename = decodeURIComponent(path.replace('/videos/', ''));
      // Basic sanitization to avoid path traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return sendError(res, 'Invalid filename', 400);
      }

      const filePath = join(VIDEOS_DIR, filename);
      const ext = extname(filePath).toLowerCase();
      const contentType = ext === '.mp4' ? 'video/mp4' : (ext === '.mkv' ? 'video/x-matroska' : 'application/octet-stream');

      const fs = await import('node:fs');
      const stats = await fs.promises.stat(filePath);

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        if (isNaN(start) || isNaN(end) || start > end || end >= stats.size) {
          res.writeHead(416, {
            'Content-Range': `bytes */${stats.size}`
          });
          return res.end();
        }
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stats.size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (error) {
      sendError(res, 'File not found', 404);
    }
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
