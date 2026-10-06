// Parses raw receipt text (from OCR or pasted manually) into classified
// lines. Pure function - no DOM, no OCR dependency - so it's testable with
// nothing but a plain string.

const NON_ITEM_KEYWORDS = [
    'SUBTOTAL', 'TOTAL', 'TAX', 'BALANCE', 'CHANGE DUE', 'AMOUNT TENDERED',
    'AMOUNT', 'ITEMS SOLD', 'VISA', 'MASTERCARD', 'AMEX', 'DEBIT',
    'PURCHASE', 'AID', 'SEQ', 'APPROVED', 'AUTH', 'MEMBER',
];

// A bottle deposit is a per-container surcharge printed as its own line
// right after the beverage it applies to (no item code, no SKU reference -
// just a description and a price) - it's logically part of that drink's
// cost, not a separate thing to hand to Smoosh or Smeesh on its own, so it
// folds into the preceding item's price instead of becoming its own card.
const BOTTLE_FEE_RE = /BOTTLE\s*DEP|BOTTLE\s*DE\b/i;

// Real phone-photo OCR of a thermal receipt is noisy on *every* line -
// stray marks, creases, and glare routinely OCR into garbage characters
// after the price (e.g. "15.69 18", "12.99 :", "9.30 | [EE"). None of
// these regexes require the line to cleanly end after the price - they
// only require the price to appear; anything after it is ignored. This
// was tested against a real Costco receipt photo where every single line
// had trailing noise (see git history for the exact raw OCR text).
//
// The leading flag column (normally "E"/"A"/"H") also OCRs inconsistently
// ("FE", "=", or an extra stray token like a leading ":"), so the prefix
// match accepts any number of short (<=3 char) non-space tokens rather
// than a fixed set of letters.
//
// The item code itself is optional - some real lines (e.g. Vermont's
// bottle-deposit line) have no code at all, just a description and price.
//
// Price allows "," as well as "." for the decimal point (seen as an OCR
// misread of the period) - normalized to "." before parseFloat. A price
// with no decimal separator at all (OCR dropped the "." entirely, e.g.
// "1779" for "17.79") deliberately does NOT match: silently guessing
// where the decimal point goes risks a wildly wrong price (this is a
// money app), so that case is left to fall through to "unknown" where
// the user corrects it by hand instead.
const LEADING_NOISE_RE = /^(?:\S{1,3}\s+)*/;
const ITEM_LINE_RE = /^(?:(\d{4,8})\s+)?(.+?)\s+(\d{1,4}[.,]\d{2})(?!\d)/;
// The trailing "-" that marks this as a discount is sometimes dropped by
// OCR entirely (confirmed against real OCR output) - without the "?" this
// fell through to ITEM_LINE_RE instead, which happily matched the long
// tracking number + "/code" text as a bogus item worth the discount
// amount (e.g. a fake "$4.00" item with a garbage name), which is worse
// than failing to parse: it looks like a real, successfully parsed line.
// The "trackingNumber / itemCode" shape is distinctive enough on its own
// (never seen on a genuine item line) to trust as a discount even without
// the dash.
const DISCOUNT_LINE_RE = /^\d{4,12}\s*\/\s*(\d{4,8})\s+(\d{1,4}[.,]\d{2})-?/;
const QTY_LINE_RE = /^(\d+)\s*@\s*(\d{1,4}[.,]\d{2})\s*$/;

function stripLeadingNoise(line) {
    return line.replace(LEADING_NOISE_RE, '');
}

function parsePrice(priceStr) {
    return parseFloat(priceStr.replace(',', '.'));
}

