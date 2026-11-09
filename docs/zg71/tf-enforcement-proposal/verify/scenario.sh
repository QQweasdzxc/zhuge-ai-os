#!/bin/bash
# Resolver, grants and creator-protection assertions against the isolated DB. Env: PGPORT_TF (default 54329), PGHOST_TF (default 127.0.0.1)
H=${PGHOST_TF:-127.0.0.1}; PT=${PGPORT_TF:-54329}
A="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -At"
T="env PGPASSWORD=tfpw psql -h $H -p $PT -U taskflow_runtime -d postgres -At"
id(){ printf '00000000-0000-4000-8000-%012d' "$1"; }
FAIL=0
expect(){ if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2] want [$3]"; FAIL=1; fi; }
dec(){ $T -c "select public.taskflow_app_access_decision('$(id "$1")')"; }
row(){ local o=""; for n in 1 2 3 4 5 6 7 8; do o="$o$(dec $n)"; done; echo "$o"; }
denied(){ $T -c "$1" 2>&1 | head -1 | grep -c "permission denied"; }
expect "taskflow_runtime cannot call is_app_access_approved" "$(denied 'select public.is_app_access_approved()')" 1
expect "taskflow_runtime cannot read private events" "$(denied 'select count(*) from private.app_access_application_events')" 1
expect "taskflow_runtime cannot call private resolver" "$(denied "select private.app_access_effective_allowed('$(id 1)')")" 1
expect "taskflow_runtime cannot read auth.users" "$(denied 'select count(*) from auth.users')" 1
expect "taskflow_runtime cannot call set_app_access_user_enabled" "$(denied "select public.set_app_access_user_enabled('$(id 3)',false,'n','k')")" 1
expect "anon cannot call decision" "$($A -c "set role anon; select public.taskflow_app_access_decision('$(id 1)')" 2>&1 | grep -c 'permission denied')" 1
expect "authenticated cannot call decision" "$($A -c "set role authenticated; select public.taskflow_app_access_decision('$(id 1)')" 2>&1 | grep -c 'permission denied')" 1
expect "pause=true, no cutoff: all allowed" "$(row)" "tttttttt"
expect "activation freezes six" "$($A -c 'select (private.activate_app_access_model(6))->>'"'"'grandfather_count'"'"'')" 6
$A -c "insert into auth.users(id,email) values('$(id 7)','new7@example.invalid')" >/dev/null
$A -c "insert into private.app_access_application_events(applicant_user_id,event_type,email_snapshot,display_name,reason) values('$(id 7)','application_submitted','new7@example.invalid','NEW','x')" >/dev/null
expect "after cutoff: six preserved, pending id7 denied, unknown id8 denied" "$(row)" "ttttttff"
$A -c "select set_config('request.uid','$(id 1)',false); select public.set_app_access_user_enabled('$(id 3)',false,'off','kA')" >/dev/null
expect "explicit Off on id3" "$(row)" "ttfttt""ff"
expect "creator cannot be switched Off" "$($A -c "select set_config('request.uid','$(id 1)',false); select public.set_app_access_user_enabled('$(id 1)',false,'x','kB')" 2>&1 | grep -c 'Cannot disable')" 1
expect "non-creator cannot switch anyone (incl. self) Off" "$($A -c "select set_config('request.uid','$(id 3)',false); select public.set_app_access_user_enabled('$(id 3)',false,'x','kC')" 2>&1 | grep -c 'approval is required')" 1
$A -c "select set_config('request.uid','$(id 1)',false); select public.set_app_access_user_enabled('$(id 3)',true,'on','kD')" >/dev/null
expect "re-enable id3" "$(row)" "ttttttff"
exit $FAIL
