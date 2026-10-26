# Pasar Malam MTG: design principles

Read this before changing any UI. It describes how the web app should look and behave, and why.

- **It's a web app, not a native app.** Use standard web patterns:
  - a top bar
  - breadcrumbs, and underlined tabs for the parts of a post
  - dialogs with a close button and footer buttons
  - native form controls (text boxes, dropdowns, checkboxes)
  - an explicit Save

  Don't imitate iOS or Android.
- **Style:** plain CSS with the semantic tokens in `styles.css` (`:root` for light, `[data-theme="dark"]` for dark). Keep the current palette and the system font.
- **Not for now:** shadcn, Tailwind or any other component library. Don't add one, and don't add new fonts.
- **Target screens:** the design canvas "Pasar Malam MTG Redesign". Board names are listed at the end of this file.
- **Who uses it:** a Malaysian MTG seller at a pasar malam stall or at home.
  - They usually open the site in their phone's browser, with a stack of cards in the other hand. Sometimes they use a laptop.
  - They post to Facebook buy/sell groups.

---

## 1. Principles

1. **Web patterns, not app chrome.**
   - Every page has the same top bar, a URL of its own, and breadcrumbs back up. The browser's Back button always works.
   - There are no sheet grabbers, action sheets, iOS switches, large collapsing titles, "‹ Back" links in the bar, blurred see-through bars, or "Done" buttons that only close something.
2. **Phone first.**
   - Design at 390px wide first, then let it grow.
   - Every tap target is at least 44px.
   - Hover only adds feedback. Nothing needs it.
3. **The photo is the source of truth.**
   - Always show *your card* next to the *matched card*.
   - Never hide what the scanner guessed or how sure it was.
   - Fixing a wrong match takes one click (Change card).
4. **Every price explains itself.**
   - Show the RM and how it was made: `USD 4.99 × 2.5`.
   - A live price carries `≈` and says when it becomes final.
5. **One primary action per page.** Only one filled blue button per page or dialog. Everything else is a gray or plain button.
6. **Quiet chrome, loud content.**
   - Use the system font, solid bars and 1px rules.
   - No decoration that doesn't carry information.
7. **Forgiving.** Prefer undo over "are you sure":
   - A removed card collapses to a row with **Restore**.
   - Archive and status changes come with **Undo**.
   - Confirm only actions that can't be undone, such as deleting a post or a photo.
8. **Seller words, not developer words.** Say post, photo, card, buyer, claim, price and foil. Never say kanban, PNG, OCR, bbox, SKU or API.
9. **One meaning per color.** The colors in section 2 each mean one thing. Never reuse a color for a different meaning.

---

## 2. Tokens

Use the CSS variables. Don't hard-code hex in components. The only exceptions are the fixed colors in section 7 (photo labels and printed slips) and section 11 (the Google button).

### Color

| Token | Light | Dark | Use it for |
|---|---|---|---|
| `--bg` | `#f2f2f7` | `#000000` | Page background and the top bar |
| `--paper` | `#ffffff` | `#1c1c1e` | Cards, panels, lists, dialogs |
| `--surface` | `#ffffff` | `#2c2c2e` | Tiles, radio cards and boxes sitting on a card |
| `--surface-2` | `#f2f2f7` | `#2c2c2e` | Inset area inside a card |
| `--fill` / `--fill-strong` | gray 12% / 20% | gray 24% / 36% | Text boxes, dropdowns, gray buttons, segmented track, chips |
| `--ink` | `#000000` | `#ffffff` | Primary text, the active tab |
| `--ink-soft` | `#636366` | `#a1a1a6` | Secondary text, labels above fields, inactive tabs. It passes 4.5:1, so use it for anything people must read. |
| `--ink-faint` | `#8e8e93` | `#6e6e73` | Placeholders, disabled items, breadcrumb `/`. **Never for text people must read.** |
| `--rule` | `rgba(60,60,67,.16)` | `rgba(84,84,88,.6)` | 1px borders and dividers |
| `--accent` | `#0066cc` | `#409cff` | Links, breadcrumbs, icons, text on gray buttons |
| `--accent-fill` | `#0071e3` | `#0a84ff` | The one filled button, the active-tab underline, focus rings, selection |
| `--accent-soft` | blue 12% | blue 20% | Tinted chips such as "2 photos not added" |
| `--green` | `#1d7a34` | `#30d158` | Money in, success, "in post" |
| `--gold`, `--gold-fill` | `#946200`, `#ffcc00` | `#ffd60a` | **Foil only** |
| `--warn` | `#d70015` | `#ff6961` | Errors, destructive text, needs attention (Unpaid, Check printing) |
| `--seg-thumb` | `#ffffff` | `#636366` | Selected segment |
| `--scrim` | black 32% | black 56% | Behind dialogs |

- **`--glass`** is retired for bars. The top bar is solid `--bg`. Keep `--glass` only for the round close button floating over the photo viewer.
- **Filled red buttons** (Delete post) use `#d70015` in both themes. White text on `#ff6961` fails contrast.

The canvas boards are drawn in dark mode with literal hex values. Map them to tokens when you build:

| Canvas hex | Token |
|---|---|
| `#000000` | `--bg` |
| `#1c1c1e` | `--paper` |
| `#2c2c2e` | `--surface` |
| `rgba(118,118,128,0.24)` | `--fill` |
| `#a1a1a6` | `--ink-soft` |
| `#6e6e73` | `--ink-faint` |
| `rgba(84,84,88,0.6)` | `--rule` |
| `#409cff` | `--accent` |
| `#0a84ff` | `--accent-fill` |
| `rgba(10,132,255,0.2)` | `--accent-soft` |
| `#30d158` | `--green` |
| `#ffd60a` | `--gold` |
| `#ff6961` | `--warn` |
| `rgba(255,69,58,0.2)` | `--warn-soft` |
| `#636366` (selected segment) | `--seg-thumb` |
| `#3a3a3c` (avatar initials) | `--surface` |

