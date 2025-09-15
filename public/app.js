// API base URL
const API_BASE = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000';

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

    console.log('Connecting to WebSocket...');
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('WebSocket connected');
        clearTimeout(wsReconnectTimer);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Attempt to reconnect after 3 seconds
        wsReconnectTimer = setTimeout(() => {
            console.log('Attempting to reconnect WebSocket...');
            initWebSocket();
        }, 3000);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'connected':
            console.log('WebSocket:', data.message);
            break;

        case 'download_progress':
            updateDownloadProgress(data.downloadId, data.progress);
            break;

        case 'download_status':
            updateDownloadStatus(data.downloadId, data.status, data);
            break;

        default:
            console.log('Unknown WebSocket message type:', data.type);
    }
}

// Update download progress
function updateDownloadProgress(downloadId, progress) {
    const download = activeDownloads.get(downloadId);
    if (download) {
        activeDownloads.set(downloadId, { ...download, progress });
        updateDownloadDisplay();
    }
}

// Update download status
function updateDownloadStatus(downloadId, status, data) {
    const download = activeDownloads.get(downloadId);
    if (download) {
        activeDownloads.set(downloadId, { ...download, status, ...data });
        updateDownloadDisplay();

        // Remove completed/errored downloads after 10 seconds
        if (status === 'completed' || status === 'error') {
            setTimeout(() => {
                activeDownloads.delete(downloadId);
                updateDownloadDisplay();
            }, 10000);
        }
    }
}

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.dataset.tab;

        // Update active tab button
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        button.classList.add('active');

        // Update active tab content
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // If navigating to downloads tab, load downloaded episodes
        if (tabName === 'downloads') {
            loadDownloadedList();
        }
    });
});

// Form submissions
document.getElementById('episode-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('episode-url').value;
    await startDownload('/download/episode', { url });
    document.getElementById('episode-url').value = '';
});

document.getElementById('show-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('show-url').value;
    const seasons = document.getElementById('season-count').value || -1;
    const reverse = document.getElementById('show-reverse').checked;
    await startDownload('/download/show', { url, seasons: parseInt(seasons), reverse });
    document.getElementById('show-url').value = '';
    document.getElementById('season-count').value = '';
    document.getElementById('show-reverse').checked = false;
});

document.getElementById('season-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('season-url').value;
    const reverse = document.getElementById('season-reverse').checked;
    await startDownload('/download/season', { url, reverse });
    document.getElementById('season-url').value = '';
    document.getElementById('season-reverse').checked = false;
});

document.getElementById('batch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const urlsText = document.getElementById('batch-urls').value;
    const urls = urlsText.split('\n').map(u => u.trim()).filter(u => u);
    if (urls.length > 0) {
        await startDownload('/download/batch', { urls });
        document.getElementById('batch-urls').value = '';
    }
});

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
            showError(result.error);
        } else {
            showSuccess(result.message);
            if (result.downloadId) {
                trackDownload(result.downloadId);
            }
        }
    } catch (error) {
        showError('Failed to start download: ' + error.message);
    }
}

// Track download progress
function trackDownload(downloadId) {
    if (!activeDownloads.has(downloadId)) {
        activeDownloads.set(downloadId, { id: downloadId, status: 'pending' });
        updateDownloadDisplay();
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
            updateDownloadDisplay();

            // Handle profile selection needed
            if (status.status === 'needs_profile') {
                handleProfileNeeded(downloadId, status);
            }
        })
        .catch(error => {
            console.error('Failed to fetch initial status:', error);
        });
}

// Update download display
function updateDownloadDisplay() {
    const container = document.getElementById('downloads-container');

    if (activeDownloads.size === 0) {
        container.innerHTML = '<p class="no-downloads">No active downloads</p>';
        return;
    }

    let html = '';
    for (const [id, download] of activeDownloads) {
        html += createDownloadCard(download);
    }
    container.innerHTML = html;
}

