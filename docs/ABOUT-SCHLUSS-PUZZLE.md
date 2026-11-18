# About SCHLUSS – the animated puzzle experience (v12.1)

The menu tab is **About SCHLUSS** (`/about`, the same page as before – no duplicate). The page is one large animated puzzle; there are no long text sections.

## What visitors see

1. **Opening (starts by itself):** the SCHLUSS picture as a large jigsaw, slightly blurred, with pieces missing (dark holes with a glowing rim). The missing pieces – real pieces of the picture – float around the puzzle, each at its own speed and direction. In the background, soft moving light, drifting particles and puzzle fragments at different depths.
2. **Each piece, one at a time:** it lights up (and its hole glows), comes forward towards the viewer, and a tile **emerges from it** with a perspective swing – image first, then title, then text. After the reading time the tile folds back into the piece, the piece **spins** and flies into its hole, **locks in** with a glow and turns sharp. The whole picture gets a little clearer with every piece.
   - **First piece (always):** WHAT DOES SCHLUSS MEAN? – *The final piece of the puzzle.* – one short sentence.
   - **Then the products you selected**, in your order: cover image, logo, name, category, small tagline, short description, "Discover …" link.
   - **Last piece (always):** AND MORE TO COME – *Every completed piece creates room for the next…* (its own colour). It completes the SCHLUSS logo in the picture.
3. **Big finish:** the picture turns completely sharp and glows, then bursts open in 3D (pieces fly outwards with rotation, depth, light flash, motion blur and particles) and settles back. The finished picture stays, with **SCHLUSS – THE FINAL PIECE OF THE PUZZLE. / Bringing every piece together.**
4. **Replay:** a small glowing puzzle piece (top right of the picture) floats and slowly turns. Click it (or Tab + Enter) to replay everything – no page reload. It never replays by itself.

Small controls under the puzzle: Pause/Resume, Next piece, Skip. Reading time stops while the mouse is over a tile, when the tab is hidden or the puzzle is scrolled away.

