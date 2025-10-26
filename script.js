const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const repoInfo = document.getElementById("repoInfo");

// Load repository and display all files
async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Fetching repository info for ${ownerRepo}...`;
    fileTreeContainer.innerHTML = "";

    try {
        // Detect default branch dynamically
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Failed to fetch repo info.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        // Fetch tree recursively
        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error("Failed to fetch repo tree.");
        const treeData = await treeRes.json();

        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch}) | ${treeData.tree.length} items`;

        // Build file tree structure
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

    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// Build HTML list recursively
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
                if (li.querySelector("pre")) return; // already loaded
                const pre = document.createElement("pre");
                pre.textContent = `Loading ${tree[key]._path}...`;
                li.appendChild(pre);
                try {
                    const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/${tree[key]._path}`);
                    pre.textContent = res.ok ? await res.text() : `Error: ${res.statusText}`;
                    Prism.highlightAll(); // syntax highlighting
                } catch (err) {
                    pre.textContent = `Error: ${err.message}`;
                }
            };
        }

        ul.appendChild(li);
    }
    return ul;
}

// Button click
loadBtn.onclick = () => {
    const repo = repoInput.value.trim();
    if (repo) loadRepository(repo);
};

// Detect GitHub URL from query parameter ?repo=
function checkURL() {
    const params = new URLSearchParams(window.location.search);
    const githubUrl = params.get("repo"); // get ?repo=...
    if (githubUrl) {
        const match = githubUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
        if (match) {
            const ownerRepo = match[1];
            repoInput.value = ownerRepo;
            loadRepository(ownerRepo);
        }
    }
}

// Run on page load
checkURL();
