package handler

// Zhuge AI TaskFlow-native approval/readback: the authenticated native issue
// and workspace member remain the ONLY business authorities. No provider calls.
// Approval != Codex ACK != TaskFlow RUNNING. The cloud dispatcher is separately
// gated until verified durable CAS, GitHub SHA and provider identity exist.

import (
 "encoding/json"
 "errors"
 "io"
 "net/http"
 "os"
 "regexp"
 "strings"
 "time"

 "github.com/go-chi/chi/v5"
 "github.com/jackc/pgx/v5"
 "github.com/jackc/pgx/v5/pgconn"
)

const zhugeAIRepo = "QQweasdzxc/zhuge-ai-os"

var zhugeAISHA = regexp.MustCompile(`^[a-f0-9]{40}$`)
var zhugeAIIdempotency = regexp.MustCompile(`^[a-f0-9]{32}$`)

// The server ignores client-supplied user, role, workspace, Run state, cost
// allowance, provider receipt or worker stop claims. Those never appear here.
type zhugeAIApproveRequest struct {
 Engineer string `json:"engineer"`
 ExpectedRevision int64 `json:"expected_issue_revision"`
 GithubPR int32 `json:"github_pr"`
 CheckpointSHA string `json:"checkpoint_sha"`
 IdempotencyKey string `json:"idempotency_key"`
}

type zhugeAIRunListItem struct {
 ID string `json:"id"`
 Engineer string `json:"engineer"`
 State string `json:"state"`
 GithubPR int32 `json:"github_pr"`
 CheckpointSHA string `json:"checkpoint_sha"`
 CreatedAt time.Time `json:"created_at"`
 ProviderThreadID *string `json:"provider_thread_id"`
 EvidenceSHA *string `json:"last_evidence_sha"`
 Revision int64 `json:"revision"`
}

func validateZhugeAIApprove(req zhugeAIApproveRequest, revision int64) string {
 if req.Engineer != "co" {return "only Co approval is available; Gem runner not verified"}
 if revision <= 0 || req.ExpectedRevision != revision {return "stale or invalid native issue revision"}
 if req.GithubPR <= 0 || req.GithubPR > 2147483647 {return "valid GitHub PR required"}
 if !zhugeAISHA.MatchString(req.CheckpointSHA) {return "exact lowercase GitHub SHA required"}
 if !zhugeAIIdempotency.MatchString(req.IdempotencyKey) {return "random 128-bit idempotency key required"}
 return ""
}

// Only an authenticated TaskFlow member can read the official Run history.
// This is not a shadow TaskFlow issue and does not show a fabricated Cloud Run.
func (h *Handler) ZhugeAIListRuns(w http.ResponseWriter, r *http.Request) {
 issue, ok := h.loadIssueForUser(w,r,chi.URLParam(r,"id"))
 if !ok {return}
 rows,err:=h.DB.Query(r.Context(),`
 SELECT id::text,engineer,state,github_pr,checkpoint_sha,created_at,
        provider_thread_id,last_evidence_sha,revision
 FROM taskflow.zhuge_ai_engineering_run
 WHERE workspace_id=$1::uuid AND issue_id=$2::uuid
 ORDER BY created_at DESC,id DESC LIMIT 20
 `,uuidToString(issue.WorkspaceID),uuidToString(issue.ID))
 if err!=nil {writeError(w,http.StatusServiceUnavailable,"AI Run authority not configured");return}
 defer rows.Close()
 items:=make([]zhugeAIRunListItem,0,8)
 for rows.Next(){
  var x zhugeAIRunListItem
  if err:=rows.Scan(&x.ID,&x.Engineer,&x.State,&x.GithubPR,&x.CheckpointSHA,
    &x.CreatedAt,&x.ProviderThreadID,&x.EvidenceSHA,&x.Revision);err!=nil{
     writeError(w,http.StatusServiceUnavailable,"AI Run readback unavailable");return
  }
  items=append(items,x)
 }
 if rows.Err()!=nil {writeError(w,http.StatusServiceUnavailable,"AI Run readback unavailable");return}
 w.Header().Set("Cache-Control","no-store, private")
 writeJSON(w,http.StatusOK,map[string]any{"runs":items,"dispatch_enabled":false,
   "message":"Run evidence is authoritative only after verified provider receipt"})
}

