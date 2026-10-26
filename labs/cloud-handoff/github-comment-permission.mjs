/**
 * Server-side GitHub App permission gate for posting an authorized @codex
 * PR comment. A connected/read-only TaskFlow GitHub App is NOT a dispatch
 * writer. This module never requests permissions, posts to GitHub, or calls
 * a provider. Evidence must come from authenticated GitHub App installation
 * and repository membership reads by the backend, not the browser or webhook.
 */
const REPO=/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const MAX_EVIDENCE_AGE_MS=5*60*1000;
export function assessGitHubCodexCommentPermission({
  repository,expectedAppId,evidence,now=Date.now()
}={}){
  const blocked=reason=>({allowed:false,reason});
  if(!REPO.test(repository||"")||!Number.isSafeInteger(expectedAppId)||expectedAppId<=0)
    return blocked("INVALID_GITHUB_SCOPE");
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))
    return blocked("VERIFIED_INSTALLATION_EVIDENCE_MISSING");
  if(evidence.source!=="authenticated_github_app_api"||
    evidence.app_id!==expectedAppId||
    !Number.isSafeInteger(evidence.installation_id)||evidence.installation_id<=0)
    return blocked("GITHUB_APP_INSTALLATION_IDENTITY_UNVERIFIED");
  if(evidence.repository_full_name!==repository ||
    evidence.repository_access_confirmed!==true ||
    !["selected","all"].includes(evidence.repository_selection))
    return blocked("GITHUB_REPOSITORY_SCOPE_UNVERIFIED");
  const obtained=Date.parse(evidence.verified_at);
  if(!Number.isFinite(obtained)||!Number.isFinite(now)||
    obtained>now+30000||obtained<now-MAX_EVIDENCE_AGE_MS)
    return blocked("GITHUB_PERMISSION_EVIDENCE_STALE");
  // GitHub REST POST /repos/{owner}/{repo}/issues/{pr}/comments
  // requires EITHER Issues:write OR Pull requests:write.
  const p=evidence.permissions;
  if(!p||typeof p!=="object"||Array.isArray(p)||
    (p.issues!=="write"&&p.pull_requests!=="write"))
    return blocked("GITHUB_PR_COMMENT_WRITE_PERMISSION_MISSING");
  return {allowed:true,reason:"GITHUB_PR_COMMENT_WRITE_VERIFIED"};
}
