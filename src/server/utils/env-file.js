import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function loadEnvFile() {
  const envPath = join(__dirname, '../../../.env');
  const envVars = {};

  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
          const value = valueParts.join('=').trim();
          envVars[key.trim()] = value;
        }
      }
    });
  }

  return envVars;
}

export async function saveEnvFile(envVars) {
  const envPath = join(__dirname, '../../../.env');
  const lines = [];

  for (const [key, value] of Object.entries(envVars)) {
    lines.push(`${key} = ${value}`);
  }

  await writeFile(envPath, lines.join('\n'), 'utf-8');

  // Update process.env with new values
  for (const [key, value] of Object.entries(envVars)) {
    process.env[key] = value;
  }
}

