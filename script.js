const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo = document.getElementById("repoInfo");

// Flag to toggle "load all files immediately"
const loadAllFiles = true; 

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
    const repo = repoInput.value.trim();
    if (repo) loadRepository(repo);
};

// --- Auto-detect GitHub URL from query param ?repo= ---
function checkURL() {
    const params = new URLSearchParams(window.location.search);
    const githubUrl = params.get("repo");
    if (githubUrl) {
        const match = githubUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
        if (match) {
            const ownerRepo = match[1];
            repoInput.value = ownerRepo;
            loadRepository(ownerRepo);
        }
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
