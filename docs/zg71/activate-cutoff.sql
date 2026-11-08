-- MAIN ONLY, after re-running the live aggregate count. NOT part of the migration; NOT executed.
-- Freezes everyone who is effectively allowed right now (no one loses current access),
-- then sets the server-clock cutoff atomically. Returns counts only: no list, no cards.
-- Argument = the live count of currently effectively-allowed people you just verified (drift guard).
-- Identities that first appear after the cutoff are not frozen and start pending/Off; explicit Off wins.
select private.activate_app_access_model(6);
-- Concurrency: the function locks the decision-event and settings tables until commit, takes the cutoff after the locks, reads the allowed set once, and aborts the whole transaction on a count mismatch.
