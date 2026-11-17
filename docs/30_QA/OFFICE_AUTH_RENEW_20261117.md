# Office session renewal hotfix

The first flat integration checked /auth/v1/user with the stored access token before running the original renewal flow. A recoverable expired access token therefore showed a false definitive sign-in failure. Existing authenticated original Office renewed that same saved session successfully and read 11 members / 100 tasks.

Renew before private reads, retry one 401 after renewal, preserve identity, sync canonical and root token snapshots, do not overwrite concurrent logout/account changes. Network/5xx/unknown errors retain credentials and show a recoverable error. Terminal refresh failure requests login. No member or task permissions broadened. No private snapshots. Retry button does not edit member/task data.

Tests: expired renewal, 401 retry, single-flight, network, 503, terminal refresh rejection, logout, account switch, JSON-await race, wrong-owner refresh response. Original six readonly branches and Chromium/WebKit 320/390/1280 room/card/logout/return regression pass. Actual live browser verification remains required after deployment. Physical iPhone/PWA and overall owner Map walkthrough remain open. FullSource not PASS.
