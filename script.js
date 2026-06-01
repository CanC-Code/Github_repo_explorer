// ============================================================
//  GitHub Repo Explorer + AI Architect  —  script.js
// ============================================================
//  Requires: WebLLM via ESM CDN, Prism.js loaded as global scripts in index.html
// ============================================================

import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ── DOM refs ─────────────────────────────────────────────────
const repoInput        = document.getElementById("repoInput");
const loadBtn          = document.getElementById("loadBtn");
const fileTreeContainer= document.getElementById("fileTree");
const repoInfo         = document.getElementById("repoInfo");
const autoLoadToggle   = document.getElementById("autoLoadToggle");

const modelSelect      = document.getElementById("modelSelect");
const initAiBtn        = document.getElementById("initAiBtn");
const clearChatBtn     = document.getElementById("clearChatBtn");
const aiStatus         = document.getElementById("aiStatus");
const progressContainer= document.getElementById("progressContainer");
const progressBar      = document.getElementById("progressBar");
const progressLabel    = document.getElementById("progressLabel");
const chatWindow       = document.getElementById("chatWindow");
const chatInput        = document.getElementById("chatInput");
const sendChatBtn      = document.getElementById("sendChatBtn");

// ── State ─────────────────────────────────────────────────────
let aiEngine       = null;
let isGenerating   = false;

// Full multi-turn conversation history sent to the model each time
const conversationHistory = [];

// Loaded file cache: path -> content string
const fileCache = {};

// ── AI Engine Init ────────────────────────────────────────────
async function initializeAiEngine() {
    const selectedModel = modelSelect.value;
    initAiBtn.disabled  = true;
    aiStatus.textContent = "Loading model… this may take a minute on first run (cached after).";
    progressContainer.classList.remove("hidden");
    progressBar.style.width = "0%";
    progressLabel.textContent = "0%";

    try {
        aiEngine = await webllm.CreateMLCEngine(selectedModel, {
            initProgressCallback: (p) => {
                const pct = p.progress !== undefined ? Math.round(p.progress * 100) : 0;
                progressBar.style.width = `${pct}%`;
                progressLabel.textContent = `${pct}%`;
                aiStatus.textContent = p.text || "Loading…";
            }
        });

        progressBar.style.width = "100%";
        progressLabel.textContent = "100%";
        aiStatus.textContent = `✅ Ready — ${selectedModel}`;
        aiStatus.classList.add("status-ready");

        chatInput.disabled  = false;
        sendChatBtn.disabled = false;
        chatInput.focus();

        // Remove welcome placeholder
        chatWindow.querySelector(".chat-welcome")?.remove();

        appendMessage("assistant",
            `Model loaded! I'm ready to help. You can ask me anything, or load a GitHub repo and click **"Ask AI"** on any file to discuss it.`);

    } catch (error) {
        let msg = `❌ Engine Error: ${error.message}`;
        if (error.message && error.message.includes("maxComputeWorkgroupStorageSize")) {
            msg = "❌ GPU Hardware Limit: Your device's GPU cannot support this model's workgroup memory requirements (needs >16KB). Switch to SmolLM 360M and try again.";
        }
        aiStatus.textContent = msg;
        aiStatus.classList.add("status-error");
        initAiBtn.disabled = false;
        console.error("WebLLM init failed:", error);
    }
}

initAiBtn.addEventListener("click", initializeAiEngine);

// ── Chat ──────────────────────────────────────────────────────

/** Append a message bubble to the chat window */
function appendMessage(role, text, streaming = false) {
    const div = document.createElement("div");
    div.className = `chat-message ${role}-message`;

    // Simple markdown-ish rendering: **bold**, `code`, newlines
    div.innerHTML = formatMessage(text);

    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
}

/** Very lightweight markdown renderer for chat bubbles */
function formatMessage(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // code blocks ```...```
        .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
        // inline code
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        // **bold**
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // newlines
        .replace(/\n/g, "<br>");
}

/** Build the system prompt, optionally embedding active file context */
function buildSystemPrompt() {
    const loadedFiles = Object.keys(fileCache);
    if (loadedFiles.length === 0) {
        return "You are a helpful coding assistant with expertise in software architecture, code review, and debugging. Answer clearly and concisely.";
    }

    const fileBlock = loadedFiles.map(path => {
        const content = fileCache[path];
        // Truncate very large files to avoid blowing the context window
        const truncated = content.length > 8000
            ? content.slice(0, 8000) + `\n\n[... truncated, ${content.length - 8000} chars omitted ...]`
            : content;
        return `=== FILE: ${path} ===\n${truncated}`;
    }).join("\n\n");

    return `You are a helpful coding assistant with expertise in software architecture, code review, and debugging.
The user has loaded the following repository files for review:

${fileBlock}

Answer questions about this codebase clearly and concisely. Reference specific files and line numbers where helpful.`;
}

