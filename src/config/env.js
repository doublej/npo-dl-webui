import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
function loadEnvFile() {
  const envPath = join(__dirname, '../../.env');
  const envVars = {};

  // Check if running in Deno or Node.js
  if (typeof Deno !== 'undefined') {
    // For Deno runtime - this will be handled by the caller
    return envVars;
  }

  // Node.js runtime - manually load .env
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
          // Trim both key and value to handle spaces around =
          const cleanKey = key.trim();
          const cleanValue = valueParts.join('=').trim();
          envVars[cleanKey] = cleanValue;
          // Also set in process.env for compatibility
          process.env[cleanKey] = cleanValue;
        }
      }
    });
  }

  return envVars;
}

// Load Deno env if running in Deno
async function loadDenoEnv() {
  if (typeof Deno !== 'undefined') {
    try {
      const { load } = await import("https://deno.land/std@0.224.0/dotenv/mod.ts");
      await load({ export: true });
    } catch (error) {
      console.warn('Failed to load Deno dotenv:', error.message);
    }
  }
}

// Initialize environment
async function initializeEnv() {
  await loadDenoEnv();
  loadEnvFile();
}

// Validate required environment variables
function validateConfig() {
  const required = ['GETWVKEYS_API_KEY'];
  const optional = ['NPO_EMAIL', 'NPO_PASSW', 'HEADLESS'];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set GETWVKEYS_API_KEY in your .env file');
    console.error('Get your key from https://getwvkeys.cc/me');
    process.exit(1);
  }

  // Warn about missing optional vars
  const missingOptional = optional.filter(key => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn(`Optional environment variables not set: ${missingOptional.join(', ')}`);
  }
}

// Get configuration object
function getConfig() {
  return {
    // Required
    GETWVKEYS_API_KEY: process.env.GETWVKEYS_API_KEY || '',

    // NPO Credentials
    NPO_EMAIL: process.env.NPO_EMAIL || '',
    NPO_PASSW: process.env.NPO_PASSW || '',
    NPO_PROFILE: process.env.NPO_PROFILE || '',

    // Browser settings
    HEADLESS: process.env.HEADLESS === 'true',

    // Paths
    VIDEO_PATH: process.env.VIDEO_PATH || './videos',

    // Server settings
    PORT: parseInt(process.env.PORT || '3001'),
  };
}

// Parse boolean from string
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
}

export {
  initializeEnv,
  validateConfig,
  getConfig,
  parseBoolean,
  loadEnvFile
};