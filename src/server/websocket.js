import { WebSocketServer } from 'ws';
import logger from '../lib/logger.js';

// Store connected clients
const clients = new Set();

/**
 * Initialize WebSocket server and basic lifecycle handlers.
 * @param {import('node:http').Server} server
 */
export function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    logger.debug('WebSocket', 'New client connected');
    clients.add(ws);

    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected successfully' }));

    // Handle client messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        logger.debug('WebSocket', `Received: ${data.type || 'unknown'}`);

        // Test method for simulating download progress
        if (data.type === 'test_download') {
          simulateDownloadProgress();
        }
      } catch (error) {
        logger.error('WebSocket', `Invalid message: ${error.message}`);
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      logger.debug('WebSocket', 'Client disconnected');
      clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket', `Error: ${error.message}`);
      clients.delete(ws);
    });
  });

  logger.debug('WebSocket', 'Server initialized');
  return wss;
}

/**
 * Broadcast message to all connected clients.
 * @param {any} data
 */
export function broadcast(data) {
  const message = JSON.stringify(data);
  logger.debug('WebSocket', `Broadcasting message: ${data.type || 'unknown'}`);

  clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message);
      } catch (error) {
        logger.error('WebSocket', `Error sending to client: ${error.message}`);
        clients.delete(client);
      }
    }
  });
}

/**
 * Send message to specific client (no-ops to broadcast until client IDs are tracked).
 * @param {string} clientId
 * @param {any} data
 */
export function sendToClient(clientId, data) {
  // This would require tracking clients by ID
  // For now, we'll use broadcast
  broadcast(data);
}

/**
 * Broadcast download progress update.
 * @param {string} downloadId
 * @param {{percentage?: number, stage?: string, message?: string}} progress
 */
export function broadcastProgress(downloadId, progress) {
  logger.debug('WebSocket', `Broadcast progress for ${downloadId}: ${progress.stage || 'unknown'}`);
  broadcast({
    type: 'download_progress',
    downloadId,
    progress
  });
}

/**
 * Broadcast download status update.
 * @param {string} downloadId
 * @param {string} status
 * @param {object} [data]
 */
export function broadcastStatus(downloadId, status, data = {}) {
  logger.debug('WebSocket', `Broadcast status for ${downloadId}: ${status}`);
  broadcast({
    type: 'download_status',
    downloadId,
    status,
    ...data
  });
}

/**
 * Get number of connected clients.
 */
export function getClientCount() {
  return clients.size;
}

/**
 * Simulate download progress for testing WebSocket communication
 */
export function simulateDownloadProgress() {
  const downloadId = Date.now().toString();
  const url = "https://npo.nl/start/serie/kamp-van-koningsbrugge/seizoen-6/kamp-van-koningsbrugge_53/afspelen";
  const filename = "e04-kamp-van-koningsbrugge";

  logger.info('WebSocket Test', `Starting simulated download ${downloadId}`);

  // Phase 1: Fetching info
  broadcastStatus(downloadId, 'fetching_info', { url });

  setTimeout(() => {
    // Phase 2: Downloading status
    broadcastStatus(downloadId, 'downloading', { filename });

    // Phase 3: Initial progress updates without percentage
    const sizesNoPercent = [
      "605.07KiB", "992.07KiB", "555.75MiB", "555.94MiB",
      "556.31MiB", "557.07MiB", "558.58MiB", "561.61MiB"
    ];

    let delay = 500;
    sizesNoPercent.forEach(size => {
      setTimeout(() => {
        broadcastProgress(downloadId, {
          totalSize: size
        });
      }, delay);
      delay += 200;
    });

    // Phase 4: Progress with percentage, speed, and ETA
    const progressUpdates = [
      { percentage: 2.1, speed: "32.47MiB/s", eta: "00:47", stage: "downloading" },
      { percentage: 2.2, speed: "32.87MiB/s", eta: "00:47", stage: "downloading" },
      { percentage: 5.5, speed: "35.21MiB/s", eta: "00:43", stage: "downloading" },
      { percentage: 12.3, speed: "40.15MiB/s", eta: "00:35", stage: "downloading" },
      { percentage: 25.7, speed: "42.33MiB/s", eta: "00:28", stage: "downloading" },
      { percentage: 38.4, speed: "38.92MiB/s", eta: "00:22", stage: "downloading" },
      { percentage: 52.1, speed: "36.47MiB/s", eta: "00:17", stage: "downloading" },
      { percentage: 67.8, speed: "34.21MiB/s", eta: "00:11", stage: "downloading" },
      { percentage: 78.5, speed: "28.95MiB/s", eta: "00:07", stage: "downloading" },
      { percentage: 89.2, speed: "22.13MiB/s", eta: "00:04", stage: "downloading" },
      { percentage: 94.6, speed: "12.87MiB/s", eta: "00:02", stage: "downloading" },
      { percentage: 97.9, speed: "4.95MiB/s", eta: "00:00", stage: "downloading" },
      { percentage: 98.2, speed: "4.97MiB/s", eta: "00:00", stage: "downloading" },
      { percentage: 98.5, speed: "4.97MiB/s", eta: "00:00", stage: "downloading" },
      { percentage: 98.7, speed: "4.98MiB/s", eta: "00:00", stage: "downloading" },
      { percentage: 99.0, speed: "4.98MiB/s", eta: "00:00", stage: "downloading" },
      { percentage: 99.5, speed: "4.99MiB/s", eta: "00:00", stage: "downloading" },
      { percentage: 99.8, speed: "5.01MiB/s", eta: "00:00", stage: "downloading" },
      { percentage: 100, speed: "5.02MiB/s", eta: "00:00", stage: "downloading" }
    ];

    progressUpdates.forEach(update => {
      setTimeout(() => {
        broadcastProgress(downloadId, update);
      }, delay);
      delay += 300;
    });

    // Phase 5: Completion
    setTimeout(() => {
      broadcastStatus(downloadId, 'completed', {
        filename,
        message: 'Download completed successfully'
      });
      logger.info('WebSocket Test', `Simulated download ${downloadId} completed`);
    }, delay + 500);

  }, 1000);
}

// Clearer alias exports (non-breaking)
export {
  broadcast as broadcastMessage,
  sendToClient as sendMessageToClient,
  broadcastProgress as broadcastProgressUpdate,
};