Always check both themes.

### Type

- Use `--font` for body text and `--font-display` for 24px and up.
- Numbers are always `tabular-nums` (already set on `body`).
- Don't set a root px size, so the browser's text-size setting still works.

| Role | Size / weight | Used for |
|---|---|---|
| Hero | 34 / 700, line-height 1.1, -0.02em | Sign-in headline only |
| Big number | 28–30 / 700 | Totals (`≈RM402`, "To collect"), the price on a card tile |
| Page title (`h1`) | 24 / 700, -0.01em | One per page: "Posts · 2", "Friday Post", "Photo 2 of 2", "Pricing settings", "Claims", "Profile" |
| Section (`h2`) | 18–20 / 700 | Card and section titles ("Payment details", "Photos · 2"), dialog titles (18) |
| Headline | 17 / 600 | Row titles, card names |
| Body | 17 / 400, line-height 1.35 | Default, text in fields |
| Callout | 15 / 400–600 | Buttons (600), tabs (500, active 600), breadcrumbs, labels above fields |
| Footnote | 13 / 400–600 | Meta, helper and error text, captions, the formula line |
| Badge | 12 / 600 | Count badges and small chips. Nothing smaller than 12px. |

To show a count next to a heading, write `Posts · 2`, with the count in weight 500 and `--ink-soft`.

### Space, shape, depth, motion

- **Gutters:** 16px on phones, 24px on wide screens. Content is at most 1240px wide.
- **Padding:**
  - Card tile: 12px
  - Card or section: 16px
  - Desktop panel: 20px
  - List row: 12px. Rows are at least 44px tall; most are 64–100px with a thumbnail.
- **Gaps:**
  - 8, 10 or 12px between items
  - 16px between cards
  - 28px before a new section heading
  - 40px between sections on the sign-in page
- **Radii:**
  - `--radius-sm` 8: card images
  - 6: chips
  - `--radius` 12: text boxes, dropdowns, inner boxes
  - 14: radio cards, boxes inside a card
  - 16: dialogs. Set `--radius-xl` to 16; the old 26 was for sheets.
  - `--radius-lg` 18: cards, tiles, lists
  - `--radius-pill`: all buttons
- **Depth:**
  - Cards get no shadow in dark mode and `--shadow` in light.
  - Only floating layers get `--shadow-lg`: dialogs and toasts.
  - Layering: sticky action bar 30, top bar 40, dialogs 60–65, toast 70.
- **Motion:**
  - Easing is always `--ease` (`cubic-bezier(.32,.72,0,1)`).
  - Press: scale .97 over 150ms.
  - Fades: 200ms.
  - Dialogs fade in and rise 24px over 280ms. Nothing slides up from the screen edge.
  - Turn motion off under `prefers-reduced-motion`.

---

## 3. Layout and navigation

### Top bar (every page, every width)

- **Bar:** 56px, sticky, solid `--bg` with a 1px `--rule` bottom border, plus `env(safe-area-inset-top)`.
- **Left:** the 28px app mark (radius 7, on `--accent-fill`) and the name "Pasar Malam MTG", at every width. Both link to Posts.
- **No tabs in the bar.** Every claim belongs to one post, so Photos and Claims are tabs on the post page (see Post tabs below), not sections of the app.
- **Right:**
  - Your avatar: a 32px circle with the Google photo, or initials on `--surface`, inside a 44px link to Profile.
  - On Profile, the avatar gets a ring (`0 0 0 2px var(--bg), 0 0 0 4px var(--accent-fill)`).
  - On wide screens, the prices status line ("● Prices ready · 99,334 cards · 8h ago") sits left of the avatar.
- **Not in the bar:** no ⋯ menu, no segmented control, no back link. Page actions live on the page.
- **Semantics:** `aria-current="page"` on the avatar link when you're on Profile.

### Post tabs

- A post has two parts, each with its own URL: **Photos** (`/posts/5`) and **Claims** (`/posts/5/claims`). The old `/claims?post=5` opens the post's Claims.
- The tabs sit under the title row, over a full-width 1px `--rule`, 24px apart, each at least 44px tall:
  - Inactive: 15/500 in `--ink-soft`. On hover, `--ink`.
  - Active: 15/600 in `--ink`, with a 2px `--accent-fill` line on the bottom edge (`box-shadow: inset 0 -2px 0 var(--accent-fill)`).
  - Each shows its count: `Photos · 12`, `Claims · 5` (buyers). A zero shows no count.
- A tab replaces the history entry instead of adding one, so Back leaves the post.
- The photos in no post (Unfiled) are not a post: they get no tabs and no Claims.
- Semantics: `<nav aria-label="Post sections">` around the tabs, with `aria-current="page"` on the active one.

### Breadcrumbs (inner pages)

- They sit above the page title: `Posts / Friday Post / Photo 2`.
- **Ancestors:** `--accent` links at 15px, underlined on hover, each with a 44px-tall hit area.
- **Separator:** `/` in `--ink-faint`.
- **Current page:** `--ink-soft`, with `aria-current="page"`.
- Wrap them in `<nav aria-label="Breadcrumb">`.
- Root pages (Posts, Profile) have no breadcrumbs. Both parts of a post read `Posts / Friday Post`.

