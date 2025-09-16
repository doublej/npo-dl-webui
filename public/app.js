// API base URL
const API_BASE = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001';

const logger = window.logger || console;

// Active downloads tracking
const activeDownloads = new Map();

// WebSocket connection
let ws = null;
let wsReconnectTimer = null;

// Video overlay functionality
function initVideoOverlay() {
    // Create video overlay structure with ambilight layers
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `
        <div class="video-close"></div>
        <div class="ambilight-container">
            <!-- Multiple ambilight layers for depth -->
            <div class="ambilight-layer ambilight-layer-1"></div>
            <div class="ambilight-layer ambilight-layer-2"></div>
            <div class="ambilight-layer ambilight-layer-3"></div>
            <div class="ambilight-layer ambilight-layer-4"></div>
            <div class="video-container">
                <video id="videoPlayer" controls></video>
                <div class="video-controls"></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Create trigger button
    const trigger = document.createElement('button');
    trigger.className = 'video-trigger';
    trigger.setAttribute('aria-label', 'Open video player');
    document.body.appendChild(trigger);

    // Event listeners
    trigger.addEventListener('click', () => openVideoPlayer());
    overlay.querySelector('.video-close').addEventListener('click', () => closeVideoPlayer());

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeVideoPlayer();
        }
    });

    // Close on overlay click (not video)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeVideoPlayer();
        }
    });
}

function openVideoPlayer(videoUrl = null) {
    const overlay = document.querySelector('.video-overlay');
    const video = document.getElementById('videoPlayer');
    const container = document.querySelector('.video-container');

    if (videoUrl) {
        video.src = videoUrl;
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Remove existing listeners to prevent duplicates
    video.onplay = null;
    video.onpause = null;
    video.onended = null;

    // Add playing class and start ambilight when video plays
    video.onplay = () => {
        overlay.classList.add('playing');
        container.classList.add('playing');
        updateAmbilightColors();
    };

    // Stop ambilight when paused
    video.onpause = () => {
        overlay.classList.remove('playing');
        container.classList.remove('playing');
        stopAmbilight();
    };

    // Stop ambilight when video ends
    video.onended = () => {
        overlay.classList.remove('playing');
        container.classList.remove('playing');
        stopAmbilight();
    };
}

function closeVideoPlayer() {
    const overlay = document.querySelector('.video-overlay');
    const video = document.getElementById('videoPlayer');

    overlay.classList.remove('active');
    document.body.style.overflow = '';
    video.pause();
    video.src = '';

    // Stop ambilight effect
    stopAmbilight();

    // Reset colors to default
    const container = document.querySelector('.ambilight-container');
    if (container) {
        container.style.setProperty('--ambilight-top', '#ff6b00');
        container.style.setProperty('--ambilight-bottom', '#ff8533');
        container.style.setProperty('--ambilight-left', '#ff6b00');
        container.style.setProperty('--ambilight-right', '#ff8533');
    }
}

// Extract dominant colors for ambilight effect
let ambilightInterval = null;

function updateAmbilightColors() {
    const video = document.getElementById('videoPlayer');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Set canvas size for sampling (smaller = faster)
    canvas.width = 100;
    canvas.height = 56;

    function extractColors() {
        if (!video || video.paused || video.ended) {
            stopAmbilight();
            return;
        }

        try {
            // Draw current video frame to canvas
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Extract colors from video edges (like real ambilight)
            const topEdgeColor = getEdgeColor(imageData, 'top');
            const bottomEdgeColor = getEdgeColor(imageData, 'bottom');
            const leftEdgeColor = getEdgeColor(imageData, 'left');
            const rightEdgeColor = getEdgeColor(imageData, 'right');

            // Apply colors to ambilight container
            const container = document.querySelector('.ambilight-container');
            if (container) {
                // Set CSS variables for each edge
                container.style.setProperty('--ambilight-top', topEdgeColor);
                container.style.setProperty('--ambilight-bottom', bottomEdgeColor);
                container.style.setProperty('--ambilight-left', leftEdgeColor);
                container.style.setProperty('--ambilight-right', rightEdgeColor);
            }
        } catch (error) {
            console.error('Ambilight extraction error:', error);
        }
    }

    // Start extraction at 24fps for smoother performance
    stopAmbilight(); // Clear any existing interval
    ambilightInterval = setInterval(extractColors, 1000 / 24);
    extractColors(); // Run immediately
}

// Get average color from video edge
function getEdgeColor(imageData, edge) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    let r = 0, g = 0, b = 0;
    let sampleCount = 0;

    // Sample pixels from the specified edge
    if (edge === 'top') {
        // Sample first 3 rows
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < width; x += 2) {
                const idx = (y * width + x) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                sampleCount++;
            }
        }
    } else if (edge === 'bottom') {
        // Sample last 3 rows
        for (let y = height - 3; y < height; y++) {
            for (let x = 0; x < width; x += 2) {
                const idx = (y * width + x) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                sampleCount++;
            }
        }
    } else if (edge === 'left') {
        // Sample first 3 columns
        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < height; y += 2) {
                const idx = (y * width + x) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                sampleCount++;
            }
        }
    } else if (edge === 'right') {
        // Sample last 3 columns
        for (let x = width - 3; x < width; x++) {
            for (let y = 0; y < height; y += 2) {
                const idx = (y * width + x) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                sampleCount++;
            }
        }
    }

    if (sampleCount === 0) {
        return 'rgb(255, 107, 0)'; // Fallback to NPO orange
    }

    // Calculate average
    r = Math.round(r / sampleCount);
    g = Math.round(g / sampleCount);
    b = Math.round(b / sampleCount);

    // Boost saturation and brightness for more vibrant edge glow
    const hsl = rgbToHsl(r, g, b);
    hsl[1] = Math.min(100, hsl[1] * 1.8); // Increase saturation significantly
    hsl[2] = Math.min(80, hsl[2] * 1.3); // Increase lightness
    const rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);

    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function stopAmbilight() {
    if (ambilightInterval) {
        clearInterval(ambilightInterval);
        ambilightInterval = null;
    }
}


// Helper functions for color conversion
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return [h * 360, s * 100, l * 100];
}

function hslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;

    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;

        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Initialize WebSocket connection
function initWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        return; // Already connected
    }

    logger.debug('WebSocket', 'Connecting...');
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        logger.info('WebSocket', 'Connected');
        clearTimeout(wsReconnectTimer);
        updateTopbarStatus({ message: 'Connected to server', type: 'success' });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            logger.error('WebSocket', 'Failed to parse message:', error);
        }
    };

    ws.onerror = (error) => {
        logger.error('WebSocket', 'Connection error:', error);
    };

    ws.onclose = () => {
        logger.debug('WebSocket', 'Disconnected');
        updateTopbarStatus({ message: 'Disconnected from server', type: 'warning' });
        // Attempt to reconnect after 3 seconds
        wsReconnectTimer = setTimeout(() => {
            logger.debug('WebSocket', 'Reconnecting...');
            updateTopbarStatus({ message: 'Reconnecting...', type: 'info' });
            initWebSocket();
        }, 3000);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'connected':
            logger.debug('WebSocket', data.message);
            updateTopbarStatus({ message: 'Connected', type: 'success' });
            break;

        case 'download_progress':
            updateDownloadProgress(data.downloadId, data.progress);
            updateDownloadTopbar({
                downloadId: data.downloadId,
                status: data.progress?.stage,
                progress: data.progress,
                data
            });
            break;

        case 'download_status':
            updateDownloadStatus(data.downloadId, data.status, data);
            updateDownloadTopbar({
                downloadId: data.downloadId,
                status: data.status,
                data
            });
            break;

        default:
            logger.debug('WebSocket', 'Unknown message type:', data.type);
    }
}

// Update download progress
function updateDownloadProgress(downloadId, progress) {
    const download = activeDownloads.get(downloadId) || { id: downloadId };
    activeDownloads.set(downloadId, { ...download, progress });
}

// Update topbar status
function ensureTopbarElements(topbar) {
    if (!topbar.dataset.enhanced) {
        topbar.innerHTML = `
            <div class="topbar-status__progress"></div>
            <div class="topbar-status__content">
                <div class="topbar-status__message" aria-live="polite"></div>
                <div class="topbar-status__metrics" role="presentation"></div>
            </div>
        `;
        topbar.dataset.enhanced = 'true';
    }

    return {
        messageEl: topbar.querySelector('.topbar-status__message'),
        metricsEl: topbar.querySelector('.topbar-status__metrics'),
        progressEl: topbar.querySelector('.topbar-status__progress'),
    };
}

function updateTopbarMetrics(metricsEl, metrics = []) {
    const existing = new Map();
    metricsEl.querySelectorAll('.status-metric').forEach((el) => {
        existing.set(el.dataset.key, el);
    });

    metrics.forEach((metric, index) => {
        const {
            key,
            label,
            value,
            weight = 'md',
            fill = null,
        } = metric;

        if (!key) {
            return;
        }

        let metricEl = existing.get(key);
        if (!metricEl) {
            metricEl = document.createElement('div');
            metricEl.className = 'status-metric';
            metricEl.dataset.key = key;
            metricEl.innerHTML = `
                <div class="status-metric__fill"></div>
                <div class="status-metric__label"></div>
                <div class="status-metric__value"></div>
            `;
            metricsEl.appendChild(metricEl);
        } else {
            existing.delete(key);
            metricEl.classList.remove('is-exiting');
        }

        metricEl.dataset.weight = weight;
        if (fill !== null && fill !== undefined) {
            const fillValue = typeof fill === 'number' ? `${fill}%` : fill;
            metricEl.style.setProperty('--metric-fill', fillValue);
        } else {
            metricEl.style.removeProperty('--metric-fill');
        }

        const labelEl = metricEl.querySelector('.status-metric__label');
        const valueEl = metricEl.querySelector('.status-metric__value');
        if (labelEl) {
            labelEl.textContent = label || '';
        }
        if (valueEl) {
            valueEl.textContent = value || '';
        }

        if (!metricEl.classList.contains('is-visible')) {
            requestAnimationFrame(() => {
                metricEl.classList.add('is-visible');
            });
        }
    });

    // Remove stale metrics with a fade-out animation
    existing.forEach((el) => {
        el.classList.remove('is-visible');
        el.classList.add('is-exiting');
        el.addEventListener('transitionend', () => {
            el.remove();
        }, { once: true });
        setTimeout(() => {
            if (el.isConnected) {
                el.remove();
            }
        }, 400);
    });

    metricsEl.classList.toggle('has-metrics', metrics.length > 0);
}

function updateTopbarStatus(state) {
    const topbar = document.getElementById('topbar-status');
    if (!topbar) {
        logger.warn('Topbar', 'Attempted to update topbar status but element was not found');
        return;
    }

    const {
        message = '',
        type = 'info',
        progress = null,
        metrics = [],
    } = state || {};

    logger.debug('Topbar', 'updateTopbarStatus', { message, type, progress, metricsCount: metrics.length });

    const { messageEl, metricsEl, progressEl } = ensureTopbarElements(topbar);

    topbar.className = `topbar__status ${type}`;
    topbar.classList.toggle('has-progress', progress !== null);
    topbar.classList.toggle('has-metrics', metrics.length > 0);

    if (messageEl) {
        messageEl.textContent = message;
    }

    if (progress !== null) {
        const boundedProgress = Math.max(0, Math.min(100, progress));
        topbar.style.setProperty('--progress', `${boundedProgress}%`);
        if (progressEl) {
            progressEl.style.setProperty('--progress-width', `${boundedProgress}%`);
        }
    } else {
        topbar.style.removeProperty('--progress');
        if (progressEl) {
            progressEl.style.removeProperty('--progress-width');
        }
    }

    if (metricsEl) {
        updateTopbarMetrics(metricsEl, metrics);
    }
}

function updateDownloadTopbar({ downloadId, status, progress, data = {} }) {
    const download = activeDownloads.get(downloadId);
    const combinedData = { ...(download || {}), ...data };
    logger.debug('Topbar', 'updateDownloadTopbar called', {
        downloadId,
        status,
        stage: progress?.stage,
        hasProgress: Boolean(progress),
    });
    const topbarState = deriveDownloadTopbarState({ status, progress, data: combinedData });

    if (!topbarState) {
        logger.debug('Topbar', 'No topbar state derived', {
            downloadId,
            status,
            stage: progress?.stage,
        });
        return;
    }

    logger.debug('Topbar', 'Applying derived topbar state', topbarState);
    updateTopbarStatus(topbarState);

    if (topbarState.resetDelay) {
        setTimeout(() => {
            if (activeDownloads.size === 0) {
                updateTopbarStatus({ message: 'Connected', type: 'info' });
            }
        }, topbarState.resetDelay);
    }
}

function getDownloadLabel(data = {}) {
    return data.filename || data.title || data.name || '';
}

function getStageLabel(stage) {
    const stageLabels = {
        downloading_video: 'Downloading video',
        downloading_audio: 'Downloading audio',
        downloading: 'Downloading',
        decrypting: 'Decrypting',
        merging: 'Merging audio & video',
        fetching_info: 'Fetching episode information',
        processing: 'Preparing download',
        needs_profile: 'Profile required',
    };

    if (!stage) {
        return 'Downloading';
    }

    return stageLabels[stage] || (stage.charAt(0).toUpperCase() + stage.slice(1).replace(/_/g, ' '));
}

function buildStageMessage(stage, percentage) {
    const base = getStageLabel(stage);
    if (typeof percentage === 'number') {
        return `${base}: ${percentage}%`;
    }
    return stage === 'completed' || stage === 'error' ? base : `${base}...`;
}

function buildProgressHeadline({ stage, percentage, progress, label, data }) {
    if (progress?.message) {
        return progress.message;
    }

    const base = getStageLabel(stage || 'downloading');

    if (stage === 'error') {
        return `Error`;
    }

    if (stage === 'completed') {
        return label ? `Download completed: ${label}` : 'Download completed!';
    }

    if (stage === 'downloading' && label) {
        if (typeof percentage === 'number') {
            return `${base} ${label} (${percentage}%)`;
        }
        return `${base} ${label}`;
    }

    return buildStageMessage(stage || 'downloading', percentage);
}

function clampPercentage(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueMetrics(metrics) {
    const seen = new Set();
    return metrics.filter((metric) => {
        if (!metric || !metric.key) {
            return false;
        }
        if (seen.has(metric.key)) {
            return false;
        }
        seen.add(metric.key);
        return true;
    });
}

function buildTopbarMetrics({ stage, percentage, progress, label, status, data }) {
    const metrics = [];
    const cleanedLabel = (label || '').trim();

    if (cleanedLabel) {
        metrics.push({ key: 'label', label: 'Title', value: cleanedLabel, weight: 'xl' });
    }

    if (stage === 'error' || status === 'error') {
        const reason = progress?.message || data?.error || progress?.error;
        if (reason) {
            metrics.push({ key: 'error-reason', label: 'Reason', value: reason, weight: 'xl' });
        }
        return uniqueMetrics(metrics);
    }

    if (stage === 'completed' || status === 'completed') {
        return uniqueMetrics(metrics);
    }

    if (stage === 'downloading' || status === 'downloading') {
        if (percentage !== null) {
            metrics.push({ key: 'progress', label: 'Progress', value: `${percentage}%`, weight: 'xl', fill: `${percentage}%` });
        }
        if (progress?.speed) {
            metrics.push({ key: 'speed', label: 'Speed', value: progress.speed, weight: 'lg' });
        }
        if (progress?.eta && progress.eta !== '00:00') {
            metrics.push({ key: 'eta', label: 'ETA', value: progress.eta, weight: 'md' });
        }
        if (progress?.totalSize) {
            metrics.push({ key: 'size', label: 'Total', value: progress.totalSize, weight: 'md' });
        }
        return uniqueMetrics(metrics);
    }

    const stageLabel = getStageLabel(stage || status);
    if (stageLabel && stageLabel !== 'Downloading' && stageLabel !== 'Download completed' && stageLabel !== 'Error') {
        metrics.push({ key: 'stage', label: 'Stage', value: stageLabel, weight: 'lg' });
    }

    return uniqueMetrics(metrics);
}

function deriveDownloadTopbarState({ status, progress, data = {} }) {
    const label = getDownloadLabel(data);
    const stage = progress?.stage || status || null;
    const percentage = clampPercentage(progress?.percentage);
    const isCompleted = stage === 'completed' || status === 'completed' || (percentage !== null && percentage >= 100);
    const isError = stage === 'error' || status === 'error' || Boolean(data.error) || Boolean(progress?.error);
    const metrics = buildTopbarMetrics({ stage, percentage, progress, label, status, data });

    logger.debug('Topbar', 'deriveDownloadTopbarState', {
        status,
        stage,
        percentage,
        label,
        isCompleted,
        isError,
        metricsCount: metrics.length,
    });

    if (isCompleted) {
        const completedMessage = progress?.message || (label ? `Download completed: ${label}` : 'Download completed!');
        return {
            message: completedMessage,
            type: 'success',
            progress: null,
            metrics,
            resetDelay: 5000,
        };
    }

    if (isError) {
        const errorMessage = progress?.message || data.error || progress?.error || 'Download failed';
        return {
            message: `Error: ${errorMessage}`,
            type: 'error',
            progress: null,
            metrics: metrics.length ? metrics : buildTopbarMetrics({ stage: 'error', percentage, progress, label, status: 'error', data: { ...data, error: errorMessage } }),
        };
    }

    if (progress) {
        const message = buildProgressHeadline({ stage, percentage, progress, label, data });
        return {
            message,
            type: 'progress',
            progress: percentage === null ? null : percentage,
            metrics,
        };
    }

    if (!status) {
        logger.debug('Topbar', 'deriveDownloadTopbarState received no status or progress data');
        return null;
    }

    const statusHandlers = {
        processing: () => ({
            message: 'Preparing download...',
            type: 'info',
            progress: null,
            metrics: buildTopbarMetrics({ stage: 'processing', percentage, progress, label, status, data }),
        }),
        fetching_info: () => ({
            message: 'Fetching episode information...',
            type: 'info',
            progress: null,
            metrics: buildTopbarMetrics({ stage: 'fetching_info', percentage, progress, label, status, data }),
        }),
        needs_profile: () => ({
            message: 'Profile selection required',
            type: 'warning',
            progress: null,
            metrics: buildTopbarMetrics({ stage: 'needs_profile', percentage, progress, label, status, data }),
        }),
        downloading: () => ({
            message: buildProgressHeadline({ stage: 'downloading', percentage, progress, label, data }),
            type: 'progress',
            progress: percentage,
            metrics: buildTopbarMetrics({ stage: 'downloading', percentage, progress, label, status, data }),
        }),
        decrypting: () => ({
            message: 'Decrypting video...',
            type: 'progress',
            progress: null,
            metrics: buildTopbarMetrics({ stage: 'decrypting', percentage, progress, label, status, data }),
        }),
        merging: () => ({
            message: 'Merging audio and video...',
            type: 'progress',
            progress: null,
            metrics: buildTopbarMetrics({ stage: 'merging', percentage, progress, label, status, data }),
        }),
        completed: () => ({
            message: label ? `Download completed: ${label}` : 'Download completed!',
            type: 'success',
            progress: null,
            metrics: buildTopbarMetrics({ stage: 'completed', percentage, progress, label, status, data }),
            resetDelay: 5000,
        }),
        error: () => ({
            message: `Error: ${data.error || 'Download failed'}`,
            type: 'error',
            progress: null,
            metrics: buildTopbarMetrics({ stage: 'error', percentage, progress, label, status, data }),
        }),
    };

    const handler = statusHandlers[status];
    if (!handler) {
        logger.debug('Topbar', 'Unhandled status value', { status });
        return null;
    }

    return handler();
}

// Update download status
function updateDownloadStatus(downloadId, status, data) {
    const download = activeDownloads.get(downloadId) || { id: downloadId };
    activeDownloads.set(downloadId, { ...download, status, ...data });

    // Remove completed/errored downloads after 10 seconds
    if (status === 'completed' || status === 'error') {
        setTimeout(() => {
            activeDownloads.delete(downloadId);
            // Reset topbar to connected state when no more active downloads
            if (activeDownloads.size === 0) {
                updateTopbarStatus({ message: 'Connected', type: 'info' });
            }
        }, 10000);
    }
}

// Keep track of loaded tabs
const loadedTabs = new Set();

// Load tab content dynamically
async function loadTabContent(tabName) {
    const tabElement = document.getElementById(`${tabName}-tab`);

    // Only load if not already loaded
    if (!loadedTabs.has(tabName)) {
        try {
            const response = await fetch(`/tabs/${tabName}-tab.html`);
            if (response.ok) {
                const html = await response.text();
                tabElement.innerHTML = html;
                loadedTabs.add(tabName);

                // Re-attach event listeners for the newly loaded content
                await attachTabEventListeners(tabName);
            } else {
                logger.error('UI', `Failed to load tab content for ${tabName}`);
                tabElement.innerHTML = '<p>Failed to load content</p>';
            }
        } catch (error) {
            logger.error('UI', `Error loading tab ${tabName}:`, error);
            tabElement.innerHTML = '<p>Error loading content</p>';
        }
    }
}

// Attach event listeners for specific tab content
async function attachTabEventListeners(tabName) {
    switch(tabName) {
        case 'home':
            // Load recent downloads
            loadRecentDownloads();
            break;
        case 'episode':
            const episodeForm = document.getElementById('episode-form');
            if (episodeForm) {
                episodeForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const url = document.getElementById('episode-url').value;
                    await startDownload('/download/episode', { url });
                    document.getElementById('episode-url').value = '';
                });
            }
            break;

        case 'show':
            const showForm = document.getElementById('show-form');
            if (showForm) {
                showForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const url = document.getElementById('show-url').value;
                    const seasonCount = document.getElementById('season-count').value;
                    const reverse = document.getElementById('show-reverse').checked;

                    const data = { url, reverse };
                    if (seasonCount) {
                        data.seasonCount = parseInt(seasonCount);
                    }

                    await startDownload('/download/show', data);
                    document.getElementById('show-form').reset();
                });
            }
            break;

        case 'season':
            const seasonForm = document.getElementById('season-form');
            if (seasonForm) {
                seasonForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const url = document.getElementById('season-url').value;
                    const reverse = document.getElementById('season-reverse').checked;
                    await startDownload('/download/season', { url, reverse });
                    document.getElementById('season-url').value = '';
                    document.getElementById('season-reverse').checked = false;
                });
            }
            break;

        case 'batch':
            const batchForm = document.getElementById('batch-form');
            if (batchForm) {
                batchForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const urls = document.getElementById('batch-urls').value
                        .split('\n')
                        .map(url => url.trim())
                        .filter(url => url);

                    if (urls.length === 0) {
                        alert('Please enter at least one URL');
                        return;
                    }

                    await startDownload('/download/batch', { urls });
                    document.getElementById('batch-urls').value = '';
                });
            }
            break;

        case 'settings':
            attachSettingsEventListeners();
            // Use setTimeout to ensure DOM is ready
            setTimeout(() => {
                loadConfig();
            }, 100);
            break;

        case 'downloads':
            attachDownloadsEventListeners();
            break;
    }
}

// Router configuration
const routes = {
    '/': 'home',
    '/episode': 'episode',
    '/show': 'show',
    '/season': 'season',
    '/batch': 'batch',
    '/downloads': 'downloads',
    '/settings': 'settings'
};

// Get route from path
function getRouteFromPath(path) {
    // Handle deep links for downloads
    if (path.startsWith('/downloads')) {
        return 'downloads';
    }
    return routes[path] || 'home';
}

// Get path from route
function getPathFromRoute(route) {
    for (const [path, r] of Object.entries(routes)) {
        if (r === route) return path;
    }
    return '/';
}

// Navigate to a specific tab
async function navigateToTab(tabName, pushState = true) {
    // Load tab content if needed
    await loadTabContent(tabName);

    // Update active tab button
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });

    // Update active tab content
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    const targetTab = document.getElementById(`${tabName}-tab`);
    if (targetTab) {
        targetTab.classList.add('active');
    }

    // If navigating to downloads tab, load downloaded episodes
    if (tabName === 'downloads') {
        loadDownloadedList();
    }

    // Update URL if needed
    if (pushState) {
        const path = getPathFromRoute(tabName);
        window.history.pushState({ tab: tabName }, '', path);
    }
}

// Handle browser back/forward buttons
window.addEventListener('popstate', async (event) => {
    const tabName = event.state?.tab || getRouteFromPath(window.location.pathname);

    // If returning to downloads page, restore navigation state from URL or history state
    if (tabName === 'downloads' && window.location.pathname.startsWith('/downloads')) {
        if (event.state?.navigationState) {
            // Restore from history state
            navigationState.level = event.state.navigationState.level;
            navigationState.currentShow = event.state.navigationState.currentShow;
            navigationState.currentSeason = event.state.navigationState.currentSeason;
        } else {
            // Parse from URL
            const parsedState = parseDownloadsURL(window.location.pathname);
            navigationState.level = parsedState.level;
            navigationState.currentShow = parsedState.currentShow;
            navigationState.currentSeason = parsedState.currentSeason;
        }
    }

    await navigateToTab(tabName, false);
});

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', async () => {
        const tabName = button.dataset.tab;
        await navigateToTab(tabName);
    });
});

// Brand/logo click - navigate to home
document.querySelector('.brand').addEventListener('click', async (e) => {
    e.preventDefault();
    await navigateToTab('home');
});

// Function to attach settings event listeners
function attachSettingsEventListeners() {
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const config = {
                NPO_EMAIL: document.getElementById('npo-email').value,
                NPO_PASSW: document.getElementById('npo-password').value,
                GETWVKEYS_API_KEY: document.getElementById('api-key').value,
                HEADLESS: document.getElementById('headless-mode').checked
            };

            try {
                const response = await fetch(`${API_BASE}/config`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(config)
                });

                const result = await response.json();

                if (result.success) {
                    // Clear password fields for security if they were updated
                    if (config.NPO_PASSW !== '********') {
                        document.getElementById('npo-password').value = '';
                    }
                    if (config.GETWVKEYS_API_KEY !== '********') {
                        document.getElementById('api-key').value = '';
                    }
                    // Reload config to show masked values and update status
                    await loadConfig();
                }
            } catch (error) {
                logger.error('Settings', 'Failed to save:', error);
            }
        });
    }

    // Test connection button
    const testButton = document.getElementById('test-connection');
    if (testButton) {
        testButton.addEventListener('click', async () => {
            try {
                const response = await fetch(`${API_BASE}/test-connection`, {
                    method: 'POST'
                });

                const result = await response.json();

                if (result.success) {
                    logger.info('Settings', 'Connection test successful');
                }
            } catch (error) {
                logger.error('Settings', 'Connection test failed:', error);
            }
        });
    }

    // Profile selection button
    const selectProfileBtn = document.getElementById('select-profile');
    if (selectProfileBtn) {
        selectProfileBtn.addEventListener('click', async () => {
            const profileList = document.getElementById('profile-list');
            const profileButtons = document.getElementById('profile-buttons');

            // Toggle profile list visibility
            if (profileList.style.display === 'none') {
                // Fetch available profiles
                try {
                    const response = await fetch(`${API_BASE}/profiles`);
                    const result = await response.json();

                    if (result.success && result.profiles && result.profiles.length > 0) {
                        // Clear existing buttons
                        profileButtons.innerHTML = '';

                        // Create profile buttons
                        result.profiles.forEach(profile => {
                            const button = document.createElement('button');
                            button.type = 'button';
                            button.className = 'btn-secondary';
                            button.textContent = profile.name;
                            button.style.padding = '5px 15px';
                            button.addEventListener('click', async () => {
                                await selectProfile(profile.name);
                            });
                            profileButtons.appendChild(button);
                        });

                        profileList.style.display = 'block';
                    }
                } catch (error) {
                    logger.error('Profile', 'Failed to fetch profiles:', error);
                }
            } else {
                profileList.style.display = 'none';
            }
        });
    }
}

// Function to attach downloads event listeners
function attachDownloadsEventListeners() {
    const playButton = document.getElementById('play-episode');
    if (playButton) {
        playButton.addEventListener('click', () => {
            const episode = playButton.dataset.episode;
            if (episode) {
                const episodeData = JSON.parse(episode);
                playVideo(encodeURIComponent(episodeData.filename), episodeData.title);
            }
        });
    }
}

// Start download
async function startDownload(endpoint, data) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.error) {
            logger.error('Download', result.error);
        } else {
            logger.info('Download', result.message);
            if (result.downloadId) {
                trackDownload(result.downloadId);
            }
        }
    } catch (error) {
        logger.error('Download', 'Failed to start: ' + error.message);
    }
}

// Track download progress
function trackDownload(downloadId) {
    if (!activeDownloads.has(downloadId)) {
        activeDownloads.set(downloadId, { id: downloadId, status: 'pending' });
    }

    // With WebSocket, we don't need polling anymore
    // The server will push updates through WebSocket
    // Just make sure WebSocket is connected
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        initWebSocket();
    }

    // Optionally, fetch initial status once
    fetch(`${API_BASE}/status?id=${downloadId}`)
        .then(response => response.json())
        .then(status => {
            activeDownloads.set(downloadId, { id: downloadId, ...status });
    
            // Handle profile selection needed
            if (status.status === 'needs_profile') {
                handleProfileNeeded(downloadId, status);
            }
        })
        .catch(error => {
            logger.error('Download', 'Failed to fetch initial status:', error);
        });
}


// Handle profile selection needed
async function handleProfileNeeded(downloadId, status) {
    logger.debug('Profile', `Selection needed for download: ${downloadId}`);

    // Remove from active downloads first
    activeDownloads.delete(downloadId);

    // Show modal with profile selection
    if (status.profiles && status.profiles.length > 0) {
        logger.debug('Profile', `Showing modal with ${status.profiles.length} profiles`);
        showProfileModal(status.profiles, status.url);
    } else {
        logger.error('Profile', 'No profiles available in status');
    }
}

// Show profile selection modal
function showProfileModal(profiles, originalUrl) {
    logger.debug('Profile', `Modal opened with ${profiles.length} profiles`);
    const modal = document.getElementById('profile-modal');
    const modalButtons = document.getElementById('modal-profile-buttons');

    if (!modal) {
        logger.error('Profile', 'Modal element not found!');
        return;
    }
    if (!modalButtons) {
        logger.error('Profile', 'Modal buttons container not found!');
        return;
    }

    // Clear existing buttons
    modalButtons.innerHTML = '';

    // Get color classes
    const colorClasses = ['blue', 'red', 'green', 'yellow', 'purple'];

    // Create profile cards
    profiles.forEach((profile, index) => {
        const card = document.createElement('div');
        card.className = 'profile-card';

        // Extract color from testId if available
        let colorClass = colorClasses[index % colorClasses.length];
        if (profile.testId && profile.testId.includes('profile-color-bg-profile-')) {
            const match = profile.testId.match(/profile-color-bg-profile-(\w+)/);
            if (match) {
                colorClass = match[1];
            }
        }

        card.innerHTML = `
            <div class="profile-name">${profile.name}</div>
            <div class="profile-color profile-color-${colorClass}"></div>
        `;

        card.addEventListener('click', async () => {
            await selectProfileAndRetry(profile.name, originalUrl);
            modal.style.display = 'none';
        });

        modalButtons.appendChild(card);
    });

    // Show modal
    modal.style.display = 'flex';

    // Cancel button handler
    document.getElementById('modal-cancel').onclick = () => {
        modal.style.display = 'none';
    };

    // Close on background click
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    };
}

// Select profile and retry download
async function selectProfileAndRetry(profileName, originalUrl) {
    try {
        // First, set the profile in env
        const response = await fetch(`${API_BASE}/profiles/set`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ profile: profileName })
        });

        const result = await response.json();

        if (result.success) {
            logger.info('Profile', `Set to: ${profileName}. Retrying download...`);

            // Update the displayed profile in settings
            document.getElementById('current-profile').textContent = profileName;

            // If we have the original URL, retry the download
            if (originalUrl) {
                // Determine the type of download from the URL
                if (originalUrl.includes('/afspelen')) {
                    // Single episode
                    await startDownload('/download/episode', { url: originalUrl, profile: profileName });
                } else {
                    // For now, just retry as episode
                    await startDownload('/download/episode', { url: originalUrl, profile: profileName });
                }
            }
        } else {
            logger.error('Profile', result.error || 'Failed to set profile');
        }
    } catch (error) {
        logger.error('Profile', 'Failed to set: ' + error.message);
    }
}

// Create download card HTML
function createDownloadCard(download) {
    let statusClass = 'status-' + download.status;
    let statusText = download.status;
    let progressInfo = '';
    let progressBar = '';

    if (download.status === 'processing') {
        statusText = 'Processing...';
    } else if (download.status === 'needs_profile') {
        statusText = 'Profile selection required';
        progressInfo = `<p>Please select a profile in Settings</p>`;
    } else if (download.status === 'downloading') {
        statusText = 'Downloading...';

        // Add progress bar if we have progress data
        if (download.progress) {
            const progress = download.progress;
            const percentage = progress.percentage || 0;
            const speed = progress.speed || '';
            const eta = progress.eta || '';
            const stage = progress.stage || 'downloading';

            statusText = stage === 'merging' ? 'Merging files...' : 'Downloading...';

            progressBar = `
                <div class="progress-bar-container">
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                    </div>
                    <div class="progress-details">
                        <span class="progress-percentage">${percentage.toFixed(1)}%</span>
                        ${speed ? `<span class="progress-speed">${speed}</span>` : ''}
                        ${eta && eta !== '00:00' ? `<span class="progress-eta">ETA: ${eta}</span>` : ''}
                    </div>
                </div>
            `;
        }

        if (download.totalEpisodes) {
            progressInfo = `<div class="progress-info">Episode ${download.currentEpisode || 1} of ${download.totalEpisodes}</div>`;
        } else if (download.totalUrls) {
            progressInfo = `<div class="progress-info">File ${download.currentUrl || 1} of ${download.totalUrls}</div>`;
        } else if (download.filename) {
            progressInfo = `<div class="progress-info">${download.filename}</div>`;
        }
    } else if (download.status === 'completed') {
        statusText = 'Completed';
        progressBar = `
            <div class="progress-bar-container">
                <div class="progress-bar">
                    <div class="progress-bar-fill completed" style="width: 100%"></div>
                </div>
            </div>
        `;
        if (download.totalEpisodes) {
            progressInfo = `<div class="progress-info">${download.totalEpisodes} episodes downloaded</div>`;
        } else if (download.totalUrls) {
            progressInfo = `<div class="progress-info">${download.totalUrls} files downloaded</div>`;
        }
    } else if (download.status === 'error') {
        statusText = 'Error';
        progressInfo = `<div class="error-info">${download.error || 'Unknown error'}</div>`;
    }

    return `
        <div class="download-card ${statusClass}">
            <div class="download-status">${statusText}</div>
            ${progressInfo}
            ${progressBar}
        </div>
    `;
}


// Check for existing downloads on page load
async function checkExistingDownloads() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const downloads = await response.json();

        for (const [id, status] of Object.entries(downloads)) {
            if (status.status === 'processing' || status.status === 'downloading') {
                trackDownload(id);
            }
        }
    } catch (error) {
        logger.error('Downloads', 'Failed to fetch existing downloads:', error);
    }
}

// Select a profile
async function selectProfile(profileName) {
    try {
        const response = await fetch(`${API_BASE}/profiles/set`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ profile: profileName })
        });

        const result = await response.json();

        if (result.success) {
            document.getElementById('current-profile').textContent = profileName;
            document.getElementById('profile-list').style.display = 'none';
        }
    } catch (error) {
    }
}

// Load current configuration
async function loadConfig() {
    try {
        const response = await fetch(`${API_BASE}/config`);
        const config = await response.json();

        // Only populate form fields if elements exist (settings tab is loaded)
        const emailField = document.getElementById('npo-email');
        if (emailField) {
            emailField.value = config.NPO_EMAIL || '';
        }

        // Handle password field
        const passwordField = document.getElementById('npo-password');
        if (passwordField) {
            if (config.hasPassword) {
                passwordField.placeholder = 'Password saved (enter new to change)';
            } else {
                passwordField.placeholder = 'Your NPO password';
            }
        }

        // Handle API key field
        const apiKeyField = document.getElementById('api-key');
        if (apiKeyField) {
            if (config.hasApiKey) {
                apiKeyField.placeholder = 'API key saved (enter new to change)';
            } else {
                apiKeyField.placeholder = 'Your API key from getwvkeys.cc';
            }
        }

        const headlessCheckbox = document.getElementById('headless-mode');
        if (headlessCheckbox) {
            headlessCheckbox.checked = config.HEADLESS;
        }

        // Update profile display
        const profileDisplay = document.getElementById('current-profile');
        if (profileDisplay) {
            if (config.NPO_PROFILE) {
                profileDisplay.textContent = config.NPO_PROFILE;
            } else {
                profileDisplay.textContent = 'Not selected';
            }
        }

    } catch (error) {
        logger.error('Config', 'Failed to load configuration:', error);

    }
}


// Show settings status message

// Store current navigation state
let navigationState = {
    level: 'shows', // shows, seasons, episodes
    currentShow: null,
    currentSeason: null,
    showsData: null
};

// Load hierarchical show data
async function loadShowsHierarchy() {
    const container = document.getElementById('downloaded-container');
    const title = document.getElementById('downloads-list-title');
    const breadcrumb = document.getElementById('downloads-breadcrumb');

    try {
        // Load shows data if not cached
        if (!navigationState.showsData) {
            const res = await fetch(`${API_BASE}/shows`);
            const data = await res.json();
            // Handle both response formats
            if (data.success && data.data) {
                navigationState.showsData = data.data.shows || [];
            } else {
                navigationState.showsData = data.shows || [];
            }
        }

        const shows = navigationState.showsData;

        if (navigationState.level === 'shows') {
            // Display shows list
            title.textContent = 'Downloaded Shows';
            breadcrumb.innerHTML = '<span class="breadcrumb-item active" data-level="shows">Shows</span>';

            if (shows.length === 0) {
                // Hide all other UI elements
                breadcrumb.style.display = 'none';
                title.style.display = 'none';
                document.querySelector('.downloads-detail-panel').style.display = 'none';

                // Show centered message with better contrast
                container.innerHTML = `
                    <div class="no-downloads" style="
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        text-align: center;
                        width: 100%;
                        padding: 40px;
                    ">
                        <p style="
                            font-size: 1.4em;
                            margin-bottom: 15px;
                            color: #333;
                            font-weight: 500;
                        ">No downloaded videos yet</p>
                        <p style="
                            font-size: 1em;
                            color: #666;
                        ">Start by downloading episodes from the other tabs</p>
                    </div>`;
                return;
            }

            // Show UI elements when there are downloads
            breadcrumb.style.display = '';
            title.style.display = '';
            document.querySelector('.downloads-detail-panel').style.display = '';

            const showCards = shows.map(show => {
                const episodeCount = show.seasons.reduce((sum, s) => sum + s.episodes.length, 0);
                const seasonText = show.seasons.length === 1 ? '1 season' : `${show.seasons.length} seasons`;
                const episodeText = episodeCount === 1 ? '1 episode' : `${episodeCount} episodes`;

                return `<div class="nav-card show-card" data-show="${show.title}">
                            <div class="nav-card-title">${show.title}</div>
                            <div class="nav-card-info">${seasonText} • ${episodeText}</div>
                            <div class="nav-card-arrow">›</div>
                        </div>`;
            }).join('');

            container.innerHTML = showCards;

            // Add click handlers
            container.querySelectorAll('.show-card').forEach(card => {
                card.addEventListener('click', () => {
                    const showTitle = card.getAttribute('data-show');
                    navigateToSeasons(showTitle);
                });
            });

        } else if (navigationState.level === 'seasons') {
            // Display seasons for selected show
            const show = shows.find(s => s.title === navigationState.currentShow);
            if (!show) return;

            title.textContent = navigationState.currentShow;
            breadcrumb.innerHTML = `
                <span class="breadcrumb-item" data-level="shows">Shows</span>
                <span class="breadcrumb-separator">›</span>
                <span class="breadcrumb-item active" data-level="seasons">${navigationState.currentShow}</span>
            `;

            const seasonCards = show.seasons.map(season => {
                const episodeText = season.episodes.length === 1 ? '1 episode' : `${season.episodes.length} episodes`;
                return `<div class="nav-card season-card" data-season="${season.number}">
                            <div class="nav-card-title">Season ${season.number}</div>
                            <div class="nav-card-info">${episodeText}</div>
                            <div class="nav-card-arrow">›</div>
                        </div>`;
            }).join('');

            container.innerHTML = seasonCards;

            // Add click handlers
            container.querySelectorAll('.season-card').forEach(card => {
                card.addEventListener('click', () => {
                    const seasonNumber = parseInt(card.getAttribute('data-season'));
                    navigateToEpisodes(navigationState.currentShow, seasonNumber);
                });
            });

        } else if (navigationState.level === 'episodes') {
            // Display episodes for selected season
            const show = shows.find(s => s.title === navigationState.currentShow);
            if (!show) return;

            const season = show.seasons.find(s => s.number === navigationState.currentSeason);
            if (!season) return;

            title.textContent = `${navigationState.currentShow} - Season ${navigationState.currentSeason}`;
            breadcrumb.innerHTML = `
                <span class="breadcrumb-item" data-level="shows">Shows</span>
                <span class="breadcrumb-separator">›</span>
                <span class="breadcrumb-item" data-level="seasons">${navigationState.currentShow}</span>
                <span class="breadcrumb-separator">›</span>
                <span class="breadcrumb-item active" data-level="episodes">Season ${navigationState.currentSeason}</span>
            `;

            const episodeCards = season.episodes.map((episode, index) => {
                const sizeMB = (episode.size / (1024*1024)).toFixed(1);
                const date = new Date(episode.mtime);
                // Store episode data in a safer way
                if (!window.episodeDataCache) {
                    window.episodeDataCache = {};
                }
                const episodeId = `episode-${navigationState.currentShow}-${navigationState.currentSeason}-${index}`;
                window.episodeDataCache[episodeId] = episode;

                return `<div class="nav-card episode-card" data-filename="${encodeURIComponent(episode.filename)}" data-episode-id="${episodeId}">
                            <div class="nav-card-title">Episode ${episode.episodeNumber}: ${episode.title}</div>
                            <div class="nav-card-info">${sizeMB} MB • ${date.toLocaleDateString()}</div>
                        </div>`;
            }).join('');

            container.innerHTML = episodeCards;

            // Add click handlers
            container.querySelectorAll('.episode-card').forEach(card => {
                card.addEventListener('click', (event) => {
                    const episodeId = card.getAttribute('data-episode-id');
                    const episodeData = window.episodeDataCache[episodeId];
                    if (episodeData) {
                        showEpisodeDetails(episodeData, event);
                    }
                });
            });
        }

        // Add breadcrumb click handlers
        breadcrumb.querySelectorAll('.breadcrumb-item:not(.active)').forEach(item => {
            item.addEventListener('click', () => {
                const level = item.getAttribute('data-level');
                if (level === 'shows') {
                    navigateToShows();
                } else if (level === 'seasons') {
                    navigateToSeasons(navigationState.currentShow);
                }
            });
        });

    } catch (e) {
        logger.error('Downloads', 'Failed to load shows:', e);
        container.innerHTML = '<p class="no-downloads">Failed to load downloads</p>';
    }
}

// Navigation functions
function navigateToShows() {
    navigationState.level = 'shows';
    navigationState.currentShow = null;
    navigationState.currentSeason = null;
    updateDownloadsURL();
    loadShowsHierarchy();
    hideEpisodeDetails();
}

function navigateToSeasons(showTitle) {
    navigationState.level = 'seasons';
    navigationState.currentShow = showTitle;
    navigationState.currentSeason = null;
    updateDownloadsURL();
    loadShowsHierarchy();
    hideEpisodeDetails();
}

function navigateToEpisodes(showTitle, seasonNumber) {
    navigationState.level = 'episodes';
    navigationState.currentShow = showTitle;
    navigationState.currentSeason = seasonNumber;
    updateDownloadsURL();
    loadShowsHierarchy();
    hideEpisodeDetails();
}

// Update URL for downloads page navigation
function updateDownloadsURL() {
    if (window.location.pathname.startsWith('/downloads')) {
        let newPath = '/downloads';

        if (navigationState.currentShow) {
            // Encode the show title for URL safety
            const encodedShow = encodeURIComponent(navigationState.currentShow);
            newPath += `/${encodedShow}`;

            if (navigationState.currentSeason) {
                newPath += `/season-${navigationState.currentSeason}`;
            }
        }

        // Update URL without triggering popstate
        window.history.replaceState({
            tab: 'downloads',
            navigationState: {
                level: navigationState.level,
                currentShow: navigationState.currentShow,
                currentSeason: navigationState.currentSeason
            }
        }, '', newPath);
    }
}

// Parse downloads deep link URL
function parseDownloadsURL(pathname) {
    const parts = pathname.split('/').filter(p => p);

    if (parts.length === 1 && parts[0] === 'downloads') {
        // Just /downloads - show all shows
        return {
            level: 'shows',
            currentShow: null,
            currentSeason: null
        };
    } else if (parts.length === 2) {
        // /downloads/show-name - show seasons
        return {
            level: 'seasons',
            currentShow: decodeURIComponent(parts[1]),
            currentSeason: null
        };
    } else if (parts.length === 3) {
        // /downloads/show-name/season-1 - show episodes
        const seasonMatch = parts[2].match(/season-(\d+)/);
        if (seasonMatch) {
            return {
                level: 'episodes',
                currentShow: decodeURIComponent(parts[1]),
                currentSeason: parseInt(seasonMatch[1])
            };
        }
    }

    // Default to shows view
    return {
        level: 'shows',
        currentShow: null,
        currentSeason: null
    };
}

// Show episode details
function showEpisodeDetails(episode, event) {
    document.getElementById('episode-details').style.display = 'block';
    document.getElementById('no-selection').style.display = 'none';

    // Fill in episode details
    document.getElementById('episode-title').textContent = episode.title;
    document.getElementById('episode-number').textContent = episode.episodeNumber;
    document.getElementById('episode-airing').textContent = episode.airing || 'Unknown';
    document.getElementById('episode-duration').textContent = episode.duration || 'Unknown';

    const sizeMB = (episode.size / (1024*1024)).toFixed(1);
    document.getElementById('episode-size').textContent = `${sizeMB} MB`;

    document.getElementById('episode-description').textContent = episode.description || 'No description available';

    // Store current episode for play button
    document.getElementById('play-episode').onclick = () => {
        playVideo(encodeURIComponent(episode.filename), episode.title);
    };

    // Highlight selected episode
    document.querySelectorAll('.episode-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('selected');
    }
}

function hideEpisodeDetails() {
    const episodeDetails = document.getElementById('episode-details');
    const noSelection = document.getElementById('no-selection');

    if (episodeDetails) {
        episodeDetails.style.display = 'none';
    }
    if (noSelection) {
        noSelection.style.display = 'block';
    }
}

// Load list of downloaded episodes (fallback/compatibility)
async function loadDownloadedList() {
    // Parse URL to restore navigation state
    if (window.location.pathname.startsWith('/downloads')) {
        const parsedState = parseDownloadsURL(window.location.pathname);
        navigationState.level = parsedState.level;
        navigationState.currentShow = parsedState.currentShow;
        navigationState.currentSeason = parsedState.currentSeason;
    } else {
        // Default state
        navigationState.level = 'shows';
        navigationState.currentShow = null;
        navigationState.currentSeason = null;
    }
    navigationState.showsData = null;
    await loadShowsHierarchy();
}

function playVideo(encodedFilename, displayName) {
    const src = `/videos/${encodedFilename}`;

    // Use the new video overlay player
    openVideoPlayer(src);

    // Update the video player title if needed
    if (displayName) {
        const overlay = document.querySelector('.video-overlay');
        if (overlay) {
            // Add title to overlay if not exists
            let titleEl = overlay.querySelector('.video-title');
            if (!titleEl) {
                titleEl = document.createElement('div');
                titleEl.className = 'video-title';
                const container = overlay.querySelector('.video-container');
                container.insertBefore(titleEl, container.firstChild);
            }
            titleEl.textContent = displayName;
        }
    }
}

// Initialize the first tab on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize video overlay
    initVideoOverlay();

    // Determine initial tab from URL
    const initialTab = getRouteFromPath(window.location.pathname);

    // Navigate to the initial tab
    await navigateToTab(initialTab, false);

    // Set initial history state
    window.history.replaceState({ tab: initialTab }, '', window.location.pathname);

    // Initialize WebSocket connection
    initWebSocket();

    // Check for existing downloads
    checkExistingDownloads();
});

// Load recent downloads for home page
async function loadRecentDownloads() {
    try {
        const response = await fetch(`${API_BASE}/downloads/recent`);
        const data = await response.json();

        const section = document.getElementById('recent-downloads-section');
        const grid = document.getElementById('recent-downloads-grid');

        if (!section || !grid) return;

        if (data.success && data.data?.files?.length > 0) {
            const files = data.data.files;

            // Show the section
            section.style.display = 'block';

            // Create video cards
            grid.innerHTML = files.map(file => {
                const meta = file.metadata;
                const title = meta.seriesTitle ? `${meta.seriesTitle} - ${meta.title}` : meta.title;
                const subtitle = meta.episodeNumber ? `Episode ${meta.episodeNumber}` : '';
                const date = new Date(file.mtime);
                const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

                return `
                    <div class="video-card" data-filename="${encodeURIComponent(file.name)}" data-title="${encodeURIComponent(title)}">
                        <div class="video-card-thumbnail">
                            <div class="video-card-play-overlay">
                                <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z"/>
                                </svg>
                            </div>
                            <div class="video-card-duration">${meta.duration || 'N/A'}</div>
                        </div>
                        <div class="video-card-info">
                            <div class="video-card-title">${title}</div>
                            <div class="video-card-subtitle">${subtitle}</div>
                            <div class="video-card-meta">
                                <span>${date.toLocaleDateString()}</span>
                                <span>${sizeMB} MB</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Add click handlers
            grid.querySelectorAll('.video-card').forEach(card => {
                card.addEventListener('click', () => {
                    const filename = card.getAttribute('data-filename');
                    const title = decodeURIComponent(card.getAttribute('data-title'));
                    playVideo(filename, title);
                });
            });
        } else {
            // Hide the section if no downloads
            section.style.display = 'none';
        }
    } catch (error) {
        logger.error('Failed to load recent downloads', error);
    }
}
