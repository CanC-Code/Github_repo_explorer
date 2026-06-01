// ============================================================
//  GitHub Repo Explorer + AI Architect  —  script.js  v5
//
//  Library: Transformers.js v3 (HuggingFace)
//  CDN: https://cdn.jsdelivr.net/npm/@huggingface/transformers@3
//
//  Key fixes vs previous version:
//   - dtype changed from invalid "q4f16" to correct "q4"
//   - WebGPU → WASM CPU fallback if GPU init fails
//   - TextStreamer used correctly (subclass override pattern)
//   - Conversation history push/pop logic cleaned up
//   - Output extracted via output[0].generated_text.at(-1).content
//   - initAiBtn re-enabled cleanly on error with class reset
// ============================================================

import {
    pipeline,
    TextStreamer,
    env
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js";

// Load models from HuggingFace hub only (no local models in browser)
env.allowLocalModels = false;

// ── DOM refs ──────────────────────────────────────────────────
const repoInput         = document.getElementById("repoInput");
const loadBtn           = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo          = document.getElementById("repoInfo");
const autoLoadToggle    = document.getElementById("autoLoadToggle");
const modelSelect       = document.getElementById("modelSelect");
const initAiBtn         = document.getElementById("initAiBtn");
const clearChatBtn      = document.getElementById("clearChatBtn");
const aiStatus          = document.getElementById("aiStatus");
const progressContainer = document.getElementById("progressContainer");
const progressBar       = document.getElementById("progressBar");
const progressLabel     = document.getElementById("progressLabel");
const chatWindow        = document.getElementById("chatWindow");
const chatInput         = document.getElementById("chatInput");
const sendChatBtn       = document.getElementById("sendChatBtn");

// ── State ─────────────────────────────────────────────────────
let generator    = null;   // Transformers.js text-generation pipeline
let isGenerating = false;
let usingWasm    = false;  // true if WebGPU failed and we fell back to CPU

// Conversation history — array of { role, content }
// NOTE: only stores user+assistant turns; system prompt is rebuilt each call
const conversationHistory = [];

// Loaded file cache: path → content string
const fileCache = {};

// ── Progress callback helper ──────────────────────────────────
function onProgress(p) {
    if (p.status === "downloading" || p.status === "progress") {
        const pct = p.progress !== undefined ? Math.round(p.progress) : 0;
        progressBar.style.width = `${pct}%`;
        progressLabel.textContent = `${pct}%`;
        const fname = p.file ? p.file.split("/").pop() : "";
        aiStatus.textContent = `Downloading${fname ? " " + fname : ""}… ${pct}%`;
    } else if (p.status === "initiate") {
        aiStatus.textContent = `Preparing ${p.file ? p.file.split("/").pop() : "model"}…`;
    } else if (p.status === "loading") {
        aiStatus.textContent = "Loading weights into memory…";
    } else if (p.status === "ready") {
        aiStatus.textContent = "Finalizing…";
    }
}

// ── AI Engine Init ────────────────────────────────────────────
async function initializeAiEngine() {
    const modelId = modelSelect.value;
    initAiBtn.disabled = true;
    aiStatus.className = "status-box";  // reset any error/ready class
    aiStatus.textContent = "Starting… (first load downloads model, then cached)";
    progressContainer.classList.remove("hidden");
    progressBar.style.width = "0%";
    progressLabel.textContent = "0%";
    usingWasm = false;

    // Try WebGPU first, fall back to WASM (CPU) if unavailable
    // dtype "q4" = 4-bit int quantization — smallest, fastest, works on mobile
    const configs = [
        { device: "webgpu", dtype: "q4",  label: "WebGPU (GPU)" },
        { device: "wasm",   dtype: "q8",  label: "CPU (WebAssembly fallback)" },
    ];

    let lastError = null;
    for (const cfg of configs) {
        try {
            aiStatus.textContent = `Trying ${cfg.label}…`;
            generator = await pipeline("text-generation", modelId, {
                device: cfg.device,
                dtype:  cfg.dtype,
                progress_callback: onProgress,
            });
            usingWasm = cfg.device === "wasm";
            break; // success
        } catch (err) {
            lastError = err;
            generator = null;
            console.warn(`${cfg.label} failed:`, err.message);
            // Reset progress for next attempt
            progressBar.style.width = "0%";
            progressLabel.textContent = "0%";
        }
    }

    if (!generator) {
        const msg = lastError?.message || "Unknown error";
        aiStatus.textContent = `❌ Failed to load model: ${msg}`;
        aiStatus.classList.add("status-error");
        initAiBtn.disabled = false;
        progressContainer.classList.add("hidden");
        return;
    }

    // Success
    progressBar.style.width = "100%";
    progressLabel.textContent = "100%";
    const modeLabel = usingWasm ? " (CPU mode — slower)" : " (GPU accelerated)";
    aiStatus.textContent = `✅ Ready — ${modelId.split("/").pop()}${modeLabel}`;
    aiStatus.classList.add("status-ready");
    chatInput.disabled   = false;
    sendChatBtn.disabled = false;
    chatInput.focus();
    chatWindow.querySelector(".chat-welcome")?.remove();
    appendMessage("assistant",
        `Model loaded${modeLabel}! Ask me anything. Load a GitHub repo and tap **"Ask AI"** on any file to discuss it.`
    );
}

initAiBtn.addEventListener("click", initializeAiEngine);

// ── Message rendering ─────────────────────────────────────────
function appendMessage(role, text) {
    const div = document.createElement("div");
    div.className = `chat-message ${role}-message`;
    div.innerHTML = renderMarkdown(text);
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
}

// Minimal safe markdown renderer for chat bubbles
function renderMarkdown(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // fenced code blocks
        .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
        // inline code
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        // bold
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // newlines to <br> (but not inside pre blocks)
        .replace(/\n/g, "<br>");
}

// ── Build message array for the model ────────────────────────
// Constructs: [system, ...history]
// Does NOT include the new user message — caller appends it separately
function buildSystemPrompt() {
    const paths = Object.keys(fileCache);
    if (paths.length === 0) {
        return "You are a helpful coding assistant. Be concise and accurate.";
    }
    const fileBlock = paths.map(p => {
        const content = fileCache[p];
        // Truncate large files to stay within model context limits on mobile
        const body = content.length > 4000
            ? content.slice(0, 4000) + "\n\n[...truncated for context limit...]"
            : content;
        return `=== FILE: ${p} ===\n${body}`;
    }).join("\n\n");
    return (
        "You are a helpful coding assistant. " +
        "The user has loaded the following repository files:\n\n" +
        fileBlock +
        "\n\nAnswer questions about this codebase concisely. " +
        "Reference file names and line numbers where relevant."
    );
}

// ── Send a chat message ───────────────────────────────────────
async function sendMessage(prefill) {
    const userText = (prefill !== undefined ? prefill : chatInput.value).trim();
    if (!userText || !generator || isGenerating) return;

    chatInput.value     = "";
    chatInput.disabled  = true;
    sendChatBtn.disabled = true;
    isGenerating        = true;

    // Render user bubble
    appendMessage("user", userText);

    // Build full messages array: system + prior history + new user turn
    const messages = [
        { role: "system",    content: buildSystemPrompt() },
        ...conversationHistory,
        { role: "user",      content: userText },
    ];

    // Placeholder AI bubble with cursor
    const aiDiv = appendMessage("assistant", "");
    aiDiv.innerHTML = `<span class="typing-cursor">▌</span>`;
    let streamedText = "";

    try {
        // Subclass TextStreamer to intercept token callbacks.
        // on_finalized_text is the correct Transformers.js v3 override point.
        class UIStreamer extends TextStreamer {
            on_finalized_text(text, streamEnd) {
                streamedText += text;
                aiDiv.innerHTML =
                    renderMarkdown(streamedText) +
                    (streamEnd ? "" : `<span class="typing-cursor">▌</span>`);
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        }

        const streamer = new UIStreamer(generator.tokenizer, {
            skip_prompt:          true,
            skip_special_tokens:  true,
        });

        await generator(messages, {
            max_new_tokens:  512,
            temperature:     0.7,
            do_sample:       true,
            streamer,
        });

        // If streamer emitted nothing (some WASM paths), fall back to output extraction
        if (!streamedText) {
            const out = await generator(messages, {
                max_new_tokens: 512,
                temperature:    0.7,
                do_sample:      true,
            });
            // Transformers.js chat pipeline returns generated_text as array of messages;
            // the last entry is the assistant reply
            const lastMsg = out[0]?.generated_text;
            streamedText = Array.isArray(lastMsg)
                ? (lastMsg.at(-1)?.content ?? "")
                : (typeof lastMsg === "string" ? lastMsg : "");
            aiDiv.innerHTML = renderMarkdown(streamedText);
        }

        // Store exchange in history
        conversationHistory.push({ role: "user",      content: userText });
        conversationHistory.push({ role: "assistant", content: streamedText });

        // Keep history from growing too large on mobile (last 10 turns = 20 entries)
        while (conversationHistory.length > 20) {
            conversationHistory.splice(0, 2);
        }

    } catch (err) {
        aiDiv.innerHTML = `<span class="error-text">❌ ${err.message}</span>`;
        console.error("Generation error:", err);
    }

    isGenerating        = false;
    chatInput.disabled  = false;
    sendChatBtn.disabled = false;
    chatInput.focus();
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

sendChatBtn.addEventListener("click",  () => sendMessage());
chatInput.addEventListener("keydown",  (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
clearChatBtn.addEventListener("click", () => {
    conversationHistory.length = 0;
    chatWindow.innerHTML = "";
    appendMessage("assistant", "Conversation cleared. What would you like to work on?");
});

// ── File fetching ─────────────────────────────────────────────
async function fetchFileContent(li, ownerRepo, branch) {
    if (li.dataset.loaded === "true") return;
    li.dataset.loaded = "true";

    const path = li.dataset.path;

    // Avoid double-injecting pre if already present
    if (li.querySelector("pre")) return;

    const pre  = document.createElement("pre");
    const code = document.createElement("code");
    const ext  = path.split(".").pop().toLowerCase();
    const langMap = {
        js:"language-javascript", mjs:"language-javascript",
        ts:"language-typescript",
        py:"language-python",
        c:"language-c", cpp:"language-c", cc:"language-c", h:"language-c",
        html:"language-markup", htm:"language-markup", xml:"language-markup",
        css:"language-css",
        json:"language-json",
        yml:"language-yaml", yaml:"language-yaml",
        sh:"language-bash", bash:"language-bash",
        md:"language-markdown",
        kt:"language-kotlin", java:"language-java",
    };
    code.className = langMap[ext] || "";
    code.textContent = "Loading…";
    pre.appendChild(code);
    li.appendChild(pre);

    try {
        const url = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${encodeURIComponent(path)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const text = await res.text();
        code.textContent = text;
        fileCache[path]  = text;
        if (window.Prism) Prism.highlightElement(code);
    } catch (err) {
        code.textContent  = `Error loading file: ${err.message}`;
        li.dataset.loaded = "false";
    }
}

// ── File tree builder ─────────────────────────────────────────
function buildTreeList(tree, ownerRepo, branch) {
    const ul   = document.createElement("ul");
    const keys = Object.keys(tree).filter(k => !k.startsWith("_"));

    // Folders first, then files, both alphabetical
    keys.sort((a, b) => {
        const aT = tree[a]._type === "tree";
        const bT = tree[b]._type === "tree";
        if (aT && !bT) return -1;
        if (!aT && bT)  return 1;
        return a.localeCompare(b);
    });

    for (const key of keys) {
        const node = tree[key];
        const li   = document.createElement("li");

        if (node._type === "tree") {
            // ── Folder ──
            li.className = "folder";
            const label  = document.createElement("span");
            label.className   = "item-label";
            label.textContent = key;
            li.appendChild(label);

            const childUl = buildTreeList(node, ownerRepo, branch);
            childUl.classList.add("folder-children", "collapsed");
            li.appendChild(childUl);

            label.addEventListener("click", (e) => {
                e.stopPropagation();
                childUl.classList.toggle("collapsed");
                label.classList.toggle("open");
            });

        } else {
            // ── File ──
            li.className      = "file";
            li.dataset.path   = node._path;
            li.dataset.loaded = "false";

            const label = document.createElement("span");
            label.className   = "item-label";
            label.textContent = key;
            li.appendChild(label);

            const askBtn = document.createElement("button");
            askBtn.className   = "ask-ai-btn";
            askBtn.textContent = "Ask AI";
            askBtn.title       = "Load this file and discuss it with the AI";
            li.appendChild(askBtn);

            // Tap filename → toggle code view
            label.addEventListener("click", async (e) => {
                e.stopPropagation();
                const pre = li.querySelector("pre");
                if (pre) { pre.classList.toggle("collapsed"); return; }
                await fetchFileContent(li, ownerRepo, branch);
            });

            // Tap Ask AI → load file + pre-fill prompt
            askBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!generator) {
                    aiStatus.textContent = "⚠️ Initialize a model first.";
                    document.querySelector(".ai-panel").scrollIntoView({ behavior: "smooth" });
                    return;
                }
                askBtn.textContent = "Loading…";
                askBtn.disabled    = true;
                await fetchFileContent(li, ownerRepo, branch);
                askBtn.textContent = "Ask AI";
                askBtn.disabled    = false;
                document.querySelector(".ai-panel").scrollIntoView({ behavior: "smooth" });
                chatInput.value = `Please review \`${node._path}\` — summarise what it does, highlight any notable patterns, and flag any potential issues.`;
                chatInput.focus();
            });
        }

        ul.appendChild(li);
    }
    return ul;
}

// ── Repo loading ──────────────────────────────────────────────
async function loadRepository(ownerRepo) {
    repoInfo.textContent          = `Fetching ${ownerRepo}…`;
    fileTreeContainer.innerHTML   = '<div class="loading-tree">Loading tree…</div>';
    // Clear old file cache
    Object.keys(fileCache).forEach(k => delete fileCache[k]);

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error(`Repo not found or rate-limited (HTTP ${repoRes.status})`);
        const repoData = await repoRes.json();
        const branch   = repoData.default_branch || "main";

        const treeRes = await fetch(
            `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`
        );
        if (!treeRes.ok) throw new Error(`Failed to fetch tree (HTTP ${treeRes.status})`);
        const treeData = await treeRes.json();

        const fileCount = treeData.tree.filter(i => i.type === "blob").length;
        repoInfo.textContent = `${ownerRepo} · ${branch} · ${fileCount} files`;

        // Build nested object tree from flat path list
        const root = {};
        for (const item of treeData.tree) {
            const parts = item.path.split("/");
            let   cur   = root;
            parts.forEach((part, i) => {
                if (!cur[part]) cur[part] = {
                    _type: i === parts.length - 1 ? item.type : "tree",
                    _path: item.path,
                };
                cur = cur[part];
            });
        }

        fileTreeContainer.innerHTML = "";
        fileTreeContainer.appendChild(buildTreeList(root, ownerRepo, branch));
        window.__github_explorer_files = { ownerRepo, branch, files: treeData.tree };

        if (autoLoadToggle.checked) {
            for (const li of fileTreeContainer.querySelectorAll("li[data-path]")) {
                await fetchFileContent(li, ownerRepo, branch);
            }
        }

    } catch (err) {
        fileTreeContainer.innerHTML = "";
        repoInfo.textContent        = `❌ Error: ${err.message}`;
    }
}

// ── Repo input button / Enter key ────────────────────────────
loadBtn.addEventListener("click", () => {
    let input = repoInput.value.trim();
    const m   = input.match(/github\.com\/([^\/\s]+\/[^\/\s#?]+)/i);
    if (m) input = m[1];
    if (!input) return;
    window.location.hash = input;
    loadRepository(input);
});

repoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadBtn.click();
});

// ── Auto-load from URL hash or ?repo= param ──────────────────
function checkURL() {
    const params = new URLSearchParams(window.location.search);
    let repo     = params.get("repo");
    if (!repo && window.location.hash) {
        repo = decodeURIComponent(window.location.hash.slice(1));
    }
    if (repo) {
        const m = repo.match(/github\.com\/([^\/\s]+\/[^\/\s#?]+)/i);
        if (m) repo = m[1];
        repoInput.value = repo;
        loadRepository(repo);
    }
}
checkURL();

// ── Hide repo input when embedded in iframe ──────────────────
if (window.top !== window.self) {
    document.getElementById("explorer-ui")?.classList.add("hidden");
}

// ── Public API ────────────────────────────────────────────────
window.GitHubExplorer = {
    async loadRepo(owner, repo) {
        const full = `${owner}/${repo}`;
        repoInput.value = full;
        await loadRepository(full);
        return window.__github_explorer_files;
    },
    getFiles()     { return window.__github_explorer_files || {}; },
    getFileCache() { return { ...fileCache }; },
    async ask(prompt) {
        if (!generator) throw new Error("AI not initialized");
        chatInput.value = prompt;
        await sendMessage(prompt);
    },
};
