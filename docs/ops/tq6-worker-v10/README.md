# WorkLog worker v10 diagnostic source

Production Supabase project lenpbbhwxyyfwgvjcozf, function worklog-google-sync, version 10, ACTIVE, verify_jwt=false retained. Deployed 2026-11-11 22:50 Asia/Taipei.

This worker-only source branch is based on 011b73f63826f8b480630ebdcec6763b63a6ed5a. It is not a Web deployment candidate. Production Web remains 4b6abf45125df92bfdedf2ed7a8c834206fadedc; API remains 044172fab110118d759aafc8bdd86903c457e49b. No Web/API pins or automatic deployment were changed.

Only runtime.mjs, sync-endpoint.mjs and sync-endpoint.test.mjs change. Diagnostics allow only fixed phase/code/status values. No tokens, request bodies, account identifiers or upstream messages are logged. Authorization and persistence checks are unchanged. 71 baseline WorkLog tests pass.

index.ts is the exact uploaded bundled source, SHA256 340de060bd8af984cf10971335e38c8e5128bd0a2063dd4a344b956d74775ce7. Supabase returned ezbr_sha256 2a48ce5ea7556723c75195d9d39ef9b8d867fd12a5fa1770491d2a237e7b9cb3. Those are distinct source and platform-bundle hashes.

The source bundle's comments reflect its isolated build directory. Rebuilding from repo root with esbuild 0.28.2 has equivalent code with different source-path comments. Original input source and exact upload are both retained here. No credentials are in this record.

This adds diagnosis only. It does not establish that the iPhone Calendar connection failure is fixed, that Calendar consent succeeded, or that two-way sync passed acceptance. At 22:50 owner status remained disconnected, metadata connection count zero. Await one intentional user retry for a bounded failure-stage log.