async function sendMessage(userText) {
    userText = (userText || chatInput.value).trim();
    if (!userText || !aiEngine || isGenerating) return;

    chatInput.value = "";
    chatInput.disabled  = true;
    sendChatBtn.disabled = true;
    isGenerating = true;

    appendMessage("user", userText);

    // Add to history
    conversationHistory.push({ role: "user", content: userText });

    // Build full message array: system prompt + history
    const messages = [
        { role: "system", content: buildSystemPrompt() },
        ...conversationHistory
    ];

    // Streaming AI response
    const aiDiv = appendMessage("assistant", "");
    aiDiv.innerHTML = `<span class="typing-cursor">▌</span>`;
    let fullReply = "";

    try {
        const stream = await aiEngine.chat.completions.create({
            messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 1024
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || "";
            fullReply += delta;
            aiDiv.innerHTML = formatMessage(fullReply) + `<span class="typing-cursor">▌</span>`;
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }

        // Finalise — remove cursor
        aiDiv.innerHTML = formatMessage(fullReply);
        conversationHistory.push({ role: "assistant", content: fullReply });

    } catch (err) {
        aiDiv.innerHTML = `<span class="error-text">Error: ${err.message}</span>`;
        console.error("Chat error:", err);
        // Don't push failed response to history
        conversationHistory.pop(); // remove the user message too so history stays clean
    }

    isGenerating = false;
    chatInput.disabled = false;
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

    // Clear old file cache when loading a new repo
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

        // Build nested object tree
        const root = {};
        treeData.tree.forEach(item => {
            const parts = item.path.split("/");
            let cur = root;
            parts.forEach((part, i) => {
                if (!cur[part]) {
                    cur[part] = {
                        _type: i === parts.length - 1 ? item.type : "tree",
                        _path: item.path
                    };
                }
                cur = cur[part];
            });
        });

        fileTreeContainer.innerHTML = "";
        const ul = buildTreeList(root, ownerRepo, branch);
        fileTreeContainer.appendChild(ul);

        window.__github_explorer_files = { ownerRepo, branch, files: treeData.tree };

        // Auto-load file contents if toggle is on
        if (autoLoadToggle.checked) {
            const fileItems = fileTreeContainer.querySelectorAll("li[data-path]");
            // Stagger fetches to avoid hammering the API
            for (const li of fileItems) {
                await fetchFileContent(li, ownerRepo, branch);
            }
        }

    } catch (err) {
        fileTreeContainer.innerHTML = "";
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

/** Fetch and display a single file's content, also caching it for AI context */
async function fetchFileContent(li, ownerRepo, branch) {
    // Guard: don't re-fetch
    if (li.dataset.loaded === "true") return;
    li.dataset.loaded = "true";

    const path = li.dataset.path;
    const pre = document.createElement("pre");
    const code = document.createElement("code");

    // Guess Prism language from extension
    const ext = path.split(".").pop().toLowerCase();
    const langMap = {
        js: "language-javascript", ts: "language-typescript",
        py: "language-python", c: "language-c", cpp: "language-c",
        h: "language-c", html: "language-markup", htm: "language-markup",
        css: "language-css", json: "language-json", yml: "language-yaml",
        yaml: "language-yaml", sh: "language-bash", md: "language-markdown",
        txt: "", xml: "language-markup"
    };
    code.className = langMap[ext] || "";

    code.textContent = "Loading…";
    pre.appendChild(code);

    // Insert after the file label span
    const existing = li.querySelector("pre");
    if (existing) return; // already added
    li.appendChild(pre);

    try {
        const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(res.statusText);
        const text = await res.text();

        code.textContent = text;
        fileCache[path] = text;

        if (window.Prism) Prism.highlightElement(code);

        // Update Ask AI button to show file is loaded
        const askBtn = li.querySelector(".ask-ai-btn");
        if (askBtn) askBtn.textContent = "Ask AI";

    } catch (err) {
        code.textContent = `Error loading file: ${err.message}`;
        li.dataset.loaded = "false"; // allow retry
    }
}

function buildTreeList(tree, ownerRepo, branch) {
    const ul = document.createElement("ul");

    // Sort: folders first, then files
    const keys = Object.keys(tree).filter(k => !k.startsWith("_"));
    keys.sort((a, b) => {
        const aIsTree = tree[a]._type === "tree";
        const bIsTree = tree[b]._type === "tree";
        if (aIsTree && !bIsTree) return -1;
        if (!aIsTree && bIsTree) return 1;
        return a.localeCompare(b);
    });

    for (const key of keys) {
        const node = tree[key];
        const li = document.createElement("li");

        if (node._type === "tree") {
            // Folder
            li.className = "folder";
            const label = document.createElement("span");
            label.className = "item-label";
            label.textContent = key;
            li.appendChild(label);

            // Folders collapse/expand
            const childUl = buildTreeList(node, ownerRepo, branch);
            childUl.classList.add("folder-children", "collapsed");
            li.appendChild(childUl);

            label.addEventListener("click", (e) => {
                e.stopPropagation();
                childUl.classList.toggle("collapsed");
                label.classList.toggle("open");
            });

        } else {
            // File
            li.className = "file";
            li.dataset.path = node._path;
            li.dataset.loaded = "false";

            const label = document.createElement("span");
            label.className = "item-label";
            label.textContent = key;
            li.appendChild(label);

            // Ask AI button
            const askBtn = document.createElement("button");
            askBtn.className = "ask-ai-btn";
            askBtn.textContent = "Ask AI";
            askBtn.title = "Load this file into AI context and start a discussion";
            li.appendChild(askBtn);

            // Click label → expand/collapse the file's code view
            label.addEventListener("click", async (e) => {
                e.stopPropagation();
                const pre = li.querySelector("pre");
                if (pre) {
                    pre.classList.toggle("collapsed");
                    return;
                }
                await fetchFileContent(li, ownerRepo, branch);
            });

            // Click Ask AI → load file + inject prompt
            askBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!aiEngine) {
                    aiStatus.textContent = "⚠️ Initialize the AI model first before using Ask AI.";
                    return;
                }
                askBtn.textContent = "Loading…";
                askBtn.disabled = true;

                await fetchFileContent(li, ownerRepo, branch);

                askBtn.textContent = "Ask AI";
                askBtn.disabled = false;

                // Scroll to AI panel and pre-fill a prompt
                document.querySelector(".ai-panel").scrollIntoView({ behavior: "smooth" });
                chatInput.value = `Please review the file \`${node._path}\` and summarize what it does, any notable patterns, and any potential issues you see.`;
                chatInput.focus();
                chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
            });
        }

        ul.appendChild(li);
    }

    return ul;
}

