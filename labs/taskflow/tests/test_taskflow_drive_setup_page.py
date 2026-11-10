from pathlib import Path
import unittest
REPO=Path(__file__).resolve().parents[3]
class DriveSetupPageTests(unittest.TestCase):
 def test_cookie_only_csrf_and_narrow_external_url(self):
  s=(REPO/'labs/taskflow/overrides/taskflow-drive-connect-page.tsx').read_text()
  for fragment in ['X-CSRF-Token','credentials: "same-origin"','/api/taskflow-drive/setup','https://accounts.google.com','https://www.googleapis.com/auth/drive.file','response.status === 401','response.status === 403','role="alert"','boxSizing: "border-box"']:
   self.assertIn(fragment,s)
  self.assertNotIn('Bearer',s)
  self.assertNotIn('client_secret',s)
  self.assertNotIn('trash30',s)
 def test_web_image_installs_page_without_frozen_vendor_edits(self):
  s=(REPO/'labs/taskflow/Dockerfile.web').read_text()
  self.assertIn('COPY labs/taskflow/overrides/taskflow-drive-connect-page.tsx /src/apps/web/app/auth/taskflow-drive/connect/page.tsx',s)
