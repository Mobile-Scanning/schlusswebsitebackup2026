# SCHLUSS platform – start here

There are two ways to see the app.

| | What you get | What you need |
| --- | --- | --- |
| **A. Offline preview** | The public website: home, products, product pages, Learning Centre, About, Partners, Contact. Sample data. Forms and sign-in show a "preview" message. | Nothing. Just a browser. |
| **B. Full app** | Everything: website, forms that save, sign-in, admin portal, partner portal, customer account, emails. | Node.js, MySQL/MariaDB, VS Code. |

---

## A. Offline preview (double-click)

1. Extract the zip.
2. Open the **`schluss-platform`** folder and double-click **`index.html`**.
   (It opens `preview/index.html`, which you can also double-click directly.)

That's it. Use Chrome, Edge or Firefox.

---

## B. Full app in Visual Studio Code

### 1. Install these once

- **Node.js 22 LTS** (or newer) – https://nodejs.org → "LTS" installer. Accept the defaults.
- **A MySQL or MariaDB database server.** The easiest on Windows is **XAMPP** – https://www.apachefriends.org. After installing, open the *XAMPP Control Panel* and click **Start** next to **MySQL**.
- **Visual Studio Code** – https://code.visualstudio.com

Check Node is installed: open a new terminal and run `node -v`. It should print `v22…` or higher.

### 2. Open the project

In VS Code: **File → Open Folder…** → choose the extracted `schluss-platform` folder.
Then open a terminal: **Terminal → New Terminal**.

### 3. Run these commands in the terminal (in this order)

```powershell
npm install
npm run setup
```

- `npm install` downloads everything the app needs into `node_modules` (a few minutes the first time).
- `npm run setup` creates your `.env` settings file, creates the `schluss` database, builds the tables and loads the sample products.

It assumes the XAMPP default: MySQL user `root` with **no password**. If yours is different, open `.env`, change `DB_USER` / `DB_PASSWORD`, and run `npm run setup` again.

### 4. Create your admin login

```powershell
npm run admin:create
```

It asks for your email, your name and a password (at least 12 characters).

### 5. Start the app

```powershell
npm start
```

Open **http://localhost:4200** in your browser.

- Admin portal: http://localhost:4200/admin (sign in with the login from step 4)
- Stop the app: click in the terminal and press **Ctrl + C**
- Next time you only need: `npm start` (with MySQL running in XAMPP)

---

## Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the full app for development at http://localhost:4200 (reloads when you edit files) |
| `npm run build` | Production build into `dist/` (for the live server) |
| `npm run start:prod` | Runs the production build at http://localhost:4000 |
| `npm run build:offline` | Rebuilds the double-click preview in `preview/` |
| `npm run offline:snapshot` | Copies the current products and content from a running app (`npm run start:prod`) into the preview data, then run `npm run build:offline` |
| `npm run test:api` | Runs the API tests (needs a `schluss_test` database) |
| `npm run worker` | Sends queued emails once (needs the `MAIL_*` settings in `.env`) |
| `npm run setup` | Safe to run again any time: creates anything missing, never deletes data |
| `npm run db:fresh` | Wipes your **local** database and sets it up again (asks you to confirm) |

## If something goes wrong

The setup and the app explain database problems in plain words, starting with ✖ and a → line telling you what to do. Do what the → line says.

- **A long error with `Acquire connection error`, `ClientHandshake` or `handlePacket`** – the app can't use the database. Usually `npm run setup` hasn't finished, MySQL isn't running, or the login in `.env` is wrong. Stop the app (Ctrl + C), run `npm run setup`, fix whatever it reports, then `npm start` again.
- **Setup stopped halfway and now says tables already exist** – run `npm run db:fresh`. It asks you to type the database name, then wipes the local database and sets it up again. (Only for your own computer – never on the live server.)
- **`npm` is not recognised** – Node.js isn't installed, or VS Code was open while you installed it. Close and reopen VS Code.
- **"Could not connect to MySQL"** – start MySQL in the XAMPP Control Panel, check `DB_USER` / `DB_PASSWORD` in `.env`, then `npm run setup` again.
- **Port 4200 is already in use** – another copy is running. Close the other terminal, or run `npx ng serve --port 4300` and open http://localhost:4300.
- **PowerShell says scripts are disabled** – run this once, then try again:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- **Emails aren't sent** – that's expected locally until you fill in the `MAIL_*` settings in `.env`. Demo requests and enquiries are still saved and show in the admin portal.

Going live on cPanel hosting is covered in `README.md`.

---

## Updating an existing installation (demos, customers, support chat – v6)

