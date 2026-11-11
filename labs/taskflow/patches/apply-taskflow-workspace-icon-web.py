#!/usr/bin/env python3
"""Explicit workspace-icon filing UI. No upload or read side effects."""
from pathlib import Path
import argparse

def once(s,old,new):
 if s.count(old)!=1: raise SystemExit('workspace icon UI anchor missing/ambiguous')
 return s.replace(old,new,1)
def apply(root):
 if 'third_party/multica' in str(root.resolve()):raise SystemExit('frozen vendor refused')
 p=root/'packages/core/api/client.ts';s=p.read_text()
 a='  async getWorkspace(id: string): Promise<Workspace> {'
 s=once(s,a,'''  async organizeWorkspaceIcon(id: string): Promise<{status: string; folder: string}> {
    return this.fetch(`/api/workspaces/${id}/organize-icon`, { method: "POST" });
  }

'''+a);p.write_text(s)
 p=root/'packages/views/settings/components/workspace-tab.tsx';s=p.read_text()
 a='  const [name, setName] = useState(workspace?.name ?? "");'
 s=once(s,a,'''  const [iconFiling, setIconFiling] = useState(false);
  const [iconFilingMessage, setIconFilingMessage] = useState("");
  const organizeIcon = async () => {
    if (!workspace || iconFiling) return;
    setIconFiling(true); setIconFilingMessage("");
    try {
      const result = await api.organizeWorkspaceIcon(workspace.id);
      if (result.status !== "filed") throw new Error("圖示歸檔未完成，請稍後重試。");
      setIconFilingMessage(`已歸入「${result.folder}」，原檔與圖示設定不變。`);
    } catch (error) {
      setIconFilingMessage(error instanceof Error ? error.message : "圖示歸檔未完成，請保留原檔後重試。");
    } finally { setIconFiling(false); }
  };
'''+a)
 a='''              />
            </div>
          </SettingsRow>

          <SettingsRow
            anchor="name"'''
 s=once(s,a,'''              />
              {canManageWorkspace && workspace.avatar_url && (
                <div className="ml-3 max-w-xs text-left">
                  <Button variant="outline" size="sm" disabled={iconFiling} onClick={organizeIcon}>
                    {iconFiling ? "圖示歸檔中…" : "整理工作區圖示"}
                  </Button>
                  <p role="status" className="mt-2 text-xs text-muted-foreground">
                    {iconFilingMessage || "把現有圖示歸入專用資料夾，不刪檔、不重傳。"}
                  </p>
                </div>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            anchor="name"''');p.write_text(s)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);a=p.parse_args();apply(a.root)
