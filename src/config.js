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

  // Verification (read-only audit that runs after the work phases)
  doVerify: bool(process.env.DO_VERIFY, true),
  // Optional allow-lists: names that MUST end up enabled/installed. Empty means
  // "whatever the UI offers" - i.e. no row may be left un-enabled/un-installed.
  expectConnectors: list(process.env.EXPECT_CONNECTORS, ''),
  expectSkills: list(process.env.EXPECT_SKILLS, ''),

  // Batch mode (npm run batch)
  usersCsv: process.env.USERS_CSV || 'data/users.csv',
  batchDelay: int(process.env.BATCH_DELAY, 5_000),
};

/**
 * Turns CLI flags into the phase map used by runUserFlow().
 *
 * Rules:
 *   --verify-only        audit only, change nothing
 *   --connectors-only    connectors (+ verification of connectors)
 *   --skills-only        skills (+ verification of skills)
 *   --verify             force verification on even if DO_VERIFY=false
 *
 * Shared by src/index.js and src/batch.js so both modes behave identically.
 */
export function resolvePhases(args = []) {
  const has = (name) => args.includes(`--${name}`);

  if (has('verify-only')) return { connectors: false, skills: false, verify: true };

  const onlySkills = has('skills-only');
  const onlyConnectors = has('connectors-only');

  return {
    connectors: onlySkills ? false : onlyConnectors || config.doConnectors,
    skills: onlyConnectors ? false : onlySkills || config.doSkills,
    verify: has('verify') || config.doVerify,
  };
}

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
