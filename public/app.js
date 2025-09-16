// API base URL
const API_BASE = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001';

const logger = window.logger || console;

// Active downloads tracking
const activeDownloads = new Map();

// WebSocket connection
let ws = null;
let wsReconnectTimer = null;

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
            const response = await fetch(`tabs/${tabName}-tab.html`);
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
            // No specific event listeners needed for home tab
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
                document.getElementById('player-section').style.display = 'block';
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
    loadShowsHierarchy();
    hideEpisodeDetails();
}

function navigateToSeasons(showTitle) {
    navigationState.level = 'seasons';
    navigationState.currentShow = showTitle;
    navigationState.currentSeason = null;
    loadShowsHierarchy();
    hideEpisodeDetails();
}

function navigateToEpisodes(showTitle, seasonNumber) {
    navigationState.level = 'episodes';
    navigationState.currentShow = showTitle;
    navigationState.currentSeason = seasonNumber;
    loadShowsHierarchy();
    hideEpisodeDetails();
}

// Show episode details
function showEpisodeDetails(episode, event) {
    document.getElementById('episode-details').style.display = 'block';
    document.getElementById('no-selection').style.display = 'none';
    document.getElementById('player-section').style.display = 'none';

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
        document.getElementById('player-section').style.display = 'block';
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
    document.getElementById('episode-details').style.display = 'none';
    document.getElementById('no-selection').style.display = 'block';
    document.getElementById('player-section').style.display = 'none';
}

// Load list of downloaded episodes (fallback/compatibility)
async function loadDownloadedList() {
    // Now loads hierarchical view
    navigationState.level = 'shows';
    navigationState.currentShow = null;
    navigationState.currentSeason = null;
    navigationState.showsData = null;
    await loadShowsHierarchy();
}

function playVideo(encodedFilename, displayName) {
    const video = document.getElementById('video-player');
    const nowPlaying = document.getElementById('now-playing');
    const src = `/videos/${encodedFilename}`;
    // If a source element exists, reuse; otherwise set src directly on video
    video.src = src;
    video.load();
    video.play().catch(() => {/* autoplay might be blocked; ignore */});
    if (displayName) {
        nowPlaying.style.display = 'block';
        nowPlaying.textContent = `Now playing: ${displayName}`;
    }
}

// Initialize the first tab on page load
document.addEventListener('DOMContentLoaded', async () => {
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