### Page anatomy (compact)

1. **Top bar.**
2. **Breadcrumbs,** on inner pages only.
3. **Title row:** the `h1`, with the page's small actions on the right. Examples:
   - rename (pencil)
   - the ⋯ Manage post menu (Post page)
   - previous and next photo
   - delete photo
   - the page's main button (Posts → **+ New post**)
4. **Summary card:** the key number and the page's one primary action.
5. **Secondary actions:** gray buttons, two to a row.
6. **Sections:** an `h2` with `· count`, then a list, tiles or a form.
7. **Footer:** a footnote line in `--ink-soft`, such as "Pricing: Card Kingdom retail, refreshed daily".

### Migrating `styles.css`

- **Remove the bottom navigation:**
  - Delete `.tab-bar`, both the floating pill and the wide segmented version.
  - Delete `--tabbar-h`.
  - Drop the extra bottom padding on `.wrap` at ≤767px. Use `calc(28px + env(safe-area-inset-bottom))`.
- **Make the bar solid:**
  - `.app-bar`: `background: var(--bg)`, no `backdrop-filter`, `border-bottom: 1px solid var(--rule)`.
  - Set `--bar-h: 56px`.
- **Add the tabs:** add `.nav-tabs` / `.nav-tab` (the underline tabs) inside `.app-bar-inner`, left-aligned after the mark.
- **Fix the back-to-top button:** set `.float-back-top` back to `bottom: calc(20px + env(safe-area-inset-bottom))`.
- **Rules:** replace every 0.5px hairline with 1px.

### Dialogs and temporary layers

- **Dialog.** This replaces bottom sheets and action sheets.
  - **Header:**
    - Title 18/700, with an optional 13px subtitle in `--ink-soft`.
    - Close × on the right: a 32px `--fill` circle inside a 44px button.
    - A 1px `--rule` underneath.
  - **Body:** scrolls when tall.
  - **Footer:**
    - A 1px `--rule` on top.
    - **Cancel** (gray) first, then the primary.
    - On phones the primary can stretch to fill the row. On wide screens both sit at the right.
  - **Phone:**
    - Anchored to the bottom edge, full width, with 16px top corners and a max height of `100% - 24px`.
    - Pickers (Change card, In this post, Add comments) take the full height, starting 24px below the top.
    - No grabber.
  - **Wide (≥768px):** centred, 480–560px wide (pickers up to 880px), with 16px corners all round.
  - **Behaviour:**
    - The backdrop is `--scrim`. Clicking it, pressing Esc or clicking × all mean Cancel.
    - Focus moves into the dialog and returns to the button that opened it.
    - Markup: `role="dialog" aria-modal="true" aria-labelledby`.
  - **Edits are a draft.** Cancel, × and Esc throw the changes away; **Save** keeps them. Edit price, for example, ends with **Cancel** and **Save price**.
  - **Info-only dialogs** (Support this app) have a single **Close** in the footer.
- **Confirm dialog** (`role="alertdialog"`):
  - Small and centred, for things that can't be undone only.
  - The title names the thing: "Delete “Friday Post”?".
  - One line says what goes: "Its 2 photos, 19 cards and any claims will be removed. This can't be undone."
  - Buttons: **Cancel**, then a filled red action (`#d70015`) that says what it does: **Delete post**.
- **Toast:**
  - A bar 16px in from each side and 24px from the bottom, above any sticky bar. Use `role="status"`.
  - A plain toast goes after about 2.2s. One with **Undo** stays about 3s.
  - Use it after archive, removals, deletes and status changes instead of asking "are you sure".
- **Sticky action bar:**
  - Docked full width to the bottom of the page: solid `--bg` with a 1px top rule, padding `12px 16px calc(24px + env(safe-area-inset-bottom))`.
  - Use it for page forms (Pricing: status text, Cancel, Save) and for modes (Select: Download · Delete).
  - Never a floating pill. It goes away when the mode ends.
- **Photo viewer:**
  - A full-screen overlay with the image centred.
  - The round close × sits at the **bottom**, inside thumb reach.
  - On a card, the viewer holds exactly two images. Clicking the image flips between them.

---

## 4. Components

- **Buttons.** All buttons are pill-shaped.
  - **Primary:** `--accent-fill` with white text, 15/600, 44px tall. The summary card's main action can be 48–50px at 17/600. One per page or dialog.
  - **Default:** `--fill` with `--accent` text, 15/600, 44px. **Cancel** and **Sign out** use `--ink` text.
  - **Plain:** `--accent` text with no fill, used for Select, Change, Reorder and "What happens to these details?".
  - **Destructive:**
    - Plain `--warn` text in a list ("Delete my payment details", "Remove buyer").
    - Filled `#d70015` only inside a confirm dialog.
  - **Disabled:** opacity .38–.4, with `cursor: not-allowed`. A disabled Save stays visible and is never hidden.
  - **Icon-only:** a 32–36px circle on `--fill`, with a 44px hit area and an `aria-label`.
- **Text box:**
  - 48px tall, radius 12, `--fill` background, no border, 17px text.
  - The label sits above it: 15/400 in `--ink-soft`, 6px gap, as a real `<label for>`.
  - Focus: a 2px `--accent-fill` ring (`box-shadow`), not an outline change.
  - Prefixes and suffixes inside the box are in `--ink-soft`: `×` before a multiplier, `RM` before a price.
  - Use `inputmode="decimal"` or `"numeric"` with `type="text"`, not `type="number"`.
