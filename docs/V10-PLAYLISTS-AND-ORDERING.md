# SCHLUSS v10 – YouTube playlist ("folder") imports and drag-and-drop ordering

## What's new

In **Products › (offering) › Videos / lessons & learning content** there are now two ways to add YouTube videos:

| Button | Use it for |
|---|---|
| **+ Add a video** | One video link (YouTube, Vimeo or a secure upload) – exactly as before |
| **+ Import YouTube playlist** | A whole YouTube playlist (folder) in one go |

### Importing a playlist
1. On YouTube, open the playlist and copy its link (`https://www.youtube.com/playlist?list=…`). The playlist must be **Public or Unlisted**.
2. Click **+ Import YouTube playlist**, paste the link and click **Load playlist**.
3. You see every video in the playlist's order, with its thumbnail and length. Untick any you don't want.
4. Choose where they go: a **new category** (named after the playlist – you can change the name), an **existing category**, or **uncategorised**.
5. Choose the content type, who can watch, whether to use the YouTube thumbnails as cover images, and whether to publish straight away or save as drafts.
6. Click **Import**.

- Videos keep the playlist's order and play inside SCHLUSS (never sent to YouTube).
- Videos already in this product's library are skipped – no duplicates.
- Videos that are private, deleted or have embedding switched off are flagged and saved as drafts.
- Cover images are made from each video's YouTube thumbnail (cropped to 16:9). Replace any of them with your own cover via **Edit**.
- If you paste a playlist link into **+ Add a video**, SCHLUSS offers to import the whole playlist instead.

### New videos added to the playlist later
Categories created from a playlist show **↻ New videos from playlist**. It reloads the playlist with only the new videos ticked, and adds them to the end of that category.

### Changing the order (the "flow")
- Drag the **⠿** handle on a video to move it up or down, or into another category.
- Drag the **⠿** handle on a category to move the whole category.
- The ↑ ↓ buttons still work (handy on phones and tablets, where dragging isn't available).
- The new order is saved immediately and the website follows it straight away.

## Playlist size: with or without a YouTube API key

| | Without a key | With `YOUTUBE_API_KEY` |
|---|---|---|
| Videos per playlist | **15** (YouTube's public feed limit) | Whole playlist (up to 500 per import) |
| Video lengths | Shown when YouTube provides them | Always |
| Embedding check | Per video (same check as single links) | From YouTube directly |

To get a free key: Google Cloud Console → create a project → enable **YouTube Data API v3** → Credentials → **API key**. Restrict it to the YouTube Data API, put it in the server's `.env` as `YOUTUBE_API_KEY=…` and restart. The key stays on the server; it is never sent to browsers. **Video & content settings** shows which mode is active.

## Things to know
- Private playlists, "Watch later", "Liked videos" and automatic YouTube Mixes can't be imported – YouTube doesn't share them. SCHLUSS explains this when it happens.
- As before, YouTube can't restrict playback to your website: anyone who finds an Unlisted/Public video on YouTube can watch it there. Use Vimeo (domain privacy) or secure uploads for customer-only content.

## Technical summary
- **Migration** `20261118_010_content_playlist_source.cjs`: `source_playlist` on `product_content_items` and `product_content_categories`; index on (product, provider, video id).
- **New** `server/api/services/youtube-playlist.ts` – playlist link parsing, Data API v3 (paged) or public feed, thumbnail covers.
- **New API** (staff with `products.manage`):
  - `POST /api/admin/products/:id/content/playlist/preview` – reads the playlist; saves nothing.
  - `POST /api/admin/products/:id/content/playlist/import` – re-reads the playlist on the server and imports the chosen videos.
  - `PUT /api/admin/products/:id/content/layout` – saves the full order of categories and videos in one transaction; refuses incomplete or foreign lists.
- **Changed** `server/api/routes/content.ts` (playlist links pasted as single videos get a helpful message; settings status), `src/app/admin/content-admin.ts` (import dialog, drag and drop, sync button), `product-editor` (section summary stays current), `.env.example` (`YOUTUBE_API_KEY`).
- **Tests**: `tests/server/playlist.test.ts` (11 tests: link parsing, feed and API modes incl. paging, private / non-embeddable videos, duplicates, re-import, wrong key, mixes, permissions, ordering). API suite 110/110. Browser test 25/25 (import, re-import, single links, drag within / between categories, category drag, website order, mobile, errors). v8 (30/30) and v9 (40/40) browser tests re-run and passing.
- **Not tested against live YouTube** – the build environment can't reach YouTube, so the tests use a stand-in that returns YouTube's formats. Please try one real playlist after upgrading.

---

## v10.1 – "I added videos but they don't show on the product page"

**Cause:** the videos were saved as **drafts**. Drafts are never shown to customers, and the product page hides the
videos section completely when a visitor has nothing to watch – so it looked as if the videos were missing.
(Playlist imports and "+ Add a video" used to default to draft.)

**Fixed:**
- **New videos are published by default** (playlist import and single links). A video that can't be published yet
  (no cover image, or YouTube doesn't allow embedding) is saved as a draft and the message says exactly why.
- **Automatic cover images** for single YouTube/Vimeo links: if you don't upload a cover, the video's own thumbnail is
  used (cropped to 16:9). You can replace it any time.
- **Admin warning:** the Videos section shows "Not everything here is on the website yet" with the reason (drafts,
  hidden category, feature switched off, video source switched off, offering unpublished) and a
  **"Publish N ready videos now"** button. It publishes everything that can be published and lists anything it skipped.
- **Product page, staff only:** when you're signed in as staff, the product page tells you why videos aren't shown to
  customers. Customers never see this note.

**To fix videos you already added:** open the product in Admin › Products, expand **Videos / lessons**, and click
**Publish N ready videos now**.

Tests: API 113/113 (3 new); browser checks for this case 10/10; earlier browser suites (v8 30/30, v9 40/40, v10 25/25) re-run and passing.

---

## v10.4 – cover images not showing (broken picture icons)

**Cause:** the cover image *files* were no longer in the server's `storage` folder (the database still pointed to
them). This happens when a new version is installed into a fresh folder without copying the old `storage` folder.

**Fixed:** covers of YouTube/Vimeo videos are recreated automatically from the video thumbnails – on the website as
soon as someone opens the page, and in the admin when the product's Videos section is opened (with a
"Restore N cover images" button as a fallback). The admin lists missing files (covers, uploaded videos) clearly,
and neither the website nor the admin shows a broken-picture icon any more. Uploaded video files and custom covers
of uploaded videos can't be recreated – copy the old `storage` folder back, or upload them again.
See START-HERE.md for how to keep `storage` safe across updates (`STORAGE_DIR`).

Tests: API 119/119 (1 new); browser check of this case 4/4; all earlier browser suites re-run and passing.
