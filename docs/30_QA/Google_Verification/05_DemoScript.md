# Zhuge AI OS — Google OAuth Verification Demo

Document Version: 1.0  
Target Length: 6 minutes 35 seconds
Recording Format: MP4, one continuous screen recording, no editing  
Homepage: https://qqweasdzxc.github.io/zhuge-ai-os/

## Title Card

Display the following full-screen title card for approximately 5 seconds before opening the public Homepage:

```text
Zhuge AI OS
Google OAuth Verification Demo

Demo Version: 1.0
Product Version: 0.9.0-alpha.8.4
Recording Date: 2026-08-01
Google Account: Demo Account

Purpose:
Demonstrate Google Sign-In
and Google Picker workflow
```

The title card is part of the continuous recording. Do not add it through video editing.

## Recording Preparation

Use a dedicated reviewer/demo Google account and a non-sensitive demo file named `Zhuge AI OS OAuth Demo`.

Before recording:

- Close unrelated browser tabs and hide bookmarks containing private information.
- Turn on Do Not Disturb so notifications do not appear in the recording.
- Confirm the public Homepage, Privacy Policy, Terms of Service, and Support pages return HTTP 200.
- Sign out of Zhuge AI OS.
- If the Google consent screen must be demonstrated again, revoke the existing Zhuge AI OS authorization from the demo Google account before recording.
- Confirm the demo file contains no personal, confidential, financial, HR, legal, or customer information.
- Keep only the demo file selected in Google Picker.

## Reviewer Timeline

| Time | Screen | Reviewer Evidence |
| --- | --- | --- |
| 00:00–00:05 | Title Card | Product, recording purpose, version, date, and demo account |
| 00:05–00:45 | Public Homepage | Public access, stable Root URL, no automatic redirect |
| 00:45–01:10 | Privacy / Terms / Support | Public policies and support contact are visible |
| 01:10–01:55 | Continue with Google | Google Sign-In and consent screen |
| 01:55–02:25 | Authenticated Dashboard | Authenticated identity and available modules |
| 02:25–03:10 | WorkLog | Normal authenticated WorkLog usage |
| 03:10–03:45 | Knowledge Import entry | Drive permission is not requested until explicit Import action |
| 03:45–04:40 | Google Picker | User explicitly selects one demo file |
| 04:40–05:40 | Import and Knowledge result | Only the selected file is imported and processed |
| 05:40–06:15 | Return to WorkLog | Imported Knowledge is available to the user |
| 06:15–06:35 | Reviewer summary | No scanning, synchronization, crawling, or hidden collection |

## Narration Script

### 00:00–00:05 — Title Card

On screen:

1. Show the title card at full screen.
2. Keep it visible for approximately 5 seconds.

Narration:

> Zhuge AI OS. Google OAuth Verification Demo. This recording demonstrates Google Sign-In and the explicit Google Picker workflow.

### 00:05–00:45 — Public Homepage

On screen:

1. Open `https://qqweasdzxc.github.io/zhuge-ai-os/` in a signed-out or private browser window.
2. Pause on the address bar so the Root URL is visible.
3. Slowly scroll through the product description, features, and reviewer information.

Narration:

> This is the public Homepage of Zhuge AI OS. The Homepage is accessible without signing in and remains at the stable Root URL. It does not automatically redirect to the authenticated application. Zhuge AI OS is an AI-powered productivity platform for WorkLog and user-controlled knowledge management.

### 00:45–01:10 — Public Policies

On screen:

1. Open Privacy Policy.
2. Briefly show the Google Drive and data-retention sections.
3. Open Terms of Service.
4. Open Support and briefly show authorization revocation and data deletion instructions.
5. Return to the Homepage.

Narration:

> Privacy Policy, Terms of Service, and Support are publicly available. The Privacy Policy explains Google data use and retention. The Support page explains how a user can revoke authorization or request deletion of account data.

### 01:10–01:55 — Google Sign-In

On screen:

1. Click `Continue with Google`.
2. Show the Google Sign-In screen.
3. Select the dedicated demo account.
4. Show the OAuth consent screen and the requested identity permissions.
5. Complete sign-in.

Narration:

> I am now choosing Continue with Google. Google Sign-In is used only to authenticate the user and maintain the session. Google Drive permission is not requested simply because the public Homepage was opened. Any Google Drive authorization is requested separately when the user explicitly starts Knowledge Import.

### 01:55–02:25 — Authenticated Dashboard

On screen:

1. Show the authenticated user's avatar, display name, and email.
2. Show the Zhuge AI OS Dashboard.
3. Show WorkLog as available and the future modules as Coming Soon.