- **Text area:** the same as a text box, with 12px vertical padding and `resize: vertical`.
- **Validation:**
  - Check fields as people type. An invalid field gets a 2px `--warn` ring, `aria-invalid="true"`, and a 13px `--warn` message under it, such as "Use a number from 1 to 5".
  - Save stays disabled while any field is invalid.
- **Dropdown:**
  - A native `<select>`, styled like a text box with `appearance: none`.
  - It has a 14px up/down chevron icon 13px from the right, with `pointer-events: none`.
  - Use it for sort orders, rounding, and label position and size.
- **Checkbox:**
  - Native, 22px, with `accent-color: var(--accent-fill)`.
  - The whole row is the `<label>`: the box, then the text at 17px, with an optional 13px helper line in `--ink-soft`. The row is at least 44px tall.
  - An on/off setting is always a checkbox. **No switches.**
- **Radio cards:**
  - For a choice with consequences, such as Price on photo vs Live price.
  - Each card: `--surface`, radius 14, padding 14, a 22px radio dot, a 17/600 title, and one 13px line in `--ink-soft` saying what the choice does.
  - Selected: a 2px `--accent-fill` inset ring and a filled dot.
  - Wrap them in `role="radiogroup"`, with `role="radio"` and `aria-checked` on each card.
- **Segmented control:**
  - Only for switching a view in place:
    - the Claims filter (All | Unpaid | Paid | Done)
    - Your card | Matched card
    - Non-foil | Foil
    - RM | USD
    - Language
    - Appearance
    - the sign-in demo (1 · Photos | 2 · Claims)
  - Never for navigation, and never for a choice with consequences (use radio cards).
  - Track: `--fill` with 2px padding and radius 11. Selected segment: `--seg-thumb` with `--seg-shadow`, weight 600.
- **Stepper:**
  - `−  value  +` inside a `--fill` capsule, with 44×40 buttons and the value at 17/600.
  - Use it for quantities and the quick ±0.1 multiplier in Edit price. Pricing settings uses text boxes.
  - When the quantity is 1, the minus becomes a red trash icon (remove).
- **Chips:**
  - Radius 6, 12–13 / 600.
  - A status chip uses its color's soft fill with the color as text, for example `--accent-soft` with `--accent`: "2 photos not added".
- **Lists:**
  - Rows sit together in one `--paper` box with radius 18, separated by full-width 1px `--rule` dividers.
  - **No chevrons.** The whole row is the link, with a hover background of `--fill` at half strength.
- **Photo picker grid:**
  - Four columns of 4:3 thumbnails with "Photo N" under each.
  - The chosen one gets a 2px `--accent-fill` ring and a check badge.
  - The last cell is **Several photos**.
- **Post mosaic:** 76px square, radius 12, 2px gaps. Show up to 4 photos; the fourth cell shows `+N`.
- **Version line:** a `[● CODE #cn]` chip followed by the set name.
  - Chip: `--fill`, 13/600. The `#cn` is in `--ink-soft` at weight 500.
  - Set name: 13, `--ink-soft`.
  - Rarity dot (7px): common `#8e8e93`, uncommon `#aeb4bd`, rare `#d4a017`, mythic `#ff6723`, special `#af52de`.

---

## 5. Pages

### Posts (home)

- **Title row:** "Posts · 2", with a primary **+ New post** on the right. It opens the **New post** dialog:
  - radio cards for Price on photo (default) and Live price
  - a tip: "avoid glare, lay cards flat on a clean, light background"
  - a footer with **Choose photos** (gray) and **Take photo** (primary)
- **List:** one box of rows. Each row has the mosaic, the name, the total (`≈RM402` for live), meta (`Live price · 2 photos`) and its status chips.
  - Claims chip: "3 buyers to pay" (`--warn-soft`), or "All 5 buyers paid" (`--green-soft`) once everyone has paid.
  - A row with buyers opens the post on **Claims**, since collecting is what is left to do. A row with none opens **Photos**.
- **Archived posts:** listed under an "Archived · N" link at the end, each with **Restore**. This isn't drawn on the canvas yet.

### Post

- **Breadcrumbs:** `Posts / Friday Post`. The title has a pencil button that opens the **Rename** dialog.
- **Tabs:** Photos | Claims, under the title (section 3, Post tabs). The rest of this section is the Photos part; section 8 is the Claims part.
- **Summary card:**
  - the total (`≈RM402`) and meta (`Live price · 2 photos · 19 cards`)
  - "19 cards aren't in the post yet"
  - the primary **Add all to post**
- **Share photos and Download all,** side by side. The line under them reads: "Share sends all 2 photos, with prices on them, straight to Facebook, Messenger or WhatsApp." These work on the whole post only; a single photo has **Download image** on its own page.
  - **Share** uses the Web Share API with files:
    - If `navigator.canShare?.({ files })` is true, call `navigator.share({ files, title })`. Otherwise, fall back to Download all.
    - Render the labelled JPEGs ahead of time, when the page loads or after an edit, so `share()` runs inside the click. Browsers drop the share once the gesture has expired.
    - Ignore `AbortError`: it means the person closed the share sheet.
  - **Download all** saves every labelled photo, named `{post} - Photo {n}.jpg` so they sort in post order. If the browser blocks several downloads at once, bundle them as one `.zip`.
