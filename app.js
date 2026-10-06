import { parseReceipt, extractTaxAmount, extractTotalAmount, extractItemCount } from './receipt-parser.js';
import { computeTotals } from './split-calc.js';
import {
    loadState, saveState, addManualItem, removeItem,
    updateItem, assignItem, splitIntoUnits,
} from './state.js';
import { loadLookupTable, matchItem, googleLookupUrl } from './item-lookup.js';
import { recognizeReceiptImage } from './ocr.js';
// Tinder-style swipe-card.js is still here, just not wired in right now -
// turned out confusing in practice, reverted to a plain in-order list so
// items can be checked back and forth against the physical receipt. Easy
// to re-enable later (see swipe-card.js and git history for how it was
// wired into renderItemCard/renderStack).

const ICON_MAGNIFIER = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

const state = loadState();

const itemsEl = document.getElementById('items-list');
const emptyStateEl = document.getElementById('empty-state');
const unknownEl = document.getElementById('unknown-list');
const backcheckEl = document.getElementById('backcheck');
const totalsEl = document.getElementById('totals');
const taxInput = document.getElementById('tax-input');
const addItemBtn = document.getElementById('add-item-btn');
const loadSampleBtn = document.getElementById('load-sample-btn');
const scanReceiptBtn = document.getElementById('scan-receipt-btn');
const receiptPhotoInput = document.getElementById('receipt-photo-input');
const scanStatusEl = document.getElementById('scan-status');

taxInput.value = state.taxAmount || 0;

function persist() {
    saveState(state);
}

function renderItems() {
    // Plain in-order list, same order the receipt parsed in - so you can
    // check items back and forth against the physical receipt instead of
    // hunting for them in a reshuffled or one-at-a-time view.
    itemsEl.innerHTML = '';
    for (const item of state.items) {
        itemsEl.appendChild(renderItemCard(item));
    }
    emptyStateEl.classList.toggle('hidden', state.items.length > 0);
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
        // "unknown" badge.
        updateItem(state, item.id, { displayName: descInput.value, nameConfidence: 'manual' });
        persist();
    });

    topRow.appendChild(descInput);

    if (item.nameConfidence === 'none' && item.itemCode) {
        const badge = document.createElement('span');
        badge.className = 'unknown-badge';
        badge.textContent = '?';
        badge.title = 'Couldn\'t auto-identify this item';
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

    const smooshBtn = makeAssignButton('Smoosh', 'SMOOSH', item);
    const splitBtn = makeAssignButton('Split', 'SPLIT', item);
    const smeeshBtn = makeAssignButton('Smeesh', 'SMEESH', item);
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

function makeAssignButton(label, value, item) {
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

// Flags "this doesn't add up" against the receipt's own printed total and
// item count - the signal that catches an OCR failure that otherwise
// looks like nothing happened (a line whose price was silently dropped
// entirely, rather than left as a visible gap). Tolerant of a couple
// cents of rounding noise; anything beyond that gets called out so the
// user knows to double-check the list instead of trusting it blindly.
function renderBackcheck() {
    const { receiptTotalAmount, receiptItemCount } = state;
    if (receiptTotalAmount == null && receiptItemCount == null) {
        backcheckEl.classList.add('hidden');
        return;
    }

    const problems = [];

    if (receiptItemCount != null && state.items.length !== receiptItemCount) {
        problems.push(`Receipt says ${receiptItemCount} items sold, but ${state.items.length} were parsed.`);
    }

    if (receiptTotalAmount != null) {
        const parsedSum = state.items.reduce((sum, i) => sum + i.totalPrice, 0);
        const parsedTotal = Math.round((parsedSum + (state.taxAmount || 0)) * 100) / 100;
        if (Math.abs(parsedTotal - receiptTotalAmount) > 0.02) {
            problems.push(`Parsed total $${parsedTotal.toFixed(2)} doesn't match the receipt's $${receiptTotalAmount.toFixed(2)}.`);
        }
    }

    if (problems.length === 0) {
        backcheckEl.classList.add('hidden');
        return;
    }

    backcheckEl.textContent = `${problems.join(' ')} Some lines may be missing or misread - check the list below.`;
    backcheckEl.classList.remove('hidden');
}

function renderAll() {
    renderItems();
    renderUnknown();
    renderTotals();
    renderBackcheck();
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

async function loadReceiptText(text) {
    const { items, excluded, unknown } = parseReceipt(text);
    await applyLookup(items);
    state.items = items;
    state.unknownLines = unknown;
    state.taxAmount = extractTaxAmount(excluded);
    // The receipt's own printed total/item-count, kept around purely to
    // flag "this doesn't add up" (e.g. OCR silently dropped a price
    // entirely, like a line that never even shows a dollar amount) - not
    // used for anything else, and cleared once the receipt no longer
    // matches what's on screen (see updateItem/removeItem/addManualItem).
    state.receiptTotalAmount = extractTotalAmount(excluded);
    state.receiptItemCount = extractItemCount(excluded);
    taxInput.value = state.taxAmount;
    persist();
    renderAll();
}

loadSampleBtn.addEventListener('click', async () => {
    const res = await fetch('./data/sample-receipt.txt');
    const text = await res.text();
    await loadReceiptText(text);
});

function setScanStatus(text) {
    if (text) {
        scanStatusEl.textContent = text;
        scanStatusEl.classList.remove('hidden');
    } else {
        scanStatusEl.classList.add('hidden');
    }
}

scanReceiptBtn.addEventListener('click', () => {
    receiptPhotoInput.click();
});

receiptPhotoInput.addEventListener('change', async () => {
    const file = receiptPhotoInput.files[0];
    receiptPhotoInput.value = ''; // allow re-selecting the same file later
    if (!file) return;

    scanReceiptBtn.disabled = true;
    setScanStatus('Reading receipt...');
    try {
        const text = await recognizeReceiptImage(file, (data) => {
            if (data.status === 'recognizing text') {
                setScanStatus(`Reading receipt... ${Math.round(data.progress * 100)}%`);
            } else {
                setScanStatus(data.status);
            }
        });
        await loadReceiptText(text);
    } catch (e) {
        console.error('OCR failed', e);
        setScanStatus('Could not read that photo - try again or use "Load Sample Receipt" to test.');
        setTimeout(() => setScanStatus(null), 4000);
        return;
    } finally {
        scanReceiptBtn.disabled = false;
    }
    setScanStatus(null);
});

taxInput.addEventListener('input', () => {
    renderTotals();
    persist();
});

renderAll();
