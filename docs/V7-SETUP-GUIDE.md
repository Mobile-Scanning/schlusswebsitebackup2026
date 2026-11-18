# SCHLUSS v7 – Sales, Support, WhatsApp, Registration & Downloads

This upgrade builds on the existing website. Nothing was rebuilt; existing accounts, products, demos, conversations, branding and animations are kept.

> **Status in one line:** everything below is built and tested against a local database, a simulated WhatsApp server and a non-sending mail setup. **Real email delivery and the real WhatsApp Business account have not been tested yet**, because they need your live credentials (see section 12).

---

## 1. Files created and modified

**New files**

| File | Purpose |
|---|---|
| `server/db/migrations/20261115_007_otp_sales_leads_whatsapp.cjs` | All database changes for v7 (with a working rollback) |
| `server/api/routes/admin-ops.ts` | Admin: leads, sales enquiries, businesses, customer account actions, email & WhatsApp settings, reports + CSV, system status, product downloads. Public WhatsApp webhook |
| `server/api/services/whatsapp.ts` | WhatsApp Cloud API: send, forward to agents, webhook processing, delivery status, retries, failure alerts |
| `server/api/services/realtime.ts` | Live updates (Server-Sent Events) for chats and the Support Inbox |
| `server/api/services/assistant.ts` | SCHLUSS Assistant – instant automated answers from SCHLUSS's own content, clearly labelled |
| `src/app/admin/ops-pages.ts` | Admin pages: Potential leads (+ lead detail), Sales enquiries, Businesses, WhatsApp settings, Email settings, Reports, System settings, Product downloads |
| `src/app/public/installer-panel.ts` | Product page: full-installer download panel and the purchase/quotation form |
| `tests/server/v7.test.ts` | 25 automated tests for v7 |
| `docs/V7-SETUP-GUIDE.md` | This guide |

**Modified files**

- **Server**
  - `index.ts`: raw-body capture for webhook signatures, the CSRF exemption for the webhook only, the new routers, and per-minute delivery checks.
  - `middleware/auth.ts`: blocks unverified customers.
  - `routes/auth.ts`: OTP registration, verification, resend, login and password-reset rules.
  - `routes/support.ts`: departments, enquiry type, assistant, live stream, summary.
  - `routes/public.ts`: contact routing, purchase enquiry, installer info.
  - `routes/customer.ts`: full-installer downloads, My demos.
  - `routes/admin-platform.ts`: full-installer channel, malware scan, nav counts, customer verification status.
- **Services**
  - `services/platform.ts`: department inboxes, encrypted WhatsApp secrets, ClamAV.
  - `services/demos.ts`: demo-expiry leads go to support.
  - `services/catalogue.ts`
- **Data and worker**
  - `cli/worker.cjs`: removes codes from the queue after sending.
  - `db/rbac.json` and `seeds/01_rbac.cjs`: new roles and permissions.
  - `seeds/02_email_templates.cjs`: 8 new templates.
- **Website and portals**
  - Registration and verification: `app.routes.ts`, `pages/auth-pages.ts`, `core/auth.service.ts`.
  - Chat and public pages: `shared/chat-widget.ts`, `public/product-detail.*`, `public/info-pages.ts` (contact type), `public/demo-download.ts`, `core/public-api.ts`.
  - Customer account: `account/account.routes.ts` (My demos, full installer).
  - Admin: `admin.routes.ts` (navigation), `support-inbox.ts`, `crm-pages.ts`, `product-editor.*`, `product-tabs.ts` (Full installer tab), `platform-api.ts`.
- **Tests and configuration**
  - Existing tests were updated to complete email verification: `tests/server/*.test.ts`, `helpers.ts`.
  - `.env.example`, `START-HERE.md`.

---

## 2. Database migrations

Run `npm run db:migrate` and then `npm run db:seed`.

Migration **007** adds:

