/**
 * PM cost authority (zero additional spend), source-only policy.
 * Provider response / browser toggle / old quota screenshot MUST NOT authorize
 * a chargeable cloud run. No payment credentials, OAuth tokens, or API calls.
 */
export const ZERO_SPEND_RULE = "zhuge.ai-cost.no-new-spend.v1";
const PROVIDERS=new Set(["co","gem"]);
const sha=/^[a-f0-9]{40}$/;
const block=(reason)=>Object.freeze({allowed:false,reason,additionalSpendAllowed:false,autoFailoverAllowed:false});
/**
 * All evidence must originate from a trusted server-side adapter. The envelope
 * is NOT an authentication system; its signer/issuer MUST be checked in the
 * privileged backend and the evidence MUST be bound to this task+checkpoint.
 * Never serialize the original evidence into the public UI or GitHub comments.
 */
export function assessNoAdditionalCost({
  provider,mode,taskId,checkpointSha,now,
  authenticatedServer=false,pmScopeVerified=false,
  evidence=null,automatic=false
}={}){
  if(!PROVIDERS.has(provider)||typeof taskId!=="string"||!/^GH-[1-9][0-9]*$/.test(taskId)||
      !sha.test(checkpointSha||""))return block("INVALID_TASK_OR_PROVIDER");
  if(authenticatedServer!==true||pmScopeVerified!==true)return block("TRUSTED_TASK_AUTHORITY_REQUIRED");
  if(evidence?.policy!==ZERO_SPEND_RULE||evidence.provider!==provider||
      evidence.taskId!==taskId||evidence.checkpointSha!==checkpointSha)
    return block("COST_EVIDENCE_MISSING_OR_MISMATCHED");
  const checked=Date.parse(evidence.verifiedAt||""),current=Date.parse(now||"");
  if(!Number.isFinite(checked)||!Number.isFinite(current)||
      checked>current||current-checked>300000)return block("COST_EVIDENCE_STALE");
  if(evidence.verifiedByTrustedServer!==true||
      evidence.accountScopeVerified!==true||
      evidence.allowNewPaidCharges!==false||
      evidence.payAsYouGoEnabled!==false||
      evidence.usageAllowanceVerified!==true||
      evidence.quotaStatus!=="available")return block("NO_COST_OR_QUOTA_NOT_VERIFIED");
  if(provider==="co"){
    // The existing Codex GitHub @codex workflow is the only previously
    // observed route for this account; usage must be confirmed inside plan.
    if(mode!=="codex_github_existing_plan"||
        evidence.allowanceType!=="chatgpt_plan_included"||
        evidence.channel!=="official_github_codex")
      return block("CO_SUBSCRIPTION_EXECUTION_NOT_VERIFIED");
    return Object.freeze({allowed:true,reason:"CO_EXISTING_PLAN_CHECKED",
      additionalSpendAllowed:false,autoFailoverAllowed:false});
  }
  if(automatic)return block("GEM_UNATTENDED_ZERO_COST_NOT_PROVED");
  // Personal Google login is suitable for interactive CLI, not proof that an
  // ephemeral cloud runner can reuse it or that Google AI Plus increases quota.
  if(mode==="gemini_cli_personal_google_login")
    return block("GEM_PERSONAL_LOGIN_NOT_A_CLOUD_RUNNER");
  // Official Gemini GitHub Action requires an explicit API or workload
  // identity pathway; no new keys, Vertex project, billing or secrets are
  // authorized for this product's current zero-new-spend phase.
  return block("GEM_HEADLESS_AUTH_AND_BILLING_NOT_APPROVED");
}

export function buildZeroCostStatus({co,gem}={}){
  const providerStatus=x=>({ready:x?.allowed===true,reason:x?.reason||"NOT_VERIFIED"});
  return Object.freeze({policy:ZERO_SPEND_RULE,
    additionalSpendAllowed:false,automaticFailoverEnabled:false,
    co:providerStatus(co),gem:providerStatus(gem)});
}
