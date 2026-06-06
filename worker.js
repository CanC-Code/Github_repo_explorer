import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

// Force extreme memory conservation and single-threaded background execution
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

let aiEngine = null;

self.onmessage = async (event) => {
    const { type, data } = event.data;

    // Handle Initialization Phase
    if (type === 'init') {
        try {
            aiEngine = await pipeline('text-generation', data.model, {
                device: 'wasm',
                dtype: 'q4', // Strict 4-bit compression
                progress_callback: (x) => {
                    self.postMessage({ type: 'progress', data: x });
                }
            });
            self.postMessage({ type: 'ready' });
        } catch (error) {
            self.postMessage({ type: 'error', data: error.message });
        }
    } 
    
    // Handle Chat Generation Phase
    else if (type === 'generate') {
        try {
            const output = await aiEngine(data.chatHistory, {
                max_new_tokens: 300,
                temperature: 0.6,
                do_sample: true
            });
            
            const replyMessage = output[0].generated_text.at(-1).content;
            self.postMessage({ type: 'result', data: replyMessage });
        } catch (error) {
            self.postMessage({ type: 'error', data: error.message });
        }
    }
};
