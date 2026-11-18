# SCHLUSS v9 – One central Products section (software, learning content, training)

The Products section is now a single **Products Management Centre**. Every software product, learning offering and training course is created, edited, published and converted from here. Nothing was rebuilt or removed: the existing screens, APIs, data and URLs are reused, just brought together in one place.

---

## 1. Files created

| File | Purpose |
|---|---|
| `server/db/migrations/20261117_009_offering_types.cjs` | Adds offering type and optional features to `products` (with rollback). Existing products are migrated safely. |
| `server/api/services/offerings.ts` | Offering types, which features each type may use, and the effective feature rules |
| `src/app/admin/products-nav.ts` | The Products centre frame: Offerings · Customer demos · Downloads · Website categories · Learning centre articles · Video & content settings |
| `tests/server/offerings.test.ts` | 7 automated tests: learning offerings, server-side feature rules, conversion both ways, centre filters and duplication, legacy products |
| `docs/V9-PRODUCTS-CENTRE-GUIDE.md` | This guide |

## 2. Files modified

| File | Change |
|---|---|
| `server/api/routes/admin-catalogue.ts` | Offering type and features on create/edit; conversion warnings and confirmation; duplicate; list search, filters and counters; product summary; publish rules per type |
| `server/api/services/demos.ts` | The demo and full-installer rules respect the offering's features |
| `server/api/routes/public.ts` | Offering type and features on product pages and in the listing (`?offering=`). Trial, pricing, demo and purchase only appear when enabled, and purchase enquiries are refused for offerings not for sale. |
| `server/api/routes/account.ts` | Free trials only for offerings with the Trial feature |
| `server/api/routes/customer.ts`, `admin-platform.ts`, `admin-ops.ts` | Read the feature columns where demo and installer rules are checked |
| `server/api/routes/content.ts` | Content hidden when the Learning feature is off; per-customer lesson progress |
| `src/app/admin/products-admin.ts` | **Rewritten** as the Products Management Centre |
| `src/app/admin/product-editor.html` / `.ts` / `.scss` | **One page with collapsible sections** instead of 17 tabs. It reuses all existing forms and components. |
| `src/app/admin/admin.routes.ts` | Navigation simplified; product views grouped under Products |
| `src/app/shared/portal-shell.ts` | "Products" stays highlighted on all its sub-pages |
| `src/app/admin/catalogue-api.ts` | Types and calls for offerings, features, stats and duplicate |
| `src/app/admin/content-admin.ts`, `product-tabs.ts` | Embed cleanly in the single editor: no duplicate access setting, unique form IDs |
| `src/app/public/product-detail.ts` / `.html`, `products.ts`, `product-card.ts`, `content-library.ts`, `core/public-api.ts` | Learning and course pages, the "Everything / Software / Learning / Training" filter, offering labels, course progress |
| `START-HERE.md` | Upgrade steps |

---

## 3. Navigation changes

**Before**, these were separate menu items:

- Products
- Categories
- Learning materials
- Product downloads
- Demo management
- Video & content settings

**Now** there is **one menu item: Products**. Inside it, a small bar switches between:

- **Offerings:** the centre itself.
- **Customer demos**, **Downloads**, **Website categories**, **Learning centre articles** and **Video & content settings:** the same pages as before, at the same addresses.

"Products" stays highlighted on every one of these pages, and the demo badge moved onto it. **Media library** is kept as its own menu item, because it holds website-wide files, not just product files.

## 4. Database changes

Run `npm run db:migrate`.

**New columns on `products`**

- **`offering_type`:** one of `software`, `learning`, `training`, `development` or `other`.
- **`features`:** `{ installer, demo, trial, pricing, purchase, learning }`.

**How existing products were migrated**

- Products that were "Coming soon" became **Product under development**. Every other existing product became a **Software product**.
- Everything that worked before stayed switched on, so customers see no change.

**What was kept**

- No product IDs, URLs, licences, demos, downloads, purchases, content or history were changed or deleted.
- The product ID is the permanent identifier, so an offering keeps its ID when its type changes.

---

## 5. Existing functionality consolidated into the one editor

| Before (separate tab/page) | Now (section in the single editor) |
|---|---|
| General information, Product images | **Basic information & cover**, **Images & gallery** |
| Category & features | **Category, availability & features list** |
| Full installer, Downloads | **Installation files (full .exe)**, including download history |
| Demo files, Demo settings, Demo history, demo request options | **Demo & trial** |
| Videos, Learning materials, Documents, External URLs, Setup steps, Content library | **Videos / lessons & learning content** |
| Pricing & packages, Enquiries | **Pricing & sales** |
| Status & publish | **Publish, visibility & delete**, plus a **Publish / Unpublish** button in the page header |
| (new) | **Offering type & features**, **Customer access** |

**How the sections behave**

- Each section opens and closes and saves on its own.
- The collapsed header shows a one-line summary, for example "Version 5.0.0 released · 3 downloads".
- Only the sections the offering needs are shown.

## 6. New product management functionality

The Products page shows:

