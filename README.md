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
- Statistics: `GET /stats?tenantId=` with the AddonService's service token.
- Data: SQLite (`node:sqlite`) in `DATA_FILE` (default `/data/tools.db`), one row per client and
  tool for the release and for the answers.
- UI: `ui/entry.js`, no build step; React comes from the web app
  (`globalThis.__ORISO_ADDON_SHARED__`), the questions from `src/questions.mjs`.

## Not yet

- Notifying the client when a counsellor releases the tool (needs a notification host API).
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
