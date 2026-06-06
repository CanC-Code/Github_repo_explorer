// ============================================================
//  script.js  —  Main UI thread  (no imports — plain script)
//
//  All AI inference runs in worker.js (background thread).
//  This file only manages the UI, file tree, and postMessage
//  communication with the worker.
// ============================================================

// ── DOM refs ──────────────────────────────────────────────────
const repoInput         = document.getElementById("repoInput");
const loadBtn           = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo          = document.getElementById("repoInfo");
const modelSelect       = document.getElementById("modelSelect");
const initAiBtn         = document.getElementById("initAiBtn");
const aiStatus          = document.getElementById("aiStatus");
const progressContainer = document.getElementById("progressContainer");
const progressBar       = document.getElementById("progressBar");
const chatWindow        = document.getElementById("chatWindow");
const chatInput         = document.getElementById("chatInput");
const sendChatBtn       = document.getElementById("sendChatBtn");
const clearChatBtn      = document.getElementById("clearChatBtn");

// ── State ─────────────────────────────────────────────────────
// loadAllFiles: false — auto-fetching every file on load hammers
// the GitHub API and spikes RAM. Files load on tap instead.
const loadAllFiles = false;

let chatHistory    = [];   // { role, content }[]
let aiWorker       = null;
let aiReady        = false;

// ── Worker bootstrap ──────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    if (window.location.protocol === "file:") {
        aiStatus.textContent = "ERROR: Running over file:// — a web server is required (GitHub Pages, localhost, etc.)";
        aiStatus.classList.add("status-error");
        initAiBtn.disabled = true;
        return;
    }
    aiWorker = new Worker("worker.js", { type: "module" });
    setupWorkerListeners();
    checkURL();
});

// ── Worker message handler ────────────────────────────────────
function setupWorkerListeners() {
    aiWorker.onmessage = (event) => {
        const { type, data } = event.data;

        if (type === "progress") {
            // SILENT: Do not update the DOM here.
            // Progress events from the worker are swallowed to prevent
            // main-thread DOM churn causing an ANR (App Not Responding) kill.
            // The indeterminate progress bar animation handles visual feedback.
            return;
        }

        if (type === "ready") {
            aiReady = true;
            progressContainer.classList.add("hidden");
            progressBar.classList.remove("indeterminate");
            aiStatus.textContent    = "✅ Model ready. Ask anything, or tap \"Ask AI\" on a file.";
            aiStatus.className      = "status-box status-ready";
            initAiBtn.disabled      = false;   // allow re-init with different model
            modelSelect.disabled    = false;
            chatInput.disabled      = false;
            sendChatBtn.disabled    = false;
            appendSystemMessage("Worker thread ready. Send one file at a time for best performance on mobile.");
        }

        if (type === "result") {
            // Find the last "Thinking…" placeholder and replace it
            const placeholders = chatWindow.querySelectorAll(".ai-msg .msg-body");
            const last = placeholders[placeholders.length - 1];
            if (last) last.textContent = data;

            chatHistory.push({ role: "assistant", content: data });

            // Keep history lean: max 10 exchanges (20 entries) to avoid
            // growing the token buffer beyond what low-RAM devices can handle
            while (chatHistory.length > 20) chatHistory.splice(0, 2);

            chatInput.disabled   = false;
            sendChatBtn.disabled = false;
            chatInput.focus();
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }

        if (type === "error") {
            progressContainer.classList.add("hidden");
            aiStatus.textContent = "❌ Worker error: " + data;
            aiStatus.className   = "status-box status-error";
            initAiBtn.disabled   = false;
            modelSelect.disabled = false;
            chatInput.disabled   = false;
            sendChatBtn.disabled = false;
        }
    };

    aiWorker.onerror = (err) => {
        aiStatus.textContent = "❌ Worker crashed: " + err.message;
        aiStatus.className   = "status-box status-error";
        initAiBtn.disabled   = false;
    };
}

