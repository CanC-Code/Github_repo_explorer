// ============================================================
//  worker.js  —  Background AI inference thread
//
//  Runs entirely off the main UI thread to prevent ANR kills.
//  Progress callbacks are SILENCED to eliminate IPC overhead
//  that caused main-thread congestion on low-RAM devices.
//
//  Library : Transformers.js v3 (ONNX WASM backend)
//  Device  : wasm (CPU) — avoids WebGPU workgroup limit
//  dtype   : q4  — 4-bit quantization, minimum RAM footprint
//  Threads : 1   — prevents background thread contention
// ============================================================

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js";

// Hub-only: no local model filesystem access in browser
env.allowLocalModels = false;

// Single-threaded WASM: prevents background thread spawning
// that triggers OOM kills on Motorola/low-RAM Android devices
env.backends.onnx.wasm.numThreads = 1;

let aiEngine = null;

self.onmessage = async (event) => {
    const { type, data } = event.data;

    // ── Model initialisation ──────────────────────────────────
    if (type === 'init') {
        try {
            aiEngine = await pipeline('text-generation', data.model, {
                device: 'wasm',
                dtype:  'q4',
                // SILENT: Empty callback sends zero IPC messages to the UI thread.
                // Removing progress updates eliminates the main-thread DOM churn
                // that caused the OS to classify the UI as unresponsive and kill it.
                progress_callback: () => {}
            });
            self.postMessage({ type: 'ready' });
        } catch (error) {
            self.postMessage({ type: 'error', data: error.message });
        }
    }

    // ── Chat generation ───────────────────────────────────────
    else if (type === 'generate') {
        if (!aiEngine) {
            self.postMessage({ type: 'error', data: 'Engine not initialised. Please tap Initialize first.' });
            return;
        }
        try {
            const output = await aiEngine(data.chatHistory, {
                // 150 tokens: enough for meaningful replies while capping
                // the tensor buffer size that causes RAM spikes mid-generation
                max_new_tokens: 150,
                temperature:    0.6,
                do_sample:      true,
            });

            // Transformers.js chat pipeline: generated_text is an array of
            // message objects; the last entry is the new assistant reply
            const reply = output[0]?.generated_text?.at(-1)?.content ?? "";
            self.postMessage({ type: 'result', data: reply });
        } catch (error) {
            self.postMessage({ type: 'error', data: error.message });
        }
    }
};