- **Pricing settings row:** a summary (`×2.5 · Foil ×2.8 · Round up to RM 1`) with **Change**. It opens the Pricing page.
- **Photos · N:**
  - **Select** and **+ Add photos** sit next to the heading.
  - A search box ("Search card names") and a sort dropdown: Post order, Newest, Oldest, Name (A–Z).
  - The order hint reads "Same order as your Facebook post, so Photo 1 here is Photo 1 there." with **Reorder**.
  - **Reorder** shows ↑/↓ buttons on each row and **Save order**.
  - **Select** shows a checkbox on each row and the sticky bar (Download · Delete).
- **Manage post:** a ⋯ button next to the title (`aria-label="Manage post"`) opens a small menu, anchored to the button:
  - **Archive post:** "Hides it from Posts. Claims stay, and you can bring it back." It shows a toast with Undo.
  - **Delete post:** "Removes its photos, cards and claims for good." It opens the confirm dialog.

### Photo

- **Breadcrumbs:** `Posts / Friday Post / Photo 2`.
- **Title:** "Photo 2 of 2", with previous, next and delete icon buttons.
- **No pricing settings here.** Pricing belongs to the post: its row is on the post's Photos part, not on each photo.
- **Below the photo:** **Add all to post**, **Download image**, **Refresh prices**, then the card tiles (section 6).
- **Change card** is a full-height dialog. Its title is "Change card", with "All printings of {name}" as the subtitle. It has a search box with **Find**, and a two-column grid of printings with Card Kingdom prices.
- **Edit price** is a dialog:
  - the price box
  - Finish (Non-foil | Foil)
  - Multiplier stepper with "Reset to ×2.5"
  - Price override (RM | USD, plus a text box)
  - footer: **Cancel**, **Save price**

### Pricing settings

A page under the post (`Posts / Friday Post / Pricing`), not a dialog.

1. **How buyers see prices:** radio cards.
   - **Price on photo:** "Prices are printed on the photo. Finishing the post locks them for claims."
   - **Live price:** "No prices on the photo. Each buyer's price is set when you send them their total."
2. **Example** for Lord Skitter:
   - Price on photo shows the two label pills.
   - Live shows `CK × 2.5`, "Today that's ≈RM13 at CK USD 4.99. It can change before you send the total.", the three steps (Post photo → Buyer claims → You send total), and the caption to copy (`CK × 2.5 · Foil × 2.8`).
3. **Price:**
   - Multiplier and Foil multiplier: text boxes with a `×` prefix, 1–5.
   - Rounding: dropdown, Up to RM 1, 5 or 10. These options are a proposal; match what the pricing code supports.
   - Minimum price: an `RM` prefix, a whole number from 0 to 50.
   - Then the formula line: "Final price = Card Kingdom retail USD × multiplier, rounded up to the nearest RM 1, never below RM 1."
4. **On the downloaded photo:**
   - Price-on-photo posts get Position, Size, Foil mark (F after price | None) and Currency label, plus the checkboxes **Show the currency label** and **Show cents (.00)**.
   - Every post gets **Draw card outlines**.
   - Live posts get one line instead of the label settings: "Live-price photos don't show prices, so there are no price labels to set."
5. **Use these for new posts too:** a checkbox. When the settings already match the defaults, show "These match your defaults for new posts." instead.
6. **Sticky bar:**
   - Status text: blank, "Unsaved changes", or "Fix the field marked in red".
   - **Cancel** and **Save**. Save is disabled until something changes and while a field is invalid.

Profile → Default pricing → **Edit** opens the same page for your defaults. The breadcrumb is `Profile / Default pricing`, and the "for new posts" checkbox is left out.

---

## 6. The card tile (photo page)

Tile: `--surface` on the photo's `--paper` section, radius 18, padding 12. From top to bottom:

1. **Two images, equal width, card ratio 63:88.**
   - Left: *Your card* (the crop from the photo), with its number badge in the corner.
   - Right: *Matched*.
   - Between them: → when verified, or a red `?` when it needs checking.
   - Clicking either image opens the viewer. Use an expand icon on the image, not an Expand button.
2. **Needs check** (only when it applies): a `--warn-soft` bar reading "Check printing & foil", with a **Looks right** button.
3. **Name ↗.** Links to Card Kingdom. On the right is an add-to-post toggle: `+` on `--fill`, or a green ✓ when the card is in the post.
4. **Version line.** Always visible. Never drop the set name or the number.
5. **Formula line** (footnote, `--ink-soft`). One of:
   - `USD 4.99 × 2.5`
   - Foil: `Foil · USD 4.49 × 2.8`, with "Foil" in `--gold`
   - Override: `Your price · auto ≈RM13`, with "Your price" in `--accent`
6. **Price.** Big number, with a pencil button (32px circle) that opens Edit price. When there's no price, show "Set a price" in `--warn`.
7. **Actions.** **Change card** (default button, opens all printings), then the stepper.

| State | How it looks |
|---|---|
| Foil | 1.5px inset `--gold` ring on the tile; "Foil" in gold in the formula line |
| Removed | Collapses to one row: number · "Removed · name" · **Restore** |

---

## 7. Prices and money

- **Format:**
  - `RM13`: no space. No decimals unless "Show cents" is on.
  - Thousands get commas: `RM1,240`.
  - On tiles and in settings, USD prices include the word: `USD 4.99`.
  - In claims and buyer messages, write `$4.99`. That's what buyers read in Messenger.
- **Calculation:** RM = USD × multiplier, rounded **up** to the rounding step (RM 1 by default: `ceil(usd*mult - 1e-9)`), then the minimum price applies.
  - Defaults: ×2.5 non-foil, ×2.8 foil.
  - Always show the formula next to the result.
