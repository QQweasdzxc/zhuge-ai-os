import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINEER, evaluateAIExecution, type AIExecutionInput } from "./taskflow-ai-engineering-policy";
const ready: AIExecutionInput = {
  projectEnabled:true,cardEnabled:true,engineer:"co",pmApproved:true,
  nativeMemberAuthorized:true,correctWorkspace:true,nativeRunApiReady:true,
  backendServiceIdentityReady:true,providerVerified:true,providerQuota:"available",
  branchHeadVerified:true,exactSha:"a".repeat(40),writerStopped:true,
  durableClaimCommitted:true,
};
describe("TF AI execution fail-closed policy",()=>{
  it("defaults to Co and no running assertion",()=>{
    expect(DEFAULT_ENGINEER).toBe("co");
    const r=evaluateAIExecution(ready);
    expect(r.state).toBe("DISPATCH_PENDING");
    expect(r.reason).toContain("no_execution_performed");
  });
  it("requires both project and card opt-in",()=>{
    expect(evaluateAIExecution({...ready,projectEnabled:false}).state).toBe("NOT_ENABLED");
    expect(evaluateAIExecution({...ready,cardEnabled:false}).state).toBe("NOT_ENABLED");
  });
  it("does not treat selecting Gem as provider dispatch",()=>{
    expect(evaluateAIExecution({...ready,engineer:"gem",pmApproved:false}).state).toBe("NEEDS_PM_APPROVAL");
  });
  it("rejects identity, authorization, workspace, and native API gaps",()=>{
    for(const key of ["nativeMemberAuthorized","correctWorkspace","nativeRunApiReady","backendServiceIdentityReady","providerVerified"] as const){
      expect(evaluateAIExecution({...ready,[key]:false}).state).toBe("BLOCKED");
    }
  });
  it("unknown/exhausted quota never counts as available",()=>{
    expect(evaluateAIExecution({...ready,providerQuota:"unknown"}).state).toBe("BLOCKED");
    expect(evaluateAIExecution({...ready,providerQuota:"exhausted"}).state).toBe("BLOCKED");
  });
  it("rejects stale SHA, unconfirmed head, competing writer, and missing CAS",()=>{
    for(const patch of [
      {exactSha:null},{exactSha:"bad"},{branchHeadVerified:false},
      {writerStopped:false},{durableClaimCommitted:false}
    ]) expect(evaluateAIExecution({...ready,...patch}).state).toBe("BLOCKED");
  });
});