// ── Model init ────────────────────────────────────────────────
function initializeAiEngine() {
    const selectedModel  = modelSelect.value;
    aiReady              = false;
    initAiBtn.disabled   = true;
    modelSelect.disabled = true;
    chatInput.disabled   = true;
    sendChatBtn.disabled = true;
    aiStatus.className   = "status-box";
    aiStatus.textContent = "⏳ Loading model in background… this may take 1–2 minutes on first run. The page will not respond until done — this is normal.";
    progressContainer.classList.remove("hidden");
    progressBar.classList.add("indeterminate");

    aiWorker.postMessage({ type: "init", data: { model: selectedModel } });
}

initAiBtn.addEventListener("click", initializeAiEngine);

// ── Chat send ─────────────────────────────────────────────────
function handleSendMessage() {
    const promptText = chatInput.value.trim();
    if (!promptText || !aiWorker || !aiReady) return;

    appendChatMessage("User", promptText);
    chatHistory.push({ role: "user", content: promptText });
    chatInput.value      = "";
    chatInput.disabled   = true;
    sendChatBtn.disabled = true;

    // Show placeholder while worker is processing
    appendChatMessage("AI", "Thinking…");

    aiWorker.postMessage({ type: "generate", data: { chatHistory: [...chatHistory] } });
}

sendChatBtn.addEventListener("click", handleSendMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
});

// ── Clear chat ────────────────────────────────────────────────
clearChatBtn.addEventListener("click", () => {
    chatHistory = [];
    chatWindow.innerHTML = "";
    appendSystemMessage("Conversation cleared.");
});