- **Price on photo (fixed price):** plain `RM13`. Labels are drawn on the exported photo at the centre of each card:
  - Non-foil: dark pill `#141414`, white bold text, 1px `rgba(255,255,255,.18)` ring.
  - Foil: gold pill `#f0c332`, text `#19140a`, ring `rgba(255,230,130,.9)`, plus the `F` suffix (`RM13F`) when Foil mark is on.
- **Live price:**
  - Prefix every live amount with **`≈`** (U+2248, "about"): on tiles, totals and lists (`≈RM402`). Never use `~`.
  - The `≈` is the same size as the number, weight 400, in `--ink-soft`.
  - Once per page, say when the price gets set: "Each buyer's price is set when you send them their total."
  - Buyer messages never carry `≈`: copying the message is the moment the price is set.
- **Totals:** a label with a count ("Total · 12 cards"), with the amount as a big number.
- **Color meanings:** money in is `--green`, and foil is `--gold`. Nothing else uses gold, including progress bars, Paid and highlights.

---

## 8. Claims

The part is called **Claims** everywhere, never "Order tracker". It is the second tab of a post, so it always shows that one post's claims.

### Page, top to bottom

1. **Post head:** breadcrumbs, the post's title with Rename and Manage post, and the Photos | Claims tabs, the same as on Photos.
2. **Totals card:**
   - "To collect" as a big number, with "Paid" in `--green`
   - a 6px `--green` progress bar
   - `7 buyers · 11 cards · RM188 claimed`
   - the primary **Add claims**
   - gray **Drop-off slips** and **How claims work** buttons
3. **No photos yet:** the empty card says to add photos first, with **Go to Photos**.
4. **Buyers · N,** with a **Sort** dropdown: Claim order, Name or Photo ("so you can pull cards in order").
5. **Filter:** a segmented control with counts: All | Unpaid | Paid | Done.
6. **Buyer cards.** A card fits its buyer's cards, two rows at most, so a buyer with one card gets a shorter card. In the grid on a computer, the cards of one row stretch to the tallest, with the actions at the bottom, so the buttons line up:
   - **Header:** the name (17/600, one line, cut with …) and the total (22/700). Under the name, a status dot with "Unpaid · 3 cards".
   - **Card rows: at most 2.** Each row is one height:
     - the card cut from the seller's photo, 48px wide at 63:88, radius 5. A quantity shows as a `×2` badge on its corner. Clicking it opens the picture large.
     - the name (15/600), then "Photo 7" (only when the post has several photos), then `$4.49 × 2.5`, or `$4.99 × 2.5 → RM13 each` for several copies. Each is one line, cut with ….
     - the row's total (`RM26`) on the right.
   - **See more:** "See 3 more cards" opens the buyer dialog. It shows only when there are more.
   - **Actions:** **Copy message** (flexible width), **QR** (44px icon button), then the next-status button, at the bottom of the card. After copying, the button reads "Copied" in `--green` until you copy another buyer's message.
   - **Done** buyers keep the same card, with "Paid and dropped off" and **Not done** where the actions are, and the name and total in `--ink-soft`.
   - Clicking the name opens the **buyer dialog**:
     - "N cards": every card row, as on the buyer card, then **+ Add a card for {name}** (opens Add claims on a claim typed by hand, with the name filled in)
     - the exact message, in a bubble
     - **Copy message** (primary) and **Copy DuitNow QR**
     - the status control (Unpaid | Paid | Done)
     - "Buyer's number, for the drop-off slip"
     - **Remove buyer**
7. **Empty state:** "No claims yet", **Add claims**, and the four steps of How claims work, shown inline.

### Where the guide lives

- **First visit:** the empty state shows the four steps inline, under the primary button.
- **Any time after:** the **How claims work** button on the totals card opens a dialog with the same steps. Its footer has the primary **Add claims**.
- **While adding:** one line at the top of the Add comments dialog: "Screenshot the post with its comments, or just the comments. One screenshot can hold many comments."
- **The four steps:**
  1. **Screenshot the comments.** Include the post's photo if it fits, so the app can tell which photo the comments are for. If not, you pick it.
  2. **Check what was read.** Fix a misread name or card before you add the claims.
  3. **Copy each buyer's message.** Paste it in Messenger. Your payment details are added for you.
  4. **Print drop-off slips.** One slip per buyer with their name, for the drop-off point.

### Add claims: screenshots or by hand → check → add

**Add claims** is one dialog for both ways in. It opens on screenshots, the usual way. Under **Choose screenshots**, a plain link "No screenshot? Add a claim by hand" goes straight to step 4 with one blank claim: the buyer's name, then the card picker open, then the quantity. Claims typed by hand cost no claim read. The buyer's name suggests the seller's buyers, this post's first, and a name already known adds to that buyer.

1. **Add the screenshot.** The dialog shows its thumbnail with "Remove screenshot".
2. **Which photo?** Photo names alone don't tell sellers which is which, so always show the photos.
   - The label "Comments are for" sits next to **In this post**, above the photo picker grid.
   - If the screenshot includes the post's photo, preselect it and say so in green: "✓ Found Photo 4 in it". It stays changeable.
   - If it doesn't, nothing is preselected, and **Find claims** stays disabled until a photo (or Several photos) is picked.
   - **In this post** opens a full-height dialog listing every photo large, in post order. Each shows "Photo N", `8 cards · RM133` and **Use this photo**, or "Chosen" on the current pick.
