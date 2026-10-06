// Pure arithmetic: turns assigned/split items + a tax amount into each
// person's final total. No DOM, no state - just numbers in, numbers out.

function round2(n) {
    return Math.round(n * 100) / 100;
}

export function computeTotals(items, taxAmount) {
    let smooshRaw = 0;
    let smeeshRaw = 0;
    let splitPool = 0;
    let unassignedCount = 0;

    for (const item of items) {
        switch (item.assignment) {
            case 'SMOOSH': smooshRaw += item.totalPrice; break;
            case 'SMEESH': smeeshRaw += item.totalPrice; break;
            case 'SPLIT': splitPool += item.totalPrice; break;
            default: unassignedCount++;
        }
    }

    const splitEach = splitPool / 2;
    smooshRaw += splitEach;
    smeeshRaw += splitEach;

    // Round one side, then take the other as a remainder against the
    // (unrounded-input) grand total - rounding both sides independently
    // can round both up (e.g. an exact .5/.5 split) and overcount the total.
    const grandSubtotal = round2(smooshRaw + smeeshRaw);
    const smooshSubtotal = round2(smooshRaw);
    const smeeshSubtotal = round2(grandSubtotal - smooshSubtotal);

    let smooshTax = 0;
    let smeeshTax = 0;
    if (grandSubtotal > 0 && taxAmount > 0) {
        smooshTax = round2(taxAmount * (smooshSubtotal / grandSubtotal));
        smeeshTax = round2(taxAmount - smooshTax);
    }

    return {
        unassignedCount,
        smooshSubtotal,
        smeeshSubtotal,
        smooshTax,
        smeeshTax,
        smooshTotal: round2(smooshSubtotal + smooshTax),
        smeeshTotal: round2(smeeshSubtotal + smeeshTax),
    };
}
