// Import WebLLM via CDN module resolution
import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// --- DOM Target Registry ---
const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo = document.getElementById("repoInfo");

// AI Control Registries
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

// --- Core State Machine ---
[span_1](start_span)const loadAllFiles = true;[span_1](end_span)
let aiEngine = null;
let chatHistory = [];
let fullCodebaseContext = ""; // In-memory accumulator for full repo evaluation

[span_2](start_span)// --- Load repository and display files ---[span_2](end_span)
async function loadRepository(ownerRepo) {
    [span_3](start_span)repoInfo.textContent = `Fetching repository info for ${ownerRepo}...`;[span_3](end_span)
    [span_4](start_span)fileTreeContainer.innerHTML = "";[span_4](end_span)
    fullCodebaseContext = `REPOSITORY CONTEXT EXPORT: ${ownerRepo}\n====================================================\n`;

    try {
        [span_5](start_span)const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);[span_5](end_span)
        [span_6](start_span)if (!repoRes.ok) throw new Error("Failed to fetch repo info.");[span_6](end_span)
        [span_7](start_span)const repoData = await repoRes.json();[span_7](end_span)
        const branch = repoData.default_branch || [span_8](start_span)"main";[span_8](end_span)
        
        [span_9](start_span)const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);[span_9](end_span)
        [span_10](start_span)if (!treeRes.ok) throw new Error("Failed to fetch repo tree.");[span_10](end_span)
        [span_11](start_span)const treeData = await treeRes.json();[span_11](end_span)
        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch}) | [span_12](start_span)${treeData.tree.length} items`;[span_12](end_span)

        [span_13](start_span)const root = {};[span_13](end_span)
        [span_14](start_span)treeData.tree.forEach(item => {[span_14](end_span)
            [span_15](start_span)const parts = item.path.split("/");[span_15](end_span)
            [span_16](start_span)let cur = root;[span_16](end_span)
            [span_17](start_span)parts.forEach((part, i) => {[span_17](end_span)
                [span_18](start_span)if (!cur[part]) cur[part] = { _type: i === parts.length - 1 ? item.type : "tree", _path: item.path };[span_18](end_span)
                [span_19](start_span)cur = cur[part];[span_19](end_span)
            });
        [span_20](start_span)});[span_20](end_span)
        
        [span_21](start_span)const ul = buildTreeList(root, ownerRepo, branch);[span_21](end_span)
        [span_22](start_span)fileTreeContainer.appendChild(ul);[span_22](end_span)

        [span_23](start_span)if (loadAllFiles) {[span_23](end_span)
            [span_24](start_span)const fileElements = fileTreeContainer.querySelectorAll("li.file");[span_24](end_span)
            [span_25](start_span)fileElements.forEach(li => li.click());[span_25](end_span)
        }

        [span_26](start_span)window.__github_explorer_files = { ownerRepo, branch, files: treeData.tree };[span_26](end_span)
        injectRepoBtn.disabled = false; // Enable context button once structure is parsed
    } catch (err) {
        [span_27](start_span)repoInfo.textContent = `Error: ${err.message}`;[span_27](end_span)
    }
}

[span_28](start_span)// --- Build HTML list recursively ---[span_28](end_span)
function buildTreeList(tree, ownerRepo, branch) {
    [span_29](start_span)const ul = document.createElement("ul");[span_29](end_span)
    [span_30](start_span)for (const key in tree) {[span_30](end_span)
        [span_31](start_span)if (key.startsWith("_")) continue;[span_31](end_span)
        [span_32](start_span)const li = document.createElement("li");[span_32](end_span)
        [span_33](start_span)li.textContent = key;[span_33](end_span)
        li.className = tree[key]._type === "tree" ? [span_34](start_span)"folder" : "file";[span_34](end_span)
        
        [span_35](start_span)if (tree[key]._type === "tree") {[span_35](end_span)
            [span_36](start_span)li.appendChild(buildTreeList(tree[key], ownerRepo, branch));[span_36](end_span)
        [span_37](start_span)} else {[span_37](end_span)
            li.onclick = async (e) => {
                e.stopPropagation(); // Avoid event bubbling up tree branches
                [span_38](start_span)if (li.querySelector("pre")) return;[span_38](end_span)
                
                [span_39](start_span)const pre = document.createElement("pre");[span_39](end_span)
                [span_40](start_span)pre.textContent = `Loading ${tree[key]._path}...`;[span_40](end_span)
                [span_41](start_span)li.appendChild(pre);[span_41](end_span)
                
                try {
                    [span_42](start_span)const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);[span_42](end_span)
                    if (res.ok) {
                        const fileContent = await res.text();
                        pre.innerHTML = `<code class="language-javascript"></code>`;
                        pre.querySelector('code').textContent = fileContent;
                        
                        // Dynamically compile into master review buffer
                        fullCodebaseContext += `\n\nFILE: ${tree[key]._path}\n====================================================\n${fileContent}\n`;
                        
                        // Insert an architectural "Analyze File" target for context processing
                        appendAiUtilityLink(li, tree[key]._path, fileContent);
                    } else {
                        pre.textContent = `Error: ${res.statusText}`;
                    }
                    [span_43](start_span)Prism.highlightAll();[span_43](end_span)
                } catch (err) {
                    [span_44](start_span)pre.textContent = `Error: ${err.message}`;[span_44](end_span)
                }
            };
        }
        [span_45](start_span)ul.appendChild(li);[span_45](end_span)
    }
    [span_46](start_span)return ul;[span_46](end_span)
}

// Helper injection tool to directly query specific files
function appendAiUtilityLink(listItem, filePath, fileContent) {
    const aiBtn = document.createElement("button");
    aiBtn.textContent = "⚙️ Review This File";
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

// --- Local AI Execution Engine Logic ---
async function initializeAiEngine() {
    const selectedModel = modelSelect.value;
    initAiBtn.disabled = true;
    modelSelect.disabled = true;
    aiStatus.textContent = "Configuring pipeline environment...";
    progressContainer.classList.remove("hidden");

    // Callback pipeline monitors downloading progress steps from HuggingFace cache
    const initProgressCallback = (report) => {
        aiStatus.textContent = report.text;
        if (report.progress !== undefined) {
            progressBar.style.width = `${report.progress * 100}%`;
        }
    };

    try {
        // Instantiate modern Engine architecture 
        aiEngine = await webllm.CreateEngine(selectedModel, { initProgressCallback });
        aiStatus.textContent = `Success: Model running locally on WebGPU!`;
        progressBar.style.width = "100%";
        
        // Unlock user chat mechanics
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
        
        appendChatMessage("System", "Local LLM operational. Your hardware graphics pipeline is driving executions. No data hits external target nodes.");
    } catch (error) {
        aiStatus.textContent = `Initialization Error: ${error.message}`;
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

    // Push new instruction vector into active conversation stack
    chatHistory.push({ role: "user", content: promptText });

    const aiBubble = appendChatMessage("AI", "Thinking...");

    try {
        // Core execution runtime targeting WebGPU hardware layer
        const completion = await aiEngine.chat.completions.create({
            messages: chatHistory,
            stream: true // Stream output progressively for clean real-time generation
        });

        let replyMessage = "";
        for await (const chunk of completion) {
            const curDelta = chunk.choices[0]?.delta?.content || "";
            replyMessage += curDelta;
            aiBubble.querySelector(".msg-body").textContent = replyMessage;
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }

        // Keep internal memory aligned
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

[span_47](start_span)// --- Traditional Action Events Setup ---[span_47](end_span)
[span_48](start_span)loadBtn.onclick = () => {[span_48](end_span)
    [span_49](start_span)let repo = repoInput.value.trim();[span_49](end_span)
    [span_50](start_span)const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)(\/|$)/i);[span_50](end_span)
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

// Runtime validation for query patterns
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