3. **The comments that were read,** as rows: the name, then the text. The raw text sits behind "Fix a misread name".
4. **Find claims,** then check them. Each claim gets one card with:
   - the buyer's name, editable
   - the comment, in quotes
   - the matched card: thumbnail, name, photo and price, with **Change**
   - a quantity stepper

   Flag a fuzzy match in `--warn`: "Spelled differently in the comment. Check it's the right card." List skipped lines too: "Skipped 1 line that isn't a claim: …".
   At the end of the list, **+ Add another claim** adds a blank claim, for a comment the app missed. Claims typed by hand stay when **Find claims** runs again.
5. **Add N claims.** The new buyers join the list with a "New" chip.

### Statuses

Unpaid → Paid → Done. A label always goes with the dot: the color marks it, the label names it.

| Status | Dot | On the buyer card |
|---|---|---|
| Unpaid | `--warn` | **Mark paid** (`--green-soft` with `--green` text) |
| Paid | `--green` | **Mark done** (gray button) |
| Done | `--ink-faint` | Collapses to one line, with **Not done** |

- Every status change shows a toast with Undo.
- The old kanban (gold for Paid, green for Done, an On credit column) is retired. The landing tagline still mentions credit.

### Message format

Plain text, built exactly like this. Messenger shows `*Total*` in bold.

```
{Buyer name}
{Card} — ${usd} × {mult} → RM{each}
{Card} ×{qty} — ${usd} × {mult} → RM{each} each = RM{subtotal}

*Total: RM{total}*

Payment: {Bank} {Account number} ({Account name})
{Note for buyers}
```

Leave out payment parts that are empty. With no payment details at all, the message ends at the total.

### Drop-off slips

- **Dialog:** "A slip with each buyer's name, to leave with their cards at the drop-off point. Ten fit on an A4 page, and spare slips print blank."
  - One checkbox row per buyer, showing their saved number or "No number". All buyers are ticked by default, with **Select none** / **Select all** above the list.
  - "Saved phone numbers print on the slip. The rest get a line to write on."
  - Footer: **Cancel** and **Make PDF · N slips**.
- **The PDF:**
  - A4 portrait, 10 slips per page in a 2 × 5 grid that fills the page.
  - Cut lines between slips only: 1px dashed `#767676`.
  - No page header, title, date or page numbers.
- **Each slip,** 36px top padding and 40px at the sides. Labels are 13px `#333`:
  - **Buyer's name:** the name, 17px bold. On spare slips, a 200px write-in line.
  - **Buyer's number:** the saved number, or a 190px write-in line.
  - **Seller's name:** a 200px write-in line, at the bottom of the slip.
- **Nothing else:** no cards, prices, totals, or Paid/Unpaid.
- **Order:** the chosen buyers in claim order. The rest of the last page is blank slips.
- **Ink:** black on white only, so it reads in grayscale. Rules are at least 1px, and no text is under 12px.

---

## 9. Profile

A normal page (`h1` "Profile"). It opens from the avatar in the top bar on every page. It has no Done button; leave it with the mark in the top bar or the browser's Back.

1. **Account card:**
   - avatar, name, "Signed in with Google"
   - **Sign out** (gray button)
   - the prices status line ("Prices ready · 99,334 cards · updated 11h ago")
