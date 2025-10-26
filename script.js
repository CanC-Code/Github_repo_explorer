// GitHub API functions
async function getRepoTree(owner, repo, branch='master') {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch repo tree: ${resp.status}`);
    const data = await resp.json();
    return data.tree.filter(f => f.type === 'blob'); // only files
}

async function getFileContent(owner, repo, branch, path) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    const resp = await fetch(rawUrl);
    if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`);
    return await resp.text();
}

// Build nested tree object from flat paths
function buildTree(files) {
    const tree = {};
    files.forEach(f => {
        const parts = f.path.split('/');
        let current = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                current[part] = f.path; // file
            } else {
                current[part] = current[part] || {}; // folder
                current = current[part];
            }
        }
    });
    return tree;
}

// Render tree into HTML
function renderTree(node, parentElem, owner, repo, branch) {
    Object.keys(node).forEach(key => {
        const value = node[key];
        if (typeof value === 'string') { // file
            const fileDiv = document.createElement('div');
            fileDiv.textContent = key;
            fileDiv.className = 'file';
            fileDiv.onclick = async () => {
                const content = await getFileContent(owner, repo, branch, value);
                document.getElementById('fileContent').value = content;
            };
            parentElem.appendChild(fileDiv);
        } else { // folder
            const folderDiv = document.createElement('div');
            folderDiv.textContent = key;
            folderDiv.className = 'folder';
            const childDiv = document.createElement('div');
            childDiv.style.display = 'none';
            childDiv.style.marginLeft = '20px';
            folderDiv.onclick = (e) => {
                e.stopPropagation();
                childDiv.style.display = childDiv.style.display === 'none' ? 'block' : 'none';
            };
            parentElem.appendChild(folderDiv);
            parentElem.appendChild(childDiv);
            renderTree(value, childDiv, owner, repo, branch);
        }
    });
}

// Main function to load repo
async function loadRepo() {
    const input = document.getElementById('repoInput').value.split('/');
    if (input.length !== 2) { alert("Enter as owner/repo"); return; }
    const [owner, repo] = input;
    const branch = document.getElementById('branchInput').value || 'master';
    try {
        const files = await getRepoTree(owner, repo, branch);
        const tree = buildTree(files);
        const fileTreeDiv = document.getElementById('fileTree');
        fileTreeDiv.innerHTML = '';
        renderTree(tree, fileTreeDiv, owner, repo, branch);
        document.getElementById('fileContent').value = '';
    } catch (err) {
        alert(err.message);
    }
}

document.getElementById('loadBtn').onclick = loadRepo;
