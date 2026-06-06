// ============================================================
//  worker.js  —  Background AI inference thread
//
//  Fixes vs previous version:
//   - Strong system prompt injected on every call so 135M model
//     doesn't drift into training-data noise
//   - Greedy decoding (do_sample: false) — sampling at temperature
//     causes incoherent looping on sub-200M parameter models
//   - History capped at last 2 exchanges (4 entries) before the
//     new user turn; 135M context window fills fast and causes
//     repetition/hallucination when history grows
//   - max_new_tokens reduced to 200 — enough for useful answers
//     without triggering OOM mid-generation
// ============================================================

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js";

env.allowLocalModels   = false;
env.backends.onnx.wasm.numThreads = 1;

let aiEngine   = null;
let modelLabel = "";

self.onmessage = async (event) => {
    const { type, data } = event.data;

    // ── Model initialisation ──────────────────────────────────
    if (type === "init") {
        try {
            modelLabel = data.model;
            aiEngine   = await pipeline("text-generation", data.model, {
                device: "wasm",
                dtype:  "q4",
                // SILENT: zero IPC messages during load prevents ANR kill
                progress_callback: () => {}
            });
            self.postMessage({ type: "ready" });
        } catch (error) {
            self.postMessage({ type: "error", data: error.message });
        }
    }

    // ── Chat generation ───────────────────────────────────────
    else if (type === "generate") {
        if (!aiEngine) {
            self.postMessage({ type: "error", data: "Engine not initialised." });
            return;
        }

        try {
            // Build a strongly-worded system prompt.
            // SmolLM2-135M has minimal RLHF — without an explicit identity
            // it defaults to training-data patterns (roleplay, nonsense loops).
            const systemPrompt =
                "You are a helpful, accurate coding assistant. " +
                "Answer questions about code, software architecture, and programming. " +
                "Be concise and factual. Do not roleplay. Do not pretend to be offline. " +
                "If you do not know something, say so clearly.";

            // Only keep the last 2 exchanges (4 messages) from history.
            // 135M models have a tiny effective context; long history causes
            // repetition and hallucination. Fresh context = coherent answers.
            const recentHistory = data.chatHistory.slice(-4);

            const messages = [
                { role: "system",    content: systemPrompt },
                ...recentHistory,
            ];

            const output = await aiEngine(messages, {
                max_new_tokens: 200,
                // Greedy decoding: do_sample:false picks the single highest-
                // probability token at every step. On tiny models this is far
                // more coherent than sampling, which amplifies noise.
                do_sample:      false,
            });

            // generated_text is an array of message objects for chat pipelines;
            // the last entry is the new assistant reply
            const reply = output[0]?.generated_text?.at(-1)?.content?.trim() ?? "(no response)";
            self.postMessage({ type: "result", data: reply });

        } catch (error) {
            self.postMessage({ type: "error", data: error.message });
        }
    }
};
