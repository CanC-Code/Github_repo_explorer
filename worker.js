// ============================================================
//  worker.js  —  Background AI inference thread
//
//  Anti-repetition fixes (v2):
//   - repetition_penalty: 1.3   — down-weights already-seen tokens
//   - no_repeat_ngram_size: 3   — hard-blocks any 3-word phrase
//                                 from appearing twice
//   - do_sample: true           — light sampling escapes greedy
//     temperature: 0.3            repetition traps; low temp keeps
//     top_p: 0.85                 output coherent on 135M model
//   - max_new_tokens: 120       — cuts off before spiralling starts
//   - Sharpened system prompt   — explicit "stop after answering"
//     instruction reduces runaway generation
// ============================================================

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js";

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

let aiEngine = null;

self.onmessage = async (event) => {
    const { type, data } = event.data;

    // ── Model initialisation ──────────────────────────────────
    if (type === "init") {
        try {
            aiEngine = await pipeline("text-generation", data.model, {
                device: "wasm",
                dtype:  "q4",
                progress_callback: () => {}   // silent — prevents ANR kill
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
            const systemPrompt =
                "You are a concise coding assistant. " +
                "Answer the user's question directly and stop. " +
                "Do not repeat yourself. Do not pad your answer. " +
                "If you do not know, say \"I don't know.\" and stop.";

            // Last 4 messages only (2 exchanges) — keeps context tight
            const recentHistory = data.chatHistory.slice(-4);

            const messages = [
                { role: "system", content: systemPrompt },
                ...recentHistory,
            ];

            const output = await aiEngine(messages, {
                max_new_tokens:       120,   // short cap — stops spiral before it starts

                // Light sampling — enough to escape greedy repetition traps
                // while staying coherent on a 135M parameter model
                do_sample:            true,
                temperature:          0.3,   // low = mostly deterministic, rarely loops
                top_p:                0.85,  // nucleus sampling cuts off long tail noise

                // Hard anti-repetition guards
                repetition_penalty:   1.3,   // penalise tokens already in the output
                no_repeat_ngram_size: 3,     // forbid any 3-gram appearing twice
            });

            const reply = output[0]?.generated_text?.at(-1)?.content?.trim() ?? "(no response)";
            self.postMessage({ type: "result", data: reply });

        } catch (error) {
            self.postMessage({ type: "error", data: error.message });
        }
    }
};
