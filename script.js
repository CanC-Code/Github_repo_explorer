const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileTreeContainer = document.getElementById("fileTree");
const fileContentContainer = document.getElementById("fileContent");
const repoInfo = document.getElementById("repoInfo");

// Function to fetch repo file tree from GitHub API
async function loadRepository(ownerRepo, branch = "main") {
    repoInfo.textContent = `Loading ${ownerRepo}...`;
    fileTreeContainer.innerHTML = "";
    fileContentContainer.textContent = "";

    const apiUrl = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error("Failed to load repository. Check owner/repo and branch.");
        const data = await res.json();

        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch})`;
        buildFileTree(data.tree, ownerRepo, branch);
    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// Build file tree
function buildFileTree(tree, ownerRepo, branch) {
    const ul = document.createElement("ul");
    tree.forEach(item => {
        if (item.type === "blob") {
            const li = document.createElement("li");
            li.textContent = item.path;
            li.onclick = () => loadFile(ownerRepo, branch, item.path);
            ul.appendChild(li);
        }
    });
    fileTreeContainer.appendChild(ul);
}

// Load individual file content
async function loadFile(ownerRepo, branch, path) {
    const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`;
    fileContentContainer.textContent = `Loading ${path}...`;
    try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error("Failed to load file.");
        const text = await res.text();
        fileContentContainer.textContent = text;
    } catch (err) {
        fileContentContainer.textContent = `Error: ${err.message}`;
    }
}

// Button click
loadBtn.onclick = () => {
    const repo = repoInput.value.trim();
    if (repo) loadRepository(repo);
};

// Check URL path for auto-loading
function checkURL() {
    let path = window.location.pathname.replace(/^\/+/, "");
    // Decode in case of URL-encoded repo URLs
    path = decodeURIComponent(path);
    if (path.startsWith("https://github.com/")) {
        repoInput.value = path.match(/github\.com\/([^\/]+\/[^\/]+)/)[1];
        loadRepository(repoInput.value);
    }
}

// Run on page load
checkURL();
