# SCHLUSS – Pre-launch security audit and hardening report (v11)

Date: 16 November 2026 · Scope: the whole SCHLUSS application (website, API, admin portal, database layer, email,
WhatsApp, uploads, backups, dependencies, build and deployment settings).

**No website can be guaranteed 100% secure.** This report says what was inspected, what was wrong, what was changed,
how each change was tested, and what is still open. Nothing is marked fixed unless it was implemented and tested.

## Launch recommendation: NO-GO today · GO once the 7 actions below are done

- **The application itself:** no critical or high-risk vulnerability remains open in the code. All 152 automated
  tests and all browser test suites pass with the hardening switched on.
- **Why not "GO" yet:** the website has not been installed on a live server, so HTTPS, the server, the database
  server and the domain could not be tested, and several protections need you to switch them on.

**Do these before launch (details in section 7):**

1. Choose hosting that can run Node.js, install with `docs/GO-LIVE.md`, and get HTTPS working.
2. On the server run `npm run live:check` until it shows no "FIX" lines.
3. **Change both mailbox passwords** (support@ and sales@) at xneelo and put the new ones in the server's `.env`.
   The current ones were shared in screenshots and chat during setup, so treat them as known.
4. Switch on **two-step verification** for every administrator (Admin › My security), then tick
   "compulsory for all staff".