- `email_otps`: verification codes, stored hashed only.
- `businesses`, plus `customers.business_id`. Existing customers with a company name get their own business record.
- `leads` and `lead_activities`: potential leads with a full contact history.
- `whatsapp_messages`: every WhatsApp message with its delivery status.
- `whatsapp_events`: a raw log of every webhook call.
- Conversations (`tickets`):
  - `department` (support/sales), `enquiry_type` (technical/general/purchase).
  - Channel `whatsapp`, plus `human_at`, `wa_customer_phone` and `wa_last_inbound_at`.
- Messages: `source` (website/admin/whatsapp/bot/system), and author `bot`.
- Sales enquiries (`quote_requests`):
  - New fields: name, email, phone, company, business, source, ticket link, lead link and `closed_at`.
  - New statuses: new, contacted, quoted, processing, won, lost and cancelled.
- Consent purpose `whatsapp`.
- **All existing users are marked as verified**, using their registration date.

Indexes cover status, department, dates, references and WhatsApp message IDs. The unique WhatsApp ID also stops a duplicated webhook from being processed twice. Multi-step actions run in database transactions, such as registration, sales enquiries and lead-to-sales.

---

## 3. Configuration (`.env`)

New optional settings. Your existing `.env` keeps working without them.

```
SUPPORT_EMAIL=support@schluss.co.za     # default support inbox (editable in Admin › Email settings)
SALES_EMAIL=sales@schluss.co.za         # default sales inbox
WHATSAPP_ACCESS_TOKEN=                  # optional – or enter in Admin › WhatsApp settings
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
MAX_UPLOAD_MB=1024
MALWARE_SCAN=                           # "required" = refuse uploads when ClamAV isn't installed
```

The email password, API keys and secrets are **never** put in the website's browser code.

- The SMTP login is read only from `.env`.
- WhatsApp secrets entered in the admin screen are stored encrypted with a key derived from `APP_SECRET`. They can be replaced but never displayed again.

---

## 4. Email provider setup

1. **Create the mailboxes.** Create `support@schluss.co.za`, `sales@schluss.co.za` and `no-reply@schluss.co.za`, either in cPanel › Email Accounts or with your email provider.
2. **Fill in `.env`.**
   - `MAIL_HOST`, for example `mail.schluss.co.za` or your provider's SMTP host.
   - `MAIL_PORT`: `587`, or `465` for SSL.
   - `MAIL_USER` and `MAIL_PASSWORD`: the no-reply mailbox login.
   - `MAIL_FROM="SCHLUSS <no-reply@schluss.co.za>"`.
3. **Set up DNS** so the emails aren't marked as spam. In cPanel this is under Email Deliverability.
   - **SPF**: a TXT record such as `v=spf1 +a +mx include:<your provider> ~all`.
   - **DKIM**: enable it in cPanel, or add your provider's DKIM record.
   - **DMARC**: a TXT record `_dmarc` with `v=DMARC1; p=none; rua=mailto:support@schluss.co.za`.
4. **Start the background worker on the live server.** Add a cron job that runs every minute: `cd /home/<user>/schluss && node server/cli/worker.cjs`.
5. **Test it.** Go to *Admin › Email settings › Send test to support* and *Send test to sales*. Failed emails appear on the same page, and admins get a notification.

---

## 5. WhatsApp Business API setup (official Cloud API)

