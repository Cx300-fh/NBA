# Community predictions

Signed-in visitors' predictions are grouped in `YYYY-MM.json` files, one per month for all accounts. GitHub Actions refreshes these archives every six hours using GitHub OIDC. No visitor or administrator personal access token is needed.

`participantId` is an anonymous account identifier. Usernames, passwords, password hashes, sessions and observation notes are never exported. The database is the authoritative store; the archive may lag behind a recent save. Existing owner predictions in `../YYYY-MM.json` remain unchanged.
