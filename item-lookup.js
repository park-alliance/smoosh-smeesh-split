// Matches a parsed receipt line against the locally bundled item-lookup
// table: exact item-code match first, then fuzzy token-overlap as a
// fallback. Works fine with a near-empty table - partial coverage is the
// accepted design (see CLAUDE.md), not a defect to fix here.

const FUZZY_THRESHOLD = 0.4; // token-overlap score needed to suggest a name

let cachedLookup = null;

export async function loadLookupTable() {
    if (cachedLookup) return cachedLookup;
    try {
        const res = await fetch('./data/item-lookup.json');
        if (!res.ok) throw new Error(`status ${res.status}`);
        cachedLookup = await res.json();
    } catch (e) {
        console.warn('Could not load item-lookup.json, continuing with an empty table', e);
        cachedLookup = { items: {}, textIndex: [] };
    }
    return cachedLookup;
}

function tokenize(text) {
    return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length > 1);
}

function tokenOverlapScore(aTokens, bTokens) {
    if (aTokens.length === 0 || bTokens.length === 0) return 0;
    const bSet = new Set(bTokens);
    const shared = aTokens.filter(t => bSet.has(t)).length;
    return shared / Math.min(aTokens.length, bTokens.length);
}

// Returns { name, confidence: 'exact' | 'fuzzy' | 'none' }
export function matchItem(lookup, { itemCode, rawDescription }) {
    if (itemCode && lookup.items[itemCode]) {
        return { name: lookup.items[itemCode].name, confidence: 'exact' };
    }

    const queryTokens = tokenize(rawDescription);
    let best = null;
    let bestScore = 0;
    for (const entry of lookup.textIndex) {
        const score = tokenOverlapScore(queryTokens, entry.tokens);
        if (score > bestScore) {
            bestScore = score;
            best = entry;
        }
    }

    if (best && bestScore >= FUZZY_THRESHOLD) {
        return { name: lookup.items[best.code]?.name || rawDescription, confidence: 'fuzzy' };
    }

    return { name: rawDescription, confidence: 'none' };
}

export function googleLookupUrl(rawText) {
    const query = `costco item "${rawText}"`;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