- **Counters:** total offerings, published, drafts, software products, learning content, training/courses, with demos, without demos and under development. Clicking a counter filters the list.
- **Search:** by name, description, offering type or category.
- **Filters:** All, Software, Learning content, Training/courses, Under development, Published, Draft/unpublished, Archived, Has installer, Has demo, No demo and Has learning content.
- **One table:** image, name, short description, type, status, what's included (installer ✓, demo ✓, trial ✓, videos published/total) and last updated.
- **Actions:**
  - **Edit** and **View**: drafts open as a staff-only preview.
  - **⋯** menu: **Duplicate**, **Publish / Unpublish**, **Archive / Restore** and **Delete**.
  - Delete is only possible when no customer depends on the offering; otherwise it offers to archive.
- **+ Add new offering:**
  - First choose the type: Software product, Learning content, Training/course, Product under development or Other.
  - Then the name and description.
  - Only the sections that type needs appear afterwards.

**Duplicate** copies the details, features, pricing, images and content library (as drafts) into a new draft. Installers, customers and history are not copied.

## 7. Learning content functionality

Learning offerings and training courses are first-class offerings.

- **What they have:** a main cover image, a description, categories, many lessons (several of the same type allowed), a cover image per lesson, descriptions, video links or secure uploads, display order, publication status and access control.
- **What they don't need:** no installer, demo, trial, category, price or purchase button. The type doesn't allow installers or demos at all.
  - Pricing and purchase can be switched on if a course is sold.
  - Training courses can also have a trial.
- **The rules are enforced by the server**, not just hidden on screen:
  - Trial start returns "no trial".
  - Purchase enquiry returns "not for sale".
  - Installer and demo downloads are refused.
- **Protected videos** keep all the v8 protection: they play inside SCHLUSS, with no downloads.

## 8. Product conversion (learning ⇄ software)

To convert an offering:

1. Open it and expand **Offering type & features**.
2. Choose the new type.
3. Adjust the features, for example switch on **Full installer** or **Demo**.
4. Click **Save type & features**.

**What is kept on conversion**

- The same offering ID and web address.
- Name, descriptions and cover image.
- Every video, category, ordering and cover.
- Customer access settings, view statistics, licences, demos, downloads, sales enquiries and publication state.

Nothing is duplicated or recreated, and the change is recorded in the audit log. The Installation files, Demo & trial and Pricing sections then appear, so you can upload the installer, demo, version and prices.

**Software → learning (reverse)**

If customers have licences, demos, trials or open sales enquiries, a confirmation lists exactly what will stop being offered.

- Nothing is deleted.
- Licences stay valid, demo and trial records keep their dates, and enquiries stay in Sales.
- Installers stay stored and can be offered again by switching the feature back on.

## 9. Customer website changes

- **Products page:** a new **Everything / Software products / Learning content / Training & courses** selector. Learning offerings and courses are labelled on their cards.
- **Software product page:** cover, information, features, videos and tutorials, plus the full installer (if authorised), demo download (if enabled), trial (if enabled), pricing and purchase form (if enabled).
- **Learning content and course pages:**
  - The cover, a "Learning content" or "Training course" label, the description and a **Start learning / Start the course** button.
  - Lessons appear right after the overview, grouped by category as cover cards.
  - No installer, demo, trial, pricing or buy sections appear unless they're switched on.
- **Courses:** signed-in customers see **"X of Y lessons completed"** with a progress bar, and watched lessons show **✓ Watched**.
- **Unchanged:** existing product addresses still work, and existing products look the same as before.

---

## 10. Testing results

| Suite | Result |
|---|---|
| API tests (`npm run test:api`) | **99 / 99 passed** (7 new) |
| Unit tests | 1 / 1 passed |
| v9 browser acceptance test (desktop and iPhone size) | **40 / 40 passed, no browser errors** |
| v8 content-library browser test, re-run on the new editor | **30 / 30 passed** |
| Production and offline builds | Pass |

**Acceptance scenarios**

1. **Software product.** Created with the type picker, with demo and trial switched on. The full installer was uploaded, the demo enabled at 14 days and its installer uploaded, a category and 2 videos with covers added, and a pricing option added. It was published from the header.
   - The website shows the installer, demo download, videos and buy form.
2. **Learning content.** Created with no installer, demo, trial, category or price, plus 2 categories and 3 lessons of the same type with their own covers. It was published.
   - The Learning filter lists it.
   - The page shows "Learning content" and "Start learning", with lessons straight after the overview.
   - There are no installer, demo or buy sections.
3. **Conversion.** The learning offering was changed to Software and an installer added.
   - Same ID and URL.
   - The same content IDs, order, covers and categories.
   - The page now shows the installer **and** the lessons.
4. **Permissions.**
   - Restricted videos are locked for visitors, and protected playback is refused (401).
   - The installer needs sign-in.
   - Unpublished offerings aren't public.
   - API tests also cover: learning offerings refusing trials, purchases and installers; reverse conversion warnings; licences kept.
5. **Existing functionality.**
   - Existing products are listed as Software and open in the new editor with their installer and demo sections.
   - Their public pages are unchanged (installer, trial).
   - Customer demos and downloads pages still work inside Products.
   - All earlier test suites still pass.

**Also verified:** the Products page and learning pages on a phone, with no sideways scrolling.

## 11. Remaining configuration

- Run `npm install`, then `npm run db:migrate`.
- Review the **type** of each existing offering in the Products centre. They were all migrated as Software products, or "Under development" for Coming soon items. Change any that are really learning content or courses; nothing is lost.
- Everything from earlier versions still applies: the mail server, the WhatsApp Business account, and Vimeo domain privacy for protected videos (see the v7 and v8 guides).
