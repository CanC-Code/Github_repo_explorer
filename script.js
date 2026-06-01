// ============================================================
//  GitHub Repo Explorer + AI Architect  —  script.js
//  Uses: Transformers.js (HuggingFace) — avoids WebLLM's
//  maxComputeWorkgroupStorageSize limit on mobile GPUs
// ============================================================

import { pipeline, TextStreamer, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js";

// Allow loading models from HuggingFace hub
env.allowLocalModels = false;

// ── DOM refs ─────────────────────────────────────────────────
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
let generator      = null;   // Transformers.js text-generation pipeline
let isGenerating   = false;

// Full multi-turn history: array of {role, content}
const conversationHistory = [];

// Loaded file cache: path -> content string
const fileCache = {};

// ── AI Engine Init ────────────────────────────────────────────
async function initializeAiEngine() {
    const modelId = modelSelect.value;
    initAiBtn.disabled = true;
    aiStatus.className = "status-box";
    aiStatus.textContent = "Downloading model… this may take a minute (cached after first run).";
    progressContainer.classList.remove("hidden");
    progressBar.style.width = "0%";
    progressLabel.textContent = "0%";

    try {
        generator = await pipeline("text-generation", modelId, {
            device: "webgpu",
            dtype: "q4f16",
            progress_callback: (progress) => {
                if (progress.status === "downloading" || progress.status === "progress") {
                    const pct = progress.progress !== undefined ? Math.round(progress.progress) : 0;
                    progressBar.style.width = `${pct}%`;
                    progressLabel.textContent = `${pct}%`;
                    const file = progress.file ? ` — ${progress.file.split("/").pop()}` : "";
                    aiStatus.textContent = `Downloading${file}… ${pct}%`;
                } else if (progress.status === "loading") {
                    aiStatus.textContent = "Loading model into GPU…";
                } else if (progress.status === "ready") {
                    aiStatus.textContent = "Model ready!";
                }
            }
        });

        progressBar.style.width = "100%";
        progressLabel.textContent = "100%";
        aiStatus.textContent = `✅ Ready — ${modelId.split("/").pop()}`;
        aiStatus.classList.add("status-ready");

        chatInput.disabled   = false;
        sendChatBtn.disabled = false;
        chatInput.focus();

        chatWindow.querySelector(".chat-welcome")?.remove();
        appendMessage("assistant",
            `Model loaded! Ask me anything about code, architecture, or bugs. Load a GitHub repo and click **"Ask AI"** on any file to discuss it.`);

    } catch (error) {
        let msg = `❌ Error: ${error.message}`;
        if (error.message?.includes("WebGPU") || error.message?.includes("adapter")) {
            msg = "❌ WebGPU not available. Make sure you are using Chrome on Android with WebGPU enabled, or try chrome://flags → Enable WebGPU.";
        }
        aiStatus.textContent = msg;
        aiStatus.classList.add("status-error");
        initAiBtn.disabled = false;
        generator = null;
        console.error("Pipeline init failed:", error);
    }
}

initAiBtn.addEventListener("click", initializeAiEngine);

// ── Chat ──────────────────────────────────────────────────────

function appendMessage(role, text) {
    const div = document.createElement("div");
    div.className = `chat-message ${role}-message`;
    div.innerHTML = formatMessage(text);
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
}

function formatMessage(text) {
    return text
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
}

function buildMessages(userText) {
    const loadedFiles = Object.keys(fileCache);
    let systemContent = "You are a helpful coding assistant. Answer clearly and concisely.";

    if (loadedFiles.length > 0) {
        const fileBlock = loadedFiles.map(path => {
            const content = fileCache[path];
            const truncated = content.length > 6000
                ? content.slice(0, 6000) + `\n\n[... truncated ...]`
                : content;
            return `=== FILE: ${path} ===\n${truncated}`;
        }).join("\n\n");
        systemContent = `You are a helpful coding assistant. The user has loaded these repository files:\n\n${fileBlock}\n\nAnswer questions about this codebase clearly and concisely.`;
    }

    return [
        { role: "system", content: systemContent },
        ...conversationHistory,
        { role: "user", content: userText }
    ];
}

async function sendMessage(prefill) {
    const userText = (prefill || chatInput.value).trim();
    if (!userText || !generator || isGenerating) return;

    chatInput.value = "";
    chatInput.disabled   = true;
    sendChatBtn.disabled = true;
    isGenerating = true;

    appendMessage("user", userText);
    conversationHistory.push({ role: "user", content: userText });

    const messages = buildMessages(userText);
    // Remove last user message from messages since buildMessages adds it
    // Actually buildMessages appends userText after history; history already has it now.
    // Fix: build from history BEFORE pushing user message
    // Re-build correctly:
    conversationHistory.pop(); // remove the one we just pushed
    const correctMessages = buildMessages(userText);
    conversationHistory.push({ role: "user", content: userText }); // re-add

    const aiDiv = appendMessage("assistant", "");
    aiDiv.innerHTML = `<span class="typing-cursor">▌</span>`;
    let fullReply = "";

    try {
        const streamer = new TextStreamer(generator.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (token) => {
                fullReply += token;
                aiDiv.innerHTML = formatMessage(fullReply) + `<span class="typing-cursor">▌</span>`;
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        });

        await generator(correctMessages, {
            max_new_tokens: 512,
            temperature: 0.7,
            do_sample: true,
            streamer
        });

        aiDiv.innerHTML = formatMessage(fullReply);
        conversationHistory.push({ role: "assistant", content: fullReply });

    } catch (err) {
        aiDiv.innerHTML = `<span class="error-text">❌ Error: ${err.message}</span>`;
        conversationHistory.pop(); // remove user message on failure
        console.error("Generation error:", err);
    }

    isGenerating = false;
    chatInput.disabled   = false;
    sendChatBtn.disabled = false;
    chatInput.focus();
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

sendChatBtn.addEventListener("click", () => sendMessage());

chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

clearChatBtn.addEventListener("click", () => {
    conversationHistory.length = 0;
    chatWindow.innerHTML = "";
    appendMessage("assistant", "Conversation cleared. What would you like to discuss?");
});

// ── File Tree ─────────────────────────────────────────────────

async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Fetching ${ownerRepo}…`;
    fileTreeContainer.innerHTML = '<div class="loading-tree">Loading tree…</div>';
    Object.keys(fileCache).forEach(k => delete fileCache[k]);

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error(`Repo not found or rate-limited (${repoRes.status})`);
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error(`Failed to fetch tree (${treeRes.status})`);
        const treeData = await treeRes.json();

        const fileCount = treeData.tree.filter(i => i.type === "blob").length;
        repoInfo.textContent = `${ownerRepo} · branch: ${branch} · ${fileCount} files`;

        const root = {};
        treeData.tree.forEach(item => {
            const parts = item.path.split("/");
            let cur = root;
            parts.forEach((part, i) => {
                if (!cur[part]) cur[part] = {
                    _type: i === parts.length - 1 ? item.type : "tree",
                    _path: item.path
                };
                cur = cur[part];
            });
        });

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
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

async function fetchFileContent(li, ownerRepo, branch) {
    if (li.dataset.loaded === "true") return;
    li.dataset.loaded = "true";

    const path = li.dataset.path;
    const pre  = document.createElement("pre");
    const code = document.createElement("code");
    const ext  = path.split(".").pop().toLowerCase();
    const langMap = {
        js: "language-javascript", ts: "language-typescript",
        py: "language-python", c: "language-c", cpp: "language-cpp",
        h: "language-c", html: "language-markup", htm: "language-markup",
        css: "language-css", json: "language-json",
        yml: "language-yaml", yaml: "language-yaml",
        sh: "language-bash", md: "language-markdown", xml: "language-markup"
    };
    code.className = langMap[ext] || "";
    code.textContent = "Loading…";
    pre.appendChild(code);

    if (li.querySelector("pre")) return;
    li.appendChild(pre);

    try {
        const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(res.statusText);
        const text = await res.text();
        code.textContent = text;
        fileCache[path] = text;
        if (window.Prism) Prism.highlightElement(code);
        li.querySelector(".ask-ai-btn")?.removeAttribute("disabled");
    } catch (err) {
        code.textContent = `Error: ${err.message}`;
        li.dataset.loaded = "false";
    }
}

function buildTreeList(tree, ownerRepo, branch) {
    const ul = document.createElement("ul");
    const keys = Object.keys(tree).filter(k => !k.startsWith("_"));
    keys.sort((a, b) => {
        const aTree = tree[a]._type === "tree";
        const bTree = tree[b]._type === "tree";
        if (aTree && !bTree) return -1;
        if (!aTree && bTree) return 1;
        return a.localeCompare(b);
    });

    for (const key of keys) {
        const node = tree[key];
        const li   = document.createElement("li");

        if (node._type === "tree") {
            li.className = "folder";
            const label = document.createElement("span");
            label.className = "item-label";
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
            li.className  = "file";
            li.dataset.path   = node._path;
            li.dataset.loaded = "false";

            const label = document.createElement("span");
            label.className = "item-label";
            label.textContent = key;
            li.appendChild(label);

            const askBtn = document.createElement("button");
            askBtn.className   = "ask-ai-btn";
            askBtn.textContent = "Ask AI";
            askBtn.title = "Load this file and discuss it with the AI";
            li.appendChild(askBtn);

            label.addEventListener("click", async (e) => {
                e.stopPropagation();
                const pre = li.querySelector("pre");
                if (pre) { pre.classList.toggle("collapsed"); return; }
                await fetchFileContent(li, ownerRepo, branch);
            });

            askBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!generator) {
                    aiStatus.textContent = "⚠️ Initialize a model first before using Ask AI.";
                    document.querySelector(".ai-panel").scrollIntoView({ behavior: "smooth" });
                    return;
                }
                askBtn.textContent = "Loading…";
                askBtn.disabled = true;
                await fetchFileContent(li, ownerRepo, branch);
                askBtn.textContent = "Ask AI";
                askBtn.disabled = false;
                document.querySelector(".ai-panel").scrollIntoView({ behavior: "smooth" });
                chatInput.value = `Please review \`${node._path}\` — summarise what it does, any notable patterns, and any potential issues.`;
                chatInput.focus();
            });
        }

        ul.appendChild(li);
    }
    return ul;
}

// ── Repo load button ──────────────────────────────────────────
loadBtn.addEventListener("click", () => {
    let input = repoInput.value.trim();
    const m = input.match(/github\.com\/([^\/\s]+\/[^\/\s#?]+)/i);
    if (m) input = m[1];
    if (!input) return;
    window.location.hash = input;
    loadRepository(input);
});

repoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadBtn.click();
});

// ── URL hash / query param auto-load ─────────────────────────
function checkURL() {
    const params = new URLSearchParams(window.location.search);
    let repo = params.get("repo");
    if (!repo && window.location.hash) repo = decodeURIComponent(window.location.hash.slice(1));
    if (repo) {
        const m = repo.match(/github\.com\/([^\/\s]+\/[^\/\s#?]+)/i);
        if (m) repo = m[1];
        repoInput.value = repo;
        loadRepository(repo);
    }
}
checkURL();

if (window.top !== window.self) {
    document.getElementById("explorer-ui")?.classList.add("hidden");
}

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
        await sendMessage(prompt);
    }
};
