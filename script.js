import * as webllm from "https://esm.run/@mlc-ai/web-llm";

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

const loadAllFiles = true;
let aiEngine = null;
let chatHistory = [];
let fullCodebaseContext = "";

// Pre-flight Environment Validation
window.addEventListener("DOMContentLoaded", () => {
    if (window.location.protocol === 'file:') {
        aiStatus.textContent = "CRITICAL: You are running via file:// protocol. The AI engine requires a localhost web server to bypass CORS limits.";
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = true;
    } else if (!navigator.gpu) {
        aiStatus.textContent = "CRITICAL: WebGPU is not supported or not enabled in your current browser. The local LLM cannot execute.";
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = true;
    }
});

async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Fetching repository info for ${ownerRepo}...`;
    fileTreeContainer.innerHTML = "";
    fullCodebaseContext = `REPOSITORY CONTEXT EXPORT: ${ownerRepo}\n====================================================\n`;
    injectRepoBtn.disabled = true;

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
        injectRepoBtn.disabled = false;
    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

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
                pre.textContent = `Loading ${tree[key]._path}...`;
                li.appendChild(pre);
                
                try {
                    const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);
                    if (res.ok) {
                        const fileContent = await res.text();
                        
                        // Map extension to Prism syntax language
                        const ext = tree[key]._path.split('.').pop().toLowerCase();
                        let lang = 'javascript';
                        if (ext === 'html') lang = 'markup';
                        else if (ext === 'css') lang = 'css';
                        else if (ext === 'py') lang = 'python';
                        else if (ext === 'cpp' || ext === 'c' || ext === 'h' || ext === 'hpp') lang = 'cpp';
                        
                        pre.innerHTML = `<code class="language-${lang}"></code>`;
                        const codeBlock = pre.querySelector('code');
                        codeBlock.textContent = fileContent;
                        
                        fullCodebaseContext += `\n\nFILE: ${tree[key]._path}\n====================================================\n${fileContent}\n`;
                        appendAiUtilityLink(li, tree[key]._path, fileContent);
                        
                        Prism.highlightElement(codeBlock);
                    } else {
                        pre.textContent = `Error: ${res.statusText}`;
                    }
                } catch (err) {
                    pre.textContent = `Error: ${err.message}`;
                }
            };
        }
        ul.appendChild(li);
    }
    return ul;
}

function appendAiUtilityLink(listItem, filePath, fileContent) {
    const aiBtn = document.createElement("button");
    aiBtn.textContent = "Review This File";
    aiBtn.className = "file-ai-btn";
    aiBtn.onclick = (e) => {
        e.stopPropagation();
        if (!aiEngine) {
            alert("Please initialize the Local AI Engine first via the right panel.");
            return;
        }
        chatInput.value = `Reviewing the following file for potential errors or optimizations:\n\nPath: ${filePath}\n\`\`\`\n${fileContent}\n\`\`\``;
        chatInput.focus();
    };
    listItem.insertBefore(aiBtn, listItem.firstChild);
}

async function initializeAiEngine() {
    const selectedModel = modelSelect.value;
    initAiBtn.disabled = true;
    modelSelect.disabled = true;
    aiStatus.textContent = "Configuring WebGPU pipeline environment...";
    aiStatus.style.color = "#cdd6f4";
    progressContainer.classList.remove("hidden");

    const initProgressCallback = (report) => {
        aiStatus.textContent = report.text;
        if (report.progress !== undefined) {
            progressBar.style.width = `${report.progress * 100}%`;
        }
    };

    try {
        aiEngine = await webllm.CreateEngine(selectedModel, { initProgressCallback });
        aiStatus.textContent = `Success: Model running locally on WebGPU!`;
        aiStatus.style.color = "#a6e3a1";
        progressBar.style.width = "100%";
        
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
        appendChatMessage("System", "Local LLM operational. Your hardware graphics pipeline is processing the executions.");
    } catch (error) {
        aiStatus.textContent = `Initialization Error: ${error.message}`;
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = false;
        modelSelect.disabled = false;
        console.error(error);
    }
}

async function handleSendMessage() {
    const promptText = chatInput.value.trim();
    if (!promptText || !aiEngine) return;

    appendChatMessage("User", promptText);
    chatInput.value = "";
    chatInput.disabled = true;
    sendChatBtn.disabled = true;

    chatHistory.push({ role: "user", content: promptText });
    const aiBubble = appendChatMessage("AI", "Thinking...");

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
        aiBubble.querySelector(".msg-body").textContent = `Generation Fault: ${error.message}`;
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
    chatInput.value = `Here is the full codebase context extracted for comprehensive code review:\n\n${fullCodebaseContext}\n\nPlease audit this file structure for flaws or layout concerns.`;
    chatInput.focus();
};

clearChatBtn.onclick = () => {
    chatHistory = [];
    chatWindow.innerHTML = '<div class="system-message">Chat history cleared. Context refreshed.</div>';
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
