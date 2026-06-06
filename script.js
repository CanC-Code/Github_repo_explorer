import * as webllm from "https://esm.run/@mlc-ai/web-llm";

[span_0](start_span)// DOM Binding Registry[span_0](end_span)
[span_1](start_span)const repoInput = document.getElementById("repoInput");[span_1](end_span)
[span_2](start_span)const loadBtn = document.getElementById("loadBtn");[span_2](end_span)
[span_3](start_span)const fileTreeContainer = document.getElementById("fileTree");[span_3](end_span)
[span_4](start_span)const repoInfo = document.getElementById("repoInfo");[span_4](end_span)

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

[span_5](start_span)// State Work-Matrix Properties[span_5](end_span)
const loadAllFiles = true; [span_6](start_span)// Pre-load repository content loops to extract workspace vectors[span_6](end_span)
let aiEngine = null;
let chatHistory = [];
let fullCodebaseContext = "";

// Immediate Environment Capabilities Pipeline
window.addEventListener("DOMContentLoaded", () => {
    if (window.location.protocol === 'file:') {
        aiStatus.textContent = "CRITICAL: Script running over file:// protocol. Local web server instance required to process cross-origin requests safely.";
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = true;
    } else if (!navigator.gpu) {
        aiStatus.textContent = "CRITICAL: WebGPU subsystem missing or blocked. Verify browser configurations inside chrome://flags.";
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = true;
    }
});

[span_7](start_span)// --- Repository API Aggregation Matrix ---[span_7](end_span)
[span_8](start_span)async function loadRepository(ownerRepo) {[span_8](end_span)
    [span_9](start_span)repoInfo.textContent = `Querying GitHub branch manifests for ${ownerRepo}...`;[span_9](end_span)
    [span_10](start_span)fileTreeContainer.innerHTML = "";[span_10](end_span)
    fullCodebaseContext = `WORKSPACE FILE CONTEXT MAP: ${ownerRepo}\n====================================================\n`;
    injectRepoBtn.disabled = true;

    try {
        [span_11](start_span)const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);[span_11](end_span)
        [span_12](start_span)if (!repoRes.ok) throw new Error("Target repository structural metadata unavailable or protected.");[span_12](end_span)
        [span_13](start_span)const repoData = await repoRes.json();[span_13](end_span)
        const branch = repoData.default_branch || [span_14](start_span)"main";[span_14](end_span)
        
        [span_15](start_span)const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);[span_15](end_span)
        [span_16](start_span)if (!treeRes.ok) throw new Error("Could not parse repository object asset maps.");[span_16](end_span)
        [span_17](start_span)const treeData = await treeRes.json();[span_17](end_span)
        repoInfo.textContent = `Repository Node: ${ownerRepo} (${branch}) | [span_18](start_span)${treeData.tree.length} components found`;[span_18](end_span)

        [span_19](start_span)const root = {};[span_19](end_span)
        [span_20](start_span)treeData.tree.forEach(item => {[span_20](end_span)
            [span_21](start_span)const parts = item.path.split("/");[span_21](end_span)
            [span_22](start_span)let cur = root;[span_22](end_span)
            [span_23](start_span)parts.forEach((part, i) => {[span_23](end_span)
                [span_24](start_span)if (!cur[part]) cur[part] = { _type: i === parts.length - 1 ? item.type : "tree", _path: item.path };[span_24](end_span)
                [span_25](start_span)cur = cur[part];[span_25](end_span)
            [span_26](start_span)});[span_26](end_span)
        [span_27](start_span)});[span_27](end_span)
        
        [span_28](start_span)const ul = buildTreeList(root, ownerRepo, branch);[span_28](end_span)
        [span_29](start_span)fileTreeContainer.appendChild(ul);[span_29](end_span)

        [span_30](start_span)if (loadAllFiles) {[span_30](end_span)
            [span_31](start_span)const fileElements = fileTreeContainer.querySelectorAll("li.file");[span_31](end_span)
            [span_32](start_span)fileElements.forEach(li => li.click());[span_32](end_span)
        }

        [span_33](start_span)window.__github_explorer_files = { ownerRepo, branch, files: treeData.tree };[span_33](end_span)
        injectRepoBtn.disabled = false;
    [span_34](start_span)} catch (err) {[span_34](end_span)
        [span_35](start_span)repoInfo.textContent = `Error: ${err.message}`;[span_35](end_span)
    [span_36](start_span)}
}[span_36](end_span)

