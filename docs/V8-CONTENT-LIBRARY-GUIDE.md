# SCHLUSS v8 – Product Content Library (videos, tutorials, cover pages)

This is an add-on to the existing website. Products, product pages, downloads, demos, the customer portal and the admin portal all keep working as before. The old **Videos** tab and section were left unchanged.

What this upgrade adds:

- **A content library per product.** Every product can now hold any number of videos, tutorials, demonstrations, training videos, installation guides and feature explanations.
- **Categories and covers.** Items are grouped in categories you define, and each item has its own cover image.
- **In-site viewing.** Customers see the items as cover cards on the product page. Clicking a card opens a viewer **on the SCHLUSS website**, never on YouTube or Vimeo.

---

## 1. Files created

| File | Purpose |
|---|---|
| `server/db/migrations/20261116_008_product_content_library.cjs` | Database changes (with rollback) |
| `server/api/services/content.ts` | Access rules, video-link parsing and testing, official embed URLs, cover optimisation |
| `server/api/routes/content.ts` | Customer API (library, viewer, playback, protected streaming, progress, covers) and admin API (categories, items, bulk actions, link test, cover upload, analytics, settings) |
| `src/app/public/content-library.ts` | Product page: cover cards grouped by category |
| `src/app/public/content-viewer.ts` | In-site viewer at `/products/<product>/content/<id>` |
| `src/app/admin/content-admin.ts` | Admin: **Content library** tab, plus the **Video & content settings** page |
| `tests/server/content.test.ts` | 9 automated tests: access, isolation, streaming protection, analytics |
| `docs/V8-CONTENT-LIBRARY-GUIDE.md` | This guide |

## 2. Files modified

| File | Change |
|---|---|
| `server/api/index.ts` | Mounts the new content routes |
| `server/api/services/platform.ts` | New `content.settings` defaults |
| `server/api/services/storage.ts` | Byte-range reading (for video seeking) |
| `server/api/routes/admin-catalogue.ts` | Deleting a product now also removes its content library (fixes a MariaDB cascade problem) |
| `src/app/app.routes.ts` | Viewer route |
| `src/app/public/product-detail.ts` / `.html` | "Videos & tutorials" section and tab |
| `src/app/admin/product-editor.ts` / `.html` | New **Content library** tab |
| `src/app/admin/admin.routes.ts` | **Video & content settings** menu item |
| `package.json` / `angular.json` | `sharp` (optional) for cover-image optimisation |
| `tests/server/product-delete.test.ts` | Covers deleting products that have content |
| `START-HERE.md` | Upgrade steps |

---

## 3. Database changes

Run `npm install`, then `npm run db:migrate`.

| Table / column | What it holds |
|---|---|
| `products.content_access` | Who may watch this product's content: `public`, `registered`, `authorised` or `demo`. Empty means the default from Content settings. |
| `product_content_categories` | id, product_id, name, description, display_order, status (active/hidden), timestamps |
| `product_content_items` | id, product_id, category_id, title, description, content_type, cover_media_id, video_provider (youtube/vimeo/upload), video_reference, video_media_id, duration_seconds, tags, display_order, status (draft/published), access_level (inherit/public/registered/authorised/demo), embed_check (last link test), published_at, created_by, updated_by, timestamps |
| `product_content_views` | id, content_id, product_id, customer_id, viewer_hash, viewed_at, last_progress_at, progress_seconds, duration_seconds, percent, completed |

**Relationships and data handling**

- One product has many categories and many items. An item belongs to one product, and optionally to one category of **that same product**. The server refuses a category from another product.
- Covers and uploaded videos reuse the existing `media` table and private storage, so there is no second file system.
- Foreign keys and indexes are in place on product, category, order, status and view date.
- **Viewer identity:** views store a customer ID or a keyed hash. No IP addresses or other personal data are stored.

---

## 4. Video hosting – options and limitations

| Source | Cost | Plays inside SCHLUSS | Limit to your website | Hide from the provider's own site | Download protection | Best for |
|---|---|---|---|---|---|---|
| **YouTube** (Unlisted) | Free | Yes (official embed, privacy-enhanced `youtube-nocookie.com`) | **No.** Anyone with the link can watch on YouTube. | Unlisted only (not searchable) | YouTube offers no downloads, but the link is visible in the page | **Public** marketing videos |
| **Vimeo** (Standard plan or higher) | Paid Vimeo plan | Yes (official embed) | **Yes:** "Where can this be embedded → Specific domains → schluss.co.za" | Yes: "Hide from Vimeo" | Switch off "Allow downloads" in Vimeo | Customer-only content without using your server's bandwidth |
| **Secure upload** (MP4/WebM stored on your server) | None (uses your hosting disk and bandwidth) | Yes (SCHLUSS player) | Yes: only playable through SCHLUSS | Never public | Strongest of the three (see section 8) | Licence- or demo-only training content |