1. **Create the app and add WhatsApp.** At developers.facebook.com, create an app of type **Business** and add the **WhatsApp** product. Use your verified Meta Business account.
2. **Add the business phone number** under *WhatsApp › API setup*. This number must not be in use on the normal WhatsApp app.
3. **Copy the IDs.** Copy the **Phone number ID** and the **WhatsApp Business Account ID**.
4. **Create a permanent access token.**
   - In *Business settings › Users › System users*, add a system user with Admin access.
   - Assign the app and the WhatsApp account to it.
   - Generate a token with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`.
5. **Copy the App secret.** It is under *App settings › Basic › App secret*.
6. **Create a message template** under *WhatsApp › Message templates*.
   - Category: **Utility**. Name, for example: `support_chat_forward`. Language: English.
   - Body with 3 parameters: `New SCHLUSS chat {{1}} from {{2}}: {{3}} – reply to this message to answer.`
   - Wait for Meta to approve it.
7. **Fill in Admin › WhatsApp settings.**
   - Tick **Enable WhatsApp support**.
   - Enter the display number, Phone number ID, Business Account ID, access token, app secret and a long random **verify token** of your choice.
   - Add each **support agent's WhatsApp number** with their name.
   - Enter the **template name** and **language**.
8. Click **Test connection**. It should say *Connected to …*. Then **Send test** to your own number.

**How agents use it**

- Each new website chat arrives on the agent's WhatsApp, from the business number.
- To answer, **swipe to reply** on that message. The answer appears in the customer's website chat within a second or two, with no refresh.
- An agent can also start a message with the chat reference, for example `SC-2026-ABC234 Hello…`.
- Send `/resolve` or `/close` as a reply to finish a chat.

**The 24-hour rule (Meta's, not ours)**

- Free text can only be sent to a number that messaged the business number within the last 24 hours.
- Outside that window the approved template is used automatically.
- If agents send any message to the business number each morning, forwards stay as normal text all day.

Customers can also message the SCHLUSS WhatsApp number directly. That creates a WhatsApp conversation in the Support Inbox, and admin replies go back to them on WhatsApp.

**Delivery** is never assumed.

- A message is **sent** when Meta accepts it.
- It is **delivered**, **read** or **failed** only when Meta's status webhook confirms it.
- Temporary failures (network errors, Meta outages, rate limits) are retried up to 5 times.
- Support is emailed and notified at most once an hour about failures.

---

## 6. WhatsApp webhook setup

1. **Use a public HTTPS address.** Meta must be able to reach the site, so `localhost` won't work. On the live server the callback URL is `https://schluss.co.za/api/whatsapp/webhook`, which is also shown on the WhatsApp settings page. For local testing, use a tunnel such as `cloudflared tunnel --url http://localhost:4200`.
2. **Configure the webhook in Meta.** Go to *WhatsApp › Configuration › Webhook › Edit*.
   - Paste the callback URL and the same **verify token** you saved in the admin.
   - Click *Verify and save*.
3. **Subscribe to the webhook field `messages`.** It carries both incoming messages and delivery statuses.
4. **Check that calls arrive.** Every webhook call is listed on the settings page under *Recent webhook calls*.
   - Calls without a valid `X-Hub-Signature-256` signature (HMAC with your App secret) are rejected and logged.
   - Duplicate deliveries from Meta are ignored.

---

## 7. Admin usage

| Menu | Who | What it's for |
|---|---|---|
| Dashboard | all staff | Overview |
| Businesses | customers.view | Companies with their customers, demos, packages and sales |
| Customers / users | customers.view | Verification status (Verified / Pending verification / Suspended), **Resend verification code**, **Suspend / Reactivate** |
| Products | products.view | Product editor – incl. **Full installer** and **Demo files** tabs |
| Product downloads | products.view | Per product: current full & demo installer, sizes, 30-day downloads, recent downloads |
| Demo management | licences.view | Demo records & expiry notification intervals (7/3/1/expired) |
| Support Inbox | support.view | Website chat, WhatsApp and contact form. Counters: total, new, open, awaiting customer, unresolved, resolved, WhatsApp, website, leads, demo-expiry leads. Source & department labels, WhatsApp delivery status per reply, live updates |
| Potential leads | leads.view | Demo-expiry leads (support). Record calls / emails / WhatsApp (WhatsApp only with consent), feedback, notes, status, assignment. **Customer wants to buy…** → creates a separate sales enquiry |
| Sales enquiries | sales.view | Purchase and quotation requests only. Status, assignment, notes, reply into the customer's chat |
| WhatsApp settings | whatsapp.manage | Section 5 |
| Email settings | email_settings.manage | Department addresses, test emails, failed emails |
| Notifications | all staff | Alerts (new enquiries, leads, WhatsApp failures, failed emails…) |
| Reports | reports.view | Date-range figures; CSV exports (leads, sales, conversations, customers) |
| System settings | settings.manage | Mail, worker queue, WhatsApp, malware scanner, upload limit, security settings |

