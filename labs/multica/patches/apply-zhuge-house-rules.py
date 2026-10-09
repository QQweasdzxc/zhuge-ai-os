#!/usr/bin/env python3
from pathlib import Path
import shutil

ROOT = Path("/src")

def read(rel):
    p = ROOT / rel
    if not p.exists():
        raise SystemExit(f"Zhuge house-rules target missing: {rel}")
    return p, p.read_text()

def must_replace(rel, old, new, count=1):
    p, text = read(rel)
    actual = text.count(old)
    if actual < count:
        raise SystemExit(f"Zhuge house-rules marker missing in {rel}: {old[:120]!r} (found {actual})")
    p.write_text(text.replace(old, new, count))

def copy_override(tmp_name, rel):
    src = Path("/tmp") / tmp_name
    if not src.exists():
        raise SystemExit(f"Zhuge house-rules override missing: {src}")
    dst = ROOT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)

# ---------------------------------------------------------------------------
# Entry / identity UX
# ---------------------------------------------------------------------------
copy_override("zhuge-root-page.tsx", "apps/web/app/(landing)/page.tsx")
copy_override("zhuge-login-page.tsx", "apps/web/app/(auth)/login/page.tsx")
copy_override("zhuge-help-launcher.tsx", "packages/views/layout/help-launcher.tsx")

# ---------------------------------------------------------------------------
# Backend: Zhuge is the only Human Identity / Membership Authority.
# Multica-native human signup, invitations, share-link joining, workspace
# leave/delete and upstream commercial/contact flows fail closed.
# ---------------------------------------------------------------------------
router = "server/cmd/server/router.go"
for old, new in [
    ('r.With(authRL).Post("/auth/send-code", h.SendCode)', 'r.With(authRL).Post("/auth/send-code", h.ZhugeManagedOnly)'),
    ('r.With(authVerifyRL).Post("/auth/verify-code", h.VerifyCode)', 'r.With(authVerifyRL).Post("/auth/verify-code", h.ZhugeManagedOnly)'),
    ('r.With(authRL).Post("/auth/google", h.GoogleLogin)', 'r.With(authRL).Post("/auth/google", h.ZhugeManagedOnly)'),
    ('r.With(contactSalesRL).Post("/api/contact-sales", h.CreateContactSales)', 'r.With(contactSalesRL).Post("/api/contact-sales", h.ZhugeManagedOnly)'),
    ('r.Post("/api/me/onboarding/cloud-waitlist", h.JoinCloudWaitlist)', 'r.Post("/api/me/onboarding/cloud-waitlist", h.ZhugeManagedOnly)'),
    ('r.Post("/api/feedback", h.CreateFeedback)', 'r.Post("/api/feedback", h.ZhugeManagedOnly)'),
    ('r.Post("/leave", h.LeaveWorkspace)', 'r.Post("/leave", h.ZhugeManagedOnly)'),
    ('r.Post("/members", h.CreateInvitation)', 'r.Post("/members", h.ZhugeManagedOnly)'),
    ('r.Patch("/", h.UpdateMember)', 'r.Patch("/", h.ZhugeManagedOnly)'),
    ('r.Delete("/", h.DeleteMember)', 'r.Delete("/", h.ZhugeManagedOnly)'),
    ('r.Post("/share-links", h.CreateShareLink)', 'r.Post("/share-links", h.ZhugeManagedOnly)'),
    ('r.With(middleware.RequireWorkspaceRoleFromURL(queries, "id", "owner")).Delete("/", h.DeleteWorkspace)',
     'r.With(middleware.RequireWorkspaceRoleFromURL(queries, "id", "owner")).Delete("/", h.ZhugeManagedOnly)'),
    ('r.Post("/api/invitations/{id}/accept", h.AcceptInvitation)', 'r.Post("/api/invitations/{id}/accept", h.ZhugeManagedOnly)'),
    ('r.Post("/api/share-links/join", h.JoinByShareLink)', 'r.Post("/api/share-links/join", h.ZhugeManagedOnly)'),
]:
    must_replace(router, old, new)

# ---------------------------------------------------------------------------
# Sidebar: no SaaS-community promo; "logout" becomes leaving this Lab only.
# Workspace creation is separately hidden/blocked by DISABLE_WORKSPACE_CREATION.
# ---------------------------------------------------------------------------
sidebar = "packages/views/layout/app-sidebar.tsx"
must_replace(sidebar, 'import { JoinDiscordCard } from "./join-discord-card";\n', '')
must_replace(sidebar, '            <JoinDiscordCard />\n', '')
must_replace(
    sidebar,
    '<DropdownMenuItem variant="destructive" onClick={logout}>\n                      <LogOut className="h-3.5 w-3.5" />\n                      {t(($) => $.sidebar.log_out)}\n                    </DropdownMenuItem>',
    '<DropdownMenuItem\n                      onClick={() => {\n                        logout();\n                        window.location.assign("https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=dashboard");\n                      }}\n                    >\n                      <LogOut className="h-3.5 w-3.5" />\n                      返回 Zhuge AI OS\n                    </DropdownMenuItem>'
)

# ---------------------------------------------------------------------------
# Settings: human membership is Zhuge-owned, so remove the Members admin surface.
# Keep member rows internally because assignee/mention/actor resolution depends on them.
# ---------------------------------------------------------------------------
settings = "packages/views/settings/components/settings-page.tsx"
must_replace(
    settings,
    '            entry("members", t(($) => $.page.tabs.members), Users, <MembersTab />, {\n              adminOnly: true,\n            }),\n',
    ''
)

# ---------------------------------------------------------------------------
# Account: canonical human name/avatar come from Zhuge identity. Keep Multica-local
# profile description/preferences so the native product can still be evaluated.
# ---------------------------------------------------------------------------
account = "packages/views/settings/components/account-tab.tsx"
must_replace(account, 'description={t(($) => $.account.click_avatar_hint)}', 'description="由 Zhuge AI OS 管理"')
must_replace(account, '                size={64}\n                onUploaded=', '                size={64}\n                disabled\n                onUploaded=')
must_replace(
    account,
    '            label={t(($) => $.account.name_label)}\n            size="text"',
    '            label={t(($) => $.account.name_label)}\n            description="由 Zhuge AI OS 管理"\n            size="text"'
)
must_replace(account, '              value={profileName}\n              onChange=', '              value={profileName}\n              disabled\n              onChange=')

# ---------------------------------------------------------------------------
# Workspace: the Zhuge-created Lab room cannot be abandoned or deleted from
# inside Multica. Native context/description/prefix settings remain testable.
# ---------------------------------------------------------------------------
workspace = ROOT / "packages/views/settings/components/workspace-tab.tsx"
text = workspace.read_text()
start = text.find('      {/* Danger Zone')
end = text.find('      <Dialog\n        open={prefixDraft !== null}', start)
if start < 0 or end < 0:
    raise SystemExit("Zhuge house-rules danger-zone markers missing")
workspace.write_text(text[:start] + text[end:])

print("Zhuge Multica Lab house rules applied")
