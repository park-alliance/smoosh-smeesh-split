// Parses raw receipt text (from OCR or pasted manually) into classified
// lines. Pure function - no DOM, no OCR dependency - so it's testable with
// nothing but a plain string.

const NON_ITEM_KEYWORDS = [
    'SUBTOTAL', 'TOTAL', 'TAX', 'BALANCE', 'CHANGE DUE', 'AMOUNT TENDERED',
    'VISA', 'MASTERCARD', 'AMEX', 'DEBIT', 'PURCHASE', 'AID', 'SEQ',
    'APPROVED', 'AUTH', 'MEMBER',
];

const ITEM_LINE_RE = /^(?:[EAH]\s+)?(\d{4,7})\s+(.+?)\s+(\d+\.\d{2})\s*$/;
const DISCOUNT_LINE_RE = /^(?:[EAH]\s+)?(\d{4,7})?\s*(\d+\.\d{2})-\s*$/;
const QTY_LINE_RE = /^(\d+)\s*@\s*(\d+\.\d{2})\s*$/;

function isNonItemLine(line) {
    const upper = line.toUpperCase();
    if (/^X{4,}/.test(upper)) return true;
    return NON_ITEM_KEYWORDS.some(kw => upper.includes(kw));
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

let idCounter = 1;
function makeLineId() {
    return `line-${idCounter++}`;
}

// Pulls the dollar amount off a TAX line in the excluded list, if present,
// so the UI can pre-fill the tax field instead of making the user retype it.
export function extractTaxAmount(excludedLines) {
    for (const { raw } of excludedLines) {
        if (/\bTAX\b/i.test(raw)) {
            const match = raw.match(/(\d+\.\d{2})\s*$/);
            if (match) return parseFloat(match[1]);
        }
    }
    return 0;
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
            continue;
        }

        const qtyMatch = raw.match(QTY_LINE_RE);
        if (qtyMatch && lastItem) {
            lastItem.quantity = parseInt(qtyMatch[1], 10);
            lastItem.unitPrice = parseFloat(qtyMatch[2]);
            continue;
        }

        const discountMatch = raw.match(DISCOUNT_LINE_RE);
        if (discountMatch && lastItem) {
            const discount = parseFloat(discountMatch[2]);
            lastItem.totalPrice = round2(lastItem.totalPrice - discount);
            lastItem.discountApplied = round2((lastItem.discountApplied || 0) + discount);
            continue;
        }

        const itemMatch = raw.match(ITEM_LINE_RE);
        if (itemMatch) {
            const [, code, desc, price] = itemMatch;
            const totalPrice = parseFloat(price);
            const item = {
                id: makeLineId(),
                raw,
                itemCode: code,
                rawDescription: desc.trim(),
                displayName: desc.trim(),
                totalPrice,
                quantity: 1,
                unitPrice: totalPrice,
                discountApplied: 0,
                assignment: null,
                nameConfidence: 'unresolved',
            };
            items.push(item);
            lastItem = item;
            continue;
        }

        unknown.push({ id: makeLineId(), raw });
    }

    return { items, excluded, unknown };
}
