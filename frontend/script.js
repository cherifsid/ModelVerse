const socket = io();
let currentModel = null;
let currentChatId = null;
let newlyInstalledModel = null;
let currentMessageDiv = null;
let temperature = 1.0;
let topP = 1.0;
let attachedImagePaths = [];

marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
});

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
    }

    const tempSlider = document.getElementById('temperature');
    const topPSlider = document.getElementById('top-p');
    const tempValueSpan = document.getElementById('temperature-value');
    const topPValueSpan = document.getElementById('top-p-value');
    temperature = parseFloat(localStorage.getItem('temperature')) || 1.0;
    topP = parseFloat(localStorage.getItem('topP')) || 1.0;
    tempSlider.value = temperature;
    tempValueSpan.textContent = temperature.toFixed(1);
    topPSlider.value = topP;
    topPValueSpan.textContent = topP.toFixed(2);
    tempSlider.addEventListener('input', (e) => {
        temperature = parseFloat(e.target.value);
        tempValueSpan.textContent = temperature.toFixed(1);
        localStorage.setItem('temperature', temperature);
    });
    topPSlider.addEventListener('input', (e) => {
        topP = parseFloat(e.target.value);
        topPValueSpan.textContent = topP.toFixed(2);
        localStorage.setItem('topP', topP);
    });

    const attachBtn = document.getElementById('attach-btn');
    const imageUploadInput = document.getElementById('image-upload-input');
    attachBtn.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageUpload);

    loadModels();
    loadChats();
    
    socket.on('model_installed', (data) => {
        document.getElementById('install-progress').innerText = `${data.status}: ${data.model}`;
        if (data.status === 'completed') {
            newlyInstalledModel = data.model;
            loadModels();
        }
    });
    
    socket.on('install_progress', (data) => {
        document.getElementById('install-progress').innerText = data.message;
    });
    
    socket.on('response_chunk', (data) => {
        if (data.chat_id === currentChatId) {
            appendToCurrentMessage(data.content);
        }
    });
    
    socket.on('response_complete', (data) => {
        if (data.chat_id === currentChatId) {
            finalizeCurrentMessage();
            document.getElementById('send-btn').disabled = false;
        }
    });
    
    socket.on('response_error', (data) => {
        if (data.chat_id === currentChatId && currentMessageDiv) {
            currentMessageDiv.innerHTML = `<div style="color: #ff4444;">Error: ${data.error}</div>`;
            document.getElementById('send-btn').disabled = false;
        }
    });
    
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});

function handleImageUpload(event) {
    const files = event.target.files;
    if (!files.length) return;

    const previewContainer = document.getElementById('image-preview-container');
    previewContainer.innerHTML = '<div>Uploading...</div>';
    previewContainer.style.display = 'flex';

    const formData = new FormData();
    for (const file of files) {
        formData.append('images[]', file);
    }

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        previewContainer.innerHTML = '';
        if (data.image_paths && data.image_paths.length > 0) {
            attachedImagePaths = data.image_paths;
            attachedImagePaths.forEach(path => {
                const previewWrapper = document.createElement('div');
                previewWrapper.className = 'image-preview';
                previewWrapper.dataset.path = path;
                previewWrapper.innerHTML = `
                    <img src="${path}" alt="Image preview">
                    <button class="remove-image-btn" onclick="removeAttachedImage('${path}')">×</button>
                `;
                previewContainer.appendChild(previewWrapper);
            });
        } else {
            previewContainer.innerHTML = `<div style="color:red;">Upload failed</div>`;
        }
    })
    .catch(error => {
        console.error('Error uploading image:', error);
        previewContainer.innerHTML = `<div style="color:red;">Upload failed</div>`;
    });
}

function removeAttachedImage(pathToRemove, clearAll = false) {
    if (clearAll) {
        attachedImagePaths = [];
    } else {
        attachedImagePaths = attachedImagePaths.filter(p => p !== pathToRemove);
        const previewToRemove = document.querySelector(`.image-preview[data-path="${pathToRemove}"]`);
        if (previewToRemove) {
            previewToRemove.remove();
        }
    }
    
    const previewContainer = document.getElementById('image-preview-container');
    if (attachedImagePaths.length === 0) {
        previewContainer.innerHTML = '';
        previewContainer.style.display = 'none';
        document.getElementById('image-upload-input').value = '';
    }
}

function filterChats() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const chatItems = document.querySelectorAll('#chat-list .chat-item');
    chatItems.forEach(item => {
        const chatTitle = item.textContent.toLowerCase();
        item.style.display = chatTitle.includes(searchTerm) ? '' : 'none';
    });
}