function isNonItemLine(line) {
    const upper = line.toUpperCase();
    if (/^X{4,}/.test(upper)) return true;
    // Section dividers like "***** BOTTOM OF BASKET *****" or
    // "***BOB Count 8***" (items scanned from under the cart) - no price,
    // just noise framed in asterisks. Excluded outright rather than left
    // for "unknown" review, since there's never anything to recover here.
    if (/\*{3,}/.test(line)) return true;
    return NON_ITEM_KEYWORDS.some(kw => upper.includes(kw));
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

let idCounter = 1;
function makeLineId() {
    return `line-${idCounter++}`;
}

// Same trailing-noise tolerance as the item/discount regexes - OCR can
// still tack garbage onto TAX/TOTAL/ITEMS SOLD lines, so none of these
// require the line to end right after the number they're pulling out.
function findLabeledAmount(excludedLines, labelPattern) {
    for (const { raw } of excludedLines) {
        if (labelPattern.test(raw)) {
            const match = raw.match(/(\d{1,5}[.,]\d{2})/);
            if (match) return parsePrice(match[1]);
        }
    }
    return null;
}

// Pulls the dollar amount off a TAX line in the excluded list, if present,
// so the UI can pre-fill the tax field instead of making the user retype it.
export function extractTaxAmount(excludedLines) {
    return findLabeledAmount(excludedLines, /\bTAX\b/i) ?? 0;
}

// For the totals backcheck: the receipt's own printed grand total, so the
// app can flag "this doesn't add up" when OCR silently drops a price (as
// opposed to leaving a visible gap) rather than trusting a short total.
export function extractTotalAmount(excludedLines) {
    const total = findLabeledAmount(excludedLines, /\bTOTAL\b/i);
    if (total !== null) return total;
    return findLabeledAmount(excludedLines, /^\**\s*AMOUNT\s*:/i);
}

// The receipt's own printed item count, for the same backcheck - compared
// against how many item cards actually got parsed out. Costco prints this
// as "TOTAL NUMBER OF ITEMS SOLD - 41" - the count comes *after* "SOLD",
// not before "ITEMS" (confirmed against a real receipt; don't swap this
// back without checking another one).
export function extractItemCount(excludedLines) {
    for (const { raw } of excludedLines) {
        const match = raw.match(/ITEMS?\s*SOLD\D{0,5}(\d{1,4})/i);
        if (match) return parseInt(match[1], 10);
    }
    return null;
}

export function parseReceipt(rawText) {
    const lines = rawText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    const items = [];
    const excluded = [];
    const unknown = [];
    let lastItem = null;

    for (const raw of lines) {
        if (isNonItemLine(raw)) {
            excluded.push({ id: makeLineId(), raw });
            // A discount or bottle-fee line always directly follows its own
            // item on a real receipt - if something else (even a divider)
            // came between, don't let a later adjustment line silently
            // attach itself to a distant, unrelated item.
            lastItem = null;
            continue;
        }

        const qtyMatch = raw.match(QTY_LINE_RE);
        if (qtyMatch && lastItem) {
            lastItem.quantity = parseInt(qtyMatch[1], 10);
            lastItem.unitPrice = parsePrice(qtyMatch[2]);
            continue;
        }

        const stripped = stripLeadingNoise(raw);

        const discountMatch = stripped.match(DISCOUNT_LINE_RE);
        if (discountMatch && lastItem) {
            const discount = parsePrice(discountMatch[2]);
            lastItem.totalPrice = round2(lastItem.totalPrice - discount);
            lastItem.discountApplied = round2((lastItem.discountApplied || 0) + discount);
            continue;
        }

        const itemMatch = stripped.match(ITEM_LINE_RE);
        if (itemMatch) {
            const [, code, desc, priceStr] = itemMatch;
            const price = parsePrice(priceStr);
            const trimmedDesc = desc.trim();

            // A bottle-deposit line has no item code and no SKU reference -
            // just text and a price - and belongs to the drink just above
            // it, not its own card.
            if (!code && lastItem && BOTTLE_FEE_RE.test(trimmedDesc)) {
                lastItem.totalPrice = round2(lastItem.totalPrice + price);
                continue;
            }

            const item = {
                id: makeLineId(),
                raw,
                itemCode: code,
                rawDescription: trimmedDesc,
                displayName: trimmedDesc,
                totalPrice: price,
                quantity: 1,
                unitPrice: price,
                discountApplied: 0,
                assignment: null,
                nameConfidence: 'unresolved',
            };
            items.push(item);
            lastItem = item;
            continue;
        }

        unknown.push({ id: makeLineId(), raw });
        lastItem = null; // same adjacency reasoning as the excluded branch above
    }

    return { items, excluded, unknown };
}