**Roles**

- **Super Admin**: everything.
- **Support Agent**: Support Inbox, chats, WhatsApp conversations and potential leads. No sales enquiries.
- **Sales Agent**: sales enquiries only. No support inbox and no leads.
- **Customer**: their own account only.

All rules are enforced on the server.

**Routing rules**

- **Support** receives technical, general, assistant, installation and demo questions, potential customers and demo-expiry leads.
- **Sales** receives only enquiries where the customer explicitly chose *Purchase / sales enquiry*, or the *Buy / get a quote* form.
- Support can also send a confirmed purchase request to sales from a lead.
- The chat may *suggest* a type from the wording, but never changes the customer's choice.
- No choice means support.

---

## 8. Uploading a full installer (.exe)

1. Go to *Admin › Products* and open the product.
2. Open the **Full installer** tab and click **+ New full installer version**.
   - Enter the version number, for example `3.0.0`.
   - Optionally add a name and release notes. These count as the version notes.
   - Add the system requirements and the installation instructions.
   - Set the status to **Released**, then click **Save version**.
3. Under that version, enter a label, for example *Windows installer (64-bit)*, and click **+ Upload file** to choose the `.exe`.
4. **Choose who may download it:**
   - **Customers with an active licence for this product** (default)
   - **Any verified customer**
   - **Nobody online**

**How the files are protected**

- **Checked:** each file is checked by its real contents (a renamed HTML page is refused), type and size. It is scanned by ClamAV when installed.
- **Stored privately:** files are kept on disk outside the database and outside the public folder, with their SHA-256 checksum recorded.
- **Downloaded only with a personal link** that works for 10 minutes. Every download is logged.

Version, size and release date appear on the product page and in *Product downloads*. Pause downloads, replace a file (the old one is kept for history) or withdraw a version from the same tab.

## 9. Uploading a demo installer (.exe)

1. Open the product's **Demo files** tab and click **+ New demo version**. Add the version, instructions and status **Released**, then upload the demo `.exe`.
2. In the **Demo settings** tab:
   - Tick *Offer a downloadable demo*.
   - Set the length, for example 14 days.
   - Choose when it starts (first activation or first download).
   - Save.

The demo and full installers are completely separate.

- The demo download only ever serves files from the product's demo versions.
- The full download only serves that product's full versions.
- A demo request can never return the full version, and a file from one product can never be served for another. This is covered by automated tests.

---

## 10. Registration & email verification (OTP)

**What the customer does**

1. Click **Create account**.
2. Enter name, email, password, confirm password and accept the terms. Business name and cellphone are optional.
3. A 6-digit code is emailed. Enter it on the *Check your email* screen, which also accepts paste and phone autofill.

The account then opens and a welcome email is sent.

**Rules**

- **Code:** the code comes from a cryptographically secure random generator.
  - It is stored only as a hash and is valid for **5 minutes**.
  - It works **once**, and allows **5 wrong attempts**.
  - It is never written to logs, and it is removed from the email queue after sending.
- **New codes:** the customer can request a new code every **60 seconds**. A new code cancels the old one. All verification requests are rate-limited.
- **Unverified accounts:** they cannot sign in, open the portal, download demos or installers, or reset a password. Signing in redirects them to the verification screen.
- **Duplicate email:** registering with an email that already exists is refused. Unverified owners are sent to verification instead.
- **Statuses:**
  - **Pending verification**
  - **Verified**
  - **Suspended**: admin only; the customer is signed out immediately.

There is no bypass, including for staff.

**Admin**

- *Customers › (customer)* shows the status.
- **Resend verification code** sends a new code.
- **Suspend** and **Reactivate** control access.

---

## 11. Test results (this build)

| Suite | Result |
|---|---|
| API tests – all (`npm run test:api`) | **81 / 81 passed** (56 existing, updated for verification + 25 new v7 tests) |
| Unit tests (`ng test`) | 1 / 1 passed |
| Production build (`ng build`) | Passes; initial bundle within budget |
| Browser end-to-end (Playwright, desktop + mobile) | **43 / 43 checks passed, no browser errors** |

