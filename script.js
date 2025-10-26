const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileContentContainer = document.getElementById("fileContent");
const repoInfo = document.getElementById("repoInfo");

// Fetch all files and display
async function loadRepository(ownerRepo, branch = "main") {
    repoInfo.textContent = `Loading ${ownerRepo}...`;
    fileContentContainer.textContent = "";

    const treeApi = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;

    try {
        const res = await fetch(treeApi);
        if (!res.ok) throw new Error("Failed to load repository tree.");
        const data = await res.json();

        const files = data.tree.filter(item => item.type === "blob");
        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch}) - ${files.length} files`;

        for (const file of files) {
            await fetchAndAppendFile(ownerRepo, branch, file.path);
        }

        repoInfo.textContent += " | All files loaded successfully.";
    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// Fetch a single file and append
async function fetchAndAppendFile(ownerRepo, branch, path) {
    const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`;
    try {
        const res = await fetch(rawUrl);
        let content = "";
        if (!res.ok) {
            content = `Error loading file: ${res.statusText}`;
        } else {
            content = await res.text();
        }
        fileContentContainer.textContent += `\n\n===== ${path} =====\n${content}`;
    } catch (err) {
        fileContentContainer.textContent += `\n\n===== ${path} =====\nError: ${err.message}`;
    }
}

// Button click
loadBtn.onclick = () => {
    const repo = repoInput.value.trim();
    if (repo) loadRepository(repo);
};

// Detect appended GitHub URL
function checkURL() {
    let path = decodeURIComponent(window.location.pathname.replace(/^\/+/, ""));
    if (path.startsWith("https://github.com/")) {
        const match = path.match(/github\.com\/([^\/]+\/[^\/]+)/);
        if (match) {
            const ownerRepo = match[1];
            repoInput.value = ownerRepo;
            loadRepository(ownerRepo);
        }
    }
}

// Run on load
checkURL();
