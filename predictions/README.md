# Monthly picks

Each `YYYY-MM.json` contains all personal win/loss predictions for games starting in that Beijing calendar month. Saving another pick updates the same file; it does not create a file per game. GitHub commit history records revisions.

- `pickedTeamId`: the selected winning team; no spreads, totals, stakes or payments.
- `createdAt` / `updatedAt`: original choice and last change, before scheduled tipoff.
- `result`: final score and winner, added by the existing six-hour NBA refresh job. The site can also derive a result immediately from a matching final scoreboard.
- Empty months are created on their first save. The initial empty file contains no example or invented picks.

The Pages app reads the latest file directly from GitHub `main`, so saving picks does not require rebuilding the website. Prediction-only commits are excluded from site build triggers.

This is the repository owner's shared personal log. Everyone can read this public repository; writing from the site requires the owner's fine-grained GitHub token with access to only `NBA` and `Contents: Read and write`. The site keeps the token only in page memory, never in repository files, browser storage, URLs or exported notes. Refreshing closes the connection. Browser timing checks support personal tracking; this is not a tamper-proof contest platform.

Connection instructions: [GitHub Pages](../docs/GITHUB_PAGES.md#竞猜连接-github).