// ── Chat message builders ─────────────────────────────────────
function appendChatMessage(sender, text) {
    const isUser = sender === "User";
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${isUser ? "user-msg" : "ai-msg"}`;

    const header = document.createElement("div");
    header.className   = "msg-header";
    header.textContent = sender;

    const body = document.createElement("pre");
    body.className   = "msg-body";
    body.textContent = text;

    msgDiv.appendChild(header);
    msgDiv.appendChild(body);
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return msgDiv;
}

function appendSystemMessage(text) {
    const div = document.createElement("div");
    div.className   = "system-message";
    div.textContent = text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// ── Repository loading ────────────────────────────────────────
async function loadRepository(ownerRepo) {
    repoInfo.textContent        = `Fetching ${ownerRepo}…`;
    fileTreeContainer.innerHTML = "<div class='loading-tree'>Loading file tree…</div>";

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error(`Repo not found or rate-limited (HTTP ${repoRes.status})`);
        const repoData = await repoRes.json();
        const branch   = repoData.default_branch || "main";

        const treeRes = await fetch(
            `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`
        );
        if (!treeRes.ok) throw new Error(`Could not fetch tree (HTTP ${treeRes.status})`);
        const treeData = await treeRes.json();

        const fileCount = treeData.tree.filter(i => i.type === "blob").length;
        repoInfo.textContent = `${ownerRepo} · ${branch} · ${fileCount} files`;

        // Build nested object from flat path list
        const root = {};
        treeData.tree.forEach(item => {
            const parts = item.path.split("/");
            let cur = root;
            parts.forEach((part, i) => {
                if (!cur[part]) cur[part] = {
                    _type: i === parts.length - 1 ? item.type : "tree",
                    _path: item.path,
                };
                cur = cur[part];
            });
        });

        fileTreeContainer.innerHTML = "";
        fileTreeContainer.appendChild(buildTreeList(root, ownerRepo, branch));
        window.__github_explorer_files = { ownerRepo, branch, files: treeData.tree };

    } catch (err) {
        fileTreeContainer.innerHTML = "";
        repoInfo.textContent        = "❌ Error: " + err.message;
    }
}

// ── File tree builder ─────────────────────────────────────────
function buildTreeList(tree, ownerRepo, branch) {
    const ul   = document.createElement("ul");
    const keys = Object.keys(tree).filter(k => !k.startsWith("_"));

    // Folders before files, both alphabetical
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

            // Use a span for the label so appendChild(childUl) doesn't wipe it.
            // Setting li.textContent = key then appending child nodes empties the
            // element — this was the original bug causing blank folder entries.
            const label = document.createElement("span");
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
            li.className = "file";

            const label = document.createElement("span");
            label.className   = "item-label";
            label.textContent = key;
            li.appendChild(label);

            // "Ask AI" button — loads file content and pre-fills the chat input
            const askBtn = document.createElement("button");
            askBtn.textContent = "Ask AI";
            askBtn.className   = "file-ai-btn";
            askBtn.title       = "Load this file and send it to the AI for review";
            li.appendChild(askBtn);

            // Tap filename → fetch & show code
            label.addEventListener("click", async (e) => {
                e.stopPropagation();
                const existing = li.querySelector("pre");
                if (existing) {
                    existing.classList.toggle("collapsed");
                    return;
                }
                await fetchAndShowFile(li, node._path, ownerRepo, branch);
            });

            // Tap Ask AI → load file + pre-fill prompt in chat
            askBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!aiReady) {
                    appendSystemMessage("⚠️ Initialize a model first, then use Ask AI.");
                    document.querySelector(".ai-panel").scrollIntoView({ behavior: "smooth" });
                    return;
                }
                askBtn.textContent = "Loading…";
                askBtn.disabled    = true;
                const content = await fetchAndShowFile(li, node._path, ownerRepo, branch);
                askBtn.textContent = "Ask AI";
                askBtn.disabled    = false;

                if (content) {
                    // Truncate to ~2000 chars to stay within mobile token budget
                    const snippet = content.length > 2000
                        ? content.slice(0, 2000) + "\n\n[... truncated to fit mobile context limit ...]"
                        : content;
                    chatInput.value =
                        `Review this file and summarise what it does, any notable patterns, and any issues:\n\n` +
                        `Path: ${node._path}\n\`\`\`\n${snippet}\n\`\`\``;
                    chatInput.focus();
                    document.querySelector(".ai-panel").scrollIntoView({ behavior: "smooth" });
                }
            });
        }

        ul.appendChild(li);
    }
    return ul;
}

// ── File fetcher ──────────────────────────────────────────────
async function fetchAndShowFile(li, filePath, ownerRepo, branch) {
    // Return cached content if already loaded
    if (li.dataset.loaded === "true") {
        return li.dataset.content || "";
    }

    const pre  = li.querySelector("pre") || document.createElement("pre");
    const code = document.createElement("code");
    const ext  = filePath.split(".").pop().toLowerCase();

    const langMap = {
        js: "javascript", mjs: "javascript", ts: "typescript",
        py: "python",
        c: "c", cpp: "cpp", cc: "cpp", h: "c", hpp: "cpp",
        html: "markup", htm: "markup", xml: "markup",
        css: "css",
        json: "json",
        yml: "yaml", yaml: "yaml",
        sh: "bash", bash: "bash",
        md: "markdown",
        kt: "kotlin", java: "java",
    };
    code.className  = "language-" + (langMap[ext] || "javascript");
    code.textContent = "Loading…";
    pre.innerHTML   = "";
    pre.appendChild(code);

    if (!li.contains(pre)) li.appendChild(pre);

    try {
        const url = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${encodeURIComponent(filePath)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const text = await res.text();

        code.textContent  = text;
        li.dataset.loaded  = "true";
        li.dataset.content = text;
        if (window.Prism) Prism.highlightElement(code);
        return text;
    } catch (err) {
        code.textContent  = "Error: " + err.message;
        li.dataset.loaded = "false";
        return null;
    }
}

// ── Repo load button ──────────────────────────────────────────
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

// ── URL hash / ?repo= auto-load ───────────────────────────────
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