Narration:

> Authentication is complete. The Dashboard now displays the authenticated Google identity and the available Zhuge AI OS modules. WorkLog is currently available. The other modules shown here are not part of this authorization demonstration.

### 02:25–03:10 — WorkLog

On screen:

1. Open WorkLog.
2. Show the normal WorkLog view.
3. Briefly show tasks or work records without exposing sensitive data.
4. Navigate to Knowledge.

Narration:

> This is the authenticated WorkLog application. Users can manage their tasks, work journals, completion records, and working hours. I will now open Knowledge to demonstrate the separate, user-initiated Google Drive workflow.

### 03:10–03:45 — Explicit Knowledge Import

On screen:

1. Pause before clicking Import.
2. Point out that no Picker or Drive file list is currently open.
3. Click the Knowledge Import action.
4. Choose the Google Drive import option.

Narration:

> No Google Drive file is accessed while I browse WorkLog. Drive access begins only after I explicitly choose Knowledge Import and then select the Google Drive option. There is no background scan, automatic synchronization, or automatic file collection.

### 03:45–04:40 — Google Picker

On screen:

1. Show Google Picker.
2. Show that the user controls file selection.
3. Select only `Zhuge AI OS OAuth Demo`.
4. Confirm the selection.

Narration:

> Google Picker is now open. The user is in control of the selection. I am selecting one non-sensitive demo file. Zhuge AI OS receives only the file explicitly selected through this Picker. It does not crawl folders or access other files in the account.

### 04:40–05:40 — Import and Knowledge Result

On screen:

1. Show the selected filename before import.
2. Start import.
3. Show the reading and analysis progress.
4. Show the resulting Knowledge item.
5. If confirmation is required, review and confirm the result.

Narration:

> The selected file is now imported into Knowledge. The application reads and analyzes this single selected file to provide the requested user-facing Knowledge feature. No other Drive files are imported. Zhuge AI OS does not modify or delete the source file, and it does not perform background synchronization.

### 05:40–06:15 — Return to WorkLog

On screen:

1. Return to WorkLog.
2. Show that the imported Knowledge result is available.
3. Optionally open the result once to show the selected source name.

Narration:

> I have returned to WorkLog. The Knowledge created from the selected demo file is now available to the authenticated user. The source remains identifiable as the file that was explicitly selected through Google Picker.

### 06:15–06:35 — Final Reviewer Summary

On screen:

1. Return to the public Homepage or Google Data page.
2. Pause on the reviewer disclosure section.

Narration:

> To summarize: the Homepage is public; Google Sign-In is used for authentication and session continuity; Google Drive authorization occurs only after explicit user action; and only the file selected through Google Picker is accessed. Zhuge AI OS performs no automatic Drive crawling, background scanning, automatic synchronization, hidden collection, or data selling. This concludes the demonstration.

## Recording Acceptance Checklist

- [ ] MP4 duration is between 5 and 8 minutes.
- [ ] Root Homepage is shown without authentication and without redirect.
- [ ] Privacy Policy, Terms of Service, and Support are visible.
- [ ] Google Sign-In and OAuth consent are legible.
- [ ] Authenticated identity is shown without exposing unrelated personal information.
- [ ] WorkLog normal operation is shown.
- [ ] Knowledge Import is initiated by a visible user action.
- [ ] Google Picker shows exactly one selected demo file.
- [ ] The selected file name is visible before and after import.
- [ ] No unrelated Drive file content is exposed.
- [ ] The final narration explicitly states the data-access boundaries.
- [ ] Browser notifications, passwords, tokens, and unrelated tabs are absent.

## Submission Note

Suggested reviewer note:

> The video demonstrates Zhuge AI OS from the public Homepage through Google Sign-In, authenticated WorkLog use, and an explicit Google Picker selection. Google Drive access occurs only when the user initiates Knowledge Import, and only the selected file is processed. No automatic scanning, crawling, synchronization, or background file collection occurs.

## Delivery and Publication Gate

The video must follow this order:

1. Record the continuous MP4.
2. Deliver the MP4 to the Product Owner for Reviewer QA.
3. Check the video for exposed personal information, credentials, tokens, unrelated tabs, or unclear authorization steps.
4. Upload only the approved MP4 to YouTube.
5. Set YouTube visibility to `Unlisted`.
6. Confirm the video is not listed on the public channel page or searchable.
7. Submit the Unlisted YouTube URL in Google OAuth Verification.

Do not upload the recording before Product Owner approval.