// Handle profile selection needed
async function handleProfileNeeded(downloadId, status) {
    // Remove from active downloads first
    activeDownloads.delete(downloadId);
    updateDownloadDisplay();

    // Show modal with profile selection
    showProfileModal(status.profiles, status.url);
}

// Show profile selection modal
function showProfileModal(profiles, originalUrl) {
    const modal = document.getElementById('profile-modal');
    const modalButtons = document.getElementById('modal-profile-buttons');

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
            showSuccess(`Profile set to: ${profileName}. Retrying download...`);

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
            showError(result.error || 'Failed to set profile');
        }
    } catch (error) {
        showError('Failed to set profile: ' + error.message);
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

// Show success message
function showSuccess(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-success';
    alert.textContent = message;
    document.body.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 3000);
}

// Show error message
function showError(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-error';
    alert.textContent = message;
    document.body.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 5000);
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
        console.error('Failed to fetch existing downloads:', error);
    }
}

// Settings management
document.getElementById('settings-form').addEventListener('submit', async (e) => {
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
            showSettingsStatus('success', result.message);
            // Clear password fields for security if they were updated
            if (config.NPO_PASSW !== '********') {
                document.getElementById('npo-password').value = '';
            }
            if (config.GETWVKEYS_API_KEY !== '********') {
                document.getElementById('api-key').value = '';
            }
            // Reload config to show masked values and update status
            await loadConfig();
        } else {
            showSettingsStatus('error', result.error || 'Failed to save settings');
        }
    } catch (error) {
        showSettingsStatus('error', 'Failed to save settings: ' + error.message);
    }
});

// Test connection button
document.getElementById('test-connection').addEventListener('click', async () => {
    try {
        const response = await fetch(`${API_BASE}/test-connection`, {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            showSettingsStatus('success', result.message);
        } else {
            showSettingsStatus('error', result.message);
        }
    } catch (error) {
        showSettingsStatus('error', 'Connection test failed: ' + error.message);
    }
});

// Profile selection button
document.getElementById('select-profile').addEventListener('click', async () => {
    const profileList = document.getElementById('profile-list');
    const profileButtons = document.getElementById('profile-buttons');

    // Toggle profile list visibility
    if (profileList.style.display === 'none') {
        // Fetch available profiles
        try {
            showSettingsStatus('info', 'Fetching available profiles...');
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
                showSettingsStatus('success', `Found ${result.profiles.length} profile(s)`);
            } else if (result.success && (!result.profiles || result.profiles.length === 0)) {
                showSettingsStatus('info', 'No profiles found. Login directly without profile selection.');
            } else {
                showSettingsStatus('error', 'Failed to fetch profiles');
            }
        } catch (error) {
            showSettingsStatus('error', 'Failed to fetch profiles: ' + error.message);
        }
    } else {
        profileList.style.display = 'none';
    }
});

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
            showSettingsStatus('success', `Profile set to: ${profileName}`);
        } else {
            showSettingsStatus('error', result.error || 'Failed to set profile');
        }
    } catch (error) {
        showSettingsStatus('error', 'Failed to set profile: ' + error.message);
    }
}

// Load current configuration
async function loadConfig() {
    try {
        const response = await fetch(`${API_BASE}/config`);
        const config = await response.json();

        // Populate form fields
        document.getElementById('npo-email').value = config.NPO_EMAIL || '';

        // Handle password field
        if (config.hasPassword) {
            document.getElementById('npo-password').value = config.NPO_PASSW; // This will be masked stars
            document.getElementById('npo-password').placeholder = 'Password saved (enter new to change)';
        }

        // Handle API key field
        if (config.hasApiKey) {
            document.getElementById('api-key').value = config.GETWVKEYS_API_KEY; // This will be masked stars
            document.getElementById('api-key').placeholder = 'API key saved (enter new to change)';
        }

        document.getElementById('headless-mode').checked = config.HEADLESS;

        // Update profile display
        if (config.NPO_PROFILE) {
            document.getElementById('current-profile').textContent = config.NPO_PROFILE;
        } else {
            document.getElementById('current-profile').textContent = 'Not selected';
        }

        // Update configuration status
        updateConfigStatus(config);
    } catch (error) {
        console.error('Failed to load configuration:', error);
        updateConfigStatus({ hasApiKey: false, hasPassword: false, NPO_EMAIL: '' });
    }
}