**Phones / small tablets:** fewer, bigger pieces; the puzzle stays pinned at the top and the tile is read underneath; fewer background particles.
**Reduced motion** (Windows "Show animations" off, or the site's motion switch): the story still plays automatically, with fades only – no flying, spinning, drifting or burst.

## About us (v12.2)

Under the puzzle there is a short **About us** section (heading, introduction, a few short paragraphs, and *Explore our products* / *Contact us* buttons). Edit it in **Website content → About us (under the puzzle)**. The puzzle experience above it is unchanged.

## Admin: Products → **About SCHLUSS experience** (also Website content → About SCHLUSS experience)

| Setting | |
|---|---|
| Play the puzzle animation | On/off. Off = the finished picture and the closing statement only. |
| The picture | Choose or upload any image from the media library (16:9, at least 1920 × 1080), or go back to the built-in SCHLUSS picture. |
| First piece | Title, main message, short description – always first. |
| Last piece | Title, message, colour – always last. Products can never replace it. |
| Closing statement | The two lines under the finished picture. |
| Animation timing (seconds) | Piece comes forward 1.5 · Tile appears 0.7 · Reading time 5 · Tile closes 0.6 · Piece moves into place 1.5. |
| Products in the puzzle | Every product with **Yes/No**, ↑ ↓ order, short animation description and small tagline. Only **published** products can be ticked; drafts, unpublished and archived products never appear. Nothing is shown until you tick it. |
| Preview | **Preview the animation ↗** / **Save & preview** open the page in a new tab with your saved settings. |

Each product also has **About SCHLUSS display settings** in its own page (Yes/No, order, title, description, tagline, puzzle cover image, puzzle logo, live tile preview).

## Technical notes

- Files created: `src/app/public/about-story.{ts,html,scss}`, `src/app/shared/story-card.ts`, `src/app/admin/about-experience.ts`, `src/app/admin/about-settings.ts`, `server/db/migrations/20261120_012_about_puzzle.cjs`, `public/brand/about-puzzle-{1280,2400}.webp`, `tests/server/about-story.test.ts`.
- Files changed: `app.routes.ts` (About route), `site-layout.ts` (menu label), `info-pages.ts` (old About component removed), `site-content.ts` / `admin-catalogue.ts` / `public.ts` (settings + APIs), `catalogue-api.ts`, `public-api.ts`, `product-editor.*`, `products-admin.ts`.
- Database: migration 012 adds optional `about_*` columns to `products` (default: not shown). Experience settings are stored in `site_content` key `story`.
- APIs: `GET /api/public/about-story` (one request: settings + selected published products); `GET/PUT /api/admin/about-experience/products`; `PUT /api/admin/products/:id/about`; `PUT /api/admin/site-content/story`. All changes are audited.
- No new libraries: Web Animations API, CSS transforms/opacity and SVG clip paths. Elements are created once per run (pieces persist), timers and observers are cleaned up, the next product image is preloaded during the current tile, the animation pauses when hidden.
- The grid grows with the number of pieces (6×4 up to 14×8; phones 4×3 up to 12×7). Up to 60 products get a piece; at most 12 float at once.

## Home page welcome (v12.3)

The top of the home page now greets visitors with the same puzzle world:
- Moving coloured light, twinkling particles and the floating pieces.
- The headline pops in word by word; the coloured line shimmers.
- A "Built for …" pill flips through your product categories every 2 seconds.
- A colourful 3D jigsaw (v12.4) builds itself from 12 flying pieces – Retail, Stock, Finance, Software, Production, Logistics, Training, Delivery, Management, Support, Security – and the blue SCHLUSS piece drops in last with a flash and sparks, then the puzzle glows and shines. Visitors can click it to watch it again; on a computer it tilts gently with the mouse. (It no longer uses the About SCHLUSS picture.)
- Under the welcome a band of industries scrolls slowly (pauses on hover).
- Reduced motion: the finished puzzle is shown still. All other home page sections are unchanged.
- File: `src/app/shared/hero-puzzle.ts` (new); `src/app/public/home.{html,ts,scss}` (hero and marquee).

## Home page hero – the puzzle-ring brand image (v12.5)

The top of the home page now shows the chosen SCHLUSS brand image (the ten industry pieces around the blue SCHLUSS piece, logo and slogan "THE FINAL PIECE THAT BRINGS IT ALL TOGETHER."), animated:
the background appears, the ten industry pieces spin out of the centre into the ring one by one, the blue SCHLUSS piece drops in last with a flash and sparks, the picture shines, and then the pieces float gently. Click the picture to play it again; on a computer it tilts gently towards the mouse. The "Built for …" ticker, the introduction, the buttons and the badges sit underneath. The finished image looks exactly like the approved artwork.
Files: `public/brand/home/*.webp` (the image split into layers, about 800 KB in total), `src/app/shared/home-ring.ts`; `home.html/ts/scss` (hero). The earlier drawn puzzle (`hero-puzzle.ts`) was removed. Reduced motion: the finished image, still.

## Home page hero – colourful puzzle-grid welcome (v12.7)

Replaces the puzzle-ring image (v12.5). Based on the SCHLUSS landing-page demo, in colour: a living interlocking puzzle grid; a rainbow spotlight that follows the mouse (and drifts by itself); the four logo pieces fly together (teal, amber, pink, then the blue SCHLUSS piece last); the wordmark letters rise in a warm-to-violet gradient with the final blue "s" dropping in; when it locks, a colour shockwave runs across the grid and coloured pieces click into place, and keep doing so quietly. Then the slogan "The final piece that brings it all together.", the "Built for …" ticker, introduction, buttons, badges and the "Schluss [ʃlʊs]" footnote. Starts on first paint (plain CSS in the server HTML). Click the logo to replay. Reduced motion: shown finished and still.
Files: `src/app/shared/home-lockup.ts` (new); `home.html/ts/scss` (hero). Removed: `home-ring.ts`, `public/brand/home/*.webp`.

## Home page hero – professional redesign (v12.8)

Same puzzle-grid feel, more professional and more eye-catching:
- **Left:** a "Built for …" pill (pulsing dot, changing industry), the headline from Website content (line 1 white, line 2 in a slowly moving blue–violet–teal gradient), the introduction, **Explore our solutions** and **Request a demo** buttons, and three check-marked promises (free trials, live demonstrations, local partner support).
- **Right – the SCHLUSS hub:** the official logo (white pieces, blue SCHLUSS piece) assembles inside turning orbit rings with a soft blue glow; when the blue piece locks, a light wave runs across the grid and your industries (live product categories, up to six) pop up around the logo as glass labels, each connected to the centre by a dotted line, floating gently. Caption: "SCHLUSS · The final piece that brings it all together."
- **Background:** the interlocking puzzle grid with a brand-colour (blue/violet/teal) spotlight that follows the mouse; pieces quietly click into place.
- Text appears straight away; the hub is complete after about 2.5 s. Click the logo to replay. Phones: hub on top, text underneath. Reduced motion: finished and still.
Files: `src/app/shared/home-lockup.ts`, `home.html/ts/scss`.

## About SCHLUSS – the crew (v13)

The About SCHLUSS animation now tells its story with people. Summary of what changed:
- **Picture:** the built-in picture is now the SCHLUSS retail-journey illustration (`public/brand/about-puzzle-{1280,2400}.webp`). An admin-chosen picture still replaces it.
- **Centre reserved for the logo:** a puzzle-piece shaped hole (a knob on every side) sits in the exact centre and glows from the start. No product piece can ever use that area (the cells under it are excluded when pieces are placed).
- **The crew:** five animated people on computers and three on phones. They wear the same cartoon look as the people in the picture. Each is a live SVG character whose legs, arms, body and head move separately, so they really walk, reach, carry, hold, point, look and celebrate. For every piece:
  1. **Collect:** one person walks to the floating piece and reaches up. The piece wobbles when touched and drops into their hands. Often this person has already walked there while the previous piece was being read.
  2. **Carry:** they carry it above their head to the front, while a helper walks over to join them.
  3. **Open:** both hold the piece up, glowing threads link their hands to it, and the piece opens into the information tile. Reading time follows the admin setting.
  4. **Close:** the tile folds back into the piece, which returns to the carrier's hands.
  5. **Place:** the piece is carried to its hole. Every third piece is carried by two people; otherwise the helper walks ahead and points to the spot. The piece is lifted, turned and aligned, then locks in and that part turns sharp. The people cheer briefly and walk off to wait.
- **Logo finale:** after AND MORE TO COME has been placed, the logo is always last:
  1. Everyone stops, turns and looks at the empty centre, which pulses.
  2. The SCHLUSS logo piece appears floating at the top and everyone reaches for it.
  3. The two people nearest the centre collect it and carry it to the centre together, while the others gather round and guide.
  4. The two carriers lift it, turn it and lock it in. A light ring and a glow wave run through the picture, all blur disappears, the frame glows, the carriers step back and everyone celebrates.
  5. The closing statement appears, followed by the 3D burst. The logo stays on top as the focal point.
- **Controls and access:** Pause stops everyone mid-step, and Next and Skip still work. Replay resets the people. With reduced motion, the people stand still and pieces and the logo fade in. The admin "Piece comes forward" time now sets how fast people walk.
- **Files:** new `src/app/shared/crew-person.ts`. Changed `src/app/public/about-story.{ts,html,scss}` and the two webp pictures.

## v13.1 – Learning Centre tab removed
- The **Learning Centre** tab is gone from the menu, the footer and the home page. Learning material (guides, PDFs, videos) is shown only on each product's own page, under *Learning materials*.
- Old links to `/learning` now open the Products page. An individual item (`/learning/<id>`) still opens, with breadcrumbs back to its product. `/learning` is no longer in the sitemap.
- The admin menu entry is now called **Learning material**. Nothing was deleted: every learning item and file is kept.
- The "File not found" error on product PDFs was not a code fault. The PDFs had been uploaded in the v12.6 folder, and the v13 folder's `storage` didn't have them. They were copied across (11 PDFs, 2 images, 1 installer).
