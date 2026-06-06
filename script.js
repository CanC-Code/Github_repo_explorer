import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

// System Configuration: Force WebAssembly to bypass strict 16KB WebGPU hardware limits
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);

// DOM Binding Registry
const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo = document.getElementById("repoInfo");

const modelSelect = document.getElementById("modelSelect");
const initAiBtn = document.getElementById("initAiBtn");
const aiStatus = document.getElementById("aiStatus");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const chatWindow = document.getElementById("chatWindow");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const injectRepoBtn = document.getElementById("injectRepoBtn");
const clearChatBtn = document.getElementById("clearChatBtn");

// State Work-Matrix Properties
const loadAllFiles = true; 
let aiEngine = null;
let chatHistory = [];
let fullCodebaseContext = "";

window.addEventListener("DOMContentLoaded", () => {
    if (window.location.protocol === 'file:') {
        aiStatus.textContent = "CRITICAL: Script running over file:// protocol. Local web server instance required to process cross-origin requests safely.";
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = true;
    }
});

// --- Repository API Aggregation Matrix ---
async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Querying GitHub branch manifests for ${ownerRepo}...`;
    fileTreeContainer.innerHTML = "";
    fullCodebaseContext = `WORKSPACE FILE CONTEXT MAP: ${ownerRepo}\n====================================================\n`;
    injectRepoBtn.disabled = true;

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Target repository structural metadata unavailable or protected.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";
        
        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error("Could not parse repository object asset maps.");
        const treeData = await treeRes.json();
        repoInfo.textContent = `Repository Node: ${ownerRepo} (${branch}) | ${treeData.tree.length} components found`;

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
        injectRepoBtn.disabled = false;
    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// --- Recursive Tree Layout Compiler ---
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
            li.onclick = async (e) => {
                e.stopPropagation();
                if (li.querySelector("pre")) return;
                
                const pre = document.createElement("pre");
                pre.textContent = `Streaming document stream for ${tree[key]._path}...`;
                li.appendChild(pre);
                
                try {
                    const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);
                    if (res.ok) {
                        const fileContent = await res.text();
                        
                        const ext = tree[key]._path.split('.').pop().toLowerCase();
                        let lang = 'javascript';
                        if (ext === 'html') lang = 'markup';
                        else if (ext === 'css') lang = 'css';
                        else if (ext === 'py') lang = 'python';
                        else if (ext === 'cpp' || ext === 'c' || ext === 'h' || ext === 'hpp') lang = 'cpp';
                        
                        pre.innerHTML = `<code class="language-${lang}"></code>`;
                        const codeBlock = pre.querySelector('code');
                        codeBlock.textContent = fileContent;
                        
                        fullCodebaseContext += `\n\nSOURCE FILE ELEMENT: ${tree[key]._path}\n====================================================\n${fileContent}\n`;
                        appendAiUtilityLink(li, tree[key]._path, fileContent);
                        
                        Prism.highlightElement(codeBlock);
                    } else {
                        pre.textContent = `Streaming Fault: HTTP target asset returned status ${res.statusText}`;
                    }
                } catch (err) {
                    pre.textContent = `Network Exception: ${err.message}`;
                }
            };
        }
        ul.appendChild(li);
    }
    return ul;
}

function appendAiUtilityLink(listItem, filePath, fileContent) {
    if (listItem.querySelector(".file-ai-btn")) return;
    const aiBtn = document.createElement("button");
    aiBtn.textContent = "Review Code Block";
    aiBtn.className = "file-ai-btn";
    aiBtn.onclick = (e) => {
        e.stopPropagation();
        if (!aiEngine) {
            alert("Local AI Engine not running. Initialize the WASM engine first.");
            return;
        }
        chatInput.value = `Analyze the structural properties of this source code file for performance blockages or optimization bugs:\n\nPath Identifier: ${filePath}\n\`\`\`\n${fileContent}\n\`\`\``;
        chatInput.focus();
    };
    listItem.insertBefore(aiBtn, listItem.firstChild);
}