// Update configuration status indicator
function updateConfigStatus(config) {
    let statusEl = document.getElementById('config-status');
    if (!statusEl) {
        // Create status element if it doesn't exist
        const statusDiv = document.createElement('div');
        statusDiv.id = 'config-status';
        statusDiv.className = 'config-status';

        // Insert after the settings form
        const settingsForm = document.getElementById('settings-form');
        settingsForm.parentNode.insertBefore(statusDiv, settingsForm.nextSibling);
        statusEl = statusDiv;
    }

    const hasAllRequired = config.hasApiKey && config.NPO_EMAIL && config.hasPassword;
    const requiredCount = [config.hasApiKey, config.NPO_EMAIL, config.hasPassword].filter(Boolean).length;

    let statusClass, statusText;

    if (hasAllRequired) {
        statusClass = 'status-complete';
        statusText = 'Configuration Complete - Ready to download';
    } else if (requiredCount > 0) {
        statusClass = 'status-partial';
        statusText = `Configuration Incomplete (${requiredCount}/3 required fields set)`;
    } else {
        statusClass = 'status-empty';
        statusText = 'Configuration Required - Please set NPO credentials and API key';
    }

    statusEl.className = `config-status ${statusClass}`;
    statusEl.innerHTML = `
        <div class="status-text">${statusText}</div>
        <div class="status-details">
            <span class="${config.NPO_EMAIL ? 'set' : 'unset'}">Email: ${config.NPO_EMAIL ? 'Set' : 'Not set'}</span>
            <span class="${config.hasPassword ? 'set' : 'unset'}">Password: ${config.hasPassword ? 'Set' : 'Not set'}</span>
            <span class="${config.hasApiKey ? 'set' : 'unset'}">API Key: ${config.hasApiKey ? 'Set' : 'Not set'}</span>
        </div>
    `;

    // Update subtle topbar status pill present on every page
    const topbarStatus = document.getElementById('topbar-status');
    if (topbarStatus) {
        topbarStatus.className = `topbar__status ${statusClass}`;
        const compactText = hasAllRequired ? 'Config: Complete' : (requiredCount > 0 ? `Config: ${requiredCount}/3` : 'Config: Missing');
        topbarStatus.textContent = compactText;
    }
}

// Show settings status message
function showSettingsStatus(type, message) {
    const statusEl = document.getElementById('settings-status');
    statusEl.className = `status-message status-${type}`;
    statusEl.textContent = message;
    statusEl.style.display = 'block';

    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 5000);
}

// Initialize
initWebSocket();
checkExistingDownloads();
loadConfig();

// Load list of downloaded episodes
async function loadDownloadedList() {
    const container = document.getElementById('downloaded-container');
    try {
        const res = await fetch(`${API_BASE}/downloads`);
        const data = await res.json();
        const files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) {
            container.innerHTML = '<p class="no-downloads">No downloads found</p>';
            return;
        }
        const items = files.map(f => {
            const date = new Date(f.mtime);
            const sizeMB = (f.size / (1024*1024)).toFixed(1);
            const safeName = encodeURIComponent(f.name);
            return `<div class="download-card status-completed" data-filename="${safeName}">
                        <div class="download-status">${f.name}</div>
                        <div class="progress-info">${sizeMB} MB • ${date.toLocaleString()}</div>
                    </div>`;
        }).join('');
        container.innerHTML = items;

        // Bind click handlers to play videos
        container.querySelectorAll('.download-card').forEach(card => {
            card.addEventListener('click', () => {
                const filename = card.getAttribute('data-filename');
                playVideo(filename, card.querySelector('.download-status').textContent);
            });
        });
    } catch (e) {
        container.innerHTML = '<p class="no-downloads">Failed to load downloads</p>';
    }
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
