# Moving SCHLUSS to schluss.co.za without losing anything

Everything you have saved lives in two places on your computer: the **database** (products, videos, customers,
settings, enquiries, logins) and the **storage folder** (pictures, covers, installers, uploaded videos).
The steps below copy both, and the last step proves that every row and every file arrived.

## Before anything else: check your hosting can run the site

SCHLUSS is a Node.js program. It needs, on the server:

- **Node.js 20.19 or newer** that can run a program continuously (not only PHP)
- **MySQL 8 or MariaDB 10.6+**
- A way to run commands (SSH or a terminal in the control panel)
- HTTPS (an SSL certificate) for schluss.co.za

**Ask xneelo exactly this:** *"Can my hosting package for schluss.co.za run a Node.js 20 application continuously,
with SSH access and a MySQL database? If not, which of your products can?"*

- If the answer is **yes** – follow the steps below on that package.
- If the answer is **no** (ordinary web hosting packages are usually PHP-only) – you need a package that can:
  a cloud / self-managed server at xneelo, or a host whose cPanel has **"Setup Node.js App"**.
  Your domain and your two mailboxes can stay at xneelo either way; only the website's address (DNS "A record")
  is pointed at the new server. Nothing about email changes.

Do not cancel or change anything at xneelo until the site is running on the new place and checked.

## Step 1 – Back up everything (on your computer, 1 minute)

In the project folder:

```
npm run backup
```

This creates `backups\schluss-backup-DATE-TIME\` containing the database, a copy of the storage folder and a list
of what is inside (row counts per table, every file). It changes nothing. **Keep this folder safe and private** – it
is also your safety copy if anything ever goes wrong. Make a second copy on a USB stick or OneDrive.

## Step 2 – Build the website (on your computer)

```
npm run build
```

This creates the `dist` folder – the ready-to-run website.

## Step 3 – Upload

Upload these to a folder on the server (for example `schluss`), **not** inside the public web folder:

| Upload | Do not upload |
|---|---|
| `dist`, `server`, `public`, `package.json`, `package-lock.json`, `.env.production.example` | `node_modules` (Windows-only files – it is installed fresh on the server) |
| your backup folder `schluss-backup-…` (zip it first) | `.angular`, `src`, `tests`, `preview`, `tools` (not needed to run) |
| | your computer's `.env` (the server gets its own – next step) |

## Step 4 – Settings on the server

1. Create a database and database user at your host (utf8mb4). Note the name, user and password.
2. On the server, copy `.env.production.example` to `.env` and fill in the marked lines: a new `APP_SECRET`,
   the database details, and the two mailbox passwords. Set `STORAGE_DIR` to a folder outside the website folder.
3. Because `APP_SECRET` is new: if you saved WhatsApp details in the admin, enter them once more after going live.

## Step 5 – Install, create the tables, restore your data

In the project folder on the server:

```
npm install --omit=dev
npm run db:migrate
npm run restore -- "path/to/schluss-backup-DATE-TIME"
```

The restore finishes with a check like this – this is your proof nothing was lost:

```
✓ Database: all 4709 rows in 55 tables match the backup
✓ Files: all 945 uploaded files are in place
Restore complete – nothing was lost.
```

If it shows a ✗, stop and send the output – do not go live.

## Step 6 – Pre-flight check and start

```
npm run live:check
npm run start:prod
```

`live:check` confirms the settings, database, your data, the storage folder and both mailboxes, and tells you in
plain words what to fix. Then start the site the way your host runs Node apps (in cPanel: "Setup Node.js App" with
startup file `dist/schluss/server/server.mjs`; on a server: a process manager such as pm2 or systemd so it restarts
by itself). Point schluss.co.za at it and switch on HTTPS.

## Step 7 – Check the live site (5 minutes)

- Sign in to the admin with your usual email and password
- Admin › Products: your products, videos and covers are there
- Admin › Email settings › **Check mail server now**
- Register a test customer → the code arrives → sign in → open a product → play a video
- Send a contact message → it arrives at support@
- Delete the test customer again (Admin › Customers)

## Afterwards

- **Run `npm run backup` regularly on the server** (and copy the folder off the server). It is the same command.
- **Updates:** upload the new `dist` and `server` folders, run `npm install --omit=dev` and `npm run db:migrate`,
  restart. Your data and `STORAGE_DIR` are not touched.
- **WhatsApp:** register the live address (`https://schluss.co.za/api/whatsapp/webhook`) with Meta.
- **Email delivery:** add SPF and DKIM records for schluss.co.za at xneelo so Gmail/Outlook trust your emails.

## What was tested

The backup and restore were tested by restoring a backup into an empty database on a second installation:
all 52 data tables were byte-for-byte identical (database checksums), every file was present, the admin could sign in
with the existing password, products, videos and covers showed, and the site ran in production mode with only the
production packages installed. It has **not** been tested on your actual hosting – that is what Steps 5–7 check.