This version adds database tables and columns. Your existing data is kept. In the VS Code terminal, inside the `schluss` folder:

```
npm install
npm run db:migrate
npm run db:seed
npm start
```

- `db:migrate` adds the new tables/columns (demos, chat, setup steps…). Nothing existing is changed or deleted.
- `db:seed` adds the default chat topics and the new email templates. Your own edits are never overwritten.

**Where to find the new features**

- *Admin › Products › (a product)* – tabs for Product images, Documents, External URLs, **Demo files**, **Demo settings**, **Demo history**, **Setup steps**, Downloads and Enquiries.
- *Admin › Demos* – demo dashboard, filters, expiry notification settings, “Check expiries now”.
- *Admin › Customers* – customer profiles with demos, downloads, activations, packages and conversations; **Assign package**.
- *Admin › Support Inbox* – website chat and contact-form conversations; replies, internal notes, topics & settings.
- *Admin › Notifications* – demo expiry and support alerts.
- Website: **Download the demo** on product pages, and the chat button (bottom right).
- Customer account: My products, step-by-step setup guide, Support, Business profile.

**Good to know**

- Demo expiry checks run automatically inside the website every 10 minutes.
- Emails (expiry reminders, chat replies) are sent by the background worker – on the live server run `node server/cli/worker.cjs` from cron every minute, and set `MAIL_HOST` etc. in `.env`.
- Large installers: uploads up to `MAX_UPLOAD_MB` (default 1024 MB). Your hosting’s upload limit may be lower – raise it in cPanel if large uploads fail.
- Installed software can use the central licensing API (`/api/licensing/activate`, `/validate`, `/public-key`) so demos stop when they expire. A plain installer that never checks its licence cannot be switched off remotely.

---

## Updating to v7 (sales & support routing, WhatsApp, email verification, full installers)

Your data is kept. In the VS Code terminal, inside the `schluss` folder:

```
npm install
npm run db:migrate
npm run db:seed
npm start
```

- `db:migrate` adds: email verification codes, businesses, potential leads (+ history), WhatsApp message/webhook logs, and new columns on conversations and sales enquiries. **Existing customer accounts are marked verified**, so nobody already registered is locked out.
- `db:seed` adds the new roles (**Support Agent**, **Sales Agent**), the new permissions and the new email templates. Your own edits are never overwritten.
- The full step-by-step guide (email provider, WhatsApp Business API, webhook, uploading installers, testing) is in **`docs/V7-SETUP-GUIDE.md`**.

**Where to find the new features**

- *Admin › Potential leads* – demo-expiry leads for the **support** team (call / email / WhatsApp, notes, feedback, status). “Customer wants to buy…” creates a separate sales enquiry.
- *Admin › Sales enquiries* – purchase and quotation requests only.
- *Admin › WhatsApp settings* / *Email settings* / *System settings* / *Reports* / *Businesses* / *Product downloads*.
- *Admin › Products › (a product) › Full installer* – upload the full `.exe` (separate from **Demo files**).
- Website: registration now emails a 6-digit code; the chat asks “Technical support / General assistance / Purchase”; product pages have **Full version** and **Buy / get a quote** sections.
- Customer account: Dashboard, **My demos**, My support.

### Testing registration on your computer (verification code emails)

- Emails now send automatically from the website every 15 seconds – no extra command is needed. (`AUTO_SEND_EMAIL=off` in `.env` switches this off.)
- **Real emails need a mail server.** Fill in `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD` and `MAIL_FROM` in `.env`, then restart `npm start`.
- **No mail server yet?** On your computer only, each email is saved instead. The *Check your email* screen shows a link to the **development inbox** (`http://localhost:4200/api/dev/mail`), where you can open the email and read the code. This inbox never exists on the live site, or once `MAIL_HOST` is set.

---

## Updating to v8 (product content library: videos, tutorials, cover pages)

```
npm install
npm run db:migrate
npm start
```

- `npm install` adds `sharp`, which resizes and optimises cover images. It is optional: if it can't install, covers are stored as uploaded.
- `db:migrate` adds the content library tables. Nothing existing is changed.
- **To add content:** go to Admin › Products › (a product) › **Content library**. Settings are under Admin › **Video & content settings**.
- The full guide is in **`docs/V8-CONTENT-LIBRARY-GUIDE.md`**.

---

## Upgrading to v9 – one central Products section

1. `npm install`
2. `npm run db:migrate` – adds the offering type and optional features to products (existing products become "Software product", or "Product under development" if they were Coming soon; nothing is deleted).
3. `npm start`