5. Make sure backups leave the server (your host's backup service, or copy the `backups` folder elsewhere weekly).
6. Have the Privacy Policy and Terms reviewed for POPIA, and register your Information Officer (section 6).
7. After launch: run the 10-minute live test in section 8 and look at Admin › Audit log › Security events.

---

## 1. How the audit was done

- **Code review** of every server route, the session/CSRF/permission middleware, upload and download handling,
  email, WhatsApp, backups, the build output and all settings, against OWASP Top 10 and the relevant OWASP ASVS areas.
- **Automated attack tests** (safe, non-destructive, against the test database only): every one of the 147 admin
  API endpoints was called as an anonymous visitor, a customer, a partner and a read-only staff member; plus
  injection, CSRF, brute force, token, session, file and upload attacks. These are now permanent tests
  (`tests/server/security.test.ts`, 27 tests) that run with the rest of the suite.
- **Browser tests**: a crawl of more than 40 public and admin pages looking for Content-Security-Policy violations, an
  injection probe (injected script, hostile image/frame, data exfiltration, clickjacking), the two-step verification
  flow, and all existing feature suites re-run.
- **Production-mode check** of headers, cookies, HTTPS redirect, exposed files and secrets in the built website.
- A code snapshot was taken before any change (`schluss-pre-security-audit.tgz`), and every change was the smallest
  targeted one. No feature was removed and no data was changed.

**Not present in this application** (so nothing to test or break): Google login or any other third-party sign-in;
online payments; business-user logins (businesses are records managed by your staff – customers and partners only
ever see their own data, which was tested).

## 2. Findings

### Critical
None found.

### High

| # | Component | Problem and risk | What was changed | How it was tested | Resolved |
|---|---|---|---|---|---|
| H1 | `src/server.ts` | **No Content-Security-Policy.** If a script were ever injected (stored text, a compromised dependency), the browser would run it and it could act as the signed-in admin or send data elsewhere. | Strict CSP: scripts only from the site plus the exact fingerprints (SHA-256) of Angular's own inline scripts on each page; video frames only from YouTube (no-cookie) and Vimeo; pictures only from the site and the YouTube/Vimeo thumbnail servers; connections only to the site; no framing; no inline event handlers. | Crawl of more than 40 pages (public, whole admin, video playback, playlist import): **0 violations**. Injection probe: injected script and `onclick` did not run, hostile image/frame blocked, sending the cookie to another site blocked. All feature suites pass with CSP enforced. | Yes |
| H2 | `package.json` (sharp 0.34.5) | **Known high-severity vulnerabilities** in the image library's decoders (libvips/libheif/librsvg advisories). It processes uploaded covers and downloaded video thumbnails. | Upgraded to sharp 0.35.5. | `npm audit`: **0 vulnerabilities**. Cover upload, optimisation, thumbnail cropping and all content tests pass. | Yes |
| H3 | Sign-in (`server/api/routes/auth.ts`) | **Admin accounts were protected by a password only.** One phished or reused password would open the admin portal and all customer data. | Two-step verification (authenticator app, TOTP) for staff, with one-time recovery codes; secret stored encrypted, recovery codes hashed; a code cannot be reused; wrong codes lock the account; switching off needs password + code; an administrator can reset it for a lost phone; can be made compulsory for all staff. | 4 API tests + 15 browser checks: setup, wrong code, sign-in needs the code, replayed code refused, recovery code works once, lockout, disable rules, admin reset, compulsory mode blocks the admin until set up. | Yes – **you must switch it on** (action 4) |
| H4 | Operations | **No automatic backups.** A disk failure, bad update or deletion would lose customer data. | Automatic daily backup on the live server (database + uploaded files), each one verified after it is made, kept 14 days, failures alert the administrators; "Back up now" button and status on Admin › System; `npm run backup` / `npm run restore`. | A backup was restored into an empty database: all rows in all tables matched, all files present, sign-in and pages worked. A deliberately cut-off backup was detected as damaged. | Yes – **off-server copy is a manual action** (action 5) |

### Medium

| # | Component | Problem and risk | What was changed | How it was tested | Resolved |
|---|---|---|---|---|---|
| M1 | `server/api/index.ts` | Only sign-in and forms were rate-limited; any other endpoint could be hammered by a script (slow site, scraping). | A general ceiling per visitor address for the whole API (1,500 requests / 5 minutes, adjustable), on top of the existing stricter limits; hitting it is logged and alerts the administrators. | Live test with the limit lowered to 30: requests 31–40 from one address were refused (429) while another address and the site's own page rendering carried on; the event was logged and an alert raised. | Yes |
| M2 | Development inbox (`/api/dev/mail`) | On a machine without a mail server in development mode, test emails **including sign-in codes** were readable by anyone who could reach the site. Harmless on your own PC; serious if a server were ever started in development mode. | Only answers to requests from the same computer; never in production; `live:check` refuses development mode. | Test: not reachable in test/production mode, nor with a forwarded address. | Yes |
| M3 | Sessions (`middleware/auth.ts`) | Admin sessions lasted 12 hours idle / 14 days – a forgotten open browser stayed signed in. | Staff: signed out after 120 minutes without activity, 24 hours at most. Customers unchanged (12 hours / 14 days). | Test: staff session refused after 121 idle minutes; customer session still valid. | Yes |
| M4 | WhatsApp webhook (`admin-ops.ts`) | Unsigned (forged) webhook calls were refused, but their content was still stored – an attacker could fill the database. | Nothing from an unsigned call is stored; the attempt is logged at most once a minute per address. | Unsigned call → 401, no row stored; signed-flow suite (42 checks) passes. | Yes |
| M5 | Monitoring | Refused requests were not recorded and nobody was told about attacks. | Security events in the audit log: refused admin requests, anonymous probing of the admin API, rate-limit hits, rejected webhooks, failed codes. Alerts to administrators for: account lockouts, 10 failed sign-ins from one address, 15 refusals in 10 minutes, recovery-code use, two-step switched off, failed backup. New "Security events" view in the audit log. | Tests: a refused request is recorded without any request content; lockout creates an alert; the view lists only security events. | Yes |
| M6 | `src/server.ts` | No redirect from http to https, and HSTS relied on defaults. | In production every http request is redirected to https; HSTS for one year (production only). | Production-mode check: 308 redirect to `https://schluss.co.za/…`; `Strict-Transport-Security: max-age=31536000`. | Yes (needs HTTPS at the host) |

### Low

| # | Component | Problem | Change | Test | Resolved |
|---|---|---|---|---|---|
| L1 | `server/api/http.ts` | A broken request body caused a "500 server error" (and a log entry per request). | Answered as 400 without logging a fault. | Test passes. | Yes |
| L2 | Change password | Not rate-limited (a stolen session could guess the current password). | 10 attempts / 15 minutes. | Covered by suite. | Yes |
| L3 | Admin-entered links | Any link scheme was accepted (e.g. `javascript:`). Angular already neutralised it in the browser. | Server now accepts only http/https links. | Build + suites. | Yes |
| L4 | Content settings "test connection" | Read-only staff could trigger it. | Needs manage permission. | Read-only sweep: 0 write endpoints allowed. | Yes |
| L5 | Headers | No Permissions-Policy; Referrer-Policy too strict for video embeds. | Camera, microphone, location, payment etc. disabled; `strict-origin-when-cross-origin`; `X-Frame-Options: DENY`. | Header check. | Yes |
| L6 | Redirect after sign-in | The "internal links only" check did not cover `/\host`. | Tightened. | Unit path + suites. | Yes |

### Informational (checked and found sound – no change needed)

- **SQL injection:** all queries are parameterised (Knex); the few raw fragments contain only server-side text.
  Ten injection strings against 10 inputs each: no error, no data, no delay.
- **Access control:** all 147 admin endpoints refuse anonymous visitors (401), customers and partners (403);
  read-only staff cannot change anything; a manager cannot grant or touch the Super Administrator role;
  customers cannot become staff through any field.
- **Data isolation:** conversations, profiles, dashboards and download links of one customer are unreachable for
  another (404/403), including by changing ids or references.
- **Passwords:** bcrypt (cost 12), minimum 10 characters with a number; never logged or returned.
- **Sessions:** random 256-bit token, only its hash stored; cookie is `__Host-`, `Secure`, `HttpOnly`,
  `SameSite=Lax`; new session on sign-in; all sessions ended on password reset and on suspension.
- **CSRF:** signed double-submit token on every state-changing request; forged, missing and unsigned tokens refused.
- **Password reset:** random token, stored hashed, 60 minutes, single use, same answer whether or not the account exists.
- **Brute force:** 5 wrong passwords lock the account for 15 minutes; sign-in limited per address.
- **Uploads:** staff only; type decided by file content (not name or declared type); size limits; stored under random
  names outside the public folder; served only through permission-checked routes; executables renamed as images,
  HTML, PHP, SVG, scripts and double extensions all refused.
- **Downloads and videos:** signed, short-lived links bound to the customer/session; no storage paths exposed.
- **Secrets:** none in the browser bundle; no source maps in the production build; API errors never contain SQL,
  paths or stack traces; settings pages show "set / missing", never values.
- **CORS:** not enabled – the API only answers the website itself.
- **WhatsApp:** webhook signature (HMAC) verified; fails closed when no secret is set. **Email:** all values escaped
  in templates; verification codes hashed and removed from the queue after sending.
- **Dependencies:** `npm audit` 0 vulnerabilities; no unexpected install scripts (only the image library and build tools).

## 3. Still outstanding (not hidden)

| # | Item | Risk | Why it is open | What to do |
|---|---|---|---|---|
| O1 | Hosting, HTTPS, firewall, operating system updates | Unknown until installed | No live server exists yet | Actions 1–2; keep the database unreachable from the internet (only from the website's server). |
| O2 | Mailbox passwords exposed during setup | High if not changed | They appeared in screenshots and chat | Action 3. |
| O3 | Two-step verification not yet switched on for your accounts | High until done | Needs your phone | Action 4. |
| O4 | Backups are on the same server | Medium | Needs somewhere else to copy to | Action 5. |
| O5 | Database user rights | Medium | Depends on the host | Give the website's database user rights on its own database only; `live:check` warns if it has server-wide rights. |
| O6 | Virus scanning of uploads | Low–medium | Needs ClamAV on the server; only staff can upload | Ask the host for ClamAV, then set `MALWARE_SCAN=required`. |
| O7 | Registration tells a visitor when an email is already registered | Low | Needed so people are sent to "enter your code / sign in"; rate-limited to 10 per 15 minutes | Accept, or ask for a "same answer" flow (slightly worse experience). |
| O8 | An attacker who knows an admin's email can lock that account for 15 minutes with wrong passwords | Low | Trade-off of lockout protection | Two-step verification plus the lockout alert; use a non-obvious admin email. |
| O9 | CSP allows inline *styles* | Low | Angular writes component styles inline | Accepted; scripts are strict. |
| O10 | Unknown addresses show the site's "not found" page with status 200 | Informational | Rendering behaviour | No sensitive file is served (tested: `.env`, `package.json`, server files, backups, storage all return the app page, never the file). |
| O11 | The audit log keeps visitor IP addresses indefinitely | Privacy decision | Useful for investigations | Decide a retention period (section 6). |
| O12 | Rate limits and alerts are kept in the website's memory | Informational | Single-server design | Fine for one server; revisit if you ever run several. |
| O14 | Visitor addresses come from the host's proxy header | Informational | Standard for Node hosting | The app must sit behind the host's web server/proxy (as on cPanel, Passenger, nginx). Never expose the Node port directly to the internet – rate limits could then be dodged. |
| O13 | POPIA organisational items | Legal | Not technical | Section 6. |

## 4. Tests

**Passed**

- API tests: **152 / 152** (27 new security tests, 6 account tests, all earlier suites).
- Security browser tests: CSP crawl of 40+ pages – 0 violations; injection probe – all blocked; two-step verification,
  security views and backup – 15 / 15.
- Feature suites re-run with all hardening on: sign-up/OTP/WhatsApp/sales/support 42 / 42; content library 30 / 30;
  Products centre 40 / 40; playlists and ordering 25 / 25; video visibility 10 / 10; customer accounts 10 / 10;
  cover restore 4 / 4.
- Production-mode check: security headers present, http→https redirect, cookie flags, no secrets or source maps in
  the build, test inbox off.
- Backup → restore into an empty database → identical data; damaged backup detected.
- `npm audit`: 0 vulnerabilities.

**Failed:** none.

**Not tested (no access):** the live server and its HTTPS certificate; the database server's network exposure and
user rights; real WhatsApp (Meta) traffic; email authentication records (SPF/DKIM/DMARC) for schluss.co.za;
the Windows start/backup `.bat` files.

## 5. Configuration and infrastructure

**New settings (all optional, safe defaults)** – see `.env.production.example`:
`SESSION_STAFF_IDLE_MINUTES` (120), `SESSION_STAFF_MAX_HOURS` (24), `API_RATE_LIMIT` (1500 per 5 min),
`BACKUP_DAILY` (on in production), `BACKUP_DIR`, `BACKUP_KEEP_DAYS` (14), `RETENTION_OTP_DAYS` (7),
`RETENTION_JOB_DAYS` (30), `RETENTION_WEBHOOK_DAYS` (90), `CSP` (leave unset; `report-only` or `off` only for
troubleshooting), `FORCE_HTTPS` (leave unset).

**Database change:** migration `20261119_011_security_hardening.cjs` adds four two-step-verification columns to
`users` and one index to `audit_logs`. Nothing existing is altered. Run `npm run db:migrate`.

**Hosting requirements:** Node.js 20.19+; HTTPS with a valid certificate in front of the app (the app then enforces
it); database reachable only from the website's server; database user limited to the SCHLUSS database; `.env`,
`storage` and `backups` outside any public web folder and readable only by the website's user; operating system and
Node.js kept up to date; ideally the host's firewall/DDoS protection in front.

## 6. POPIA review (technical view – not legal advice)

Technical measures do not make a business POPIA-compliant on their own; the organisational items need your
decision and, ideally, a professional review.

| Question | Finding |
|---|---|
| What personal information is collected | Customers: name, email, cellphone, company, country, password (hashed), consents, demo/licence records, downloads, device activations, support conversations, WhatsApp number and messages, video viewing progress. Enquirers: name, contact details, message. Staff: name, email, sign-in history. Technical: IP addresses in the audit log (hashed elsewhere). |
| Why, and is it necessary | Each item supports an account, a demo/licence, support or a sales enquiry. No special personal information, ID numbers or payment details are collected. Marketing consent is a separate, optional tick box. |
| Who can access it | Staff only, by role and permission (enforced on the server, tested). Customers see only their own. |
| How it is stored and protected | One database; passwords hashed; sessions, reset tokens and codes stored hashed; WhatsApp secrets and two-step secrets encrypted; files private; HTTPS enforced in production. |
| Correction and deletion | Customers can edit their profile. Staff can edit, suspend and delete customer accounts (deletion is refused when history must be kept, by design). **Gap:** there is no self-service "send me my data / delete me" request screen – handle requests by email and record them (the `data_requests` table exists for a future screen). |
| Third parties (operators) | Your hosting provider and xneelo (email), Meta (WhatsApp), Google/YouTube and Vimeo (embedded video – the no-cookie player is used; they see the viewer's IP when a video plays). **Action:** list these in the Privacy Policy and keep operator agreements. |
| Notices and consent | Privacy Policy and Terms pages exist; acceptance and the version accepted are recorded at registration and on forms. **Action:** have the wording reviewed against POPIA (purpose, retention, cross-border transfer to Meta/Google, complaints to the Information Regulator). |
| Retention | Now automatic for short-lived technical data: verification codes 7 days, finished email jobs 30 days, raw WhatsApp webhook data 90 days, expired sessions and reset links. **Decision needed:** how long to keep closed enquiries, inactive customer accounts, email logs and audit-log IP addresses. |
| Breach response | **Gap (organisational):** write a short plan – who decides, how to contain (suspend accounts, change `APP_SECRET` and passwords, restore from backup), and notifying the Information Regulator and affected people "as soon as reasonably possible" (section 22). The audit log, security events and alerts now provide the evidence trail. |
| Information Officer | **Action:** register an Information Officer with the Information Regulator if not already done. |

## 7. Manual actions – exactly what to do

1. **Hosting:** ask xneelo: *"Can my package run a Node.js 20 application continuously, with SSH and MySQL? If not,
   which product can?"* Then follow `docs/GO-LIVE.md`. HTTPS: use the host's free certificate (Let's Encrypt/AutoSSL)
   for schluss.co.za and www.
2. **Pre-flight:** on the server, `npm run live:check`. Fix every "FIX"; read every "WARN".
3. **Mailbox passwords:** xneelo control panel → Email → each mailbox → reset password → put the new values in the
   server's `.env` (`MAIL_PASSWORD`, `MAIL_SALES_PASSWORD`) → restart → Admin › Email settings › Check mail server now.
4. **Two-step verification:** sign in → My security → "Set up two-step verification" → scan with Google/Microsoft
   Authenticator → save the recovery codes somewhere safe (not on the same phone). Repeat for every staff member,
   then tick "Make two-step verification compulsory for all staff".
5. **Backups off the server:** enable the host's daily backups, or download the `backups` folder weekly. Once a
   quarter, restore one on your own computer (`npm run restore`) to prove it works.
6. **Email trust records:** at xneelo add SPF and DKIM for schluss.co.za and a DMARC record – stops others sending
   mail that looks like yours and keeps your emails out of spam.
7. **POPIA:** the actions in section 6.
8. **Staff accounts:** one person per login, no shared accounts; remove the test accounts; give each person only the
   role they need; use Admin › Audit log › Security events weekly.

## 8. Launch-readiness checklist

| Area | Status | Notes |
|---|---|---|
| HTTPS working | **NOT TESTED** | No live server yet. The app redirects to https and sends HSTS once a certificate is in place (tested in production mode). |
| Secure login | **PASS** | Hashing, lockout, rate limits, generic answers, secure cookies, reset flow – tested. |
| Admin protection | **PASS** / **WARNING** | Every admin endpoint enforces permissions on the server (147 endpoints tested). Warning until two-step verification is switched on for your accounts. |
| Business / customer data isolation | **PASS** | Cross-customer access attempts all refused. No business-user logins exist. |
| Database protection | **PASS** (application) / **NOT TESTED** (server) | Parameterised queries, no SQL in errors, restore tested. Network exposure and user rights depend on the host. |
| API security | **PASS** | Authentication, permissions, validation, size limits, rate limits, no CORS, safe errors. |
| File upload protection | **PASS** / **WARNING** | Content checks, size limits, random names, private storage, access control. Warning: virus scanning needs ClamAV on the server. |
| Security headers | **PASS** | CSP (enforced, 0 violations), HSTS, nosniff, frame denial, Referrer-Policy, Permissions-Policy. |
| Dependency security | **PASS** | 0 known vulnerabilities; re-run `npm audit` monthly. |
| Backup and recovery | **PASS** / **WARNING** | Automatic, verified, restore-tested. Warning until copies leave the server. |
| POPIA-related requirements | **WARNING** | Technical measures in place; policy review, Information Officer, operator list, breach plan and retention decisions are yours. |
| Error monitoring | **WARNING** | Server errors are logged and security events alert administrators in the app; there is no external uptime/error monitoring – add a free uptime monitor on `https://schluss.co.za/api/health`. |
| Production environment configuration | **NOT TESTED** | `.env.production.example` and `npm run live:check` are ready; needs the real server. |
| Domain and hosting security | **NOT TESTED** | Use two-step verification on your xneelo/registrar account and keep the domain on auto-renew. |
| Final security testing | **PASS** (test environment) / **NOT TESTED** (live) | After going live, repeat the 10-minute check below. |

**10-minute live check after launch**

1. `http://schluss.co.za` jumps to `https://` with a padlock.
2. Sign in as admin: you are asked for the 6-digit code.
3. Open `https://schluss.co.za/.env` and `/api/admin/customers` in a private window: no file, and "please sign in".
4. Register a test customer: the code arrives; that customer cannot open `/admin`.
5. Admin › System: a backup from today, "verified". Admin › Audit log › Security events: your own sign-ins are listed.
6. Scan the site at securityheaders.com and ssllabs.com/ssltest (both free) – expect A grades.

## 9. Files changed in v11

**New:** `server/api/services/security.ts`, `server/api/services/maintenance.ts`,
`server/db/migrations/20261119_011_security_hardening.cjs`, `src/app/admin/security-pages.ts`,
`tests/server/security.test.ts`, `docs/SECURITY-REPORT.md`.

**Changed:** `src/server.ts` (headers, CSP, HTTPS redirect), `server/api/index.ts` (rate limit, test inbox, health),
`server/api/middleware/auth.ts` (staff sessions, refusal logging, compulsory two-step), `server/api/routes/auth.ts`
(two-step sign-in, alerts, limits), `server/api/routes/admin-system.ts` (security settings, events filter, reset),
`server/api/routes/admin-ops.ts` (webhook, backups), `server/api/routes/admin-catalogue.ts` and `content.ts` (link and
permission tightening), `server/api/http.ts` (bad requests), `server/api/config.ts`, `server/api/services/platform.ts`,
`server/cli/backup.cjs`, `restore.cjs`, `live-check.cjs`, the sign-in page, My security, Staff, Audit log and System
pages, `package.json` (sharp 0.35.5, nodemailer 10.6.0, qrcode added), `.env.production.example`.
