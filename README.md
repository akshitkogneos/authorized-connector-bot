# Authorized Connectors Bot

A Playwright bot that opens Gemini Enterprise in a clean **incognito** session,
signs in, and then runs two phases:

1. **Connectors** — authorizes every connector in the composer's *Sources* menu,
   clicking through the full Google OAuth consent flow for each one.
2. **Skills** — opens the skills marketplace and installs every available skill.

## What it automates

### Phase 1 — connectors

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

### Phase 2 — skills

| # | Step |
|---|------|
| 11 | Clicks **Skills** in the left nav |
| 12 | Opens the marketplace — **Browse Skills** when no skill is installed yet, otherwise the **+** at the top of the Skills panel |
| 13 | Clicks **+ Install** on every card, one at a time, until none are left |

Both phases are resumable: anything already authorized or installed is simply
not offered again, so re-running is harmless.

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

`npm start` picks the mode for you:

| Situation | What runs |
|-----------|-----------|
| `data/users.csv` exists with at least one usable row | **Batch mode** — every account in the CSV |
| No CSV, or every row filtered out | **Single user** — `LOGIN_EMAIL` / `LOGIN_PASSWORD` from `.env` |

To ignore the CSV and force the `.env` account:

```bash
npm start -- --single
```

Run just one phase:

```bash
npm start -- --connectors-only
npm start -- --skills-only
```

Useful during the first run — keeps the browser open at the end (or on failure)
so you can inspect what the page actually looked like:

```bash
npm start -- --keep-open      # single-user mode only
```

Screenshots of every major step land in `runs/<timestamp>/`.

## Batch mode — many accounts from a CSV

```bash
npm run batch
```

This is the explicit form of what `npm start` already does whenever
`data/users.csv` has at least one usable row. Override the file with
`USERS_CSV` or `--csv=path`; every account is run one after another.

```csv
First Name,Last Name,Email,Password,Status
Ada,Lovelace,ada@example.com,pw1,Active
Alan,Turing,alan@example.com,pw2,Suspended
```

- Only **Email** and **Password** are required; the header is matched
  case-insensitively.
- Rows whose **Status** is not `Active` are skipped — pass `--all` to include
  them.
- `LOGIN_EMAIL` / `LOGIN_PASSWORD` from `.env` are ignored here.

Flags:

```bash
npm run batch -- --csv=data/other.csv   # a different file
npm run batch -- --skills-only          # or --connectors-only
npm run batch -- --all                  # ignore the Status column
```

> [!IMPORTANT]
> Every user gets its **own browser process**, not just a new tab. Google keeps
> the previous account in its chooser otherwise, and the second user would
> silently authorize connectors against the first user's account.

Each run produces:

- `runs/<timestamp>/<n>-<email>/` — screenshots for that user
- `runs/<timestamp>/report.csv` — one row per user with counts and errors
- a summary table on stdout:

```
USER                    STATUS   CONN  SKILLS TIME
ada@example.com         ok       3     5      88s
alan@example.com        failed   0     0      11s
  Sign-in failed for alan@example.com: Wrong password
grace@example.com       ok       3     5      84s
2/3 user(s) completed without errors
```

One user's failure never stops the rest, and the exit code is non-zero if any
user failed — handy for CI or a cron job.

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

> [!NOTE]
> The mock only covers phase 1, but it does support multiple accounts, so it
> can also exercise `npm run batch -- --csv=... --connectors-only`. Run the
> skills phase against the real app with `npm start -- --skills-only`.

The CSV layer has its own test — no browser, no network:

```bash
npm run test:csv
```

It covers CRLF endings, a missing trailing newline, a UTF-8 BOM, quoted fields,
passwords containing `$` or `!`, the `Status` filter, and a `writeCsv`
round-trip, then validates your real `data/users.csv`.

## Configuration

All settings live in `.env` — see [.env.example](./.env.example) for the full,
commented list. The ones you are most likely to touch:

| Variable | Default | Purpose |
|----------|---------|---------|
| `TARGET_URL` | — | Page to open |
| `LOGIN_EMAIL` / `LOGIN_PASSWORD` | — | Credentials typed at sign-in |
| `SKIP_CONNECTORS` | `Enable all connectors,Google Search` | Rows the bot must never touch (substring match) |
| `MAX_CONNECTORS` | `3` | Safety cap per run |
| `MAX_SKILLS` | `10` | Safety cap on skill installs per run |
| `DO_CONNECTORS` / `DO_SKILLS` | `true` | Enable/disable a phase without CLI flags |
| `BROWSER_CHANNEL` | `chrome` | `chrome` = real Chrome, empty = bundled Chromium |
| `USE_INCOGNITO_WINDOW` | `true` | Launch Chrome with `--incognito` |
| `SLOW_MO` | `120` | Delay (ms) between actions |
| `MANUAL_STEP_TIMEOUT` | `180000` | Pause for you to finish 2FA by hand |
| `USERS_CSV` | `data/users.csv` | Accounts for batch mode |
| `BATCH_DELAY` | `5000` | Pause (ms) between users in a batch run |

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

And on the Skills page:

- **Left nav entries are links**, not buttons — `getByRole('link', 'Skills')`.
- **Install buttons are `<ucs-luminous-button>`** wrapping a
  `button.luminous-button` whose text reads `add_2 Install` — `add_2` is the
  Material icon *ligature* leaking into `textContent`, so it is stripped before
  comparing.
- **Each card itself has `role="button"`.** A naive
  `[role="button"]:has-text("Install")` therefore matches the card too, and
  clicking it opens the skill's detail view instead of installing. The bot only
  matches the luminous-button classes.
- **The marketplace entry point changes with state.** With nothing installed the
  page shows three buttons (middle = *Browse Skills*); once a skill exists that
  row is replaced by the installed-skills list and the only way in is the **+**
  at the top of the Skills panel. The bot tries both and verifies the dialog
  actually opened.

### Re-discovering selectors

If a UI update breaks something, run the inspector instead of guessing:

```bash
node tools/inspect.js           # composer + Sources menu
node tools/inspect.js skills    # Skills page + marketplace dialog
```

It signs in, dumps every shadow-piercing button with its `aria-label` and
position, drills into the relevant menu, and writes everything to
`runs/inspect-<timestamp>.json` plus screenshots.

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
- **Skill progress is measured by how many *Install* buttons remain**, never by
  index or name: the marketplace re-orders itself after every install, so a
  remembered position points at a different card on the next scan.
- **Failures are isolated**: a broken connector closes stray windows and moves
  on, a stubborn skill is skipped after one retry, and a whole failed phase
  still lets the other phase run. The summary lists exactly what failed.

## Project layout

```
src/
  index.js            single-user entry point
  batch.js            multi-user entry point (CSV -> report)
  flow.js             the per-user journey, shared by both entry points
  csv.js              dependency-free CSV read/write
  config.js           .env parsing and validation
  browser.js          incognito launch (Chrome, Chromium fallback)
  utils.js            resilient click / type / scroll helpers
  logger.js           coloured logs + per-user screenshot folders
  steps/
    login.js          email, password, 2FA pause, sign-in verification
    onboarding.js     "I understand" + "Get started"
    connectors.js     the Sources menu loop
    consent.js        account chooser -> scroll -> Allow
    skills.js         Skills nav -> marketplace -> install everything
data/
  users.csv           accounts for batch mode (gitignored - holds passwords)
mock/
  server.js           offline stand-in for the real app (npm run mock)
tools/
  inspect.js          shadow-DOM selector discovery (composer | skills)
  test-csv.js         offline CSV test suite (npm run test:csv)
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `npm start` uses the CSV, not `LOGIN_EMAIL` | That's the default once `data/users.csv` has a usable row. Use `npm start -- --single` for the `.env` account. |
| `npm start` uses `.env`, not the CSV | Every CSV row was filtered out — check the `Email`/`Password` columns and that `Status` is `Active` (or pass `--all`). Run `npm run test:csv` to validate the file. |
| `Could not find "Connectors"` | The app was still loading. Raise `TIMEOUT`, or check `runs/<timestamp>/prompt-ready.png` for the real button label. |
| Wrong rows get enabled | Adjust `SKIP_CONNECTORS` to match the exact labels you see in the log line *"connectors awaiting authorization: …"*. |
| `Could not click "Allow"` | The consent screen used a different label — add it to `clickAllow` in [consent.js](./src/steps/consent.js). |
| Chrome won't launch | Set `BROWSER_CHANNEL=` (empty) and run `npx playwright install chromium`. |
| Sign-in blocked | Run once with `--keep-open`, log in manually to clear the security prompt, then re-run. |
