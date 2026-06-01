import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo = document.getElementById("repoInfo");

// AI panel elements
const initAiBtn = document.getElementById("initAiBtn");
const aiStatus = document.getElementById("aiStatus");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const chatWindow = document.getElementById("chatWindow");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");

// Flag to toggle "load all files immediately"
const loadAllFiles = true;

// AI engine instance
let aiEngine = null;

// --- Load repository and display files ---
async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Fetching repository info for ${ownerRepo}...`;
    fileTreeContainer.innerHTML = "";

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Failed to fetch repo info.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error("Failed to fetch repo tree.");
        const treeData = await treeRes.json();
        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch}) | ${treeData.tree.length} items`;

        const root = {};
        treeData.tree.forEach(item => {
            const parts = item.path.split("/");
            let cur = root;
            parts.forEach((part, i) => {
                if (!cur[part]) cur[part] = { _type: i === parts.length - 1 ? item.type : "tree", _path: item.path };
                cur = cur[part];
            });
        });

        const ul = buildTreeList(root, ownerRepo, branch);
        fileTreeContainer.appendChild(ul);

        if (loadAllFiles) {
            const fileElements = fileTreeContainer.querySelectorAll("li.file");
            fileElements.forEach(li => li.click());
        }

        window.__github_explorer_files = { ownerRepo, branch, files: treeData.tree };
    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// --- Build HTML list recursively ---
function buildTreeList(tree, ownerRepo, branch) {
    const ul = document.createElement("ul");
    for (const key in tree) {
        if (key.startsWith("_")) continue;
        const li = document.createElement("li");
        li.textContent = key;
        li.className = tree[key]._type === "tree" ? "folder" : "file";

        if (tree[key]._type === "tree") {
            li.appendChild(buildTreeList(tree[key], ownerRepo, branch));
        } else {
            li.onclick = async () => {
                if (li.querySelector("pre")) return;
                const pre = document.createElement("pre");
                pre.textContent = `Loading ${tree[key]._path}...`;
                li.appendChild(pre);
                try {
                    const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);
                    pre.textContent = res.ok ? await res.text() : `Error: ${res.statusText}`;
                    Prism.highlightAll();
                } catch (err) {
                    pre.textContent = `Error: ${err.message}`;
                }
            };
        }
        ul.appendChild(li);
    }
    return ul;
}

// --- Button click ---
loadBtn.onclick = () => {
    let repo = repoInput.value.trim();
    // If input is a full GitHub URL, extract owner/repo
    const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)(\/|$)/i);
    if (urlMatch) {
        repo = urlMatch[1]; // Extracted owner/repo
    }

    if (repo) {
        // Update hash for shareable URL
        window.location.hash = repoInput.value.trim();
        loadRepository(repo);
    }
};

// --- Auto-detect GitHub repo from hash or query param ---
function checkURL() {
    const params = new URLSearchParams(window.location.search);
    let repo = params.get("repo"); // Check query param first

    if (!repo && window.location.hash) {
        // Use hash if no query param
        repo = window.location.hash.slice(1); // remove the leading #
    }

    if (repo) {
        // If it's a full GitHub URL, extract owner/repo
        const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)/i);
        if (urlMatch) {
            repo = urlMatch[1];
        }
        repoInput.value = repo;
        loadRepository(repo);
    }
}

// --- Run on page load ---
checkURL();

// === Web Designer Integration Support ===
window.GitHubExplorer = {
    async loadRepo(owner, repo, branch = "main") {
        const full = `${owner}/${repo}`;
        await loadRepository(full);
        return window.__github_explorer_files;
    },
    getFiles() {
        return window.__github_explorer_files || {};
    }
};

// Hide UI if embedded
if (window.top !== window.self) {
    document.getElementById('explorer-ui')?.classList.add('hidden');
}

// === AI Engine ===

async function initializeAiEngine() {
    const modelSelector = document.getElementById("modelSelect");
    const selectedModel = modelSelector.value;

    initAiBtn.disabled = true;
    aiStatus.textContent = "Checking device GPU capabilities...";
    progressContainer.classList.remove("hidden");

    try {
        // Use CreateMLCEngine with explicit configuration for constrained hardware
        aiEngine = await webllm.CreateMLCEngine(selectedModel, {
            initProgressCallback: (p) => {
                aiStatus.textContent = p.text;
                if (p.progress !== undefined) progressBar.style.width = `${p.progress * 100}%`;
            },
            // Reduce cache pressure for low-RAM mobile devices
            webWorker: true
        });

        aiStatus.textContent = `Success: Model running on ${selectedModel}`;
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
    } catch (error) {
        if (error.message && error.message.includes("maxComputeWorkgroupStorageSize")) {
            aiStatus.textContent = "Hardware Limit Reached: Your GPU cannot support this model's compute requirements. Please try SmolLM-360M.";
        } else {
            aiStatus.textContent = `Engine Error: ${error.message}`;
        }
        initAiBtn.disabled = false;
        console.error("Initialization Failed:", error);
    }
}

initAiBtn.onclick = initializeAiEngine;

// --- Collect loaded file contents for AI context ---
function getLoadedFilesContext() {
    const pres = fileTreeContainer.querySelectorAll("pre");
    let context = "";
    pres.forEach(pre => {
        const li = pre.closest("li");
        const filename = li ? li.childNodes[0].textContent.trim() : "unknown";
        context += `\n\n--- File: ${filename} ---\n${pre.textContent}`;
    });
    return context.trim();
}

// --- Send chat message ---
async function sendMessage() {
    const userText = chatInput.value.trim();
    if (!userText || !aiEngine) return;

    chatInput.value = "";
    chatInput.disabled = true;
    sendChatBtn.disabled = true;

    // Append user message
    const userMsg = document.createElement("div");
    userMsg.className = "chat-message user-message";
    userMsg.textContent = userText;
    chatWindow.appendChild(userMsg);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // Build prompt with repo context
    const repoContext = getLoadedFilesContext();
    const systemPrompt = repoContext
        ? `You are a helpful code review assistant. The user has loaded the following repository files:\n\n${repoContext}\n\nAnswer questions about this codebase.`
        : "You are a helpful code review assistant.";

    // Append AI placeholder
    const aiMsg = document.createElement("div");
    aiMsg.className = "chat-message ai-message";
    aiMsg.textContent = "Thinking...";
    chatWindow.appendChild(aiMsg);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    try {
        let reply = "";
        const chunks = await aiEngine.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText }
            ],
            stream: true
        });

        for await (const chunk of chunks) {
            const delta = chunk.choices[0]?.delta?.content || "";
            reply += delta;
            aiMsg.textContent = reply;
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    } catch (err) {
        aiMsg.textContent = `Error: ${err.message}`;
        console.error("Chat error:", err);
    }

    chatInput.disabled = false;
    sendChatBtn.disabled = false;
    chatInput.focus();
}

sendChatBtn.onclick = sendMessage;
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
