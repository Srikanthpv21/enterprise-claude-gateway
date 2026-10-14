(function () {
  const state = {
    currentUser: null,
    currentUsage: null,
    chats: [],
    activeChatId: null,
    currentMessages: [],
    models: [],
    activeModel: 'claude-3-5-sonnet-20241022',
    isStreaming: false,
    abortController: null,
    theme: localStorage.getItem('claude_theme') || 'light',
  };

  const el = {

    authModal: document.getElementById('auth-modal'),
    authAlert: document.getElementById('auth-alert'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    authTitle: document.getElementById('auth-title'),
    authSubtitle: document.getElementById('auth-subtitle'),
    switchToRegister: document.getElementById('switch-to-register'),
    switchToLogin: document.getElementById('switch-to-login'),
    loginEmail: document.getElementById('login-email'),
    loginPassword: document.getElementById('login-password'),
    regName: document.getElementById('reg-name'),
    regEmail: document.getElementById('reg-email'),
    regPassword: document.getElementById('reg-password'),
    regAccessCode: document.getElementById('reg-access-code'),

    mainLayout: document.getElementById('main-layout'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
    btnCloseSidebar: document.getElementById('btn-close-sidebar'),
    btnNewChat: document.getElementById('btn-new-chat'),
    chatSearch: document.getElementById('chat-search'),
    chatsList: document.getElementById('chats-list'),

    tokenUsageText: document.getElementById('token-usage-text'),
    meterFill: document.getElementById('meter-fill'),
    userAvatarBadge: document.getElementById('user-avatar-badge'),
    userDisplayName: document.getElementById('user-display-name'),
    userDisplayEmail: document.getElementById('user-display-email'),
    btnAdminPanel: document.getElementById('btn-admin-panel'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    btnLogout: document.getElementById('btn-logout'),

    currentChatTitle: document.getElementById('current-chat-title'),
    btnRenameChat: document.getElementById('btn-rename-chat'),
    modelSelectBtn: document.getElementById('model-select-btn'),
    currentModelName: document.getElementById('current-model-name'),
    modelDropdown: document.getElementById('model-dropdown'),
    btnSystemPrompt: document.getElementById('btn-system-prompt'),
    btnExportChat: document.getElementById('btn-export-chat'),

    messagesContainer: document.getElementById('messages-container'),
    welcomeScreen: document.getElementById('welcome-screen'),
    welcomeGreeting: document.getElementById('welcome-greeting'),
    chatMessages: document.getElementById('chat-messages'),

    promptInput: document.getElementById('prompt-input'),
    charCounter: document.getElementById('char-counter'),
    btnStopStream: document.getElementById('btn-stop-stream'),
    btnSend: document.getElementById('btn-send'),

    systemPromptModal: document.getElementById('system-prompt-modal'),
    systemPromptInput: document.getElementById('system-prompt-input'),
    btnClosePromptModal: document.getElementById('btn-close-prompt-modal'),
    btnSaveSystemPrompt: document.getElementById('btn-save-system-prompt'),
    adminModal: document.getElementById('admin-modal'),
    btnCloseAdminModal: document.getElementById('btn-close-admin-modal'),
    adminTotalUsers: document.getElementById('admin-total-users'),
    adminTotalChats: document.getElementById('admin-total-chats'),
    adminTotalTokensToday: document.getElementById('admin-total-tokens-today'),
    adminUsersTable: document.getElementById('admin-users-table'),
  };

  // Configure Marked renderer
  marked.setOptions({
    gfm: true,
    breaks: true,
    sanitize: false,
    smartypants: true,
  });

  async function init() {
    applyTheme(state.theme);
    bindEvents();
    checkHealth();
    await checkAuth();
  }

  // Apply light or dark theme and persist selection in local storage
  function applyTheme(theme) {
    state.theme = theme;
    localStorage.setItem('claude_theme', theme);
    document.body.className = theme === 'dark' ? 'theme-dark' : 'theme-light';
    const icon = el.btnThemeToggle.querySelector('i');
    if (icon) {
      icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
    const hlTheme = document.getElementById('highlight-theme');
    if (hlTheme) {
      hlTheme.href =
        theme === 'dark'
          ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css'
          : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
    }
  }

  // Check health and update greeting
  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (!data.apiKeyConfigured) {
        showGlobalWarning(
          '⚠️ Anthropic API key not configured. Add your ANTHROPIC_API_KEY in the server .env file.'
        );
      }
    } catch (e) {
      console.warn('Could not reach health check endpoint.');
    }
  }

  function showGlobalWarning(msg) {
    const banner = document.createElement('div');
    banner.style.cssText =
      'background:#DC2626;color:#FFF;padding:8px 16px;text-align:center;font-size:13px;font-weight:600;z-index:9999;position:relative;';
    banner.innerText = msg;
    document.body.prepend(banner);
  }

  // Validate active user session on app launch
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        state.currentUser = data.user;
        state.currentUsage = data.usage;
        onAuthSuccess();
      } else {
        showAuthModal();
      }
    } catch (err) {
      showAuthModal();
    }
  }

  function showAuthModal() {
    el.authModal.classList.remove('hidden');
    el.mainLayout.classList.add('hidden');
  }

  // Initialize workspace UI once authentication succeeds
  function onAuthSuccess() {
    el.authModal.classList.add('hidden');
    el.mainLayout.classList.remove('hidden');

    // Update User UI
    el.userDisplayName.textContent = state.currentUser.name;
    el.userDisplayEmail.textContent = state.currentUser.email;
    el.userAvatarBadge.textContent = state.currentUser.name.charAt(0).toUpperCase();

    // Show Admin Panel icon if role is admin
    if (state.currentUser.role === 'admin') {
      el.btnAdminPanel.classList.remove('hidden');
    }

    updateUsageUI(state.currentUsage);
    updateGreeting();

    loadModels();
    loadChats();
  }

  function updateGreeting() {
    const hour = new Date().getHours();
    let timeGreeting = 'Good morning';
    if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
    else if (hour >= 17) timeGreeting = 'Good evening';

    const firstName = state.currentUser ? state.currentUser.name.split(' ')[0] : '';
    el.welcomeGreeting.textContent = `${timeGreeting}, ${firstName}`;
  }

  // Refresh daily quota progress bar and token metrics
  function updateUsageUI(usage) {
    if (!usage) return;
    state.currentUsage = usage;
    const total = usage.totalTokens || 0;
    const limit = usage.dailyLimit || 150000;
    const percent = Math.min(100, Math.round((total / limit) * 100));

    el.tokenUsageText.textContent = `${(total / 1000).toFixed(1)}k / ${(limit / 1000).toFixed(0)}k`;
    el.meterFill.style.width = `${percent}%`;

    if (percent > 90) {
      el.meterFill.style.background = '#DC2626';
    } else {
      el.meterFill.style.background = 'linear-gradient(90deg, var(--accent), #F29E4C)';
    }
  }

  function showAuthError(msg) {
    el.authAlert.textContent = msg;
    el.authAlert.classList.remove('hidden');
  }

  function hideAuthError() {
    el.authAlert.classList.add('hidden');
  }

  // Fetch available model configurations from backend
  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        state.models = data.models;
        state.activeModel = data.defaultModel;
        renderModelDropdown();
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    }
  }

  function renderModelDropdown() {
    el.modelDropdown.innerHTML = '';
    const activeObj = state.models.find((m) => m.id === state.activeModel) || state.models[0];
    if (activeObj) {
      el.currentModelName.textContent = activeObj.name;
    }

    state.models.forEach((m) => {
      const item = document.createElement('div');
      item.className = `model-option ${m.id === state.activeModel ? 'active' : ''}`;
      item.innerHTML = `
        <div class="model-opt-header">
          <span class="model-opt-name">${m.name}</span>
          <span class="model-opt-badge">${m.contextWindow}</span>
        </div>
        <p class="model-opt-desc">${m.description}</p>
      `;
      item.onclick = () => {
        state.activeModel = m.id;
        el.currentModelName.textContent = m.name;
        el.modelDropdown.classList.add('hidden');
        renderModelDropdown();

        // Update active chat model if active chat exists
        if (state.activeChatId) {
          fetch(`/api/chats/${state.activeChatId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m.id }),
          });
        }
      };
      el.modelDropdown.appendChild(item);
    });
  }

  // Fetch conversations belonging to active user
  async function loadChats() {
    try {
      const res = await fetch('/api/chats');
      if (res.ok) {
        const data = await res.json();
        state.chats = data.chats;
        renderChatsList();

        if (state.chats.length > 0 && !state.activeChatId) {
          selectChat(state.chats[0].id);
        } else if (state.chats.length === 0) {
          startNewChat(false);
        }
      }
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
  }

  // Render conversation list in sidebar grouped by recency
  function renderChatsList(searchTerm = '') {
    el.chatsList.innerHTML = '';

    const filtered = state.chats.filter((c) =>
      c.title.toLowerCase().includes(searchTerm.toLowerCase().trim())
    );

    if (filtered.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText =
        'padding: 1rem; color: var(--text-dim); font-size: 0.8rem; text-align: center;';
      emptyMsg.textContent = searchTerm ? 'No matching chats found' : 'No conversations yet';
      el.chatsList.appendChild(emptyMsg);
      return;
    }

    // Group chats by date
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    const groups = {
      Today: [],
      Yesterday: [],
      'Previous 7 Days': [],
      Older: [],
    };

    const now = Date.now();
    filtered.forEach((chat) => {
      const chatDate = new Date(chat.updatedAt).toDateString();
      const diffDays = (now - new Date(chat.updatedAt).getTime()) / (1000 * 3600 * 24);

      if (chatDate === today) groups.Today.push(chat);
      else if (chatDate === yesterday) groups.Yesterday.push(chat);
      else if (diffDays <= 7) groups['Previous 7 Days'].push(chat);
      else groups.Older.push(chat);
    });

    Object.entries(groups).forEach(([groupName, chatsInGroup]) => {
      if (chatsInGroup.length === 0) return;

      const groupHeader = document.createElement('div');
      groupHeader.className = 'history-group-title';
      groupHeader.textContent = groupName;
      el.chatsList.appendChild(groupHeader);

      chatsInGroup.forEach((c) => {
        const item = document.createElement('div');
        item.className = `chat-item ${c.id === state.activeChatId ? 'active' : ''}`;
        item.innerHTML = `
          <span class="chat-item-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</span>
          <div class="chat-item-actions">
            <button class="btn-del-chat" title="Delete conversation"><i class="fa-solid fa-trash"></i></button>
          </div>
        `;

        item.onclick = (e) => {
          if (e.target.closest('.btn-del-chat')) {
            e.stopPropagation();
            deleteChat(c.id);
            return;
          }
          selectChat(c.id);
          // Close mobile sidebar
          el.sidebar.classList.remove('open');
          el.sidebarBackdrop.classList.remove('active');
        };

        el.chatsList.appendChild(item);
      });
    });
  }

  // Create a new conversation session
  async function startNewChat(shouldSelect = true) {
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Conversation',
          model: state.activeModel,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        state.chats.unshift(data.chat);
        renderChatsList();
        if (shouldSelect) {
          selectChat(data.chat.id);
        }
      }
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  // Load message history for selected conversation
  async function selectChat(chatId) {
    state.activeChatId = chatId;
    renderChatsList();

    try {
      const res = await fetch(`/api/chats/${chatId}`);
      if (res.ok) {
        const data = await res.json();
        const chat = data.chat;
        state.currentMessages = data.messages || [];

        el.currentChatTitle.textContent = chat.title;
        if (chat.model) {
          state.activeModel = chat.model;
          renderModelDropdown();
        }

        renderMessages();
      }
    } catch (err) {
      console.error('Failed to load chat details:', err);
    }
  }

  // Delete a conversation thread and clean up message store
  async function deleteChat(chatId) {
    if (!confirm('Are you sure you want to delete this conversation?')) return;

    try {
      const res = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
      if (res.ok) {
        state.chats = state.chats.filter((c) => c.id !== chatId);
        if (state.activeChatId === chatId) {
          state.activeChatId = null;
          if (state.chats.length > 0) {
            selectChat(state.chats[0].id);
          } else {
            startNewChat(true);
          }
        } else {
          renderChatsList();
        }
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }

  // Render message thread into chat feed
  function renderMessages() {
    el.chatMessages.innerHTML = '';

    if (state.currentMessages.length === 0) {
      el.welcomeScreen.classList.remove('hidden');
      el.chatMessages.classList.add('hidden');
      return;
    }

    el.welcomeScreen.classList.add('hidden');
    el.chatMessages.classList.remove('hidden');

    state.currentMessages.forEach((msg) => {
      appendMessageToDOM(msg.role, msg.content, msg.createdAt, false);
    });

    scrollToBottom();
  }

  function appendMessageToDOM(role, content, timestamp, isTyping = false) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const initial =
      role === 'user'
        ? (state.currentUser ? state.currentUser.name.charAt(0).toUpperCase() : 'U')
        : '';

    const avatarHtml =
      role === 'user'
        ? `<div class="message-avatar">${initial}</div>`
        : `<div class="message-avatar">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>
           </div>`;

    const authorName = role === 'user' ? (state.currentUser?.name || 'You') : 'Claude';
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    row.innerHTML = `
      ${avatarHtml}
      <div class="message-bubble-wrapper">
        <div class="message-author-header">
          <span>${authorName}</span>
          <span class="message-timestamp">${timeStr}</span>
        </div>
        <div class="message-body" id="body-${role}">
          ${formatMarkdown(content)}
          ${isTyping ? '<span class="typing-cursor"></span>' : ''}
        </div>
      </div>
    `;

    el.chatMessages.appendChild(row);
    enhanceCodeBlocks(row);
    scrollToBottom();
    return row;
  }

  // Parse markdown into sanitized HTML using DOMPurify
  function formatMarkdown(text) {
    if (!text) return '';
    try {
      const rawHtml = marked.parse(text);
      return DOMPurify.sanitize(rawHtml);
    } catch (e) {
      return escapeHtml(text);
    }
  }

  // Add syntax highlighting and one-click copy button to code blocks
  function enhanceCodeBlocks(container) {
    const preBlocks = container.querySelectorAll('pre');
    preBlocks.forEach((pre) => {
      // Avoid re-wrapping
      if (pre.parentElement.classList.contains('code-block-wrapper')) return;

      const code = pre.querySelector('code');
      const langMatch = code ? code.className.match(/language-(\w+)/) : null;
      const lang = langMatch ? langMatch[1] : 'code';

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';

      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `
        <span class="code-lang">${lang}</span>
        <button class="btn-copy-code" title="Copy code">
          <i class="fa-regular fa-copy"></i>
          <span>Copy</span>
        </button>
      `;

      const copyBtn = header.querySelector('.btn-copy-code');
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i><span>Copied!</span>';
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Copy</span>';
        }, 2000);
      };

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      if (code && typeof hljs !== 'undefined') {
        hljs.highlightElement(code);
      }
    });
  }

  function scrollToBottom() {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
  }

  // Send message and stream token response via Server-Sent Events (SSE)
  async function sendMessage() {
    const text = el.promptInput.value.trim();
    if (!text || state.isStreaming) return;

    // Ensure we have an active chat
    if (!state.activeChatId) {
      await startNewChat(true);
    }

    // Reset input
    el.promptInput.value = '';
    adjustTextareaHeight();
    updateCharCounter();
    el.btnSend.disabled = true;

    // Render User Message
    appendMessageToDOM('user', text, new Date().toISOString(), false);

    // Hide welcome screen
    el.welcomeScreen.classList.add('hidden');
    el.chatMessages.classList.remove('hidden');

    // Render Assistant skeleton
    const assistantRow = appendMessageToDOM('assistant', '', new Date().toISOString(), true);
    const bodyElem = assistantRow.querySelector('.message-body');

    // UI state for streaming
    state.isStreaming = true;
    el.btnStopStream.classList.remove('hidden');
    state.abortController = new AbortController();

    let fullAccumulated = '';

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: state.activeChatId,
          message: text,
          model: state.activeModel,
        }),
        signal: state.abortController.signal,
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || 'Failed to generate response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep partial

        for (const block of lines) {
          if (!block.trim()) continue;

          let eventType = 'message';
          let eventData = '';

          const parts = block.split('\n');
          for (const line of parts) {
            if (line.startsWith('event: ')) {
              eventType = line.replace('event: ', '').trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.replace('data: ', '').trim();
            }
          }

          if (eventType === 'token' && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              fullAccumulated += parsed.delta;
              bodyElem.innerHTML = `${formatMarkdown(fullAccumulated)}<span class="typing-cursor"></span>`;
              enhanceCodeBlocks(assistantRow);
              scrollToBottom();
            } catch (e) {}
          } else if (eventType === 'done' && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              if (parsed.totalDailyTokens) {
                updateUsageUI({ ...state.currentUsage, totalTokens: parsed.totalDailyTokens });
              }
            } catch (e) {}
          } else if (eventType === 'error' && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              bodyElem.innerHTML = `<span style="color:#DC2626;">Error: ${parsed.error}</span>`;
            } catch (e) {}
          }
        }
      }

      // Remove typing cursor & final highlight
      bodyElem.innerHTML = formatMarkdown(fullAccumulated);
      enhanceCodeBlocks(assistantRow);

      // Re-fetch chat history to update chat list and message IDs
      loadChats();
    } catch (err) {
      if (err.name === 'AbortError') {
        bodyElem.innerHTML = `${formatMarkdown(fullAccumulated)} <em style="color:var(--text-dim);">(generation stopped)</em>`;
      } else {
        bodyElem.innerHTML = `<span style="color:#DC2626;font-size:0.9rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${err.message}</span>`;
      }
    } finally {
      state.isStreaming = false;
      state.abortController = null;
      el.btnStopStream.classList.add('hidden');
      el.btnSend.disabled = el.promptInput.value.trim().length === 0;
      scrollToBottom();
    }
  }

  // Attach DOM event handlers for inputs, buttons, and shortcuts
  function bindEvents() {

    el.switchToRegister.onclick = (e) => {
      e.preventDefault();
      hideAuthError();
      el.loginForm.classList.add('hidden');
      el.registerForm.classList.remove('hidden');
      el.authTitle.textContent = 'Create Team Account';
      el.authSubtitle.textContent = 'Join your colleagues in the workspace.';
    };

    el.switchToLogin.onclick = (e) => {
      e.preventDefault();
      hideAuthError();
      el.registerForm.classList.add('hidden');
      el.loginForm.classList.remove('hidden');
      el.authTitle.textContent = 'Team Workplace Portal';
      el.authSubtitle.textContent = 'Sign in with your email to access your secure AI assistant.';
    };

    // Login Submission
    el.loginForm.onsubmit = async (e) => {
      e.preventDefault();
      hideAuthError();
      const email = el.loginEmail.value.trim();
      const password = el.loginPassword.value;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (res.ok) {
          state.currentUser = data.user;
          const meRes = await fetch('/api/auth/me');
          if (meRes.ok) {
            const meData = await meRes.json();
            state.currentUsage = meData.usage;
          }
          onAuthSuccess();
        } else {
          showAuthError(data.error || 'Invalid credentials');
        }
      } catch (err) {
        showAuthError('Failed to connect to server.');
      }
    };

    // Register Submission
    el.registerForm.onsubmit = async (e) => {
      e.preventDefault();
      hideAuthError();
      const name = el.regName.value.trim();
      const email = el.regEmail.value.trim();
      const password = el.regPassword.value;
      const accessCode = el.regAccessCode.value.trim();

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, accessCode }),
        });
        const data = await res.json();
        if (res.ok) {
          state.currentUser = data.user;
          onAuthSuccess();
        } else {
          showAuthError(data.error || 'Registration failed');
        }
      } catch (err) {
        showAuthError('Failed to connect to server.');
      }
    };

    // Logout
    el.btnLogout.onclick = async () => {
      if (confirm('Are you sure you want to sign out?')) {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.reload();
      }
    };

    // Theme Toggle
    el.btnThemeToggle.onclick = () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    };

    // Sidebar Mobile
    el.btnToggleSidebar.onclick = () => {
      el.sidebar.classList.toggle('open');
      el.sidebarBackdrop.classList.toggle('active');
    };
    el.btnCloseSidebar.onclick = () => {
      el.sidebar.classList.remove('open');
      el.sidebarBackdrop.classList.remove('active');
    };
    el.sidebarBackdrop.onclick = () => {
      el.sidebar.classList.remove('open');
      el.sidebarBackdrop.classList.remove('active');
    };

    // New Chat
    el.btnNewChat.onclick = () => startNewChat(true);

    // Keyboard Shortcuts (Ctrl+K or Cmd+K for New Chat)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        startNewChat(true);
      }
    });

    // Chat Search
    el.chatSearch.oninput = (e) => {
      renderChatsList(e.target.value);
    };

    // Model Dropdown
    el.modelSelectBtn.onclick = (e) => {
      e.stopPropagation();
      el.modelDropdown.classList.toggle('hidden');
    };
    document.addEventListener('click', () => {
      el.modelDropdown.classList.add('hidden');
    });

    // Rename Chat
    el.btnRenameChat.onclick = async () => {
      if (!state.activeChatId) return;
      const current = el.currentChatTitle.textContent;
      const newTitle = prompt('Rename conversation:', current);
      if (newTitle && newTitle.trim() && newTitle !== current) {
        await fetch(`/api/chats/${state.activeChatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        el.currentChatTitle.textContent = newTitle.trim();
        loadChats();
      }
    };

    // Export Chat (Download Markdown)
    el.btnExportChat.onclick = () => {
      if (!state.currentMessages || state.currentMessages.length === 0) {
        alert('No messages in this chat to export.');
        return;
      }
      let md = `# ${el.currentChatTitle.textContent}\n\n`;
      md += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;
      state.currentMessages.forEach((m) => {
        md += `### ${m.role === 'user' ? 'User' : 'Claude'}\n\n${m.content}\n\n---\n\n`;
      });

      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${el.currentChatTitle.textContent.replace(/[^a-z0-9]/gi, '_')}.md`;
      a.click();
      URL.revokeObjectURL(url);
    };

    // System Prompt Modal
    el.btnSystemPrompt.onclick = () => {
      el.systemPromptModal.classList.remove('hidden');
    };
    el.btnClosePromptModal.onclick = () => {
      el.systemPromptModal.classList.add('hidden');
    };
    el.btnSaveSystemPrompt.onclick = async () => {
      const promptVal = el.systemPromptInput.value.trim();
      if (state.activeChatId) {
        await fetch(`/api/chats/${state.activeChatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemPrompt: promptVal }),
        });
      }
      el.systemPromptModal.classList.add('hidden');
    };

    // Quick Personas
    document.querySelectorAll('.persona-tag').forEach((tag) => {
      tag.onclick = () => {
        el.systemPromptInput.value = tag.getAttribute('data-prompt');
      };
    });

    // Admin Dashboard Modal
    el.btnAdminPanel.onclick = async () => {
      el.adminModal.classList.remove('hidden');
      try {
        const res = await fetch('/api/admin/stats');
        if (res.ok) {
          const data = await res.json();
          renderAdminStats(data.stats);
        }
      } catch (err) {
        console.error('Failed to load admin stats:', err);
      }
    };
    el.btnCloseAdminModal.onclick = () => {
      el.adminModal.classList.add('hidden');
    };

    // Input Handling
    el.promptInput.addEventListener('input', () => {
      adjustTextareaHeight();
      updateCharCounter();
      el.btnSend.disabled = el.promptInput.value.trim().length === 0 || state.isStreaming;
    });

    el.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    el.btnSend.onclick = sendMessage;

    // Stop Streaming
    el.btnStopStream.onclick = () => {
      if (state.abortController) {
        state.abortController.abort();
      }
    };

    // Suggestion Cards
    document.querySelectorAll('.suggestion-card').forEach((card) => {
      card.onclick = () => {
        const prompt = card.getAttribute('data-prompt');
        el.promptInput.value = prompt;
        adjustTextareaHeight();
        updateCharCounter();
        el.btnSend.disabled = false;
        el.promptInput.focus();
      };
    });
  }

  function adjustTextareaHeight() {
    el.promptInput.style.height = 'auto';
    el.promptInput.style.height = `${Math.min(el.promptInput.scrollHeight, 220)}px`;
  }

  function updateCharCounter() {
    const len = el.promptInput.value.length;
    el.charCounter.textContent = `${len.toLocaleString()} / 50,000`;
    if (len > 45000) {
      el.charCounter.style.color = '#DC2626';
    } else {
      el.charCounter.style.color = 'var(--text-dim)';
    }
  }

  function renderAdminStats(stats) {
    el.adminTotalUsers.textContent = stats.totalUsers || 0;
    el.adminTotalChats.textContent = stats.totalChats || 0;

    let totalTokensToday = 0;
    el.adminUsersTable.innerHTML = '';

    stats.users.forEach((u) => {
      const tokensToday = u.todayUsage ? u.todayUsage.totalTokens : 0;
      totalTokensToday += tokensToday;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="badge-internal">${u.role}</span></td>
        <td>${tokensToday.toLocaleString()}</td>
        <td>${u.todayUsage ? u.todayUsage.requestCount : 0}</td>
        <td>${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</td>
      `;
      el.adminUsersTable.appendChild(tr);
    });

    el.adminTotalTokensToday.textContent = totalTokensToday.toLocaleString();
  }

  // Start app on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