**v7 API tests cover:**

- **OTP:**
  - The code is hashed.
  - Wrong codes, expiry and single use.
  - The 5-attempt lock.
  - The resend cooldown and that a new code cancels the old one.
  - Duplicate registration.
  - Unverified accounts are blocked.
  - Reset only for verified accounts.
  - The worker removes the code from the queue.
- **Routing:**
  - Technical, general and no-type enquiries go to support only, even when the wording mentions buying.
  - Purchase enquiries go to sales.
  - Contact form and purchase form routing.
- **Role separation:** support vs sales vs customer.
- **Leads:** contact attempts, feedback and status. A purchase must be confirmed before it reaches sales. A won sale converts the lead.
- **Installers:**
  - Demo vs full are separate.
  - An unlicensed customer is blocked.
  - The other product is blocked.
  - The download link is personal.
- **WhatsApp** (against a simulated Meta server):
  - Secrets are write-only and encrypted.
  - Webhook verification, and signature rejection.
  - Two simultaneous chats with replies in reverse order each land in the right chat.
  - Replies arrive live over the event stream.
  - Reply by reference, and `/resolve`.
  - Duplicate webhooks are ignored.
  - Delivery statuses never go backwards.
  - Customer-initiated WhatsApp chats work.
  - Retries after a Meta error, and the failure alert.
  - Switched off means nothing is sent.
- **Admin:** email settings, businesses, reports, CSV export, account suspend, reactivate and resend.

**End-to-end in a real browser:**

- **Admin and settings:**
  - Admin menu and every new page.
  - Saving WhatsApp settings and *Test connection*.
  - Webhook verification.
- **Installers:** uploading a full installer through the product editor.
- **Registration:**
  - A password mismatch is caught.
  - No portal access before verification.
  - A wrong code is rejected and the right code opens the account.
  - The My demos page.
- **Product page:**
  - The installer is gated without a licence and downloadable with one.
  - The purchase form goes to sales.
- **Chat and WhatsApp:**
  - The chat type suggestion.
  - The chat is forwarded to WhatsApp.
  - The agent's WhatsApp reply appears in the open chat without a refresh, with "joined" shown.
  - The admin inbox shows "via WhatsApp" and the delivered status.
  - The sales list.
- **Mobile:** the verification screen fits the phone width with no sideways scrolling.

**Not tested (needs your live accounts):**

- Sending real email through your SMTP server.
- Real WhatsApp messages through Meta.
- ClamAV scanning, which isn't installed in the test environment. Uploads were recorded as "not scanned".

---

## 12. Remaining external configuration (to do before go-live)

1. **Email:** fill in the SMTP settings in `.env`, create the support, sales and no-reply mailboxes, and add the **SPF, DKIM and DMARC** DNS records. Then send the test emails from *Admin › Email settings*.
2. **Background worker:** add the cron job that runs `node server/cli/worker.cjs` every minute on the live server.
3. **Meta account:** a **verified Meta Business account** and a WhatsApp Business phone number that isn't used in the normal WhatsApp app.
4. **Token and secret:** a **permanent System User access token** and the **App secret**.
5. **Template:** an **approved message template**, as in section 5, step 6.
6. **Webhook:** set it up on the public HTTPS URL and subscribe to `messages` (section 6).
7. **Agent numbers:** enter them in *Admin › WhatsApp settings*, then click *Test connection* and *Send test*.
8. **ClamAV (optional but recommended):** install it on the server (`clamdscan`). Set `MALWARE_SCAN=required` to refuse unscanned uploads.
9. **Upload limit:** raise the hosting upload limit (cPanel/PHP/nginx) if installers are larger than the current limit.
10. **Staff accounts:** create staff with *Admin › Staff* and give them the **Support Agent** or **Sales Agent** role.

Until steps 3–7 are done, WhatsApp stays switched off and the website chat and email routing work normally.
