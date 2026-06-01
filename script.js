// ============================================
// Cards, Collectibles & Oddities - AI Chat
// Powered by Transformers.js + ONNX Runtime Web
// Model: HuggingFaceTB/SmolLM2-360M-Instruct
// ============================================

// --- State ---
let pipeline = null;
let tokenizer = null;
let streamer = null;
let isGenerating = false;
let conversationHistory = [];

// --- DOM Elements ---
const messagesEl = document.getElementById('messages');
const userInputEl = document.getElementById('userInput');
const sendBtnEl = document.getElementById('sendBtn');
const initAiBtnEl = document.getElementById('initAiBtn');
const chatHistoryEl = document.getElementById('chatHistory');

// --- Configuration ---
const CONFIG = {
    MODEL_ID: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    // Valid dtypes for Transformers.js: 'fp32', 'fp16', 'q8', 'q4'
    DEFAULT_DTYPE: 'q4', // int4 quantization (best for WebGPU)
    FALLBACK_DTYPE: 'q8', // int8 quantization (for WASM fallback)
    DEFAULT_DEVICE: 'webgpu', // Try WebGPU first
    FALLBACK_DEVICE: 'wasm', // Fallback to WASM if WebGPU fails
    MAX_NEW_TOKENS: 512,
    TEMPERATURE: 0.7,
};

// ============================================
// Custom TextStreamer for Transformers.js v3
// ============================================
class CustomTextStreamer {
    constructor(tokenizer, onTokenCallback) {
        this.tokenizer = tokenizer;
        this.onTokenCallback = onTokenCallback;
        this.buffer = '';
    }

    // Called for each new token
    put(token) {
        this.buffer += token;
        if (this.onTokenCallback) {
            this.onTokenCallback(this.buffer);
        }
    }

    // Called when streaming ends
    end() {
        if (this.onTokenCallback) {
            this.onTokenCallback(this.buffer, true);
        }
        this.buffer = '';
    }
}

// ============================================
// Helper Functions
// ============================================

// --- Add a message to the chat UI ---
function addMessage(content, role = 'assistant', isStreaming = false) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    
    if (isStreaming) {
        messageEl.id = 'streaming-message';
        messageEl.innerHTML = '<span class="streaming-token"></span>';
    } else {
        messageEl.textContent = content;
    }
    
    messagesEl.appendChild(messageEl);
    scrollToBottom();
    return messageEl;
}

// --- Update the streaming message ---
function updateStreamingMessage(content, isFinal = false) {
    const streamingMsg = document.getElementById('streaming-message');
    if (!streamingMsg) return;

    if (isFinal) {
        streamingMsg.removeAttribute('id');
        streamingMsg.textContent = content;
    } else {
        streamingMsg.innerHTML = content;
    }
    scrollToBottom();
}

// --- Scroll chat to bottom ---
function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Toggle loading state ---
function setLoading(isLoading) {
    userInputEl.disabled = isLoading;
    sendBtnEl.disabled = isLoading || !pipeline;
    
    if (isLoading) {
        initAiBtnEl.classList.add('status-loading');
        initAiBtnEl.classList.remove('status-ready', 'status-error');
        initAiBtnEl.innerHTML = '<span class="spinner"></span><span>Loading Model...</span>';
    } else if (pipeline) {
        initAiBtnEl.classList.add('status-ready');
        initAiBtnEl.classList.remove('status-loading', 'status-error');
        initAiBtnEl.textContent = 'Model Ready';
    } else {
        initAiBtnEl.classList.add('status-error');
        initAiBtnEl.classList.remove('status-loading', 'status-ready');
        initAiBtnEl.textContent = 'Retry Loading Model';
    }
}

// --- Build messages for the pipeline ---
function buildMessages() {
    // Always start with a system message for context
    const systemMessage = {
        role: 'system',
        content: 'You are a helpful AI assistant for Cards, Collectibles & Oddities, a shop specializing in trading cards, memorabilia, and unique collectibles. Answer questions helpfully and concisely.'
    };

    // Add conversation history
    const historyMessages = conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    return [systemMessage, ...historyMessages];
}

// --- Clear all messages ---
function clearMessages() {
    messagesEl.innerHTML = '';
    conversationHistory = [];
}

// --- Show error message ---
function showError(message) {
    addMessage(message, 'error');
    console.error('AI Error:', message);
}