function toggleTheme() {
    document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
}

function toggleSettings() {
    document.getElementById('model-parameters').classList.toggle('visible');
}

async function openImportModal() {
    if (!currentChatId) return alert("Please select a chat to import context into.");
    try {
        const response = await fetch('/api/chats');
        const chats = await response.json();
        const importList = document.getElementById('import-chat-list');
        importList.innerHTML = '';
        chats.forEach(chat => {
            if (chat.id !== currentChatId) {
                const radioLabel = document.createElement('label');
                radioLabel.className = 'import-item';
                const radioInput = document.createElement('input');
                radioInput.type = 'radio';
                radioInput.name = 'import-source';
                radioInput.value = chat.id;
                radioLabel.appendChild(radioInput);
                radioLabel.append(` ${chat.title}`);
                importList.appendChild(radioLabel);
            }
        });
        document.getElementById('import-modal').classList.add('visible');
    } catch (error) {
        console.error("Failed to load chats for import:", error);
    }
}

function closeImportModal() {
    document.getElementById('import-modal').classList.remove('visible');
}

async function importSelectedChat() {
    const selectedRadio = document.querySelector('input[name="import-source"]:checked');
    if (!selectedRadio) return alert("Please select a chat to import from.");
    const sourceChatId = selectedRadio.value;
    const confirmBtn = document.getElementById('import-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Importing...';
    try {
        await fetch(`/api/chats/${currentChatId}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_chat_id: parseInt(sourceChatId) })
        });
        await selectChat(currentChatId);
        document.querySelectorAll('.message.system ~ .message').forEach(el => el.classList.add('fade-in'));
    } catch (error) {
        console.error("Failed to import chat context:", error);
        alert("An error occurred during import.");
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Import';
        closeImportModal();
    }
}

async function loadChats() {
    try {
        const response = await fetch('/api/chats');
        const chats = await response.json();
        const chatList = document.getElementById('chat-list');
        chatList.innerHTML = '';
        chats.forEach(chat => {
            const chatDiv = document.createElement('div');
            chatDiv.className = 'chat-item';
            chatDiv.textContent = chat.title;
            chatDiv.dataset.chatId = chat.id;
            chatDiv.onclick = () => selectChat(chat.id);
            chatList.appendChild(chatDiv);
        });
        if (chats.length > 0 && !currentChatId) {
            selectChat(chats[0].id);
        }
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

async function createNewChat() {
    const chatTitle = prompt("Enter a name for the new chat:", "New Chat");
    if (chatTitle && chatTitle.trim()) {
        try {
            const response = await fetch('/api/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: chatTitle.trim() })
            });
            const data = await response.json();
            await loadChats();
            selectChat(data.chat_id);
        } catch (error) {
            console.error('Failed to create new chat:', error);
        }
    }
}

async function selectChat(chatId) {
    currentChatId = chatId;
    document.querySelectorAll('#chat-list .chat-item').forEach(item => {
        item.classList.toggle('active', item.dataset.chatId == chatId);
    });
    const messagesDiv = document.getElementById('chat-messages');
    messagesDiv.innerHTML = '';
    try {
        const response = await fetch(`/api/chats/${chatId}/messages`);
        const messages = await response.json();
        messages.forEach(msg => {
            const imagePaths = msg.image_path ? JSON.parse(msg.image_path) : [];
            addMessage(msg.role, msg.content, imagePaths, true)
        });
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

async function deleteCurrentChat() {
    if (!currentChatId) return;
    if (confirm('Are you sure you want to delete this chat?')) {
        try {
            await fetch(`/api/chats/${currentChatId}`, { method: 'DELETE' });
            document.getElementById('chat-messages').innerHTML = '';
            currentChatId = null;
            document.getElementById('current-model').textContent = 'Select a chat to begin';
            await loadChats();
        } catch (error) {
            console.error('Failed to delete chat:', error);
        }
    }
}

async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        const modelSelect = document.getElementById('model-select');
        modelSelect.innerHTML = '';
        if (data.models && data.models.length > 0) {
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = model.is_vision ? `${model.name} (vision)` : model.name;
                option.dataset.isVision = model.is_vision;
                
                if (model.name === newlyInstalledModel) {
                    option.textContent += ' (new)';
                    option.style.color = '#28a745';
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });
            selectModel(modelSelect);
        }
    } catch (error) {
        console.error('Failed to load models:', error);
    }
}

function selectModel(selectElement) {
    const selectedOption = selectElement.options[selectElement.selectedIndex];
    currentModel = selectedOption.value;
    document.getElementById('current-model').textContent = `Model: ${selectedOption.textContent}`;
    
    const isVision = selectedOption.dataset.isVision === 'true';
    document.getElementById('attach-btn').disabled = !isVision;
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if ((!message && attachedImagePaths.length === 0) || !currentModel || !currentChatId) {
        return;
    }
    document.getElementById('send-btn').disabled = true;
    addMessage('user', message, attachedImagePaths);
    input.value = '';
    const assistantMsg = addMessage('assistant', '', null);
    currentMessageDiv = assistantMsg.querySelector('.message-content');
    currentMessageDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    
    socket.emit('chat_stream', {
        model: currentModel,
        message: message,
        chat_id: currentChatId,
        image_paths: attachedImagePaths,
        options: { temperature: temperature, top_p: topP }
    });
    removeAttachedImage(null, true);
}

function addMessage(role, content, imagePaths, isInitialLoad = false) {
    const messagesDiv = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const roleDiv = document.createElement('div');
    roleDiv.className = 'message-role';
    roleDiv.textContent = role;

    if (role === 'system') {
        messageDiv.classList.add('system-message');
        roleDiv.style.display = 'none';
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (imagePaths && imagePaths.length > 0) {
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'message-images-container';
        imagePaths.forEach(path => {
            const imageEl = document.createElement('img');
            imageEl.src = path;
            imageEl.className = 'message-image';
            imagesContainer.appendChild(imageEl);
        });
        contentDiv.appendChild(imagesContainer);
    }
    
    if (content) {
        const textEl = document.createElement('div');
        textEl.innerHTML = (role === 'system') ? content : renderMarkdown(content);
        contentDiv.appendChild(textEl);
        if (isInitialLoad && role !== 'system') {
            addCopyButtons(textEl);
        }
    }
    
    messageDiv.appendChild(roleDiv);
    messageDiv.appendChild(contentDiv);
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return messageDiv;
}

let accumulatedContent = '';

function appendToCurrentMessage(chunk) {
    if (!currentMessageDiv) return;
    if (currentMessageDiv.querySelector('.typing-indicator')) {
        currentMessageDiv.innerHTML = '';
    }
    accumulatedContent += chunk;
    const textContentDiv = currentMessageDiv.querySelector('div') || currentMessageDiv;
    textContentDiv.innerHTML = renderMarkdown(accumulatedContent);
    const messagesDiv = document.getElementById('chat-messages');
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function finalizeCurrentMessage() {
    if (!currentMessageDiv) return;
    const finalContentEl = currentMessageDiv.querySelector('div') || currentMessageDiv;
    finalContentEl.innerHTML = renderMarkdown(accumulatedContent);
    addCopyButtons(finalContentEl);
    currentMessageDiv = null;
    accumulatedContent = '';
}

function renderMarkdown(text) {
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => `\`\`\`${lang || ''}\n${code.trim()}\n\`\`\``);
    return marked.parse(text);
}

async function installModel() {
    const modelNameInput = document.getElementById('model-name-input');
    const modelName = modelNameInput.value.trim();
    const isVision = document.getElementById('is-vision-checkbox').checked;
    if (!modelName) return;
    document.getElementById('install-btn').disabled = true;
    document.getElementById('install-progress').innerText = 'Starting installation...';
    socket.emit('install_model', { model: modelName, is_vision: isVision });
    modelNameInput.value = '';
    setTimeout(() => {
        document.getElementById('install-btn').disabled = false;
    }, 3000);
}

function addCopyButtons(container) {
    const codeBlocks = container.querySelectorAll('pre code');
    codeBlocks.forEach((codeBlock) => {
        const pre = codeBlock.parentElement;
        if (pre.parentElement.className === 'code-block-wrapper') return;
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        const langClass = Array.from(codeBlock.classList).find(c => c.startsWith('language-'));
        const language = langClass ? langClass.replace('language-', '') : 'code';
        const header = document.createElement('div');
        header.className = 'code-header';
        const langSpan = document.createElement('span');
        langSpan.className = 'code-language';
        langSpan.textContent = language;
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-button';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => copyCode(codeBlock, copyBtn);
        header.appendChild(langSpan);
        header.appendChild(copyBtn);
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);
    });
}

async function copyCode(codeBlock, button) {
    try {
        await navigator.clipboard.writeText(codeBlock.textContent);
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    } catch (err) {
        console.error('Failed to copy code:', err);
    }
}