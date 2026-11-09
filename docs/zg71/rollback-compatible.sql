-- MAIN ONLY: safe application rollback after any explicit new access decisions.
-- Freeze administrative decision writers, retain readers + legacy guard so Off cannot be bypassed.
-- No event deletion, no reset of pause/cutoff, no loss of decision history.
begin;
revoke execute on function public.set_app_access_user_enabled(uuid,boolean,text,text) from authenticated;
commit;
-- Redeploy prior Edge source only AFTER confirming it retains an App-access gate.
-- Never remove fail-closed enforcement while there are active Off decisions.
-- Exact legacy rollback is a separate guarded script and MUST refuse such data.
-- Keep ensure_app_member callable: the current gate requires its self-only,
-- idempotent membership record. Revoking it would block even approved users.
