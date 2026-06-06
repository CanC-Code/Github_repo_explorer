import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// DOM Binding Nodes
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

// Application Work-State Registry
const loadAllFiles = true; // Automatically load contents to generate workspace context maps
let aiEngine = null;
let chatHistory = [];
let fullCodebaseContext = "";

// Immediate Environment Diagnostics Pipeline
window.addEventListener("DOMContentLoaded", () => {
    if (window.location.protocol === 'file:') {
        aiStatus.textContent = "CRITICAL LIMITATION: Running via file:// protocol. WebLLM requires a local web server instance to load assets via ESM imports.";
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = true;
    } else if (!navigator.gpu) {
        aiStatus.textContent = "CRITICAL LIMITATION: WebGPU is missing or disabled in this browser profile. Navigate to chrome://flags to toggle WebGPU subsystems.";
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = true;
    }
});

// --- Repository Loader Matrix ---
async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Querying GitHub API manifests for ${ownerRepo}...`;
    fileTreeContainer.innerHTML = "";
    fullCodebaseContext = `REPOSITORY CONTEXT MAP EXPORT: ${ownerRepo}\n====================================================\n`;
    injectRepoBtn.disabled = true;

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Target repository records unreadable or missing.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";
        
        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error("Failed to index repository architecture maps.");
        const treeData = await treeRes.json();
        repoInfo.textContent = `Repository Asset Node: ${ownerRepo} (${branch}) | ${treeData.tree.length} elements detected`;

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
        repoInfo.textContent = `Exploration Interrupted: ${err.message}`;
    }
}

// --- Recursive Tree Interface Compiler ---
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
                pre.textContent = `Streaming data array from ${tree[key]._path}...`;
                li.appendChild(pre);
                
                try {
                    const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);
                    if (res.ok) {
                        const fileContent = await res.text();
                        
                        // Parse extension for target token styling matching Prism dictionary rules
                        const ext = tree[key]._path.split('.').pop().toLowerCase();
                        let lang = 'javascript';
                        if (ext === 'html') lang = 'markup';
                        else if (ext === 'css') lang = 'css';
                        else if (ext === 'py') lang = 'python';
                        else if (ext === 'cpp' || ext === 'c' || ext === 'h' || ext === 'hpp') lang = 'cpp';
                        
                        pre.innerHTML = `<code class="language-${lang}"></code>`;
                        const codeBlock = pre.querySelector('code');
                        codeBlock.textContent = fileContent;
                        
                        fullCodebaseContext += `\n\nTARGET SOURCE FILE: ${tree[key]._path}\n====================================================\n${fileContent}\n`;
                        appendAiUtilityLink(li, tree[key]._path, fileContent);
                        
                        Prism.highlightElement(codeBlock);
                    } else {
                        pre.textContent = `Streaming Fault: HTTP status response flag returned ${res.statusText}`;
                    }
                } catch (err) {
                    pre.textContent = `Connection Fault: ${err.message}`;
                }
            };
        }
        ul.appendChild(li);
    }
    return ul;
}

// Injects contextual assessment link controls inside listed folder nodes
function appendAiUtilityLink(listItem, filePath, fileContent) {
    if (listItem.querySelector(".file-ai-btn")) return;
    const aiBtn = document.createElement("button");
    aiBtn.textContent = "Review Code Segment";
    aiBtn.className = "file-ai-btn";
    aiBtn.onclick = (e) => {
        e.stopPropagation();
        if (!aiEngine) {
            alert("Local AI Processing Engine offline. Complete initialization steps on the workspace management panel first.");
            return;
        }
        chatInput.value = `Perform a structure review on the following file target for logic errors, optimizations, or layout vulnerabilities:\n\nPath Element: ${filePath}\n\`\`\`\n${fileContent}\n\`\`\``;
        chatInput.focus();
    };
    listItem.insertBefore(aiBtn, listItem.firstChild);
}

// --- Mobile Memory-Constrained Local AI Engine Framework ---
async function initializeAiEngine() {
    const selectedModel = modelSelect.value;
    initAiBtn.disabled = true;
    modelSelect.disabled = true;
    aiStatus.textContent = "Assembling processing workers and loading compilation configurations...";
    aiStatus.style.color = "#cdd6f4";
    progressContainer.classList.remove("hidden");

    // Live progress updating matrix hooking tensor downloads directly from HuggingFace
    const initProgressCallback = (report) => {
        aiStatus.textContent = report.text;
        if (report.progress !== undefined) {
            progressBar.style.width = `${report.progress * 100}%`;
        }
    };

    try {
        // Strict hardware parameter configurations engineered specifically to prevent mobile driver crashes at 100% loading
        const constrainedConfig = {
            initProgressCallback: initProgressCallback,
            contextWindowSize: 2048, // Shrinks internal attention matrix structures to fit low VRAM constraints
            kvConfig: {
                numLayers: 16, // Forces structural boundaries to run safely inside 16KB execution pools
            }
        };

        // Initialize Web Worker instance mapping execution tensors off the browser interface window
        aiEngine = await webllm.CreateMLCEngine(selectedModel, constrainedConfig);
        
        aiStatus.textContent = `Local Engine active via WebGPU. Target model verified: ${selectedModel}`;
        aiStatus.style.color = "#a6e3a1";
        progressBar.style.width = "100%";
        
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
        appendChatMessage("System", "Zero-cost compute execution framework fully operational. Matrix pipeline calculations are processing locally within device components.");
    } catch (error) {
        aiStatus.textContent = `Initialization Interrupted: ${error.message}`;
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = false;
        modelSelect.disabled = false;
        console.error("WebGPU Allocation System Error Trap:", error);
    }
}

// --- Chat Interface Logic Engine ---
async function handleSendMessage() {
    const promptText = chatInput.value.trim();
    if (!promptText || !aiEngine) return;

    appendChatMessage("User", promptText);
    chatInput.value = "";
    chatInput.disabled = true;
    sendChatBtn.disabled = true;

    chatHistory.push({ role: "user", content: promptText });
    const aiBubble = appendChatMessage("AI", "Processing computational arrays...");

    try {
        const completion = await aiEngine.chat.completions.create({
            messages: chatHistory,
            stream: true
        });

        let replyMessage = "";
        for await (const chunk of completion) {
            const curDelta = chunk.choices[0]?.delta?.content || "";
            replyMessage += curDelta;
            aiBubble.querySelector(".msg-body").textContent = replyMessage;
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
        chatHistory.push({ role: "assistant", content: replyMessage });

    } catch (error) {
        aiBubble.querySelector(".msg-body").textContent = `Generation System Trap Fault: ${error.message}`;
        console.error(error);
    } finally {
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
        chatInput.focus();
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

// --- Event Handlers and Listeners ---
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
    chatInput.value = `Here is the comprehensive structural file context mapped from this workspace assembly:\n\n${fullCodebaseContext}\n\nPerform a comprehensive overview targeting architecture flaws, synchronization risks, or code quality anomalies.`;
    chatInput.focus();
};

clearChatBtn.onclick = () => {
    chatHistory = [];
    chatWindow.innerHTML = '<div class="system-message">Chat memory storage clean. Context vectors tracking flushed.</div>';
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