[span_37](start_span)// --- Recursive Tree Layout Compiler ---[span_37](end_span)
[span_38](start_span)function buildTreeList(tree, ownerRepo, branch) {[span_38](end_span)
    [span_39](start_span)const ul = document.createElement("ul");[span_39](end_span)
    [span_40](start_span)for (const key in tree) {[span_40](end_span)
        [span_41](start_span)if (key.startsWith("_")) continue;[span_41](end_span)
        [span_42](start_span)const li = document.createElement("li");[span_42](end_span)
        [span_43](start_span)li.textContent = key;[span_43](end_span)
        li.className = tree[key]._type === "tree" ? [span_44](start_span)"folder" : "file";[span_44](end_span)
        
        [span_45](start_span)if (tree[key]._type === "tree") {[span_45](end_span)
            [span_46](start_span)li.appendChild(buildTreeList(tree[key], ownerRepo, branch));[span_46](end_span)
        [span_47](start_span)} else {[span_47](end_span)
            [span_48](start_span)li.onclick = async (e) => {[span_48](end_span)
                e.stopPropagation();
                [span_49](start_span)if (li.querySelector("pre")) return;[span_49](end_span)
                
                [span_50](start_span)const pre = document.createElement("pre");[span_50](end_span)
                [span_51](start_span)pre.textContent = `Streaming document stream for ${tree[key]._path}...`;[span_51](end_span)
                [span_52](start_span)li.appendChild(pre);[span_52](end_span)
                
                try {
                    [span_53](start_span)const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);[span_53](end_span)
                    [span_54](start_span)if (res.ok) {[span_54](end_span)
                        [span_55](start_span)const fileContent = await res.text();[span_55](end_span)
                        
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
                        [span_56](start_span)pre.textContent = `Streaming Fault: HTTP target asset returned status ${res.statusText}`;[span_56](end_span)
                    }
                [span_57](start_span)} catch (err) {[span_57](end_span)
                    [span_58](start_span)pre.textContent = `Network Exception: ${err.message}`;[span_58](end_span)
                [span_59](start_span)}
            };[span_59](end_span)
        [span_60](start_span)}
        ul.appendChild(li);[span_60](end_span)
    [span_61](start_span)}
    return ul;[span_61](end_span)
[span_62](start_span)}

function appendAiUtilityLink(listItem, filePath, fileContent) {
    if (listItem.querySelector(".file-ai-btn")) return;
    const aiBtn = document.createElement("button");
    aiBtn.textContent = "Review Code Block";
    aiBtn.className = "file-ai-btn";
    aiBtn.onclick = (e) => {
        e.stopPropagation();
        if (!aiEngine) {
            alert("Local AI Engine not running. Complete environmental setup stages via the right configuration workspace panel first.");
            return;
        }
        chatInput.value = `Analyze the structural properties of this source code file for performance blockages or optimization bugs:\n\nPath Identifier: ${filePath}\n\`\`\`\n${fileContent}\n\`\`\``;
        chatInput.focus();
    };
    listItem.insertBefore(aiBtn, listItem.firstChild);
}

// --- High-Compatibility WebGPU Execution Engine Initialization ---
async function initializeAiEngine() {
    const selectedModel = modelSelect.value;
    initAiBtn.disabled = true;
    modelSelect.disabled = true;
    aiStatus.textContent = "Setting up compilation parameters and downloading execution weights...";
    aiStatus.style.color = "#cdd6f4";
    progressContainer.classList.remove("hidden");

    const initProgressCallback = (report) => {
        aiStatus.textContent = report.text;
        if (report.progress !== undefined) {
            progressBar.style.width = `${report.progress * 100}%`;
        }
    };

    try {
        // Enforce strict context boundaries to bypass mobile driver 16KB workgroup limitations
        const mobileHardwareOverrides = {
            initProgressCallback: initProgressCallback,
            contextWindowSize: 1024, // Keeps allocation matrices small inside mobile memory pools
        };

        aiEngine = await webllm.CreateMLCEngine(selectedModel, mobileHardwareOverrides);
        
        aiStatus.textContent = `Success: Mobile-optimized compute pipeline live. Model: ${selectedModel}`;
        aiStatus.style.color = "#a6e3a1";
        progressBar.style.width = "100%";
        
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
        appendChatMessage("System", "Zero-cost compute interface engine successfully mounted. Matrix arithmetic loops are rendering strictly inside your local device hardware components.");
    } catch (error) {
        aiStatus.textContent = `Initialization Terminated: ${error.message}`;
        aiStatus.style.color = "#f38ba8";
        initAiBtn.disabled = false;
        modelSelect.disabled = false;
        console.error("WebGPU Kernel Assembly Exception:", error);
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
    const aiBubble = appendChatMessage("AI", "Processing computational inference...");

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
        aiBubble.querySelector(".msg-body").textContent = `Inference Failure: ${error.message}`;
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

// --- Event Listeners and Hooking Matrices ---[span_62](end_span)
[span_63](start_span)loadBtn.onclick = () => {[span_63](end_span)
    [span_64](start_span)let repo = repoInput.value.trim();[span_64](end_span)
    [span_65](start_span)const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)(\/|$)/i);[span_65](end_span)
    [span_66](start_span)if (urlMatch) repo = urlMatch[1];[span_66](end_span)
    [span_67](start_span)if (repo) {[span_67](end_span)
        [span_68](start_span)window.location.hash = repoInput.value.trim();[span_68](end_span)
        [span_69](start_span)loadRepository(repo);[span_69](end_span)
    [span_70](start_span)}
};[span_70](end_span)

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

[span_71](start_span)function checkURL() {[span_71](end_span)
    [span_72](start_span)const params = new URLSearchParams(window.location.search);[span_72](end_span)
    [span_73](start_span)let repo = params.get("repo");[span_73](end_span)
    [span_74](start_span)if (!repo && window.location.hash) repo = window.location.hash.slice(1);[span_74](end_span)
    [span_75](start_span)if (repo) {[span_75](end_span)
        [span_76](start_span)const urlMatch = repo.match(/github\.com\/([^\/]+\/[^\/]+)/i);[span_76](end_span)
        [span_77](start_span)if (urlMatch) repo = urlMatch[1];[span_77](end_span)
        [span_78](start_span)repoInput.value = repo;[span_78](end_span)
        [span_79](start_span)loadRepository(repo);[span_79](end_span)
    [span_80](start_span)}
}[span_80](end_span)

[span_81](start_span)checkURL();[span_81](end_span)
