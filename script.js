const repoInput = document.getElementById("repoInput");
const loadBtn = document.getElementById("loadBtn");
const fileContentContainer = document.getElementById("fileContent");
const repoInfo = document.getElementById("repoInfo");

// Load repository and all readable files
async function loadRepository(ownerRepo) {
    repoInfo.textContent = `Fetching repository info for ${ownerRepo}...`;
    fileContentContainer.textContent = "";

    try {
        // Get default branch dynamically
        const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`);
        if (!repoRes.ok) throw new Error("Failed to fetch repository info.");
        const repoData = await repoRes.json();
        const branch = repoData.default_branch || "main";

        // Fetch all files
        const treeRes = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) throw new Error("Failed to fetch repository tree.");
        const treeData = await treeRes.json();

        const files = treeData.tree.filter(item => item.type === "blob");

        repoInfo.textContent = `Repository: ${ownerRepo} (branch: ${branch}) | ${files.length} files`;

        // Fetch all files in parallel, but limit concurrency to avoid browser/network issues
        const maxParallel = 10;
        for (let i = 0; i < files.length; i += maxParallel) {
            const batch = files.slice(i, i + maxParallel);
            const fetchPromises = batch.map(file => fetchFile(ownerRepo, branch, file.path));
            const results = await Promise.all(fetchPromises);
            results.forEach(text => fileContentContainer.textContent += text);
        }

        repoInfo.textContent += " | All files loaded.";
    } catch (err) {
        repoInfo.textContent = `Error: ${err.message}`;
    }
}

// Fetch individual file and format output
async function fetchFile(ownerRepo, branch, path) {
    const rawUrl = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${path}`;
    try {
        const res = await fetch(rawUrl);
        let content;
        if (!res.ok) {
            content = `\n\n===== ${path} =====\nError loading file: ${res.statusText}\n`;
        } else {
            const text = await res.text();
            // Only display files smaller than 1MB to avoid freezing browser
            if (text.length > 1024 * 1024) {
                content = `\n\n===== ${path} =====\n[File too large to display]\n`;
            } else {
                content = `\n\n===== ${path} =====\n${text}\n`;
            }
        }
        return content;
    } catch (err) {
        return `\n\n===== ${path} =====\nError: ${err.message}\n`;
    }
}

// Button click
loadBtn.onclick = () => {
    const repo = repoInput.value.trim();
    if (repo) loadRepository(repo);
};

// Detect appended GitHub URL and auto-load
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

// Run on page load
checkURL();
