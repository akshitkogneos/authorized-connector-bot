import 'dotenv/config';

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const list = (value, fallback) =>
  (value === undefined || value === '' ? fallback : value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  targetUrl: process.env.TARGET_URL || '',
  email: process.env.LOGIN_EMAIL || '',
  password: process.env.LOGIN_PASSWORD || '',

  headless: bool(process.env.HEADLESS, false),
  channel: (process.env.BROWSER_CHANNEL ?? 'chrome').trim(),
  incognitoWindow: bool(process.env.USE_INCOGNITO_WINDOW, true),
  slowMo: int(process.env.SLOW_MO, 120),
  timeout: int(process.env.TIMEOUT, 45_000),

  skipConnectors: list(process.env.SKIP_CONNECTORS, 'Enable all connectors,Google Search'),
  maxConnectors: int(process.env.MAX_CONNECTORS, 3),
  maxSkills: int(process.env.MAX_SKILLS, 10),
  doConnectors: bool(process.env.DO_CONNECTORS, true),
  doSkills: bool(process.env.DO_SKILLS, true),
  selectAllScopes: bool(process.env.SELECT_ALL_SCOPES, true),
  manualStepTimeout: int(process.env.MANUAL_STEP_TIMEOUT, 180_000),
  screenshots: bool(process.env.SCREENSHOTS, true),
};

export function assertConfig() {
  const missing = [];
  if (!config.targetUrl) missing.push('TARGET_URL');
  if (!config.email) missing.push('LOGIN_EMAIL');
  if (!config.password) missing.push('LOGIN_PASSWORD');

  if (missing.length) {
    throw new Error(
      `Missing required settings: ${missing.join(', ')}.\n` +
        'Create a .env file (copy .env.example) and fill those values in.',
    );
  }
}