Then open **Admin → Products**. Everything product-related (offerings, customer demos, downloads, website categories, learning centre articles, video & content settings) is now inside this one section. Use **+ Add new offering** to create software, learning content or training courses. Full details: `docs/V9-PRODUCTS-CENTRE-GUIDE.md`.

---

## Upgrading to v10 – YouTube playlist imports & drag-and-drop ordering

1. `npm run db:migrate` (adds a "came from playlist" marker to content; nothing existing changes)
2. Optional: put a free YouTube Data API v3 key in `.env` as `YOUTUBE_API_KEY=` to import whole playlists. Without it, YouTube only shares 15 videos per playlist.
3. `npm start`

In a product's **Videos / lessons** section use **+ Add a video** (one link) or **+ Import YouTube playlist** (a whole folder). Drag ⠿ to change the order. Details: `docs/V10-PLAYLISTS-AND-ORDERING.md`.

---

## v10.2 – Email is set up (support@ and sales@)

The `.env` in this download already contains the schluss.co.za mail server and both mailboxes. No database change.

1. Replace your project files with this version (keep your `storage` folder), then `npm install` and `npm start`.
2. Admin › **Email settings** → **Send test to support** and **Send test to sales**.

Business partner registrations go to sales@; everything else goes to support@. Details: `docs/EMAIL-SETUP.md`.

---

## v10.4 – Missing cover images are restored automatically

**Important when updating:** uploaded files (cover images, installers, uploaded videos, product pictures) live in the
`storage` folder inside the project, not in the database. When you install a new version, **copy your existing
`storage` folder into the new project folder** (or extract the new version over the old folder). If it is left
behind, the website still lists everything but the files themselves are gone.

Tip – so this can't happen again: put the files somewhere outside the project and point the site at it in `.env`:

```
STORAGE_DIR=C:\SchlussStorage
```

(Create the folder, move the contents of your current `storage` folder into it once, restart.)

New in v10.4:
- Cover images of YouTube/Vimeo videos whose file is missing are **recreated automatically** from the video's
  thumbnail – when a visitor opens the page, and when you open the product's Videos section in the admin.
- The admin shows which files are missing (covers and uploaded videos) instead of broken pictures.
- No database change: `npm install`, `npm start`.

---

## v10.5 – Verification codes when coming back, and delete / suspend customer accounts

No database change: copy your `storage` folder across, `npm install`, `npm start`.

- **Verification code:** if someone registers or signs in again with an address that is still waiting for
  verification, a fresh code is now emailed automatically (previously they reached the "enter your code" page
  without a new email). The page now says honestly whether the email was sent, is being sent, or could not be sent.
- **Admin › Customers:** each row has **Suspend / Reactivate** and **Delete**. The customer page has
  **Delete customer** next to Suspend account.
  - Suspend: the customer is signed out and cannot sign in until reactivated. Nothing is deleted.
  - Delete: removes the login and profile permanently. Only possible when the customer has no history
    (demos, packages, downloads, service records, sales enquiries, leads, support conversations) – otherwise
    the site explains why and you can suspend instead. Deleted addresses can register again.

---

## v10.7 – Verification codes are sent immediately, and you can see every email

No database change: copy your `storage` folder across, `npm install`, `npm start`.

- A verification code is now sent the moment someone registers (or asks for a new code) – no 15-second wait.
- **Admin › Email settings › Latest emails** lists every email with its status (Waiting, Sent with the time,
  Retrying, Failed), how many are waiting, and when the automatic sender last ran. If the sender itself stops
  with an error, the error is shown there. **Send waiting emails now** sends anything in the queue on the spot.
- "Sent" means your mail server accepted the email. If the person can't find it, it is in their Spam/Junk
  (or Gmail's Promotions/Updates) folder.

---

## v10.8 – Backup, restore and going live

No database change: copy your `storage` folder across, `npm install`, `npm start`.

- `npm run backup` – one complete copy of your database and uploaded files, in `backups\`. Changes nothing.
- `npm run restore -- "path\to\schluss-backup-…"` – puts a backup into another installation and proves every
  row and file arrived.
- `npm run live:check` – on the live server: checks settings, database, data, storage and email.
- Step-by-step guide for moving to schluss.co.za: **`docs/GO-LIVE.md`**. Settings template: `.env.production.example`.

---

## v11 – Security hardening before launch

1. Copy your `storage` folder across, then `npm install` and `npm run db:migrate` (adds two-step-verification
   columns – nothing existing changes), then start as usual.
2. Sign in to the admin → **My security** → set up **two-step verification** with an authenticator app.

What changed, what was tested and what you still need to do: **`docs/SECURITY-REPORT.md`** (includes the launch
checklist and the GO / NO-GO recommendation).
