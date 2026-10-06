import { parseReceipt, extractTaxAmount } from './receipt-parser.js';
import { computeTotals } from './split-calc.js';
import {
    loadState, saveState, addManualItem, removeItem,
    updateItem, assignItem, splitIntoUnits, deferItem,
} from './state.js';
import { loadLookupTable, matchItem, googleLookupUrl } from './item-lookup.js';

const ICON_MAGNIFIER = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

const state = loadState();

const itemsEl = document.getElementById('items-list');
const unknownEl = document.getElementById('unknown-list');
const totalsEl = document.getElementById('totals');
const taxInput = document.getElementById('tax-input');
const addItemBtn = document.getElementById('add-item-btn');
const loadSampleBtn = document.getElementById('load-sample-btn');

taxInput.value = state.taxAmount || 0;

function persist() {
    saveState(state);
}

function renderItems() {
    itemsEl.innerHTML = '';
    // Tapping an unresolved item's "?" badge defers it to the bottom (a
    // deliberate "come back to this later", not an automatic sort - an
    // unresolved item stays wherever it is until you actually dismiss it).
    // Stable sort keeps everything else in its original order.
    const sorted = [...state.items].sort((a, b) => (a.deferred ? 1 : 0) - (b.deferred ? 1 : 0));
    for (const item of sorted) {
        itemsEl.appendChild(renderItemCard(item));
    }
}

function renderItemCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card';
    if (item.assignment) card.classList.add(`assigned-${item.assignment.toLowerCase()}`);

    const topRow = document.createElement('div');
    topRow.className = 'item-top-row';

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'item-desc';
    descInput.value = item.displayName;
    descInput.addEventListener('input', () => {
        // Typing a correction means the name is resolved now - drop the
        // "unknown" badge and let it re-sort out of the unresolved group
        // on the next structural render.
        updateItem(state, item.id, { displayName: descInput.value, nameConfidence: 'manual' });
        persist();
    });

    topRow.appendChild(descInput);

    if (item.nameConfidence === 'none' && item.itemCode) {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'unknown-badge';
        badge.textContent = '?';
        badge.title = 'Couldn\'t auto-identify this item - tap to come back to it later';
        badge.addEventListener('click', () => {
            deferItem(state, item.id);
            persist();
            renderAll();
        });
        topRow.appendChild(badge);
    }

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.step = '0.01';
    priceInput.className = 'item-price';
    priceInput.value = item.totalPrice;
    priceInput.addEventListener('input', () => {
        const val = parseFloat(priceInput.value) || 0;
        updateItem(state, item.id, { totalPrice: val, unitPrice: val });
        persist();
        renderTotals();
    });

    topRow.appendChild(priceInput);
    card.appendChild(topRow);

    if (item.nameConfidence === 'fuzzy') {
        const hint = document.createElement('div');
        hint.className = 'confidence-hint';
        // The suggested name has already replaced the raw receipt text in
        // the field above - show the raw text here too, otherwise there's
        // nothing left to check the suggestion against.
        hint.textContent = `Suggested for "${item.rawDescription}" - check it's right`;
        card.appendChild(hint);
    } else if (item.nameConfidence === 'none' && item.itemCode) {
        const lookupRow = document.createElement('div');
        lookupRow.className = 'lookup-row';
        const link = document.createElement('a');
        link.className = 'lookup-link';
        link.href = googleLookupUrl(item.rawDescription);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.innerHTML = `${ICON_MAGNIFIER} Look up online`;
        lookupRow.appendChild(link);
        card.appendChild(lookupRow);
    }

    if (item.quantity > 1) {
        const qtyRow = document.createElement('div');
        qtyRow.className = 'item-qty-row';
        qtyRow.textContent = `Qty ${item.quantity} @ $${item.unitPrice.toFixed(2)} each`;
        const splitBtn = document.createElement('button');
        splitBtn.className = 'link-btn';
        splitBtn.textContent = 'Split into 1 each';
        splitBtn.addEventListener('click', () => {
            splitIntoUnits(state, item.id);
            persist();
            renderAll();
        });
        qtyRow.appendChild(splitBtn);
        card.appendChild(qtyRow);
    }

    const actionsRow = document.createElement('div');
    actionsRow.className = 'item-actions-row';

    const smooshBtn = makeAssignButton('Smoosh', 'SMOOSH', item, actionsRow);
    const splitBtn = makeAssignButton('Split', 'SPLIT', item, actionsRow);
    const smeeshBtn = makeAssignButton('Smeesh', 'SMEESH', item, actionsRow);
    actionsRow.appendChild(smooshBtn);
    actionsRow.appendChild(splitBtn);
    actionsRow.appendChild(smeeshBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn danger-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', () => {
        removeItem(state, item.id);
        persist();
        renderAll();
    });
    actionsRow.appendChild(deleteBtn);

    card.appendChild(actionsRow);
    return card;
}

