/**
 * Codex Cloud official GitHub-comment ACK correlation (read-only).
 *
 * Only the GitHub API may authenticate source metadata. A PR comment posted
 * successfully (201) is NOT a Codex task. A bot response is only a
 * provider-reported ACK, NOT permission to mark native TaskFlow RUNNING.
 *
 * The random 128-bit dispatch ID MUST be persisted in the existing durable
 * single-writer CAS claim before the triggering @codex POST. No retries or
 * provider launches happen here. HTTP failures fail closed.
 */
import { validateHandoff } from "./contract.mjs";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{40}$/;
const DISPATCH_ID=/^[a-f0-9]{32}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BOT="chatgpt-codex-connector[bot]";
const MARKER="<!-- ZHUGE_CODEX_ACK_V1 ";
const MAX_COMMENT_BODY=16384;
function must(value,reason){if(!value)throw Error("codex ack: "+reason);}
const validDate=value=>typeof value==="string"&&Number.isFinite(Date.parse(value));
function safeDate(value){return validDate(value)?Date.parse(value):NaN;}

export function parseCodexAck(body){
  if(typeof body!=="string"||body.length>MAX_COMMENT_BODY)return null;
  const line=body.split(/\r?\n/,1)[0];
  if(!line.startsWith(MARKER)||!line.endsWith(" -->"))return null;
  const raw=line.slice(MARKER.length,-4);
  if(raw.length<30||raw.length>700)return null;
  let ack;
  try{ack=JSON.parse(raw);}catch{return null;}
  if(!ack||typeof ack!=="object"||Array.isArray(ack))return null;
  const names=Object.keys(ack).sort();
  if(names.join(",")!=="checkpoint_sha,dispatch_id,status,thread_id")return null;
  if(!DISPATCH_ID.test(ack.dispatch_id)||!SHA.test(ack.checkpoint_sha))return null;
  if(ack.status!=="accepted"&&ack.status!=="blocked")return null;
  if(ack.status==="accepted"&&!UUID.test(ack.thread_id||""))return null;
  if(ack.status==="blocked"&&ack.thread_id!==null)return null;
  return Object.freeze({...ack});
}

export function assessCodexAck({
  claim,requestComment,candidateComments,repository,prNumber,
  expectedRequestCommentId,now
}){
  const record=validateHandoff(claim);
  must(record.phase==="CLAIMED"&&record.owner==="co","Co must hold the durable writer claim");
  must(DISPATCH_ID.test(record.dispatch?.id)&&record.dispatch.claimed_revision===record.revision,
    "claim has no persisted dispatch identity");
  must(REPO.test(repository||"")&&record.repo===repository,"repository mismatch");
  must(Number.isInteger(prNumber)&&prNumber>0,"valid PR number required");
  must(Number.isInteger(expectedRequestCommentId)&&expectedRequestCommentId>0,
    "verified GitHub comment receipt required");
  must(validDate(now),"reconciliation timestamp required");
  const url="https://github.com/"+repository+"/pull/"+prNumber+"#issuecomment-";
  const issueApi="https://api.github.com/repos/"+repository+"/issues/"+prNumber;
  const id=record.dispatch.id,sha=record.source.head_sha;
  const req=requestComment;
  must(req&&req.id===expectedRequestCommentId &&
    req.issue_url===issueApi&&req.html_url===url+expectedRequestCommentId,
    "request receipt does not belong to selected PR");
  must(validDate(req.created_at)&&safeDate(req.created_at)<=safeDate(now),
    "request creation timestamp invalid");
  must(req.user?.login!==BOT,"request must not impersonate the provider");
  const body=req.body;
  must(typeof body==="string"&&body.length<=MAX_COMMENT_BODY &&
    body.startsWith("@codex ") &&
    body.includes("\nDispatch ID: "+id+".\n") &&
    body.includes("\nCheckpoint SHA: "+sha+".\n") &&
    body.includes("Draft PR #"+prNumber+"."),
    "original GitHub request does not match durable claim");
  must(Array.isArray(candidateComments)&&candidateComments.length<=500,
    "bounded authenticated comment page required");

  let matches=[],conflicts=0;
  for(const comment of candidateComments){
    // GitHub authenticates actor, issue and immutable comment ID; never
    // trust sender or timestamps from a webhook body without an API read.
    if(comment?.user?.login!==BOT||comment?.user?.type!=="Bot")continue;
    if(comment.issue_url!==issueApi||comment.html_url!==url+comment.id)continue;
    if(!Number.isInteger(comment.id)||comment.id<=req.id)continue;
    if(!validDate(comment.created_at)||
      safeDate(comment.created_at)<safeDate(req.created_at)||
      safeDate(comment.created_at)>safeDate(now))continue;
    const ack=parseCodexAck(comment.body);
    if(ack?.dispatch_id!==id)continue;
    if(ack.checkpoint_sha!==sha){conflicts++;continue;}
    matches.push({ack,commentId:comment.id,url:comment.html_url});
  }
  if(conflicts>0||matches.length>1){
    return {state:"ACK_CONFLICT_REQUIRES_REVIEW",reason:"multiple_or_mismatched_official_ack",
      dispatchId:id};
  }
  if(matches.length===0){
    return {state:"PENDING_PROVIDER_ACK",reason:"no_exact_official_ack",dispatchId:id};
  }
  const match=matches[0];
  return {
    // Provider reporting is evidence only; native TF RUNNING needs separate
    // atomic persistence plus verified authorization and provider status.
    state:match.ack.status==="accepted"?"PROVIDER_ACK_OBSERVED":"PROVIDER_BLOCKED_OBSERVED",
    dispatchId:id,requestedSha:sha,reportedThreadId:match.ack.thread_id,
    requestCommentId:req.id,ackCommentId:match.commentId,ackUrl:match.url,
    requiresTaskflowRunVerification:true
  };
}

