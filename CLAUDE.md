# Smoosh & Smeesh Split

Costco receipt splitter PWA. Scan or paste a receipt, assign each line item
to Smoosh or Smeesh (or Split it evenly), get a final total. Pure
arithmetic - no bank integration.

## Accounts / Repo

- GitHub: `park-alliance/smoosh-smeesh-split`, branch `master`
- No backend, no login, no database, no paid API calls of any kind
- No persistence requirement across sessions - `sessionStorage` only
  (survives an accidental tab switch, not closing the app)

## Structure

Plain HTML/CSS/JS, no build step, no framework - same approach as the
sibling `workout-tracker-app` repo:
- `index.html` / `style.css` - shell and styles
- `app.js` - wires state to the DOM, no business logic of its own
- `state.js` - central state object, sessionStorage persistence, the
  "split into 1 each" per-unit action
- `receipt-parser.js` - pure function, OCR/pasted text -> classified items
  (no DOM, no OCR dependency - testable with a plain string via Node); see
  "Receipt parsing" below before touching its regexes
- `split-calc.js` - pure arithmetic, items + tax -> each person's total
- `item-lookup.js` - item-code exact match + fuzzy text match against
  `data/item-lookup.json` (398 scraped items, partial coverage by design) -
  deliberately not being invested in further; the user said to drop it
  entirely if it's ever in the way, parsing + the "Look up online" linkout
  matter more
- `ocr.js` - thin wrapper around the vendored Tesseract.js build
  (`vendor/tesseract/`); see "OCR" below before touching its options
- `swipe-card.js` - Tinder-style drag-gesture card, built in full and
  tested, but **not currently wired into app.js** - the user found
  one-at-a-time swiping confusing in practice and asked to go back to a
  plain flat list in receipt order, so items can be checked back and forth
  against the physical receipt. The file is kept as-is so it's easy to
  re-enable later; see git history (search "swipe-card" / "Milestone 4")
  for exactly how it was wired into renderItemCard/renderStack if asked to
  bring it back.
- `data/sample-receipt.txt` - a full, real 41-item Costco receipt (hand-
  verified against the actual photo, item count and totals match what's
  printed on it), used by the "Load Sample Receipt" dev button. Exercises
  every real pattern this parser handles: duplicate lines, both discount-
  with-dash and discount-without-dash (OCR drops it sometimes), the bottle-
  deposit fold, a `***divider***` line, and a double-asterisk product name
  (`**KS ULTRA**`, not a divider). If you change the parser, reload this
  sample and confirm no backcheck warning appears - that's the regression
  check.
- `scripts/scrape_costco_items.py` - one-off script that built
  `data/item-lookup.json`, run manually, not at app runtime (robots.txt
  checked, rate-limited, only touches costco.com's sitemap + plain product
  pages - never its category/search browsing, which sits behind Kasada
  bot-mitigation)

Full build plan and milestone order: see the plan this was built from if
still present, otherwise this file is the source of truth going forward.

## Design decisions (do not revisit without the user)

- Flat list, all items shown at once, in the same order the receipt
  parsed in (not sorted, not split into "undecided"/"decided" sections).
  The user explicitly asked for this after trying the one-at-a-time swipe
  stack and finding it confusing - being able to check items back and
  forth against the physical receipt mattered more than the Tinder
  interaction. Assigning an item does not move or reorder it.
