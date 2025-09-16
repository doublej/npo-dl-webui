import { sendOk, sendFail } from '../http/response.js';
import { loadEnvFile, saveEnvFile } from '../utils/env-file.js';
import { npoLogin } from '../../providers/npo/login.js';

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export async function handleGetConfig(req, res) {
  try {
    const envVars = loadEnvFile();
    const config = {
      NPO_EMAIL: envVars.NPO_EMAIL || '',
      NPO_PROFILE: envVars.NPO_PROFILE || '',
      HEADLESS: envVars.HEADLESS === 'true',
      hasPassword: !!envVars.NPO_PASSW,
      hasApiKey: !!envVars.GETWVKEYS_API_KEY,
    };
    sendOk(res, config);
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleUpdateConfig(req, res) {
  try {
    const updates = await parseBody(req);
    const currentEnv = loadEnvFile();
    if (updates.NPO_EMAIL !== undefined) currentEnv.NPO_EMAIL = updates.NPO_EMAIL;
    if (updates.NPO_PASSW && updates.NPO_PASSW !== '********') currentEnv.NPO_PASSW = updates.NPO_PASSW;
    if (updates.GETWVKEYS_API_KEY && updates.GETWVKEYS_API_KEY !== '********') currentEnv.GETWVKEYS_API_KEY = updates.GETWVKEYS_API_KEY;
    if (updates.HEADLESS !== undefined) currentEnv.HEADLESS = updates.HEADLESS ? 'true' : 'false';
    await saveEnvFile(currentEnv);
    sendOk(res, { success: true, message: 'Configuration updated successfully' });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleTestConnection(req, res) {
  try {
    const envVars = loadEnvFile();
    if (!envVars.NPO_EMAIL || !envVars.NPO_PASSW) {
      return sendOk(res, { success: false, message: 'NPO credentials not configured' });
    }
    if (!envVars.GETWVKEYS_API_KEY) {
      return sendOk(res, { success: false, message: 'GetWVKEYS API key not configured' });
    }
    return sendOk(res, { success: true, message: 'Configuration appears valid. Test download to verify credentials.' });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleGetProfiles(req, res) {
  try {
    const { getCachedProfiles } = await import('../../providers/npo/login.js');
    const cachedProfiles = await getCachedProfiles();
    if (cachedProfiles && cachedProfiles.length > 0) {
      const envVars = loadEnvFile();
      return sendOk(res, { success: true, profiles: cachedProfiles, selectedProfile: envVars.NPO_PROFILE || null, fromCache: true });
    }
    const loginResult = await npoLogin();
    if (loginResult && loginResult.needsProfileSelection) {
      return sendOk(res, { success: true, profiles: loginResult.profiles, message: loginResult.message, fromCache: false });
    } else if (loginResult && loginResult.success) {
      return sendOk(res, { success: true, profiles: loginResult.profiles || [], selectedProfile: loginResult.selectedProfile, fromCache: false });
    }
    return sendFail(res, 'Failed to retrieve profiles', 500);
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleSetProfile(req, res) {
  try {
    const { profile } = await parseBody(req);
    if (!profile) return sendFail(res, 'Profile name is required');
    const currentEnv = loadEnvFile();
    currentEnv.NPO_PROFILE = profile;
    await saveEnvFile(currentEnv);
    return sendOk(res, { success: true, message: `Profile set to: ${profile}` });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

