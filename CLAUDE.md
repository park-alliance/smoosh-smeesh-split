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
- `item-lookup.js` (planned) - item-code/text match against
  `data/item-lookup.json`
- `ocr.js` (planned) - Tesseract.js wrapper
- `swipe-card.js` (planned) - swipe gesture + buttons for Smoosh/Split/Smeesh
- `data/sample-receipt.txt` - hardcoded sample text used to develop/test
  the parser and split math without needing OCR or a camera
- `scripts/scrape_costco_items.py` (planned) - one-off script that builds
  `data/item-lookup.json`, run manually, not at app runtime

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
- OCR is fully client-side (Tesseract.js), cached offline after first use.
- Manual add/edit/delete on every item card is a first-class feature, not
  just a fallback - both OCR and the parser will sometimes miss or
  mis-split a line.
- The totals screen is gated: it shows "N items still need a decision"
  instead of totals while anything is unassigned, so a missed line never
  silently drops someone's cost.

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
