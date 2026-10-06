// Central in-memory state + sessionStorage persistence (survives an
// accidental tab switch, not a closed app - this is deliberately ephemeral).

const STORAGE_KEY = 'smoosh-smeesh-state-v1';

let idCounter = 1;
export function makeId() {
    return `item-${Date.now()}-${idCounter++}`;
}

export function loadState() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to load saved state', e);
    }
    return { items: [], taxAmount: 0 };
}

export function saveState(state) {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Failed to save state', e);
    }
}

export function addManualItem(state, { description, price }) {
    state.items.push({
        id: makeId(),
        raw: '',
        itemCode: null,
        rawDescription: description,
        displayName: description,
        totalPrice: price,
        quantity: 1,
        unitPrice: price,
        discountApplied: 0,
        assignment: null,
        nameConfidence: 'manual',
    });
}

export function removeItem(state, id) {
    state.items = state.items.filter(i => i.id !== id);
}

export function updateItem(state, id, fields) {
    const item = state.items.find(i => i.id === id);
    if (item) Object.assign(item, fields);
}

export function assignItem(state, id, assignment) {
    const item = state.items.find(i => i.id === id);
    if (item) item.assignment = assignment;
}

// Replaces a quantity>1 card with `quantity` independent 1-unit cards, so
// each one can be swiped/assigned separately ("each bought 1").
export function splitIntoUnits(state, id) {
    const idx = state.items.findIndex(i => i.id === id);
    if (idx === -1) return;
    const item = state.items[idx];
    const qty = item.quantity || 1;
    if (qty <= 1) return;

    // Split the actual (post-discount) line total evenly, not the receipt's
    // pre-discount per-unit price - otherwise a discounted line would
    // overcharge once split into units. Leftover cents from the division
    // go to the first unit(s) so the pieces still add up to the original.
    const baseCents = Math.floor((item.totalPrice / qty) * 100);
    let remainderCents = Math.round(item.totalPrice * 100) - baseCents * qty;

    const units = [];
    for (let i = 0; i < qty; i++) {
        let cents = baseCents;
        if (remainderCents > 0) {
            cents += 1;
            remainderCents -= 1;
        }
        units.push({
            ...item,
            id: makeId(),
            displayName: `${item.displayName} (unit ${i + 1} of ${qty})`,
            totalPrice: cents / 100,
            quantity: 1,
            unitPrice: cents / 100,
            assignment: null,
        });
    }
    state.items.splice(idx, 1, ...units);
}