- Exactly 2 people, hardcoded as Smoosh/Smeesh - no 3rd+ person mode.
- A line with quantity > 1 gets a "Split into 1 each" action that replaces
  it with N independent 1-unit cards (dividing the actual, post-discount
  total - not the receipt's pre-discount per-unit price) so each unit can
  be assigned to a person individually.
- Item-name identification is a locally bundled lookup table (built offline
  by a one-off scraper script) with a "Look it up" Google-search linkout +
  manual inline edit as the deliberate fallback for unmatched items -
  partial coverage is expected, not a bug.
- OCR is fully client-side (Tesseract.js), vendored same-origin (not
  loaded from Tesseract's default CDN) so it works offline once the
  service worker caches it (Milestone 5 - not done yet, so OCR currently
  still needs a network connection for its first-ever run on a device).
- Manual add/edit/delete on every item card is a first-class feature, not
  just a fallback - both OCR and the parser will sometimes miss or
  mis-split a line.
- The totals screen is gated: it shows "N items still need a decision"
  instead of totals while anything is unassigned, so a missed line never
  silently drops someone's cost.

## Receipt parsing (`receipt-parser.js`)

Rewritten against two real Costco receipt photos (one run through actual
OCR, one hand-verified line-by-line against the photo) after the first
version - built only from a guessed/synthetic sample - failed to parse a
single line of real OCR output. Lessons that shaped the current regexes,
in case they look overly permissive:

- Real phone-photo OCR puts garbage *after* the price on nearly every
  line (stray marks, creases, glare - e.g. `15.69 18`, `12.99 :`,
  `9.30 | [EE`). None of the regexes require a line to end cleanly after
  the price/amount they're pulling out - they only require the number to
  be there, trailing junk is ignored. Don't add an end-anchor back.
- The leading flag column (normally `E`) OCRs inconsistently (`FE`, `=`,
  a stray `:`) - the prefix strip accepts any short (<=3 char) tokens, not
  a fixed letter set.
- Costco's real discount-line format is a tracking number + `/` + the
  *referenced* item code + the negative amount (`0000390206 /1930531
  4.00-`) - not a simpler "code, negative price" shape. The trailing `-`
  itself is sometimes dropped by OCR too; the `tracking / code` shape
  alone is trusted as "this is a discount" even without it, since that
  shape never appears on a genuine item line - without this, a dash-
  dropped discount line fell through to the item regex and became a fake
  standalone item worth the discount amount, which is worse than failing
  to parse (it looks like a real, successfully parsed line).
- A bottle deposit (`VT BOTTLE DE`, no item code, no SKU reference) folds
  into the *immediately preceding* item's price rather than becoming its
  own card - it's logically part of that drink's cost. "Immediately
  preceding" is enforced by resetting the adjacency pointer on *any* line
  that isn't a successful item/discount/qty match (including excluded and
  unknown lines) - otherwise a fee or discount line can silently attach
  itself to a distant, unrelated item when OCR drops the lines in between
  (this was a real bug, caught by testing, not a hypothetical).
- A price with no decimal separator at all (OCR dropped the `.` entirely,
  e.g. `1779` for `17.79`) deliberately does **not** match anything -
  guessing where the decimal goes risks a wildly wrong price in a money
  app. It's left to fall through to "unknown" for the user to fix by hand.
  Same reasoning for a totally dropped price (`GREEK YOGURT` with no price
  token at all) - no parser-level recovery is attempted.
- `extractTotalAmount`/`extractItemCount` read the receipt's own printed
  total and "TOTAL NUMBER OF ITEMS SOLD - N" count (the count comes
  *after* "SOLD", not before "ITEMS") as a backcheck, surfaced as a
  warning banner in app.js when the parsed total/count doesn't match -
  this is what catches a severe OCR misread that produces a plausible-but-
  wrong price (e.g. a real `21.99` OCR'd as `111.29` - structurally a
  valid price, no way to detect it's wrong except that the grand total
  stops adding up).
- `***** divider text *****` lines (section breaks like "Bottom of
  Basket") are excluded outright when OCR preserves the asterisks; when it
  doesn't (garbles them away entirely), the line has no price pattern
  anyway and harmlessly falls to "unknown" rather than being misread as an
  item.
- A photo with a visible background (desk clutter, a hand, a keyboard) or
  a verification mark drawn across the receipt measurably degrades OCR
  quality on nearby lines - confirmed by comparing two photos of the same
  receipt. No parser-level fix for this; if revisited, it would be image
  preprocessing (crop/mask) before OCR, not a parsing change.

## OCR (`ocr.js`, `vendor/tesseract/`)

Vendored rather than CDN-loaded: main lib + worker script + one WASM core
variant (SIMD+LSTM, the fast/modern combo - no legacy or non-SIMD
fallback vendored) + English trained data, ~6MB total. `workerBlobURL:
false` is required in the `createWorker` options - Tesseract.js's default
loads the worker via a Blob URL, which breaks the WASM core's own
relative fetch of its `.wasm` file (a blob: URL has no real path for a
bare filename to resolve against). Found this by testing OCR end-to-end
against a synthetic image before trusting the wiring - don't skip that
kind of check if you touch these options, the failure mode is a silent
hang, not a thrown error at the call site.

## Money math (`split-calc.js`)

Rounds one side with `round2()`, then computes the other side as a
remainder against the (unrounded) grand total - rounding both sides
independently can round both up on an exact half-cent split and overcount
the total by a cent. Same remainder trick is used for tax proration. See
the function's comments before changing this.

## Style

- No em dashes in any generated text (UI copy, code strings, docs, commit
  messages) - use a regular hyphen.
- No build tooling - edit the files directly and reload.
