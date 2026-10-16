package handler

import "testing"

// Source-level unit tests do not read/write the Production database and do not
// start any Co/Gem run. The router/migration patch has separate drift checks.
func TestZhugeAIApprovalInputGate(t *testing.T) {
 valid:=zhugeAIApproveRequest{
  Engineer:"co",ExpectedRevision:7,GithubPR:55,
  CheckpointSHA:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  IdempotencyKey:"0123456789abcdef0123456789abcdef",
 }
 if why:=validateZhugeAIApprove(valid,7);why!=""{t.Fatalf("valid explicit PM request blocked: %s",why)}
 for _,tc:=range []struct{name string; mutate func(*zhugeAIApproveRequest);rev int64}{
  {"gem_without_runner",func(r *zhugeAIApproveRequest){r.Engineer="gem"},7},
  {"stale_revision",func(r *zhugeAIApproveRequest){r.ExpectedRevision=6},7},
  {"invalid_project_revision",func(r *zhugeAIApproveRequest){},0},
  {"missing_pr",func(r *zhugeAIApproveRequest){r.GithubPR=0},7},
  {"malformed_sha",func(r *zhugeAIApproveRequest){r.CheckpointSHA="head"},7},
  {"nonrandom_nonce",func(r *zhugeAIApproveRequest){r.IdempotencyKey="test"},7},
 }{
  request:=valid;tc.mutate(&request)
  if why:=validateZhugeAIApprove(request,tc.rev);why==""{
   t.Errorf("%s unexpectedly authorized",tc.name)
  }
 }
}
