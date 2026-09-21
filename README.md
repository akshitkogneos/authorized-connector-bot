# Authorized Connectors Bot

A Playwright bot that opens your app in a clean **incognito** session, signs in,
clears the onboarding dialogs, and then authorizes every connector in the
prompt's **Connectors** menu — clicking through the full Google OAuth consent
flow for each one.

## What it automates

| # | Step |
|---|------|
| 1 | Opens `TARGET_URL` in an incognito window |
| 2 | Types the email address, then the password |
| 3 | Clicks **I understand** (only shown on the first ever login) |
| 4 | Clicks **Get started** in the welcome popup |
| 5 | Waits for the composer, clicks the connectors icon (3rd from the left, accessible name **Sources**) |
| 6 | Skips *Enable all connectors* and *Google Search* — they have no **Enable actions** button |
| 7 | For each remaining row (Calendar, Drive, Gmail): clicks **Enable actions** |
| 8 | In the popup: picks your account under *Choose an account* |
| 9 | Scrolls all the way down and clicks **Allow** |
| 10 | Re-opens the menu, confirms the row now reads **Disable actions**, moves to the next one |

## Setup

```bash
npm install
npx playwright install chromium   # only needed if you don't use real Chrome
cp .env.example .env              # then fill in TARGET_URL / LOGIN_EMAIL / LOGIN_PASSWORD
```

## Run

```bash
npm start
```

Useful during the first run — keeps the browser open at the end (or on failure)
so you can inspect what the page actually looked like:

```bash
npm start -- --keep-open
```

Screenshots of every major step land in `runs/<timestamp>/`.

## Verify it works (offline self-test)

The repo ships with a mock app that imitates the real flow — sign-in, the two
onboarding dialogs, a 5-row connectors menu, and an OAuth popup whose **Allow**
button only unlocks after you scroll. Use it to sanity-check the bot without
touching the real site:

```bash
npm run mock        # terminal 1 - serves http://localhost:5599
npm run test:mock   # terminal 2 - runs the bot headlessly against it
```

Expected tail of the output:

```
connectors awaiting authorization: "Gmail", "Google Calendar", "Google Drive"
(1/3) Enabling actions for "Gmail"      ... "Gmail" now shows "Disable actions"
(2/3) Enabling actions for "Google Calendar" ...
(3/3) Enabling actions for "Google Drive"    ...
Summary
connectors authorized: 3
```

## Configuration

All settings live in `.env` — see [.env.example](./.env.example) for the full,
commented list. The ones you are most likely to touch:

| Variable | Default | Purpose |
|----------|---------|---------|
| `TARGET_URL` | — | Page to open |
| `LOGIN_EMAIL` / `LOGIN_PASSWORD` | — | Credentials typed at sign-in |
| `SKIP_CONNECTORS` | `Enable all connectors,Google Search` | Rows the bot must never touch (substring match) |
| `MAX_CONNECTORS` | `3` | Safety cap per run |
| `BROWSER_CHANNEL` | `chrome` | `chrome` = real Chrome, empty = bundled Chromium |
| `USE_INCOGNITO_WINDOW` | `true` | Launch Chrome with `--incognito` |
| `SLOW_MO` | `120` | Delay (ms) between actions |
| `MANUAL_STEP_TIMEOUT` | `180000` | Pause for you to finish 2FA by hand |

> [!IMPORTANT]
> Leave `HEADLESS=false`. Google's sign-in and OAuth consent screens routinely
> block headless browsers, and a real window is also what lets you complete a
> 2FA challenge when one appears.

> [!WARNING]
> `.env` holds a plaintext password. It is already in `.gitignore` — never
> commit it. Prefer a dedicated test account over a personal one.

## How the target app is put together

Worth knowing if the UI ever changes, because none of this is guessable from
the rendered page:

- **The entire UI lives in nested shadow roots.** A plain
  `document.querySelectorAll('button')` returns *one* element. Playwright's
  CSS/text engines pierce open shadow roots, so its locators still work — but
  any `page.evaluate` you write must walk `el.shadowRoot` by hand.
- **The composer's three left icons have no visible text.** Their accessible
  names are `Add files`, `Select tools` and `Sources`. **Sources** is the
  connectors menu referred to in the instructions.
- **Rows are Material Web components.** The label sits in the *host's* light
  DOM — `<md-outlined-button>Enable actions</md-outlined-button>` — while the
  inner shadow `<button>` renders only a `<slot>` and has empty text. The bot
  therefore targets the host element, and de-duplicates matches by position.
- **The first two rows have no button at all**, just an `md-switch`. So
  "skip the top two" happens naturally: only rows with an actual
  *Enable actions* button are ever touched.

### Re-discovering selectors

If a UI update breaks something, run the inspector instead of guessing:

```bash
node tools/inspect.js
```

It signs in, dumps every shadow-piercing button with its `aria-label` and
position, clicks the 3rd composer icon, dumps the resulting menu, and writes
everything to `runs/inspect-<timestamp>.json` plus two screenshots.

## How it stays reliable

- **No brittle CSS selectors.** Every element is located by its accessible role
  and visible text, with a ranked list of fallbacks
  ([`firstVisible`](./src/utils.js)).
- **The menu is re-opened for each connector**, because the OAuth popup tears it
  down and because an authorized row disappears from the "Enable actions" list.
- **Deep scrolling** walks every scrollable container, not just the document, so
  the *Allow* button is reachable even when it lives inside a nested pane.
- **Allow is retried** — Google keeps it disabled until the consent text has
  genuinely been scrolled.
- **Popup or same-tab** consent flows are both handled.
- **Failures are isolated**: if one connector breaks, stray windows are closed
  and the bot moves on to the next, then reports which ones failed.

## Project layout

```
src/
  index.js            orchestration + summary
  config.js           .env parsing and validation
  browser.js          incognito launch (Chrome, Chromium fallback)
  utils.js            resilient click / type / scroll helpers
  logger.js           coloured logs + screenshots
  steps/
    login.js          email, password, 2FA pause
    onboarding.js     "I understand" + "Get started"
    connectors.js     the Sources menu loop
    consent.js        account chooser -> scroll -> Allow
mock/
  server.js           offline stand-in for the real app (npm run mock)
tools/
  inspect.js          shadow-DOM selector discovery
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Could not find "Connectors"` | The app was still loading. Raise `TIMEOUT`, or check `runs/<timestamp>/prompt-ready.png` for the real button label. |
| Wrong rows get enabled | Adjust `SKIP_CONNECTORS` to match the exact labels you see in the log line *"connectors awaiting authorization: …"*. |
| `Could not click "Allow"` | The consent screen used a different label — add it to `clickAllow` in [consent.js](./src/steps/consent.js). |
| Chrome won't launch | Set `BROWSER_CHANNEL=` (empty) and run `npx playwright install chromium`. |
| Sign-in blocked | Run once with `--keep-open`, log in manually to clear the security prompt, then re-run. |
