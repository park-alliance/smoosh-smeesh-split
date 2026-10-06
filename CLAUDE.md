# Smoosh & Smeesh Split

Costco receipt splitter PWA. Scan or paste a receipt, assign each line item
to Smoosh or Smeesh (or Split it evenly) with Tinder-style swipe/buttons,
get a final total. Pure arithmetic - no bank integration.

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
  (no DOM, no OCR dependency - testable with a plain string via Node)
- `split-calc.js` - pure arithmetic, items + tax -> each person's total
- `item-lookup.js` - item-code exact match + fuzzy text match against
  `data/item-lookup.json` (398 scraped items, partial coverage by design)
- `ocr.js` - thin wrapper around the vendored Tesseract.js build
  (`vendor/tesseract/`); see "OCR" below before touching its options
- `swipe-card.js` (planned, Milestone 4) - swipe gesture + buttons for
  Smoosh/Split/Smeesh, replacing the current flat list
- `data/sample-receipt.txt` - hardcoded sample text, still used by the
  "Load Sample Receipt" dev button for testing without a camera/photo
- `scripts/scrape_costco_items.py` - one-off script that built
  `data/item-lookup.json`, run manually, not at app runtime (robots.txt
  checked, rate-limited, only touches costco.com's sitemap + plain product
  pages - never its category/search browsing, which sits behind Kasada
  bot-mitigation)

Full build plan and milestone order: see the plan this was built from if
still present, otherwise this file is the source of truth going forward.

## Design decisions (do not revisit without the user)

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
