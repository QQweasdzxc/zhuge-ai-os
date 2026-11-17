# Private family question preview

Generic loader under learning/question-preview. The HTML question payload stays in owner-only Google Drive. The source file ID is supplied privately through a URL fragment and retained in sessionStorage only for the same-tab OAuth return. No public source, workflow, test, or artifact contains the private question text, answer data, image, or file ID.

Uses existing TRQN Google sign-in, same existing scopes. Verifies Supabase user and Drive about-user match before private media read. Requests omit cookies and disable cache. No write or share call. 401 prompts existing login; 403/404 does not change Drive sharing. The preview runs in an allow-scripts-only iframe with opaque origin and CSP blocking network, forms, base URL changes and external resources. Auth/account changes and page exit clear srcdoc. No learning progress, grades, coins or redemption writes.

Local Chromium 390/1280 real private-payload render and answer-feedback verified. Ten branch checks pass: success, expired provider, forbidden file, mismatched account and logout for both widths. Existing all-P0 CI and real published-account verification remain required before delivery. Source answer correctness is not newly checked by this presentation preview.
