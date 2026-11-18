# SCHLUSS email setup (v10.2)

## What is set up

| | Mailbox | Used for |
|---|---|---|
| **Support** | support@schluss.co.za | Receives everything except partner registrations: support and contact messages, purchase / quotation enquiries, demo requests, potential leads, WhatsApp chats, system alerts. Sends verification codes (OTP), welcome and password emails, demo and trial emails, and customer confirmations. |
| **Sales** | sales@schluss.co.za | Receives **business partner registrations**. Sends the partner emails (application received, approved, declined, reactivated), so partners' replies come back to sales@. |

Mail server: `smtp.schluss.co.za`, port `465`, SSL/TLS on, login required. Both mailboxes log in with their own address and password.

## Where the settings live

In the `.env` file in the project folder (already filled in in this download):

```
MAIL_HOST=smtp.schluss.co.za
MAIL_PORT=465
MAIL_USER=support@schluss.co.za
MAIL_PASSWORD=…            (support mailbox password)
MAIL_FROM="SCHLUSS <support@schluss.co.za>"
MAIL_SALES_USER=sales@schluss.co.za
MAIL_SALES_PASSWORD=…      (sales mailbox password)
MAIL_SALES_FROM="SCHLUSS Sales <sales@schluss.co.za>"
```

Passwords are only ever read from `.env` on the server. They are not stored in the database and never shown in the admin or sent to browsers. If you change a mailbox password at your host, change it here too and restart.

## Check that it works (2 minutes)

1. Start the site (`npm start`) and sign in to the admin.
2. Open **Email settings**. "Mail server" should show both mailboxes with "password set".
3. Click **Send test to support**, then **Send test to sales**. Within about 15 seconds each mailbox should receive a test email (check webmail).
4. If one doesn't arrive, look at **Failed emails** on the same page. "The mail server refused the login … check the mailbox password in .env" means the password in `.env` doesn't match – copy it again from your hosting panel (letters such as `l`, `I`, `O` and `0` are easy to mix up) and restart.

## If an email (such as a verification code) doesn't arrive – v10.3

**Admin › Email settings › Check mail server now.** It connects to the mail server and logs in to each mailbox
immediately, and tells you in plain words what is wrong. Type an address in the box next to the button to also send
one test email straight away.

The same check from a terminal in the project folder (works even if you can't sign in to the admin):

```
npm run mail:check
npm run mail:check -- you@example.com     (also sends a test email to that address)
```

| It says | What to do |
|---|---|
| The mail server refused the password | Copy the mailbox password again from your hosting panel into `.env` (`MAIL_PASSWORD` for support@, `MAIL_SALES_PASSWORD` for sales@). `l`/`I`/`1` and `O`/`0` look alike. |
| Could not reach … on port 465 | A firewall, antivirus "mail shield", VPN or internet provider is blocking outgoing mail from this computer. Allow Node.js, switch off antivirus mail scanning, or try another network (phone hotspot). |
| The certificate is not issued for "smtp.schluss.co.za" – it is issued for … | Set `MAIL_HOST` in `.env` to the server name it shows (your host's own mail server name). |
| The name could not be found | Check the spelling of `MAIL_HOST`, and that the computer is online. |
| Everything works, test email accepted – but nothing in the inbox | Check Spam/Junk. For Gmail/Outlook, add SPF and DKIM records for schluss.co.za at your host. |

Also in v10.3: mail problems are recorded within about 15 seconds under **Emails with problems** (previously an
unreachable mail server could leave an email waiting with no message); changes to the mail settings in `.env` are
picked up by the email sender straight away; verification codes are not retried for long, because an old code is useless –
use "Resend code" on the sign-up page after fixing the problem.

## Changing who receives what

**Admin › Email settings**: change the support or sales address, and choose which department receives business partner registrations and purchase / quotation enquiries. Everything else always goes to support.

## Good to know
- While `MAIL_HOST` is set, the development inbox (`/api/dev/mail`) is switched off – real emails are sent.
- Emails are sent in the background within about 15 seconds; verification codes go first.
- For best delivery to Gmail/Outlook, make sure your domain has SPF and DKIM records (your host's email settings usually have a one-click option).