/**
 * Authenticated GitHub API read adapter. Neither creates a comment nor
 * modifies GitHub, TF Issue, Run, CAS, or the original code branch.
 */
export function createCodexAckReader({
  repository,prNumber,token,fetcher=fetch,apiBase="https://api.github.com"
}){
  must(REPO.test(repository||""),"invalid repository");
  must(Number.isInteger(prNumber)&&prNumber>0,"invalid PR");
  must(typeof token==="string"&&token.length>=12,"server-only GitHub read token required");
  const api=new URL(apiBase);
  must(api.protocol==="https:"&&!api.username&&!api.password&&
    !api.search&&!api.hash&&api.pathname==="/","official HTTPS GitHub API root required");
  const root=api.origin+"/repos/"+repository;
  const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28"};
  const read=async path=>{
    const res=await fetcher(root+path,{method:"GET",headers,redirect:"error",
      signal:AbortSignal.timeout(15000)});
    must(res.status===200,"authenticated GitHub read unavailable (HTTP "+res.status+")");
    const raw=await res.text();
    must(raw.length<=512000,"GitHub response exceeds safe size");
    let j;try{j=JSON.parse(raw);}catch{throw Error("codex ack: invalid GitHub response");}
    return j;
  };
  return Object.freeze({
    async reconcile({claim,requestCommentId,now}){
      const req=await read("/issues/comments/"+requestCommentId);
      const comments=[];
      // GitHub comment pages are sorted oldest-first for this endpoint.
      // Never accept incomplete pagination as exhaustive ACK evidence.
      let complete=false;
      for(let page=1;page<=5;page++){
        const batch=await read("/issues/"+prNumber+"/comments?per_page=100&page="+page);
        must(Array.isArray(batch)&&batch.length<=100,"GitHub comment page invalid");
        comments.push(...batch);
        if(batch.length<100){complete=true;break;}
      }
      if(!complete){
        return {state:"ACK_CONFLICT_REQUIRES_REVIEW",reason:"unbounded_comment_history"};
      }
      const ack=assessCodexAck({
        claim,requestComment:req,candidateComments:comments,repository,prNumber,
        expectedRequestCommentId:requestCommentId,now
      });
      if(ack.state!=="PROVIDER_ACK_OBSERVED"&&ack.state!=="PROVIDER_BLOCKED_OBSERVED")return ack;
      const pr=await read("/pulls/"+prNumber);
      must(pr.number===prNumber&&pr.state==="open","PR identity/state unverified");
      if(pr.head?.sha!==claim.source.head_sha){
        return {state:"ACK_CONFLICT_REQUIRES_REVIEW",reason:"review_branch_changed",
          dispatchId:claim.dispatch.id,reportedThreadId:ack.reportedThreadId};
      }
      return ack;
    }
  });
}
