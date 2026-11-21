# Cloud run: daily RCIP, AIP, Alberta & Saskatchewan job search with Gmail drafts

This file is the runbook for the scheduled cloud session (claude.ai/code). It
replaces `run.sh` and the launchd plist, which are for the Mac. Follow
`automation/rcip-daily/prompt.md` for the search itself, with the changes
below. Where this file and `prompt.md` disagree, this file wins.

Do all of the work yourself in this one session. Do not start subagents,
background tasks or workflows. Do not edit, commit or push anything in the
repository.

## Step 0: Skip if today's digest already went out
Use the Gmail connector's `search_threads` with
`in:sent to:peterodejobi9@gmail.com subject:"software jobs" newer_than:1d`.
If a digest whose subject carries today's date (Africa/Lagos time) is there,
stop and end with `ALREADY_SENT <thread id>`. Otherwise continue.

## Step 0b: Get the résumé
1. Download Peter's résumé from Google Drive with the Drive connector's
   `download_file_content`, fileId `1OatdCJqOZRlGm6ZgvgLHKcLjos4RffC8`
   ("Peter-A-Odejobi.docx", the file Peter chose). The tool saves the file and
   prints its path.
2. Gmail can attach only files in your scratchpad or working directory. Copy
   the file to `<your scratchpad directory>/Peter-A-Odejobi.docx` (the
   scratchpad path is in your environment notes). If you have no scratchpad,
   copy it to `.resume-cache/Peter-A-Odejobi.docx` in the repository root,
   which is git-ignored.
3. Run `sha256sum` on the copy. The attachment you pass to Gmail is
   `{"content": "sha256:<hex>:<absolute path of the copy>", "filename": "Peter-A-Odejobi.docx", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}`.
If the download or copy fails, carry on without an attachment and put
"Résumé could not be attached today: attach it by hand before sending" in the
digest's "Couldn't check today" footer.

## How to read web pages here
The WebFetch tool does not work in this cloud container (every host fails with
`getaddrinfo ENOTFOUND`). Do not use it, and do not report a site as down
because WebFetch failed. Instead:
- Read pages with Bash: `automation/rcip-daily/fetch.sh '<url>' [max_chars]`.
  It fetches through the session proxy with curl and prints the page as text
  (HTML, PDF and JSON). Link targets are kept in `[brackets]`, so apply links
  and email addresses survive. Exit 2 means blocked or a bot-check page; exit 3
  means a network failure. Quote the URL.
- Use the WebSearch tool as `prompt.md` says (Reddit, X, hiring.cafe).
- canada.ca does not answer from cloud machines. For the IRCC steps (1a and
  1b), try `fetch.sh` once; if it fails, use WebSearch with
  `site:canada.ca` for the latest RCIP and AIP status and news, and use the
  community list in `prompt.md`. List canada.ca under "Couldn't check today",
  but do not let it empty the report: the community, provincial and job sites
  are checked separately.
- Already known to block bots: princeedwardisland.ca (use the PEI names in
  `prompt.md`), Indeed, Glassdoor, hiring.cafe. Do not retry them.
- The "Do not read or change any local files" line in `prompt.md` is for the
  Mac. Here you may run `fetch.sh`, `sha256sum` and `cp`, and write temporary
  files under `/tmp` or your scratchpad. Nothing else.

## Adzuna
There are no Adzuna keys in the cloud. Skip the Adzuna source.

## Step 6c (new): Save a Gmail draft application for each job with an email address
After Step 6b, for every job in today's list whose "To" is a real application
email address found in Step 6 (on the posting, the employer's careers or HR
page, or a program contact page; never guessed or constructed):
1. Check that Peter has not already applied or drafted for this job. Use
   `search_threads` with `in:sent to:<that address>` and the Gmail
   connector's `list_drafts` with `to:<that address>`. If he already emailed
   that address about this job title, do not draft again; mark the card
   "Already emailed <date>". If a draft for the same job already exists, reuse
   its link and do not make a second one.
2. Create the draft with the Gmail connector's `create_draft`:
   - `to`: the application address only. No cc or bcc.
   - `subject` and `body`: exactly the Step 6b subject and body (plain text).
   - `attachments`: the résumé from Step 0b.
3. Keep the returned `viewUrl` for the digest.
A program office address (RCIP community office, provincial AIP office) is a
secondary contact, never the To of a draft. A job with no published address
gets no draft; its cover note stays in the digest as `prompt.md` says.

Hard limits:
- NEVER send an application. Use `create_draft` only. Never call
  `send_message` with a `draftId`, and never call `send_message` to anyone but
  peterodejobi9@gmail.com.
- At most 12 drafts per run (the full-card jobs).
- A draft is for Peter to review. Everything in it must come from the facts
  list in `prompt.md` Step 6b.

## Changes to the digest (Step 7)
- In each job card that has a draft, replace the "Open email draft ✉" mailto
  button with:
  `<a href="{draft viewUrl}" style="display:inline-block;background:#ffffff;color:#2563eb;border:1px solid #2563eb;text-decoration:none;font-weight:700;font-size:14px;padding:9px 16px;border-radius:6px;margin-left:6px;">Open Gmail draft ✉</a>`
  and change the note in the ready-to-send box to
  `(saved in your Gmail drafts with your résumé attached: check it and press Send)`.
- Cards without a draft keep the template from `prompt.md` unchanged.
- Under the summary line, add one line: "<N> drafts are waiting in Gmail
  Drafts." (or "No drafts today." when N is 0).

## Finish
Send exactly one digest email, as `prompt.md` Step 7 says. End your final
answer with `EMAIL_SENT <message id> DRAFTS <N>` once `send_message` has
succeeded, or with `EMAIL_FAILED <reason>`.
