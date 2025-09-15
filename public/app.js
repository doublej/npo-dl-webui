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
        updateTopbarStatus('Connected to server', 'success');
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
        updateTopbarStatus('Disconnected from server', 'warning');
        // Attempt to reconnect after 3 seconds
        wsReconnectTimer = setTimeout(() => {
            console.log('Attempting to reconnect WebSocket...');
            updateTopbarStatus('Reconnecting...', 'info');
            initWebSocket();
        }, 3000);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'connected':
            console.log('WebSocket:', data.message);
            updateTopbarStatus('Connected', 'success');
            break;

        case 'download_progress':
            updateDownloadProgress(data.downloadId, data.progress);
            updateTopbarWithProgress(data.downloadId, data.progress);
            break;

        case 'download_status':
            updateDownloadStatus(data.downloadId, data.status, data);
            updateTopbarWithStatus(data.downloadId, data.status, data);
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
    }
}

// Update topbar status
function updateTopbarStatus(message, type = 'info', progress = null) {
    const topbar = document.getElementById('topbar-status');
    if (topbar) {
        topbar.textContent = message;
        topbar.className = `topbar__status ${type}`;

        // Set progress CSS variable if provided
        if (progress !== null) {
            topbar.style.setProperty('--progress', `${progress}%`);
        } else {
            topbar.style.removeProperty('--progress');
        }
    }
}

// Update topbar with download progress
function updateTopbarWithProgress(downloadId, progress) {
    if (progress && progress.percentage !== undefined) {
        let displayMessage = '';
        const percentage = Math.round(progress.percentage);

        // Use custom message if provided, otherwise format based on stage
        if (progress.message) {
            displayMessage = progress.message;
        } else {
            switch (progress.stage) {
                case 'downloading_video':
                    displayMessage = `Downloading video: ${percentage}%`;
                    break;
                case 'downloading_audio':
                    displayMessage = `Downloading audio: ${percentage}%`;
                    break;
                case 'downloading':
                    displayMessage = `Downloading: ${percentage}%`;
                    break;
                case 'decrypting':
                    displayMessage = `Decrypting: ${percentage}%`;
                    break;
                case 'merging':
                    displayMessage = `Merging audio/video: ${percentage}%`;
                    break;
                case 'completed':
                    displayMessage = 'Download completed!';
                    break;
                default:
                    displayMessage = `${progress.stage}: ${percentage}%`;
            }
        }

        // Add speed and ETA if available
        if (progress.speed && progress.eta && progress.stage === 'downloading') {
            displayMessage = `Downloading: ${percentage}% (${progress.speed} - ETA: ${progress.eta})`;
        }

        updateTopbarStatus(displayMessage, 'progress', percentage);
    }
}

// Update topbar with download status
function updateTopbarWithStatus(downloadId, status, data) {
    let message = '';
    let type = 'info';

    switch (status) {
        case 'fetching_info':
            message = 'Fetching episode information...';
            break;
        case 'downloading':
            message = `Downloading: ${data.filename || 'episode'}`;
            break;
        case 'decrypting':
            message = 'Decrypting video...';
            break;
        case 'merging':
            message = 'Merging audio and video...';
            break;
        case 'completed':
            message = `Download completed: ${data.filename || 'episode'}`;
            type = 'success';
            setTimeout(() => updateTopbarStatus('Connected', 'info'), 5000);
            break;
        case 'error':
            message = `Error: ${data.error || 'Download failed'}`;
            type = 'error';
            break;
    }

    if (message) {
        updateTopbarStatus(message, type);
    }
}

// Update download status
function updateDownloadStatus(downloadId, status, data) {
    const download = activeDownloads.get(downloadId);
    if (download) {
        activeDownloads.set(downloadId, { ...download, status, ...data });

        // Show overlay for active downloads
        if (status === 'downloading' || status === 'decrypting' || status === 'merging' || status === 'fetching_info') {
            showDownloadOverlay();
        }

        // Remove completed/errored downloads after 10 seconds
        if (status === 'completed' || status === 'error') {
            setTimeout(() => {
                activeDownloads.delete(downloadId);
                // Reset topbar to connected state and hide overlay if no more active downloads
                if (activeDownloads.size === 0) {
                    updateTopbarStatus('Connected', 'info');
                    hideDownloadOverlay();
                } else {
                    // Check if any remaining downloads are active
                    const hasActiveDownloads = Array.from(activeDownloads.values()).some(d =>
                        d.status === 'downloading' || d.status === 'decrypting' ||
                        d.status === 'merging' || d.status === 'fetching_info'
                    );
                    if (!hasActiveDownloads) {
                        hideDownloadOverlay();
                    }
                }
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
        showDownloadOverlay(); // Show overlay when starting download

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
            hideDownloadOverlay(); // Hide on error
        } else {
            showSuccess(result.message);
            if (result.downloadId) {
                trackDownload(result.downloadId);
            } else {
                hideDownloadOverlay(); // Hide if no download started
            }
        }
    } catch (error) {
        showError('Failed to start download: ' + error.message);
        hideDownloadOverlay(); // Hide on error
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
            console.error('Failed to fetch initial status:', error);
        });
}


// Handle profile selection needed
async function handleProfileNeeded(downloadId, status) {
    console.log('Profile selection needed for download:', downloadId);
    console.log('Status object:', status);

    // Remove from active downloads first
    activeDownloads.delete(downloadId);

    // Hide overlay since download needs user interaction
    hideDownloadOverlay();

    // Show modal with profile selection
    if (status.profiles && status.profiles.length > 0) {
        console.log('Showing profile modal with profiles:', status.profiles);
        console.log('Original URL:', status.url);
        showProfileModal(status.profiles, status.url);
    } else {
        console.error('No profiles available in status:', status);
    }
}

// Show profile selection modal
function showProfileModal(profiles, originalUrl) {
    console.log('showProfileModal called with:', { profiles, originalUrl });
    const modal = document.getElementById('profile-modal');
    const modalButtons = document.getElementById('modal-profile-buttons');

    if (!modal) {
        console.error('Profile modal element not found!');
        return;
    }
    if (!modalButtons) {
        console.error('Profile modal buttons container not found!');
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
        }
    } catch (error) {
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
        }
    } catch (error) {
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

    } catch (error) {
        console.error('Failed to load configuration:', error);

    }
}


// Show settings status message

// Initialize
initWebSocket();
checkExistingDownloads();
loadConfig();

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
            navigationState.showsData = data.shows || [];
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
        console.error('Failed to load shows:', e);
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

// Show download overlay
function showDownloadOverlay() {
    const overlay = document.getElementById('download-overlay');
    if (overlay) {
        overlay.style.display = 'block';
        document.body.classList.add('downloading');
    }
}

// Hide download overlay
function hideDownloadOverlay() {
    const overlay = document.getElementById('download-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        document.body.classList.remove('downloading');
    }
}
