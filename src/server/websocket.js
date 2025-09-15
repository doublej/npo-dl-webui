import { WebSocketServer } from 'ws';

// Store connected clients
const clients = new Set();

/**
 * Initialize WebSocket server and basic lifecycle handlers.
 * @param {import('node:http').Server} server
 */
export function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');
    clients.add(ws);

    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected successfully' }));

    // Handle client messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('Received from client:', data);
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
    });
  });

  console.log('WebSocket server initialized');
  return wss;
}

/**
 * Broadcast message to all connected clients.
 * @param {any} data
 */
export function broadcast(data) {
  const message = JSON.stringify(data);

  clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message);
      } catch (error) {
        console.error('Error sending to client:', error);
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

// Clearer alias exports (non-breaking)
export {
  broadcast as broadcastMessage,
  sendToClient as sendMessageToClient,
  broadcastProgress as broadcastProgressUpdate,
};