// PM may approve ONE exact Co GitHub checkpoint for ONE native issue. No token,
// GitHub comment, agent task, chargeable provider, or Run launch is created.
// Both PM role and issue revision must be authenticated/verified server-side.
func (h *Handler) ZhugeAIApproveRun(w http.ResponseWriter,r *http.Request) {
 if os.Getenv("ZHUGE_TASKFLOW_AI_APPROVALS_ENABLED")!="true"{
  writeError(w,http.StatusServiceUnavailable,"AI approval authority is not configured")
  return
 }
 issue,ok:=h.loadIssueForUser(w,r,chi.URLParam(r,"id"))
 if !ok{return}
 workspaceID:=uuidToString(issue.WorkspaceID)
 if _,ok=h.requireWorkspaceRole(w,r,workspaceID,"workspace not found","owner","admin");!ok{return}
 if !issue.ProjectID.Valid {writeError(w,http.StatusConflict,"project-linked TaskFlow issue required");return}
 // Fail closed for terminal/blocked/missing and arbitrary custom status keys.
 switch issue.Status {
 case "backlog","todo","in_progress","in_review","unstarted","started":
 default:
  writeError(w,http.StatusConflict,"issue status not eligible for dispatch approval");return
 }
 decoder:=json.NewDecoder(io.LimitReader(r.Body,4097))
 decoder.DisallowUnknownFields()
 var req zhugeAIApproveRequest
 if err:=decoder.Decode(&req);err!=nil{
  writeError(w,http.StatusBadRequest,"invalid AI approval request");return
 }
 var trailing any
 if err:=decoder.Decode(&trailing);!errors.Is(err,io.EOF){
  writeError(w,http.StatusBadRequest,"invalid or oversized AI approval request");return
 }
 if why:=validateZhugeAIApprove(req,issue.Revision);why!=""{
  writeError(w,http.StatusBadRequest,why);return
 }
 // The supplied revision is rechecked INSIDE the SQL statement, closing
 // the gap between the native read and the approval write.
 userID:=requestUserID(r)
 var id string
 err:=h.DB.QueryRow(r.Context(),`
 INSERT INTO taskflow.zhuge_ai_engineering_run
 (workspace_id,issue_id,project_id,requested_by,engineer,issue_revision,
 github_repo,github_pr,checkpoint_sha,idempotency_key,state,approval_expires_at)
 SELECT i.workspace_id,i.id,i.project_id,$4::uuid,'co',i.revision,
 $5,$6,$7,$8,'approved',now()+interval '5 minutes'
 FROM taskflow.issue i
 WHERE i.id=$1::uuid AND i.workspace_id=$2::uuid AND
       i.project_id=$3::uuid AND i.revision=$9::bigint
 ON CONFLICT (workspace_id,issue_id,requested_by,idempotency_key) DO NOTHING
 RETURNING id::text
 `,uuidToString(issue.ID),workspaceID,uuidToString(issue.ProjectID),userID,
    zhugeAIRepo,req.GithubPR,req.CheckpointSHA,req.IdempotencyKey,req.ExpectedRevision).Scan(&id)
 if errors.Is(err,pgx.ErrNoRows){
   // Idempotency retry is allowed ONLY when all original immutable request
   // parameters match; otherwise conflict. No second approval is inserted.
   var previous zhugeAIRunListItem
   same:=h.DB.QueryRow(r.Context(),`
    SELECT id::text,engineer,state,github_pr,checkpoint_sha,created_at,
      provider_thread_id,last_evidence_sha,revision
    FROM taskflow.zhuge_ai_engineering_run
    WHERE workspace_id=$1::uuid AND issue_id=$2::uuid AND requested_by=$3::uuid
      AND idempotency_key=$4
   `,workspaceID,uuidToString(issue.ID),userID,req.IdempotencyKey).Scan(
     &previous.ID,&previous.Engineer,&previous.State,&previous.GithubPR,
     &previous.CheckpointSHA,&previous.CreatedAt,&previous.ProviderThreadID,
     &previous.EvidenceSHA,&previous.Revision)
   if same==nil && previous.GithubPR==req.GithubPR && previous.CheckpointSHA==req.CheckpointSHA{
     w.Header().Set("Cache-Control","no-store, private")
     writeJSON(w,http.StatusOK,map[string]any{"id":previous.ID,"state":previous.State,
       "launch_performed":false,"idempotent_replay":true})
     return
   }
   writeError(w,http.StatusConflict,"stale native revision or conflicting approval")
   return
 }
 if err!=nil{
   var pgerr *pgconn.PgError
   if errors.As(err,&pgerr) && pgerr.Code=="23505"{
     writeError(w,http.StatusConflict,"another active AI run approval exists");return
   }
   writeError(w,http.StatusServiceUnavailable,"AI approval authority unavailable")
   return
 }
 // Append-only audit; on write failure the approval remains, but cannot be
 // launched: dispatched processor must require this evidence to exist.
 _,auditErr:=h.DB.Exec(r.Context(),`
 INSERT INTO taskflow.zhuge_ai_engineering_event(run_id,state,event_kind,github_sha)
 VALUES($1::uuid,'approved','pm_approved',$2)
 `,id,req.CheckpointSHA)
 if auditErr!=nil{
   writeError(w,http.StatusServiceUnavailable,"AI approval audit unavailable");return
 }
 w.Header().Set("Cache-Control","no-store, private")
 writeJSON(w,http.StatusCreated,map[string]any{
   "id":id,"state":"approved","launch_performed":false,
   "provider_status":"not_started","message":"PM checkpoint approval recorded; dispatch remains locked"})
}