function makeAssignButton(label, value, item, row) {
    const btn = document.createElement('button');
    btn.className = 'assign-btn';
    btn.textContent = label;
    if (item.assignment === value) btn.classList.add('active');
    btn.addEventListener('click', () => {
        assignItem(state, item.id, item.assignment === value ? null : value);
        persist();
        renderAll();
    });
    return btn;
}

function renderUnknown() {
    unknownEl.innerHTML = '';
    if (!state.unknownLines || state.unknownLines.length === 0) {
        unknownEl.classList.add('hidden');
        return;
    }
    unknownEl.classList.remove('hidden');
    for (const line of state.unknownLines) {
        const row = document.createElement('div');
        row.className = 'unknown-row';

        const text = document.createElement('span');
        text.textContent = line.raw;
        row.appendChild(text);

        const addBtn = document.createElement('button');
        addBtn.className = 'link-btn';
        addBtn.textContent = 'Add as item';
        addBtn.addEventListener('click', () => {
            addManualItem(state, { description: line.raw, price: 0 });
            state.unknownLines = state.unknownLines.filter(l => l.id !== line.id);
            persist();
            renderAll();
        });
        row.appendChild(addBtn);

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'icon-btn danger-btn';
        dismissBtn.textContent = '✕';
        dismissBtn.addEventListener('click', () => {
            state.unknownLines = state.unknownLines.filter(l => l.id !== line.id);
            persist();
            renderAll();
        });
        row.appendChild(dismissBtn);

        unknownEl.appendChild(row);
    }
}

function renderTotals() {
    const taxAmount = parseFloat(taxInput.value) || 0;
    state.taxAmount = taxAmount;
    const totals = computeTotals(state.items, taxAmount);

    totalsEl.innerHTML = '';

    if (state.items.length === 0) {
        totalsEl.textContent = 'Add items to see the split.';
        return;
    }

    if (totals.unassignedCount > 0) {
        const banner = document.createElement('div');
        banner.className = 'totals-banner';
        banner.textContent = `${totals.unassignedCount} item${totals.unassignedCount === 1 ? '' : 's'} still need a decision`;
        totalsEl.appendChild(banner);
        return;
    }

    const row = document.createElement('div');
    row.className = 'totals-row';
    row.innerHTML = `
        <div class="totals-person">
            <div class="totals-name">Smoosh</div>
            <div class="totals-amount">$${totals.smooshTotal.toFixed(2)}</div>
            <div class="totals-breakdown">$${totals.smooshSubtotal.toFixed(2)} + $${totals.smooshTax.toFixed(2)} tax</div>
        </div>
        <div class="totals-person">
            <div class="totals-name">Smeesh</div>
            <div class="totals-amount">$${totals.smeeshTotal.toFixed(2)}</div>
            <div class="totals-breakdown">$${totals.smeeshSubtotal.toFixed(2)} + $${totals.smeeshTax.toFixed(2)} tax</div>
        </div>
    `;
    totalsEl.appendChild(row);
}

function renderAll() {
    renderItems();
    renderUnknown();
    renderTotals();
}

addItemBtn.addEventListener('click', () => {
    addManualItem(state, { description: 'New item', price: 0 });
    persist();
    renderAll();
});

async function applyLookup(items) {
    const lookup = await loadLookupTable();
    for (const item of items) {
        const match = matchItem(lookup, {
            itemCode: item.itemCode,
            rawDescription: item.rawDescription,
        });
        item.nameConfidence = match.confidence;
        if (match.confidence !== 'none') {
            item.displayName = match.name;
        }
    }
}

loadSampleBtn.addEventListener('click', async () => {
    const res = await fetch('./data/sample-receipt.txt');
    const text = await res.text();
    const { items, excluded, unknown } = parseReceipt(text);
    await applyLookup(items);
    state.items = items;
    state.unknownLines = unknown;
    state.taxAmount = extractTaxAmount(excluded);
    taxInput.value = state.taxAmount;
    persist();
    renderAll();
});

taxInput.addEventListener('input', () => {
    renderTotals();
    persist();
});

renderAll();
