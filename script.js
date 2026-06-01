// ============================================
// Fixed Main JavaScript (app.js)
// Transformers.js v3 + WebGPU/WASM Fallback
// ============================================

// --- Constants ---
const MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";
const DEFAULT_DTYPE = "q4"; // Valid: "fp32", "fp16", "q8", "q4"
const FALLBACK_DTYPE = "q8"; // For WASM fallback
const DEVICE_WEBGPU = "webgpu";
const DEVICE_WASM = "wasm";

// --- DOM Elements ---
const initAiBtn = document.getElementById("initAiBtn");
const chatInput = document.getElementById("chatInput");
const chatOutput = document.getElementById("chatOutput");
const statusText = document.getElementById("statusText");

// --- State ---
let pipeline = null;
let tokenizer = null;
let isWebGPUSupported = false;

// ============================================
// Initialize AI Pipeline
// ============================================
async function initPipeline() {
  try {
    updateStatus("Initializing pipeline...", "status-loading");
    disableInitButton();

    // Check WebGPU support
    isWebGPUSupported = await checkWebGPUSupport();
    const device = isWebGPUSupported ? DEVICE_WEBGPU : DEVICE_WASM;
    const dtype = isWebGPUSupported ? DEFAULT_DTYPE : FALLBACK_DTYPE;

    // Load tokenizer and model
    tokenizer = await autoTokenizers({ model: MODEL_ID });
    pipeline = await pipeline(
      "text-generation",
      {
        model: MODEL_ID,
        tokenizer: tokenizer,
        device: device,
        dtype: dtype,
      }
    );

    updateStatus("Pipeline ready!", "status-success");
    enableInitButton();
  } catch (error) {
    console.error("Pipeline initialization failed:", error);
    updateStatus(`Error: ${error.message}`, "status-error");
    enableInitButton();
  }
}

// ============================================
// Check WebGPU Support
// ============================================
async function checkWebGPUSupport() {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (error) {
    return false;
  }
}

// ============================================
// Custom TextStreamer (Transformers.js v3)
// ============================================
class CustomTextStreamer extends TextStreamer {
  constructor(tokenizer, options = {}) {
    super(tokenizer, options);
    this.callback = options.callback || (() => {});
  }

  on_finalized_text(text, stream_end) {
    this.callback(text, stream_end);
  }
}

// ============================================
// Build Messages (Fixed: No Double-Push)
// ============================================
function buildMessages(userMessage) {
  const messages = [];
  // Add system prompt if needed
  messages.push({ role: "user", content: userMessage });
  return messages;
}

// ============================================
// Send Message (Fixed Logic)
// ============================================
async function sendMessage() {
  const userMessage = chatInput.value.trim();
  if (!userMessage || !pipeline) return;

  // Clear input
  chatInput.value = "";

  // Add user message to chat output
  appendMessage("user", userMessage);

  try {
    // Build messages (no double-push)
    const messages = buildMessages(userMessage);

    // Generate response
    const streamer = new CustomTextStreamer(tokenizer, {
      callback: (text, stream_end) => {
        if (stream_end) {
          appendMessage("assistant", text);
        }
      },
    });

    const output = await pipeline(messages, {
      streamer: streamer,
      max_new_tokens: 256,
    });

    // Fallback: Extract final reply if streaming fails
    if (!streamer.is_streaming) {
      const finalReply = output[0].generated_text.at(-1).content;
      appendMessage("assistant", finalReply);
    }
  } catch (error) {
    console.error("Message generation failed:", error);
    appendMessage("assistant", `Error: ${error.message}`);
  }
}

// ============================================
// Helper Functions
// ============================================
function updateStatus(message, className) {
  statusText.textContent = message;
  statusText.className = className;
}

function disableInitButton() {
  initAiBtn.disabled = true;
  initAiBtn.classList.add("status-loading");
}

function enableInitButton() {
  initAiBtn.disabled = false;
  initAiBtn.classList.remove("status-loading", "status-error");
}

function appendMessage(role, content) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;
  messageDiv.textContent = content;
  chatOutput.appendChild(messageDiv);
  chatOutput.scrollTop = chatOutput.scrollHeight;
}

// ============================================
// Event Listeners
// ============================================
initAiBtn.addEventListener("click", initPipeline);
chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Initialize on load (optional)
window.addEventListener("load", () => {
  updateStatus("Click 'Initialize AI' to start", "status-idle");
});