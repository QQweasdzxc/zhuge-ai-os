import test from "node:test";
import assert from "node:assert/strict";
import {assessNoAdditionalCost,buildZeroCostStatus,ZERO_SPEND_RULE}
  from "../labs/cloud-handoff/provider-cost-policy.mjs";
const SHA="a".repeat(40);
const at="2026-10-16T00:42:00Z";
function evidence(extra={}){
  return {policy:ZERO_SPEND_RULE,provider:"co",taskId:"GH-51",checkpointSha:SHA,
    verifiedAt:"2026-10-16T00:40:00Z",verifiedByTrustedServer:true,
    accountScopeVerified:true,allowNewPaidCharges:false,payAsYouGoEnabled:false,
    usageAllowanceVerified:true,quotaStatus:"available",
    allowanceType:"chatgpt_plan_included",channel:"official_github_codex",...extra};
}
function args(overrides={}){
  return {provider:"co",mode:"codex_github_existing_plan",
    taskId:"GH-51",checkpointSha:SHA,now:at,authenticatedServer:true,
    pmScopeVerified:true,evidence:evidence(),...overrides};
}
test("Co may proceed only with trustworthy same-task plan allowance, but never auto-failover",()=>{
  const r=assessNoAdditionalCost(args());
  assert.deepEqual(r,{allowed:true,reason:"CO_EXISTING_PLAN_CHECKED",
    additionalSpendAllowed:false,autoFailoverAllowed:false});
});
test("no authenticated backend or no exact PM task authority: FAIL CLOSED",()=>{
  assert.equal(assessNoAdditionalCost(args({authenticatedServer:false})).allowed,false);
  assert.equal(assessNoAdditionalCost(args({pmScopeVerified:false})).allowed,false);
  assert.equal(assessNoAdditionalCost(args({taskId:"GH-52"})).reason,
    "COST_EVIDENCE_MISSING_OR_MISMATCHED");
  assert.equal(assessNoAdditionalCost(args({checkpointSha:"b".repeat(40)})).allowed,false);
});
test("block unknown quota, pay-as-you-go, stale proof, and misleading provider receipts",()=>{
  for(const variant of [
    {quotaStatus:"unknown"},{quotaStatus:"exhausted"},
    {usageAllowanceVerified:false},{allowNewPaidCharges:true},
    {payAsYouGoEnabled:true},{verifiedByTrustedServer:false},
    {accountScopeVerified:false},{allowanceType:"pay_as_you_go"},
    {channel:"unverified_api"},{verifiedAt:"2026-10-15T00:00:00Z"},
    {verifiedAt:"2026-10-16T01:00:00Z"}
  ]){
    const result=assessNoAdditionalCost(args({evidence:evidence(variant)}));
    assert.equal(result.allowed,false,JSON.stringify(variant));
  }
  assert.equal(assessNoAdditionalCost(args({evidence:null})).allowed,false);
  assert.equal(assessNoAdditionalCost(args({mode:"openai_api_metered"})).allowed,false);
});
test("Gem Google AI Plus/personal CLI login is never proof of headless cloud permission",()=>{
  const gem=evidence({provider:"gem",allowanceType:"gemini_cli_free",
    channel:"personal_google_login"});
  for(const mode of ["gemini_cli_personal_google_login","gemini_github_actions",
    "gemini_cli_api_key_free","vertex_paygo","unknown"]){
    for(const automatic of [false,true]){
      const result=assessNoAdditionalCost(args({provider:"gem",mode,evidence:gem,automatic}));
      assert.equal(result.allowed,false);
      assert.equal(result.additionalSpendAllowed,false);
    }
  }
});
test("backend status exposes only sanitized reason, never token, account or user data",()=>{
  const r=buildZeroCostStatus({
    co:assessNoAdditionalCost(args()),
    gem:assessNoAdditionalCost(args({provider:"gem",mode:"gemini_github_actions",
      evidence:evidence({provider:"gem"})}))
  });
  assert.deepEqual(Object.keys(r),["policy","additionalSpendAllowed","automaticFailoverEnabled","co","gem"]);
  assert.equal(r.co.ready,true);
  assert.equal(r.gem.ready,false);
  assert.equal(r.automaticFailoverEnabled,false);
  assert.equal(JSON.stringify(r).includes("token"),false);
});