**What this means in practice**

- **YouTube** cannot restrict playback to your domain, so the admin shows a warning whenever a YouTube video is used for non-public content.
- **YouTube embedding** must be switched on ("Allow embedding" in YouTube Studio), and Private videos can't be embedded at all. Use **Unlisted**. Link testing detects both problems.
- **Vimeo domain-restricted videos** can't be tested from the server, because Vimeo hides their details. They're saved as "Not verified". Use **Preview** to confirm they play.
- **Secure uploads** use your hosting's disk space and bandwidth.
  - Each video can be up to `MAX_UPLOAD_MB`, capped at 1024 MB.
  - Use **MP4 (H.264 + AAC)** for the widest browser support. WebM also works.
  - For very large libraries or heavy traffic, a paid streaming service with encrypted adaptive streaming and signed URLs (for example Cloudflare Stream or Mux) is the next step up. It isn't included, because it needs a subscription and credentials that couldn't be tested here.

No API keys are needed for YouTube or Vimeo. Links are tested through each provider's public oEmbed service.

## 5. Storage configuration

- **Secure-upload videos and covers** are stored in the existing private storage folder, `STORAGE_DIR` (default `storage/` inside the app). It is outside the public web folder and never served directly.
- **Video files** are marked staff-only. Customers can only reach them through the protected streaming endpoint.
- **Covers** are resized to fit 1600×900 and converted to WebP when the optional `sharp` package is installed. `npm install` installs it on Windows, macOS and Linux. Without it, covers are stored unchanged.
- **Upload limits:** covers up to 10 MB in, at least 480×270 (1280×720 recommended). Videos up to `MAX_UPLOAD_MB`, capped at 1024 MB. Raise your hosting's upload limit if large uploads fail.

---

## 6. Admin instructions

- **Admin › Products › (product) › Content library** – everything per product:
  - **Overview:** total items, published, unpublished, categories, last updated.
  - **Who can watch:** Public / Registered / Authorised (active licence for this product) / Demo (active demo or licence), or the default.
  - **Add content**, **+ Category**, and rename, reorder (↑ ↓) or delete categories.
  - **Per item:** reorder (↑ ↓), Edit, Preview, Publish / Unpublish, Delete (asks for confirmation).
  - **Bulk:** tick items, then Publish, Unpublish or Move to a category. The ↑ ↓ buttons change the display order.
  - **Preview product page ↗:** shows the library exactly as customers see it, with drafts marked "Draft".
  - **Show analytics:** last 30 days of views, unique viewers, completions, average watched, most and least viewed, popular categories and activity.
- **Admin › Video & content settings** – settings for all products:
  - Turn video sources on or off.
  - Set the default access level.
  - Choose whether new items publish immediately.
  - Choose whether a cover is required before publishing.
  - Set the playback link lifetime and the repeat-view window.
  - Status checks: cover optimisation, storage, and a YouTube/Vimeo connection test.
- **Deleting a category** always asks what to do with its items:
  - **Move them** to another category,
  - **Keep them** uncategorised, or
  - **Delete them too** (a second confirmation is required).

## 7. Adding content to a product

1. Open **Admin › Products**, choose the product, then open the **Content library** tab.
2. Click **+ Category** and create one, for example "Getting Started". Repeat for "Stocktake Tutorials", "Advanced Features" and so on.
3. Click **+ Add content** and fill in the item:
   - **Title**, **Content type**, **Category** and **Short description**.
   - **Video source:** YouTube, Vimeo or Secure upload (section 9).
   - **Cover image** (section 8).
   - **Duration**, **Tags** and **Display order** (all optional).
   - **Who can watch:** "Same as the product", or an override.
   - **Status:** Draft or Published.
4. Click **Save**, then **Preview** to check the item.
5. Publish it with the item's **Publish** button, or use the bulk action. Publishing is refused if the video definitely can't be embedded, or if no cover has been uploaded (that rule can be switched off in settings).

Add as many items as you like, including many of the same type, for example 10 demonstrations.

## 8. Uploading cover images

In the item dialog, click **Upload image** and choose a JPG, PNG or WebP.

- Use 16:9, 1280×720 or larger.
- A preview appears straight away.
- Click **Replace image** to change it, or **Remove** to clear it.
- Covers are optimised automatically and only shown to people who are allowed to see that item.

## 9. Adding video links

