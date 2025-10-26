const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileContentContainer = document.getElementById("fileContent");
const repoInfo = document.getElementById("repoInfo");

// Load repository and all files
async function loadRepository(ownerRepo, branch = "main") {
    repoInfo.textContent = `Loading ${ownerRepo}...`;
    fileContentContainer.textContent = "";

    const apiUrl = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error("Failed to load repository. Check owner/repo and branch.");
        const data = await res.json();

        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch})`;

        const files = data.tree.filter(item => item.type === "blob");

        fileContentContainer.textContent = `Fetching ${files.length} files...\n`;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            await loadFile(ownerRepo, branch, file.path);
        }

        fileContentContainer.textContent += `\nAll files loaded.`;
    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// Load a single file and append it
async function loadFile(ownerRepo, branch, path) {
    const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`;
    try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error(`Failed to load ${path}`);
        const text = await res.text();

        fileContentContainer.textContent += `\n\n===== ${path} =====\n`;
        fileContentContainer.textContent += text;
    } catch (err) {
        fileContentContainer.textContent += `\n\n===== ${path} =====\nError loading file: ${err.message}\n`;
    }
}

// Button click event
loadBtn.onclick = () => {
    const repo = repoInput.value.trim();
    if (repo) loadRepository(repo);
};

// Check URL path for appended GitHub repo
function checkURL() {
    let path = window.location.pathname.replace(/^\/+/, "");
    path = decodeURIComponent(path);
    if (path.startsWith("https://github.com/")) {
        const match = path.match(/github\.com\/([^\/]+\/[^\/]+)/);
        if (match) {
            const ownerRepo = match[1];
            repoInput.value = ownerRepo;
            loadRepository(ownerRepo);
        }
    }
}

// Run on page load
checkURL();
