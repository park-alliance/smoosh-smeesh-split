// Thin wrapper around the vendored Tesseract.js build. tesseract.min.js is
// loaded as a plain <script> in index.html (it's a UMD build that exposes
// window.Tesseract - no bundler needed), so this module just wires it up
// with same-origin worker/core/lang-data paths instead of Tesseract's
// default jsDelivr CDN paths, so OCR works fully offline after the first
// successful run (see sw.js once Milestone 5 caches these files).

const VENDOR_BASE = './vendor/tesseract/';

let workerPromise = null;
let progressHandler = () => {};

function getWorker() {
    if (!workerPromise) {
        workerPromise = window.Tesseract.createWorker('eng', undefined, {
            workerPath: VENDOR_BASE + 'worker.min.js',
            corePath: VENDOR_BASE + 'tesseract-core-simd-lstm.js',
            langPath: VENDOR_BASE,
            gzip: true,
            // Tesseract.js defaults to loading the worker script via a
            // Blob URL. That breaks the core script's own relative fetch
            // of its .wasm file (no real base URL to resolve "foo.wasm"
            // against from inside a blob: worker) - loading the worker
            // from its real same-origin path instead fixes it.
            workerBlobURL: false,
            logger: (data) => progressHandler(data),
        });
    }
    return workerPromise;
}

// Runs OCR on an image file/blob and returns the raw recognized text.
// onProgress (optional) receives Tesseract's {status, progress} updates.
export async function recognizeReceiptImage(imageFile, onProgress) {
    progressHandler = onProgress || (() => {});
    const worker = await getWorker();
    const { data } = await worker.recognize(imageFile);
    return data.text;
}
