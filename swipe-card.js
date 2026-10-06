// Drag-gesture handling for the Tinder-style swipe stack. Pointer Events
// cover mouse + touch with one code path. Threshold-based commit: past the
// threshold on release, the card flies off and onDecide fires; otherwise
// it snaps back to center. Attached only to the single active (top of
// stack) card - everything else (peek cards, the decided list below) is
// plain, non-interactive or instantly-toggling, same as before this
// milestone.

const THRESHOLD_X = 90; // px, left/right (Smoosh/Smeesh)
const THRESHOLD_Y_UP = 70; // px, up (Split) - shorter since it's a smaller natural gesture
const FLY_DISTANCE = 600;

export function attachSwipeGesture(cardEl, { onDecide }) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let dragging = false;
    let pointerId = null;
    let settled = false; // true once a decision has fired or we've been reset

    function pickDecision() {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (dy < 0 && absY > THRESHOLD_Y_UP && absY > absX) return 'SPLIT';
        if (absX > THRESHOLD_X && absX >= absY) return dx < 0 ? 'SMOOSH' : 'SMEESH';
        return null;
    }

    function onPointerDown(e) {
        if (settled) return;
        if (e.target.closest('button, a, input')) return; // don't hijack taps on real controls
        dragging = true;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        cardEl.setPointerCapture(pointerId);
        cardEl.classList.add('dragging');
    }

    function onPointerMove(e) {
        if (!dragging || e.pointerId !== pointerId) return;
        dx = e.clientX - startX;
        dy = e.clientY - startY;
        const rotate = dx / 14;
        cardEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`;
        const decision = pickDecision();
        cardEl.classList.toggle('swipe-smoosh', decision === 'SMOOSH');
        cardEl.classList.toggle('swipe-smeesh', decision === 'SMEESH');
        cardEl.classList.toggle('swipe-split', decision === 'SPLIT');
    }

    function onPointerUp(e) {
        if (!dragging || e.pointerId !== pointerId) return;
        dragging = false;
        cardEl.classList.remove('dragging');

        const decision = pickDecision();
        if (decision) {
            flyOff(decision);
        } else {
            snapBack();
        }
    }

    function flyOff(decision) {
        if (settled) return;
        settled = true;
        cardEl.classList.remove('swipe-smoosh', 'swipe-smeesh', 'swipe-split');
        const flyX = decision === 'SMOOSH' ? -FLY_DISTANCE : decision === 'SMEESH' ? FLY_DISTANCE : dx;
        const flyY = decision === 'SPLIT' ? -FLY_DISTANCE : dy;
        cardEl.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
        cardEl.style.transform = `translate(${flyX}px, ${flyY}px) rotate(${dx / 14}deg)`;
        cardEl.style.opacity = '0';
        setTimeout(() => onDecide(decision), 220);
    }

    function snapBack() {
        cardEl.classList.remove('swipe-smoosh', 'swipe-smeesh', 'swipe-split');
        cardEl.style.transition = 'transform 0.2s ease-out';
        cardEl.style.transform = '';
        setTimeout(() => { cardEl.style.transition = ''; }, 200);
    }

    cardEl.addEventListener('pointerdown', onPointerDown);
    cardEl.addEventListener('pointermove', onPointerMove);
    cardEl.addEventListener('pointerup', onPointerUp);
    cardEl.addEventListener('pointercancel', onPointerUp);

    return {
        // Lets the always-visible Smoosh/Split/Smeesh buttons play the same
        // fly-off animation as a real swipe, so a mouse/keyboard/
        // accessibility user gets consistent feedback instead of the card
        // just vanishing.
        triggerDecision(decision) {
            dx = 0;
            dy = 0;
            flyOff(decision);
        },
    };
}
