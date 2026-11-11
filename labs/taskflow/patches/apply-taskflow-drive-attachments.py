#!/usr/bin/env python3
"""Private Drive backend overlay; never edits the frozen vendor tree."""
import argparse
from pathlib import Path

def apply(root,overlay):
 if 'third_party/multica' in str(root.resolve()):raise SystemExit('frozen vendor refused')
 router=root/'server/cmd/server/router.go';file=root/'server/internal/handler/file.go';issue=root/'server/internal/handler/issue.go';service=root/'server/internal/service/issue.go';handler=root/'server/internal/handler/handler.go'
 workspace=root/'server/internal/handler/workspace.go';wt=workspace.read_text()
 workspace_anchor='\tslog.Info("workspace updated", append(logger.RequestAttrs(r), "workspace_id", id)...)'
 if wt.count(workspace_anchor)!=1:raise SystemExit('workspace avatar filing anchor missing')
 rt=router.read_text();ft=file.read_text();it=issue.read_text();st=service.read_text();ht=handler.read_text()
 old='\t// Initialize storage with S3 as primary, fallback to local\n\tvar store storage.Storage\n\ts3 := storage.NewS3StorageFromEnv()\n\tif s3 != nil {'
 new='''\t// Drive is explicit and fails closed, never ephemeral fallback.
\tvar store storage.Storage
\tdriveMode:=strings.TrimSpace(os.Getenv("TASKFLOW_ATTACHMENT_STORAGE"))
\tif driveMode=="drive"||driveMode=="drive-readonly" {
\t\tctx,cancel:=context.WithTimeout(context.Background(),30*time.Second)
\t\tprivateDrive,err:=storage.TaskFlowDriveStorageFromEnv(ctx,pool);cancel()
\t\tif err!=nil{panic("private Drive store is not ready; refusing ephemeral fallback")};store=privateDrive
\t} else if driveMode!=""&&driveMode!="local" {panic("unsupported storage mode; refusing fallback")
\t} else if s3:=storage.NewS3StorageFromEnv();s3!=nil {'''
 callback_old='\t// Health / readiness checks\n'
 callback_new='''\t// Public OAuth callback carries only expiring single-use state + PKCE.
\t// All ordinary task/file routes retain their existing authorization.
\tif driveSetup,err:=storage.TaskFlowDriveSetupFromEnv(pool);err!=nil {
\t\tpanic("private Drive connection configuration invalid")
\t} else if driveSetup!=nil {r.Get(storage.TaskFlowDriveCallbackPath,driveSetup.Callback)}

'''+callback_old
 setup_old='\t\tr.Post("/api/upload-file", h.UploadFile)'
 setup_new='\t\tr.With(handler.RequireHumanActor).Post("/api/taskflow-drive/setup",h.StartTaskFlowDriveSetup)\n'+setup_old
 admission_old='\tworkspaceID := h.resolveWorkspaceID(r)\n\n\tr.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)'
 admission_new='''\tworkspaceID := h.resolveWorkspaceID(r)
\tif drive,ok:=h.Storage.(*storage.TaskFlowDriveStorage);ok {
\t\tctx,release,err:=drive.BeginUpload(r.Context());if err!=nil {writeError(w,http.StatusServiceUnavailable,"Drive 附件連線尚未就緒，這次未完成上傳。");return};defer release();r=r.WithContext(ctx)
\t}
\tr.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)'''
 parse_old='\tif err := r.ParseMultipartForm(maxUploadSize); err != nil {'
 parse_new='\tmultipartMemory:=int64(maxUploadSize);if _,drive:=h.Storage.(*storage.TaskFlowDriveStorage);drive{multipartMemory=1<<20}\n\tif err := r.ParseMultipartForm(multipartMemory); err != nil {'
 read_old='\tdata, err := io.ReadAll(file)'
 read_new='\tvar data []byte\n\tif _,drive:=h.Storage.(*storage.TaskFlowDriveStorage);drive{data,err=storage.ReadTaskFlowDriveUpload(file,header.Size)}else{data,err=io.ReadAll(file)}'
 upload_old='\t\t\tslog.Error("file upload failed", "error", err)\n\t\t\twriteError(w, http.StatusInternalServerError, "upload failed")'
 upload_new='\t\t\tslog.Error("file upload failed", "error", err)\n\t\t\tif _,drive:=h.Storage.(*storage.TaskFlowDriveStorage);drive{writeError(w,http.StatusServiceUnavailable,"Drive 附件未完成儲存，請稍後再試。");return}\n\t\t\twriteError(w, http.StatusInternalServerError, "upload failed")'
 metadata_old='\t\t\tslog.Error("failed to create attachment record", "error", err)\n'
 metadata_new=metadata_old+'\t\t\tif _,drive:=h.Storage.(*storage.TaskFlowDriveStorage);drive{writeError(w,http.StatusServiceUnavailable,"檔案已保留，但任務附件記錄未完成，請稍後重試。");return}\n'
 issue_old='\t\t\tparams.IssueID = issue.ID\n'
 issue_new=issue_old+'\t\t\tif _,drive:=h.Storage.(*storage.TaskFlowDriveStorage);drive{r=r.WithContext(storage.WithTaskFlowDriveFolderLabel(r.Context(),h.getIssuePrefix(r.Context(),issue.WorkspaceID)+"-"+strconv.Itoa(int(issue.Number))))}\n'
 reader_old='\t\tslog.Error("failed to open attachment for download", "id", uuidToString(att.ID), "key", key, "error", err)\n'
 reader_new=reader_old+'\t\tif errors.Is(err,storage.ErrTaskFlowDriveIntegrity){writeError(w,http.StatusBadGateway,"原附件完整性檢查未通過，未顯示可能錯誤的內容。");return}\n\t\tif errors.Is(err,storage.ErrTaskFlowDriveUnavailable){writeError(w,http.StatusServiceUnavailable,"Drive 連線暫時無法使用，原附件記錄仍保留。");return}\n'
 bind_old='\th.broadcastCancelledWakeups(ctx, workspaceID, cancelledWakeups)\n\treturn issue, current, attachmentsChanged, nil\n'
 bind_new='\th.broadcastCancelledWakeups(ctx, workspaceID, cancelledWakeups)\n\th.taskFlowDriveFileBoundAttachments(ctx, issue, attachmentIDs)\n\treturn issue, current, attachmentsChanged, nil\n'
 svc_field_old='\tEntitlements entitlement.Provider\n}'
 svc_field_new='\tEntitlements entitlement.Provider\n\t// Filer, when set, runs best-effort post-commit filing of newly linked\n\t// attachments (private Drive task folders). Nil in tests and non-Drive setups.\n\tFiler func(ctx context.Context, issue db.Issue, attachmentIDs []pgtype.UUID)\n}'
 svc_call_old='\tattachments := s.linkAttachments(ctx, issue, p.AttachmentIDs)\n'
 svc_call_new=svc_call_old+'\tif s.Filer != nil {\n\t\ts.Filer(ctx, issue, p.AttachmentIDs)\n\t}\n'
 wire_old='\th.PRRefresh = ghsnapshot.NewManager(ghClient, queries, txStarter, h.broadcastPRSnapshotApplied)\n\n\treturn h'
 wire_new='\th.PRRefresh = ghsnapshot.NewManager(ghClient, queries, txStarter, h.broadcastPRSnapshotApplied)\n\th.IssueService.Filer = h.taskFlowDriveFileBoundAttachments\n\n\treturn h'
 serve_old='func (h *Handler) proxyAttachmentDownload(w http.ResponseWriter, r *http.Request, att db.Attachment, key string, forceAttachment bool) {\n\treader, err := h.Storage.GetReader(r.Context(), key)'
 serve_new='func (h *Handler) proxyAttachmentDownload(w http.ResponseWriter, r *http.Request, att db.Attachment, key string, forceAttachment bool) {\n\tif _,drive:=h.Storage.(*storage.TaskFlowDriveStorage);drive&&att.IssueID.Valid{go h.taskFlowDriveFileAttachment(context.WithoutCancel(r.Context()),att)}\n\treader, err := h.Storage.GetReader(r.Context(), key)'
 patches=[(rt,old),(rt,callback_old),(rt,setup_old),(ft,admission_old),(ft,parse_old),(ft,read_old),(ft,upload_old),(ft,metadata_old),(ft,reader_old),(ft,issue_old),(ft,serve_old),(it,bind_old),(st,svc_field_old),(st,svc_call_old),(ht,wire_old)]
 if any(text.count(anchor)!=1 for text,anchor in patches):raise SystemExit('Drive overlay source anchor missing/ambiguous')
 route_anchor='\t\t\t\t\tr.Patch("/", h.UpdateWorkspace)'
 if rt.count(route_anchor)!=1:raise SystemExit('workspace icon route anchor missing')
 files={}
 for source in overlay.glob('*.go'):
  directory='handler' if '_handler' in source.name else 'storage'
  dest=(root/'server/cmd/server'/source.name) if '_router' in source.name else (root/'server/internal'/directory/source.name)
  if dest.exists():raise SystemExit('Drive overlay destination exists')
  files[dest]=source.read_text()
 main=root/'server/cmd/server/main.go';mt=main.read_text()
 main_anchor='\t// Channel inbound supervisor (MUL-3620): holds the §4.4 WS lease per'
 if mt.count(main_anchor)!=1:raise SystemExit('Drive worker lifetime anchor missing')
 worker='\t// Private Drive pending-trash retry uses the normal shutdown-bound worker context.\n\tif drive,ok:=h.Storage.(*storage.TaskFlowDriveStorage);ok {go drive.RunTrashWorker(sweepCtx)}\n\n'
 if mt.count('"github.com/multica-ai/multica/server/internal/selfhosttelemetry"')!=1:raise SystemExit('Drive storage import anchor missing')
 mt=mt.replace('"github.com/multica-ai/multica/server/internal/selfhosttelemetry"','"github.com/multica-ai/multica/server/internal/selfhosttelemetry"\n"github.com/multica-ai/multica/server/internal/storage"',1).replace(main_anchor,worker+main_anchor,1)
 workspace.write_text(wt.replace(workspace_anchor,'\tif req.AvatarURL != nil { h.taskFlowDriveFileWorkspaceIcon(r.Context(), ws) }\n'+workspace_anchor,1))
 main.write_text(mt)
 rt=rt.replace(route_anchor,route_anchor+'\n\t\t\t\t\tr.With(handler.RequireHumanActor).Post("/organize-icon",h.OrganizeTaskFlowWorkspaceIcon)',1)
 router.write_text(rt.replace(old,new,1).replace(callback_old,callback_new,1).replace(setup_old,setup_new,1))
 ft=ft.replace('DownloadURL   string  `json:"download_url"`', 'DownloadURL   string  `json:"download_url"`\n\tPrivateStorage bool `json:"private_storage,omitempty"`',1)
 ft=ft.replace('\t// Only CloudFront mode overrides', '\tif _,private:=h.Storage.(*storage.TaskFlowDriveStorage);private{resp.PrivateStorage=true}\n\t// Only CloudFront mode overrides',1)
 file.write_text(ft.replace(admission_old,admission_new,1).replace(parse_old,parse_new,1).replace(read_old,read_new,1).replace(upload_old,upload_new,1).replace(metadata_old,metadata_new,1).replace(reader_old,reader_new,1).replace(issue_old,issue_new,1).replace(serve_old,serve_new,1))
 issue.write_text(it.replace(bind_old,bind_new,1))
 service.write_text(st.replace(svc_field_old,svc_field_new,1).replace(svc_call_old,svc_call_new,1))
 handler.write_text(ht.replace(wire_old,wire_new,1))
 for dest,text in files.items():dest.write_text(text)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--overlays',type=Path,default=Path(__file__).parent/'drive-attachments');a=p.parse_args();apply(a.root,a.overlays)
