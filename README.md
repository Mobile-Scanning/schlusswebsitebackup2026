# SCHLUSS Platform

Public website, Customer portal, Partner portal and Administration portal for **schluss.co.za** – one Angular + Node application, one MySQL database.

## Architecture

| Layer | Technology | Where |
|---|---|---|
| Frontend (public site + 3 portals) | Angular 22, standalone components, signals, SSR | `src/app` |
| Backend API | Express, mounted at `/api` in the same Node process as Angular SSR | `server/api`, `src/server.ts` |
| Database | MySQL 8 / MariaDB 10.6+ via Knex (pure JS – no native binaries, cPanel-friendly) | `server/db` |
| Background jobs | DB-backed queue processed by a cron-run worker (no Redis needed) | `server/cli/worker.cjs` |
| Email | Nodemailer over SMTP, branded templates stored in DB | `server/mail`, `email_templates` table |

```
src/app/            Angular app
  core/             auth service, guards, reduced-motion service
  shared/           brand (logo/wordmark SVG), portal shell, countries, change-password
  pages/            home (interim), sign-in/register/reset, privacy/terms, 404
  account/ partner/ admin/   lazy-loaded portals
server/
  api/              config, db, http helpers, middleware (sessions/CSRF/RBAC), routes, services
  db/migrations     schema (4 migration files, ~40 tables)
  db/seeds          roles/permissions + default email templates (reference data only)
  db/rbac.json      permission + role definitions
  cli/              create-admin.cjs, worker.cjs
tests/server/       API tests (real database)
```

## Local development

Step-by-step instructions for Windows/macOS with VS Code are in **START-HERE.md**. In short:

```bash
npm install
npm run setup        # creates .env, the database, tables and sample catalogue
npm run admin:create # asks for email, name and password
npm start            # http://localhost:4200 (API included)
```

**Offline preview:** `npm run build:offline` writes `preview/` – a copy of the public website that opens by double-clicking `index.html` (hash URLs, bundled sample data from `src/offline/sample-data.json`, no server; forms and sign-in show a preview message). Refresh its data from a running app with `npm run offline:snapshot`.

Tests: `npm run test:api` (needs `DB_NAME_TEST` database) and `npx ng test --watch=false`.

## Security model (Phase 1)

- Passwords: bcrypt (cost 12). Staff passwords ≥ 12 chars; customers ≥ 10 with letters + a number.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax`, `Secure` (`__Host-` prefixed in production) cookie; only its SHA-256 is stored. 12 h sliding / 14 day absolute expiry. Login rotates the session.
- CSRF: signed double-submit token (`XSRF-TOKEN` cookie → `X-XSRF-TOKEN` header, which Angular sends automatically).
- Brute force: per-IP rate limits + account lock for 15 min after 5 failed logins. Login errors are identical for unknown email / wrong password.
- Password reset: single-use, hashed, 60-minute token; resetting signs out all sessions.
- RBAC: every admin route checks a permission on the server (`requirePermission`). Customers and partners can never reach admin endpoints. Only a Super Administrator can grant Super Administrator.
- Audit log: logins, failed logins, password events, staff and role changes – with actor, before/after and IP; secrets are redacted.
- POPIA: separate consent records per purpose (privacy, terms, **marketing opt-in is separate and optional**); IPs on consents are stored as keyed hashes; fonts are self-hosted (no Google Fonts calls).
- API responses are `no-store` and `noindex`; portal pages send `X-Robots-Tag: noindex`.

## Deploying to cPanel (Setup Node.js App)

> Requires a hosting plan with **"Setup Node.js App"** (CloudLinux / Passenger). Confirm the Node version offered is 20.19 or newer.

1. **Build locally**: `npm ci && npm run build`. Upload the project **without** `node_modules`, `.env`, `.angular` (include `dist/`, `server/`, `package.json`, `package-lock.json`).
2. **Database**: cPanel → MySQL Databases → create database + user (ALL PRIVILEGES). Use utf8mb4.
3. **Node app**: cPanel → Setup Node.js App → Create
   - Node version: 22.x (or ≥ 20.19) · Application mode: Production
   - Application root: e.g. `schluss` · Application URL: `schluss.co.za`
   - Application startup file: `dist/schluss/server/server.mjs`
   - Add the environment variables from `.env.example` (or upload a `.env` file into the application root).
4. Click **Run NPM Install**, then in the cPanel Terminal (inside the app's virtualenv command shown on that page):
   ```bash
   npm run db:migrate && npm run db:seed
   ADMIN_PASSWORD='…' npm run admin:create -- --email you@schluss.co.za --name "Your Name"
   history -c
   ```
5. **Cron** (cPanel → Cron Jobs, every minute):
   `cd ~/schluss && /home/USER/nodevenv/schluss/22/bin/node server/cli/worker.cjs >> ~/schluss-worker.log 2>&1`
6. **SSL**: cPanel → SSL/TLS Status → run AutoSSL for schluss.co.za and www. Force HTTPS redirect in cPanel → Domains.
7. **Email DNS**: add SPF, DKIM (cPanel → Email Deliverability) and a DMARC record.
8. Restart the app; check `https://schluss.co.za/api/health` returns `{"ok":true,"db":"up"}`.

Each new deploy: upload new `dist/` + `server/`, run `npm run db:migrate && npm run db:seed` (seeds are idempotent and never overwrite admin edits), restart the app.

## Backups

- Database: cPanel → Backup (daily) **plus** an off-site copy, e.g. weekly `mysqldump --single-transaction` downloaded or sent to object storage.
- Uploaded files (from Phase 3): back up the private storage folder / bucket on the same schedule.
- Test a restore before launch.

## Phase status

See `claude/phase-1-architecture-report.md` in the SCHLUSS project for the full plan.
- [x] **Phase 1 – Foundation**
- [x] **Phase 2 – Public website**: home, products marketplace, product pages, coming soon, learning centre, partners + application, about, contact, request a demo, privacy/terms, SEO (titles, Open Graph, canonical, JSON-LD, sitemap.xml, robots.txt)
- [x] **Phase 3 – Product management** (except installer/version uploads): categories, 7-step product editor with drafts, pricing, features/FAQs, screenshots & videos, demo options, learning materials, media library, website content editor, publish/unpublish/archive
- [x] Admin: demo requests, partner applications & approval (creates partner login + set-password email), website enquiries, dashboard
- [ ] Phase 4 – Customers, secure downloads, versions/installers, trials & licences (licence API)
- [ ] Phase 5 – Partner portal tools · [ ] 6 – Support tickets & remaining emails · [ ] 7 – Reports · [ ] 8 – Hardening (CSP etc.) · [ ] 9 – Deployment

## Website management quick guide

1. **Categories** – create your product categories first (Admin › Categories).
2. **Products › Add product** – the 7-step editor saves a draft at every step. Publishing requires a short description, a category and (unless Coming Soon) at least one pricing option.
3. **Media library** – upload logos, screenshots (JPG/PNG/WebP/GIF ≤ 5 MB) and PDFs (≤ 25 MB); add YouTube/Vimeo links. Each file has a visibility: public, signed-in customers, approved partners, or staff only – enforced by the server.
4. **Website content** – edit home page text, About, Partner page, contact details, footer and an announcement banner. Contact details stay hidden until filled in.
5. **Demo requests / Business partners / Enquiries** – everything submitted on the website lands here; customers get an emailed reference number.
# schlusswebsitebackup2026