// ============================================
// Initialize AI Pipeline
// ============================================
async function initPipeline() {
    if (pipeline) {
        console.log('Pipeline already initialized');
        return;
    }

    setLoading(true);
    addMessage('Initializing AI model...', 'system');

    try {
        // --- Check WebGPU support ---
        let device = CONFIG.DEFAULT_DEVICE;
        let dtype = CONFIG.DEFAULT_DTYPE;

        if (CONFIG.DEFAULT_DEVICE === 'webgpu') {
            try {
                // Test WebGPU availability
                if (!navigator.gpu) {
                    throw new Error('WebGPU not supported in this browser');
                }
                const adapter = await navigator.gpu.requestAdapter();
                if (!adapter) {
                    throw new Error('No WebGPU adapter found');
                }
                console.log('WebGPU is available');
            } catch (webgpuError) {
                console.warn('WebGPU not available, falling back to WASM:', webgpuError.message);
                device = CONFIG.FALLBACK_DEVICE;
                dtype = CONFIG.FALLBACK_DTYPE;
            }
        }

        console.log(`Loading pipeline with device: ${device}, dtype: ${dtype}`);

        // --- Load tokenizer and pipeline ---
        tokenizer = await window.transformers.createTokenizer(CONFIG.MODEL_ID);
        
        pipeline = await window.transformers.pipeline('text-generation', CONFIG.MODEL_ID, {
            device: device,
            dtype: dtype,
            config: {
                max_new_tokens: CONFIG.MAX_NEW_TOKENS,
                temperature: CONFIG.TEMPERATURE,
            }
        });

        console.log('Pipeline loaded successfully');
        setLoading(false);
        addMessage('Model loaded successfully! You can now chat.', 'system');
        
        // Enable input
        userInputEl.disabled = false;
        userInputEl.focus();

    } catch (error) {
        console.error('Failed to load pipeline:', error);
        setLoading(false);
        showError(`Failed to load AI model: ${error.message}`);
        
        // Retry logic
        initAiBtnEl.onclick = () => {
            initAiBtnEl.classList.remove('status-error');
            initPipeline();
        };
    }
}

// ============================================
// Send Message
// ============================================
async function sendMessage() {
    if (isGenerating || !pipeline) return;

    const userMessage = userInputEl.value.trim();
    if (!userMessage) return;

    // --- Add user message to UI and history ---
    addMessage(userMessage, 'user');
    conversationHistory.push({ role: 'user', content: userMessage });
    userInputEl.value = '';
    userInputEl.disabled = true;
    sendBtnEl.disabled = true;
    isGenerating = true;

    // --- Add placeholder for assistant response ---
    const assistantMessageEl = addMessage('', 'assistant', true);

    try {
        // --- Build messages for the pipeline ---
        const messages = buildMessages();
        
        // Create a new streamer for this request
        streamer = new CustomTextStreamer(tokenizer, (text, isFinal) => {
            if (isFinal) {
                // Final response - add to history
                conversationHistory.push({ role: 'assistant', content: text });
                updateStreamingMessage(text, true);
                isGenerating = false;
                userInputEl.disabled = false;
                sendBtnEl.disabled = false;
                userInputEl.focus();
            } else {
                // Streaming token
                updateStreamingMessage(text);
            }
        });

        // --- Generate response ---
        await pipeline(
            messages,
            {
                streamer: streamer,
                max_new_tokens: CONFIG.MAX_NEW_TOKENS,
                temperature: CONFIG.TEMPERATURE,
            }
        );

    } catch (error) {
        console.error('Generation error:', error);
        showError(`Failed to generate response: ${error.message}`);
        isGenerating = false;
        userInputEl.disabled = false;
        sendBtnEl.disabled = false;
        assistantMessageEl.remove();
    }
}

// ============================================
// Event Listeners
// ============================================

// --- Initialize pipeline on page load ---
document.addEventListener('DOMContentLoaded', () => {
    setLoading(true);
    initPipeline();
});

// --- Send message on button click ---
sendBtnEl.addEventListener('click', sendMessage);

// --- Send message on Enter (Shift+Enter for new line) ---
userInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// --- Auto-resize textarea ---
userInputEl.addEventListener('input', () => {
    userInputEl.style.height = 'auto';
    userInputEl.style.height = Math.min(userInputEl.scrollHeight, 150) + 'px';
});

// --- New chat button ---
document.getElementById('newChat').addEventListener('click', () => {
    clearMessages();
    userInputEl.value = '';
    userInputEl.focus();
});

// --- Handle window resize for responsive layout ---
window.addEventListener('resize', () => {
    scrollToBottom();
});

// ============================================
// Debug: Expose pipeline to console
// ============================================
window.AI = {
    pipeline: () => pipeline,
    tokenizer: () => tokenizer,
    sendMessage,
    clearMessages,
    initPipeline,
};