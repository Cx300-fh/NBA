# Account service

The public Pages site uses username/password accounts through `data/account-service.json`. Ordinary visitors never need a GitHub account or personal access token. Browsing remains anonymous; saving predictions requires signing in. Current scope is personal predictions. Observation notebooks and classic replay notes remain device-local and are separated by account ID.

## Runtime and storage

- Account API: `https://courtside-nba-cx300.pastelsong512.chatgpt.site/api/account`
- Server routes: `app/api/account/[...path]/route.ts`
- Schema: `db/schema.ts`; schema-only migrations: `drizzle/`
- Hosted D1 binding: `DB`, declared in `.openai/hosting.json`. Sites provisions the database and applies migrations during deployment.
- Frontend remains on `https://cx300-fh.github.io/NBA/`. Its CORS origin is explicitly allowed. Session authorization uses a random bearer token, so Pages does not depend on third-party cookies.

Only password hashes enter the private database: scrypt N=32768, r=8, p=3, random 16-byte salts. Hashing is serialized within each isolate to bound memory. Sessions use 32 random bytes, only their SHA-256 hashes are stored server-side, and they expire after 30 days. Logout revokes the current session; password changes revoke all previous sessions. Auth endpoints enforce per-IP and per-username rate limits. Registration accepts 3–24 normalized letters, numbers, underscores or hyphens; passwords are 10–128 characters. There is no email collection or email password recovery in this version.

The server determines account ownership from the verified session. Client-supplied user IDs, scores, kickoff times and statuses cannot authorize a prediction. Writes fetch the official NBA schedule and enforce the cutoff with both server and database clocks. Final results settle only against matching official teams and scores.

## GitHub archives

`.github/workflows/archive-account-picks.yml` refreshes all recorded months every six hours and can be run manually. Files are grouped by month for all accounts at `predictions/community/YYYY-MM.json`, using an anonymous participant ID. The database is authoritative, so a new prediction may not appear in GitHub until the next archive run.

The export endpoint verifies a signed GitHub OIDC identity for the exact repository, immutable owner/repository IDs, main branch, audience and archive workflow. This repository uses GitHub’s post-July-2026 immutable subject format; its verified IDs are owner `193564111` and repository `1426730723`. No long-lived GitHub credential is stored in the frontend or account service. Actions uses its built-in repository write permission to commit the archives. The export script explicitly allows prediction fields only; usernames, passwords, hashes, sessions and observation notes are excluded. Original owner files at `predictions/YYYY-MM.json` are preserved and are not assigned to an arbitrary new account.

## Development and deployment

```bash
pnpm db:generate     # only after an intentional schema change
pnpm typecheck
pnpm test
pnpm build
pnpm build:pages
pnpm test:pages
```

Account tests use real SQLite migrations; the runtime integration test also executes registration, login and a private read inside workerd with D1 and the deployed scrypt implementation. Deploy the backend and its migrations before publishing a Pages build that points to it. Keep the existing Sites project ID for this service. If moving to your own Cloudflare account, use a Worker with Node.js compatibility and a D1 `DB` binding, apply the same migrations, and update the API base, exact CORS origin and archive script origin together. Never put a database credential or GitHub token in the static build.

## Existing local notes

Old visitor notes remain under the original browser keys. To transfer them, sign out, export the old notebook, sign in to your account and import the file. This does not upload observation notes to GitHub. Each account's predictions are server-backed; notebooks and replay notes are not cloud-synced.