- **YouTube:**
  - Upload the video as **Unlisted** and make sure **Allow embedding** is on.
  - Paste the link (`youtube.com/watch?v=…`, `youtu.be/…` or a Shorts link).
  - Click **Test link**.
- **Vimeo:**
  - In Vimeo's privacy settings, set **Hide from Vimeo**.
  - Under **Where can this be embedded?**, choose **Specific domains** and add `schluss.co.za`, plus `localhost` while testing.
  - Switch off **Allow downloads**.
  - Paste the link. For private links, include the code after the number: `vimeo.com/123456789/abcdef1234`.
  - Click **Test link**.
- **Secure upload:** click **Upload video file** and choose an MP4 or WebM file. A progress bar shows while it uploads.

To change a video later, edit the item and paste a new link or upload a new file. The test result is saved with the item, and problems show in red in the list.

---

## 10. Security and access-control testing

**How access is checked**

The server runs every check on each library request, each viewer request, each playback start and while a private video streams:

1. Signed in, if the content isn't public.
2. Account active (suspended accounts are signed out).
3. Email verified (unverified accounts can't sign in).
4. Access to this product (licence or demo for this product).
5. The content is published.
6. The content belongs to this product.

**Protection for secure uploads**

- **No file URL anywhere.** There is no download button and no API that returns a file location.
- **The playback link is:**
  - short-lived (15 minutes by default, renewed automatically while the customer watches);
  - tied to that browser session, so a copied link fails elsewhere;
  - refused when opened directly in the address bar or a new tab;
  - never cached;
  - re-checked against the customer's current access while playing.
- **The player** has no download control, picture-in-picture or casting, and right-click is disabled.
- **The original file** is marked staff-only in the media library.

**Test results**

| Check | Result |
|---|---|
| API tests (`npm run test:api`) | **92 / 92 passed** (9 new content tests, plus existing tests including product deletion with content) |
| Unit tests | 1 / 1 passed |
| Production and offline builds | Pass |
| Browser end-to-end (desktop and iPhone size), **30 / 30 checks, no browser errors** | See the details below |

**What the browser test covered**

- **Admin:**
  - Created 2 categories and 6 items, including several of the same type.
  - Uploaded 5 different covers and secure videos, and added a YouTube link (Test link plus the warning).
  - Reordered and bulk-moved items, kept a draft, changed access to "Registered" and previewed a draft.
- **Visitor:**
  - Sees only the public item, plus "4 more videos – sign in".
  - Opening a protected item's link asks them to sign in.
- **Customer** (registered and verified):
  - Sees all 5 published cards, grouped by category, with the draft hidden.
  - Clicking a card opens the viewer on SCHLUSS, and **the video plays**.
  - The player has no download control.
  - The stream address is a token, not a file path, and opening it as a page is refused (403).
  - No storage paths appear in the page.
  - Next and previous stay in the same category, and "back to library" works.
  - Content from another product can't be opened through this product.
- **Mobile:** 16:9 player with no sideways scrolling.
- **Analytics:** views appear in the admin.
- **Revoked:** unpublished content can't be played.

**What the API tests covered**

- **Access levels:**
  - Registered, authorised and demo levels.
  - A licence for **another** product doesn't grant access.
  - An expired licence or expired demo revokes access.
- **Isolation:** unpublished items return 404, and content can't be opened across products.
- **Streaming:**
  - The link is session-bound: another customer, or the same link without a session, gets 403.
  - Range (seeking) requests return 206, and the response is marked inline and no-store.
  - The original file can't be fetched through the media route (403).
- **Views and admin:**
  - A refresh doesn't add a second view, and progress and completion are recorded.
  - Staff previews aren't counted, and settings require admin permission.

**Honest limits**

- No website can stop someone recording their screen or using specialised capture tools while a video plays. These protections stop ordinary downloading, direct file access and link sharing.
- YouTube content is only as private as YouTube's settings allow (see section 4).
- YouTube and Vimeo playback wasn't tested against the live services, because the test environment has no internet access to them. The embed players are their official ones. Use **Preview** after adding your first real link.

## 11. External services or subscriptions

**None are required.**

- **YouTube:** free.
- **Vimeo:** a **paid plan** (Starter/Standard or higher) is needed for domain-restricted embedding and hiding videos from Vimeo. A free Vimeo account can't restrict where videos are embedded.
- **Secure upload:** uses your existing hosting. Check your disk space and monthly bandwidth for the number of viewers you expect.
- **Optional, for large scale:** a streaming service such as Cloudflare Stream or Mux. Ask if you'd like it added; it needs that provider's account and API credentials, kept in `.env`.