// ── Repo Load Button ──────────────────────────────────────────

loadBtn.addEventListener("click", () => {
    let input = repoInput.value.trim();
    const urlMatch = input.match(/github\.com\/([^\/\s]+\/[^\/\s#?]+)/i);
    if (urlMatch) input = urlMatch[1];
    if (!input) return;
    window.location.hash = input;
    loadRepository(input);
});

repoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadBtn.click();
});

// ── URL Hash / Query Param Auto-load ─────────────────────────

function checkURL() {
    const params = new URLSearchParams(window.location.search);
    let repo = params.get("repo");

    if (!repo && window.location.hash) {
        repo = decodeURIComponent(window.location.hash.slice(1));
    }

    if (repo) {
        const urlMatch = repo.match(/github\.com\/([^\/\s]+\/[^\/\s#?]+)/i);
        if (urlMatch) repo = urlMatch[1];
        repoInput.value = repo;
        loadRepository(repo);
    }
}

checkURL();

// ── Embedded iframe support ───────────────────────────────────

if (window.top !== window.self) {
    document.getElementById("explorer-ui")?.classList.add("hidden");
}

// ── Public API for external integration ──────────────────────

window.GitHubExplorer = {
    async loadRepo(owner, repo) {
        const full = `${owner}/${repo}`;
        repoInput.value = full;
        await loadRepository(full);
        return window.__github_explorer_files;
    },
    getFiles() {
        return window.__github_explorer_files || {};
    },
    getFileCache() {
        return { ...fileCache };
    },
    async ask(prompt) {
        if (!aiEngine) throw new Error("AI engine not initialized");
        chatInput.value = prompt;
        await sendMessage(prompt);
    }
};
