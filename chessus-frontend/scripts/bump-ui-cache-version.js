const fs = require('fs');
const path = require('path');

const envFilePath = path.resolve(__dirname, '../.env.production.local');
const today = new Date().toISOString().slice(0, 10);

let envContent = '';
if (fs.existsSync(envFilePath)) {
  envContent = fs.readFileSync(envFilePath, 'utf8');
}

const versionMatch = envContent.match(/^REACT_APP_UI_CACHE_VERSION=(.*)$/m);
const currentVersion = versionMatch ? versionMatch[1].trim() : '';

let nextBuildNumber = 1;
const numericTailMatch = currentVersion.match(/(\d+)$/);
if (numericTailMatch) {
  nextBuildNumber = Number(numericTailMatch[1]) + 1;
}

const nextVersion = `${today}-${nextBuildNumber}`;
const nextLine = `REACT_APP_UI_CACHE_VERSION=${nextVersion}`;

if (versionMatch) {
  envContent = envContent.replace(/^REACT_APP_UI_CACHE_VERSION=.*$/m, nextLine);
} else {
  envContent = envContent.trim();
  envContent = envContent ? `${envContent}\n${nextLine}\n` : `${nextLine}\n`;
}

fs.writeFileSync(envFilePath, envContent, 'utf8');
console.log(`[cache-version] ${currentVersion || 'unset'} -> ${nextVersion}`);
