#!/usr/bin/env node
import logger from './src/lib/logger.js';

console.log('Testing improved logging system...\n');

// Test regular logging levels
logger.info('System', 'Starting application...');
logger.debug('System', 'Debug mode enabled');
logger.warn('System', 'Low memory warning');
logger.error('System', 'Connection timeout');

console.log('\n--- Testing grouped operations ---\n');

// Test grouped operations
logger.group('NPO LOGIN');
logger.info('Login', 'Navigating to NPO Start...');
logger.info('Login', 'Clicking login button...');
logger.info('Login', 'Entering credentials...');
logger.info('Login', 'Submitting login form...');
logger.info('Login', 'Checking for profile selection...');
logger.info('Login', 'Found 2 profiles: jurrejan, Mingie');
logger.info('Login', 'Selecting profile: jurrejan');
logger.info('Login', 'Establishing session...');
logger.groupEnd('Login successful');

console.log('\n--- Testing download progress ---\n');

// Test download progress
logger.group('GET EPISODE');
logger.info('Episode', 'URL: https://npo.nl/start/serie/nos-journaal/episode.mp4');
logger.debug('Episode', 'Profile: jurrejan');
logger.info('Episode', 'Fetching episode information...');
logger.info('Episode', 'nos-journaal-20241216.mp4');
logger.info('Download', 'Starting download: nos-journaal-20241216.mp4');
logger.info('Download', 'nos-journaal-20241216.mp4: 5% of 334MB at 2.1MB/s - ETA 02:35');
logger.info('Download', 'nos-journaal-20241216.mp4: 25% of 334MB at 3.5MB/s - ETA 01:45');
logger.info('Download', 'nos-journaal-20241216.mp4: 50% of 334MB at 4.2MB/s - ETA 01:00');
logger.info('Download', 'nos-journaal-20241216.mp4: 75% of 334MB at 3.8MB/s - ETA 00:30');
logger.info('Download', 'nos-journaal-20241216.mp4: 100% of 334MB at 3.5MB/s - ETA 00:00');
logger.info('Download', 'Completed: /videos/nos-journaal-20241216.mp4');
logger.groupEnd('Episode fetched successfully');

console.log('\n--- Testing different log levels ---\n');
console.log('Set LOG_LEVEL environment variable to control verbosity:');
console.log('  ERROR - Only errors');
console.log('  WARN  - Errors and warnings');
console.log('  INFO  - Errors, warnings, and info (default)');
console.log('  DEBUG - All messages including debug');