// --- Transformers.js ONNX WASM Engine Initialization ---
async function initializeAiEngine() {
    const selectedModel = modelSelect.value;
    initAiBtn.disabled = true;
    modelSelect.disabled = true;
    aiStatus.textContent = "Booting ONNX WASM Engine (bypassing WebGPU limitations)...";
    aiStatus.style.color = "#cdd6f4";
    progressContainer.classList.remove("hidden");

    try {
        aiEngine = await pipeline('text-generation', selectedModel, {
            device: 'wasm', // Absolutely enforces CPU/WASM matrix routing
            dtype: 'q4f16', // Quantized 4-bit memory safety
            progress_callback: (x) => {
                if (x.status === 'progress') {
                    progressBar.style.width = `${(x.loaded / x.total) * 100}%`;
                } else if (x.status === 'init') {
                    aiStatus.textContent = `Loading matrix tensors: ${x.file}`;
                } else if (x.status === 'ready') {
                    aiStatus.textContent = `Success: CPU/WASM Engine Active.`;
                    aiStatus.style.color = "#a6e3a1";
                    progressBar.style.width = "100%";
                    chatInput.disabled = false;
                    sendChatBtn.disabled = false;
                }
            }
        });
        
        appendChatMessage("System", "Zero-cost compute engine successfully mounted via WebAssembly. Inference will process directly on the CPU, safely bypassing restricted mobile graphics drivers.");
    } catch (error) {
        aiStatus.textContent = `Initialization Terminated: ${error.message}`;
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = false;
        modelSelect.disabled = false;
        console.error("ONNX Assembly Exception:", error);
    }
}

// --- Chat Communication Interface Pipeline ---
async function handleSendMessage() {
    const promptText = chatInput.value.trim();
    if (!promptText || !aiEngine) return;

    appendChatMessage("User", promptText);
    chatInput.value = "";
    chatInput.disabled = true;
    sendChatBtn.disabled = true;

    chatHistory.push({ role: "user", content: promptText });
    const aiBubble = appendChatMessage("AI", "Processing computational inference (Processing via CPU)...");

    try {
        const output = await aiEngine(chatHistory, {
            max_new_tokens: 300,
            temperature: 0.6,
            do_sample: true
        });

        // Transformers.js text-generation returns the entire conversation array
        const replyMessage = output[0].generated_text.at(-1).content;
        
        aiBubble.querySelector(".msg-body").textContent = replyMessage;
        chatHistory.push({ role: "assistant", content: replyMessage });

    } catch (error) {
        aiBubble.querySelector(".msg-body").textContent = `Inference Failure: ${error.message}`;
        console.error("Pipeline failure:", error);
    } finally {
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
        chatInput.focus();
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
}

function appendChatMessage(sender, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${sender.toLowerCase()}-msg`;
    
    const senderHeader = document.createElement("div");
    senderHeader.className = "msg-header";
    senderHeader.textContent = sender;
    
    const msgBody = document.createElement("pre");
    msgBody.className = "msg-body";
    msgBody.textContent = text;
    
    msgDiv.appendChild(senderHeader);
    msgDiv.appendChild(msgBody);
    chatWindow.appendChild(msgDiv);
    
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return msgDiv;
}

// --- Event Listeners and Hooking Matrices ---
loadBtn.onclick = () => {
    let repo = repoInput.value.trim();
    const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)(\/|$)/i);
    if (urlMatch) repo = urlMatch[1];
    if (repo) {
        window.location.hash = repoInput.value.trim();
        loadRepository(repo);
    }
};

initAiBtn.onclick = initializeAiEngine;
sendChatBtn.onclick = handleSendMessage;
chatInput.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } };

injectRepoBtn.onclick = () => {
    if (!fullCodebaseContext) return;
    chatInput.value = `Review the compiled context file structure for code design flaws, interface errors, or architecture synchronization anomalies:\n\n${fullCodebaseContext}`;
    chatInput.focus();
};

clearChatBtn.onclick = () => {
    chatHistory = [];
    chatWindow.innerHTML = '<div class="system-message">Conversation records cleared. Content tracking maps refreshed.</div>';
};

function checkURL() {
    const params = new URLSearchParams(window.location.search);
    let repo = params.get("repo");
    if (!repo && window.location.hash) repo = window.location.hash.slice(1);
    if (repo) {
        const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)/i);
        if (urlMatch) repo = urlMatch[1];
        repoInput.value = repo;
        loadRepository(repo);
    }
}

checkURL();