2. **Payment details** (optional): "Shown under each summary you copy for a buyer."
   - **What happens to these details?** reveals a short note. [Write that text: who sees the details, where they're stored, and how to delete them.]
   - **Text boxes:** Bank, Account number (numeric keyboard), Account name, and Note for buyers (a 2-line text area).
   - **DuitNow QR:** a thumbnail, **Replace QR** and **Remove**, with the line "Copy QR on Claims pastes this image into the chat."
   - **Buyers see:** a live preview of the payment lines, built from the fields as you type.
   - **Footer:**
     - **Delete my payment details** (plain `--warn`). It clears everything and offers Undo, not a confirm.
     - **Save** (primary). It's disabled until something changes. After saving, it reads "Saved" until the next edit.
     - Nothing saves as you type.
3. **Default pricing:** `×2.5 · Foil ×2.8 · Round up to RM 1` with **Edit**, and the line "New posts start with this. A post with its own pricing keeps it."
4. **Preferences:**
   - Language: English | Melayu
   - Appearance: Auto | Light | Dark
   - Each is a segmented control with its label above.
5. **Help:** **Support this app** and **Send feedback**, as full-width gray buttons. Each opens a dialog.

---

## 10. Sign-in page

- **Order:**
  1. Top bar: the mark and the name only. The avatar appears after sign-in.
  2. Headline "Snap. Price. Post." and the tagline, which tells the life of a post: priced from a photo, then the claims from the comments
  3. **Google button**, with "Google sign-in only — no password, nothing posted to your profile." under it
  4. **Try a sample post:** the demo, with a `1 · Photos | 2 · Claims` switch named like the post's tabs in the app. After the scan plays, **Next: Claims** moves to the Claims demo.
  5. **How a post works:** four numbered rows, each with a chip naming the tab it happens on: Snap and price (On Photos) · Post to Facebook (On Photos) · Read the claims (On Claims) · Collect and drop off (On Claims)
  6. Google button again (phones only; on wide screens the first one stays beside the demo)
  7. Footer: language, appearance and links
- **The sign-in button must be visible on the first screen** without scrolling, including on a 375×667 phone.
- **The Google button is Google's own:**
  - Call `google.accounts.id.renderButton` with `{ type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", logo_alignment: "left", width: <container px, max 400> }`.
  - Use the white `outline` theme in both app themes; it's the brightest thing on a dark page. Keep `color-scheme: light` on its container.
  - It is 40px tall. That's the one allowed exception to the 44px rule, so keep 8px clear around it.
  - Never redraw Google's logo yourself.
- **Demo:** no fake desktop window chrome (traffic-light dots) on phones.
  - **Photos:**
    - The sample photo fills the column.
    - Clicking play draws card outlines, then price pills, then shows the results list ("4 cards found · Total RM68").
    - Progress uses `--accent-fill`, not gold.
  - **Claims:**
    - A screenshot of a post with four comments, then **Find claims**.
    - Each comment gets its result: an RM amount or "Skipped".
    - Then a buyer switch (Aina | Wei Jie | Hafiz), the exact message, and **Copy message**.
  - **Sample data only.** Use invented buyers and `Payment: Maybank 0000 0000 0000 (Your name)`. This page is public: never real names, accounts or QR codes.
- **Steps list:** one list box with 36px `--accent-soft` number circles, not separate bordered cards.

---

## 11. Copy

- Sentence case everywhere: "Add all to post", not "Add All To Post".
- Buttons are verbs: Add photos, Change card, Mark paid, Download all, Save price.
- Join meta with a middle dot: `Live price · 2 photos · 19 cards`.
- Dates: `22 Oct, 4:11 pm`.
- Under a choice, give its consequence in one line: "Prices are printed on the photo. Finishing the post locks them for claims."
- Errors say what happened and what to do: "Couldn't read this photo. Try again with less glare."
- Avoid "tap" and "click" where a verb works: "Choose one", not "Tap one to select".
- Text that buyers read (messages and slips) is short and plain. Write it for someone reading on their phone in Messenger.
- English UI for now. Keep every string in code, never baked into images, so Bahasa Melayu can be added later.

## 12. Accessibility checklist

- Text contrast is at least 4.5:1. Secondary text uses `--ink-soft`; `--ink-faint` is never used for text people must read.
- Hit areas are at least 44px. On coarse pointers, small buttons keep their look but get a 44px `::after`.
- One visible focus ring: 3px `--accent-fill`, offset 2px, on `:focus-visible` only. Text boxes show their 2px ring on focus.
- Use real `<button>`, `<a href>`, `<input>`, `<select>` and `<label>`. Never put `onClick` on a div.
- Dialogs trap focus, close on Esc, and return focus to the button that opened them.
- Icon-only buttons have an `aria-label`. Decorative SVGs have `aria-hidden="true"`.
- Totals, quantities, save status and scan progress use `aria-live="polite"`. Field errors use `aria-invalid` and a message under the field.
- Color is never the only signal: a status dot has a label, and foil has the word "Foil".

## 13. Don'ts

- No bottom tab bar or floating pill navigation.
- No native-app chrome:
  - no sheet grabbers or swipe-down sheets
  - no action sheets
  - no switches
  - no large collapsing titles
  - no "‹ Back" in the bar
  - no blurred see-through bars
  - no Done buttons that only close
  - no chevrons on list rows
- No `~` for live prices. Use `≈`.
- No component library or new font for now.
- No gradients, no emoji as icons, no left-border accent cards, no decorative illustrations.
- No gold except for foil. No more than one filled blue button per page or dialog.
- No hover-only controls, no targets under 44px, no text under 12px.
- No fake desktop chrome on phones.
- Never hide the scanner's uncertainty or a price's formula.

---

## Canvas boards (what each one shows)

| Board | Shows |
|---|---|
| Card tile · states | Default, Check printing, Foil and Your price tiles |
| Sign in · phone | The sign-in page with a working demo (tweak: Before scan / Scanning / Scanned / Claims / Claims found) |
| Scanner home · phone | Posts with **+ New post**, the post list, and the New post dialog |
| Post · phone | Breadcrumbs and rename, the total, Share photos / Download all, Pricing settings row, photos (search, sort, select, reorder), and Manage post (Archive with Undo, Delete with confirm). The board draws Manage post as a card at the end; the app puts it in the ⋯ menu next to the title |
| Photo 2 · phone | Breadcrumbs, 11 working tiles, the viewer, the Change card dialog, and the Edit price dialog (Cancel / Save price) |
| Pricing settings · phone | The Pricing page: radio cards, text boxes, dropdowns, checkboxes and the sticky Cancel / Save bar |
| Claims · phone | (Drawn before Claims moved into the post: the app has the post head and tabs where the board has the Post dropdown.) How claims work, totals, buyers (Copy message, QR, Mark paid), Add comments with the photo picker and In this post, check claims, buyer dialog, drop-off slips dialog, and the empty state (tweak: view) |
| Drop-off slips · A4 PDF | The printed page: 10 slips with the buyer's name, number and seller lines only |
| Profile · phone | Account, the payment details form with Save, DuitNow QR, default pricing, preferences, and the help dialogs |
| Desktop boards | Compare, Change card, Edit price, and Photo 2 in place at 1440px, with the same top bar and tabs |

## Before you merge a UI change

- [ ] Works at 375px and 390px wide. Nothing scrolls sideways.
- [ ] Checked in both light and dark themes.
- [ ] Every interactive element is at least 44px, keyboard-reachable, with a visible focus ring.
- [ ] Tokens only, with no new hex values (except the fixed photo-label, slip and Google button colors).
- [ ] At most one primary button on the page or dialog.
- [ ] Every price shows its formula; every live price shows `≈`.
- [ ] Web patterns only: top bar, breadcrumbs on inner pages, post tabs, dialogs with × and a footer, checkboxes instead of switches, explicit Save.
- [ ] Copy is sentence case and uses seller words.
- [ ] Buyer messages match the template in section 8, character for character.