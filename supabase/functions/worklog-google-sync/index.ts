// Source-only candidate. Production activation and cron registration are separate.
import {createWorklogSyncRuntime} from '../../../modules/worklog/native/server/runtime.mjs';
const handler=createWorklogSyncRuntime({env:Deno.env.toObject()});
Deno.serve(handler);
