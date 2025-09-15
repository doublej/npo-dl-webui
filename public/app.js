// API base URL
const API_BASE = 'http://localhost:3000/api';

// Active downloads tracking
const activeDownloads = new Map();

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

    // Poll for status updates
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/status?id=${downloadId}`);
            const status = await response.json();

            activeDownloads.set(downloadId, { id: downloadId, ...status });
            updateDownloadDisplay();

            // Stop polling if download is complete or errored
            if (status.status === 'completed' || status.status === 'error') {
                clearInterval(pollInterval);

                // Remove from active downloads after 10 seconds
                setTimeout(() => {
                    activeDownloads.delete(downloadId);
                    updateDownloadDisplay();
                }, 10000);
            }
        } catch (error) {
            console.error('Failed to fetch status:', error);
            clearInterval(pollInterval);
        }
    }, 1000);
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

// Create download card HTML
function createDownloadCard(download) {
    let statusClass = 'status-' + download.status;
    let statusText = download.status;
    let progressInfo = '';

    if (download.status === 'processing') {
        statusText = 'Processing...';
    } else if (download.status === 'downloading') {
        statusText = 'Downloading...';
        if (download.totalEpisodes) {
            progressInfo = `<div class="progress-info">Episode ${download.currentEpisode || 1} of ${download.totalEpisodes}</div>`;
        } else if (download.totalUrls) {
            progressInfo = `<div class="progress-info">File ${download.currentUrl || 1} of ${download.totalUrls}</div>`;
        } else if (download.filename) {
            progressInfo = `<div class="progress-info">${download.filename}</div>`;
        }
    } else if (download.status === 'completed') {
        statusText = 'Completed';
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
checkExistingDownloads();
loadConfig();
