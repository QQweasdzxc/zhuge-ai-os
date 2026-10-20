from pathlib import Path
import re
import os
ROOT = Path(os.environ.get("TASKFLOW_VENDOR_ROOT", str(Path(__file__).resolve().parents[3] / "third_party" / "multica"))) / "server" / "internal" / "handler"
def patch(path, field_count):
    p = ROOT / path; s = p.read_text()
    if path == "github.go" and "HeadSHA string `json:\"head_sha,omitempty\"`" not in s:
        marker = "type GitHubPullRequestResponse struct {\n"
        if s.count(marker) != 1: raise SystemExit(f"{path}: response marker mismatch")
        s = s.replace(marker, marker + '\tHeadSHA string `json:"head_sha,omitempty"`\n', 1)
    pattern = r"(?m)^(\s*)Branch:(\s+)textToPtr\(p\.Branch\),$"
    matches = list(re.finditer(pattern, s))
    if len(matches) != field_count: raise SystemExit(f"{path}: branch mapper count {len(matches)} != {field_count}")
    s = re.sub(pattern, lambda m: f"{m.group(1)}HeadSHA:{m.group(2)}p.HeadSha,\n{m.group(1)}Branch:{m.group(2)}textToPtr(p.Branch),", s)
    p.write_text(s)
patch("github.go", 2)
patch("vcs_webhook.go", 2)
