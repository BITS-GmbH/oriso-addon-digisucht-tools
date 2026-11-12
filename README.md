# DigiSucht tools add-on

The digital counselling tools of DigiSucht as an ORISO add-on (contract `oriso-addon/v1`,
ADR-031 draft). Runs behind the [AddonService](https://github.com/BITS-GmbH/ORISO-AddonService).

First tool: **Ausgangssituation und Ziele** (tool a of delphi's specification): five open
questions the client answers in their own words and can change at any time.

| Who | Where (slot) | What |
|---|---|---|
| Client | own page (`asker.navigation`) | Answers the questions once a counsellor released the tool; chooses whether the counsellor may read them |
| Counsellor | case view (`consultant.session`), client profile (`consultant.asker-profile`) | Releases the tool for the client; sees the status and, if shared, the answers |
| Admin | ORISO-Admin | Settings per Träger or agency: intro text, whether sharing is possible; statistics: released, started, shared |

The question texts are placeholders until delphi provides the wording of the current
DigiSucht tool (`src/questions.mjs`, formal and informal).

## How it works

- The AddonService forwards `/service/addons/digisucht-tools/api/**` to `/api/**` with its own
  short-lived token; the add-on verifies it against the AddonService JWKS (`src/auth.mjs`).
  Clients are identified by `sub`; counsellors only get a client when the web app sent the
  session and the AddonService verified access (`askerId` claim).
- Settings come from the AddonService host API (`/addons/host/settings`) with the same token.
- Host capabilities (contract `docs/contract-v1-notifications-audit-calendar.md` in the AddonService,
  texts in `src/messages.mjs`), called with the incoming token and a 2 s timeout; a failing call
  is logged and never fails the user's action:
  - Release by a counsellor (first time only): audit entry `tool.released` (subject `asker`) and
    an important notification to the client (`recipient: "asker"`, app `goals`, slot
    `asker.navigation`), formal unless the token (`informal: true` or `formalLanguage: false`)
    or the settings (`informal: true`) ask for informal address.
  - Client shares the answers (when switching from not shared to shared): audit entry
    `answers.shared` (subject `self`). The counsellor is not notified, v1 only addresses `self`
    and `asker`.
  - Calendar (`GET /calendar?from=&to=`, manifest `calendar`): for a client with a released tool
    that is neither shared nor fully answered, one all-day `reminder` "Ausgangssituation und Ziele
    ausfüllen" due seven days after the release, linking to `asker.navigation`; filtered to
    `from <= start < to`. Counsellors get no entries.
- Visibility: the app `goals` is `"visibility": "dynamic"`, so the AddonService asks
  `GET /visibility` (user token) before listing it. A client sees it only once it is released,
  with `badge: 1` until their first `GET /api/goals` (stored as `opened_at` of the release);
  counsellors always see it, without a badge. The release notification makes the AddonService
  drop its cached answer, so the tool appears for the client right away.
- Statistics: `GET /stats?tenantId=` with the AddonService's service token.
- Data: SQLite (`node:sqlite`) in `DATA_FILE` (default `/data/tools.db`), one row per client and
  tool for the release and for the answers. Columns added later (`releases.opened_at`) are added on
  start.
- UI: `ui/entry.js`, no build step; React comes from the web app
  (`globalThis.__ORISO_ADDON_SHARED__`), the questions from `src/questions.mjs`.

## Not yet

- Deleting a client's data when the account is deleted (needs ORISO deletion events).
- PDF export and the central data export.

## Development

```sh
npm test          # Node 24
```

| Variable | Default | |
|---|---|---|
| `ADDONSERVICE_URL` | `http://addonservice:8090` | JWKS and host API |
| `DATA_FILE` | `/data/tools.db` | |
| `PORT` | `8080` | |

Images: `harbor.mybits.dev/digisucht/addon-digisucht-tools:<version>-<sha>`.
