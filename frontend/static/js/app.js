// State
const state = {
    isLoggedIn: document.cookie.includes('session_token'),
    user: null, // Current logged in user
    users: [], // List of all users
    activeChatUser: null, // ID of user we are chatting with
    socket: null,
    chatOffset: 0,
    chatLoading: false
};

// DOM Elements
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logout-btn');

const CATEGORIES = ["General", "Tech", "Random"];

// Initialization
function initApp() {
    if (state.isLoggedIn) {
        logoutBtn.style.display = 'block';
        fetchUserInfo();
        initWebSocket();
        renderHome();
    } else {
        renderLogin();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function fetchUserInfo() {
    // Optional: Fetch self profile
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    state.socket.onopen = () => { console.log("Connected to WebSocket"); };
    state.socket.onmessage = (event) => { handleWsMessage(JSON.parse(event.data)); };
    state.socket.onclose = () => { console.log("Disconnected from WebSocket"); };
}

function handleWsMessage(msg) {
    if (msg.type === 'status') {
        updateUserStatus(msg.user_id, msg.online);
    } else if (msg.type === 'message') {
        if (state.activeChatUser === msg.sender_id || state.activeChatUser === msg.receiver_id) {
            appendMessage(msg);
        } else {
            markUserUnread(msg.sender_id);
        }
    }
}

function updateUserStatus(userId, online) {
    const el = document.getElementById(`user-status-${userId}`);
    if (el) { el.style.color = online ? '#00ff00' : '#888'; el.innerText = online ? '●' : '○'; }
}

function markUserUnread(userId) {
    const el = document.getElementById(`user-name-${userId}`);
    if (el) { el.style.fontWeight = 'bold'; el.style.color = '#bb86fc'; }
}

// Throttling function
function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

async function renderChat(targetUserId, nickname) {
    state.activeChatUser = targetUserId;
    state.chatOffset = 0;

    const el = document.getElementById(`user-name-${targetUserId}`);
    if (el) { el.style.fontWeight = 'normal'; el.style.color = 'inherit'; }

    const chatContainer = document.getElementById('chat-view');
    if (!chatContainer) return;

    chatContainer.innerHTML = `
        <div class="card" style="height: 100%; display: flex; flex-direction: column; padding: 0;">
            <div style="padding: 1rem; border-bottom: 1px solid #444; font-weight: bold; background: #2d2d2d;">
                Chat with ${nickname}
                <button onclick="closeChat()" style="float: right; background: none; border: none; color: #888; cursor: pointer;">X</button>
            </div>
            <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column-reverse;">
                <!-- Messages go here -->
            </div>
            <form id="chat-form" style="padding: 1rem; border-top: 1px solid #444; background: #222;">
                <div style="display: flex; gap: 0.5rem;">
                    <input type="text" name="content" autocomplete="off" placeholder="Type a message..." style="flex: 1; padding: 0.8rem; background: #000; border: 1px solid #444; color: #e0e0e0;">
                    <button type="submit" class="btn" style="width: auto; margin: 0; padding: 0.8rem 1.5rem;">Send</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = e.target.elements.content;
        const text = input.value;
        if (!text) return;

        const payload = { type: "message", receiver_id: targetUserId, content: text };
        state.socket.send(JSON.stringify(payload));
        input.value = '';
    });

    const msgList = document.getElementById('chat-messages');
    msgList.addEventListener('scroll', throttle(handleScroll, 300));

    await loadChatHistory(targetUserId);
}

async function handleScroll() {
    const list = document.getElementById('chat-messages');
    if (Math.abs(list.scrollTop) > (list.scrollHeight - list.clientHeight - 50)) {
        if (!state.chatLoading) {
            loadChatHistory(state.activeChatUser);
        }
    }
}

async function loadChatHistory(targetUserId) {
    if (state.chatLoading) return;
    state.chatLoading = true;

    const list = document.getElementById('chat-messages');
    try {
        const response = await fetch(`/api/messages?user_id=${targetUserId}&offset=${state.chatOffset}`);
        const messages = await response.json();

        if (messages && messages.length > 0) {
            state.chatOffset += messages.length;
            const html = messages.map(msg => formatMessage(msg)).join('');
            list.insertAdjacentHTML('beforeend', html);
        }
    } catch (e) {
        console.error(e);
    } finally {
        state.chatLoading = false;
    }
}

function appendMessage(msg) {
    const list = document.getElementById('chat-messages');
    if (list) {
        list.insertAdjacentHTML('afterbegin', formatMessage(msg));
    }
}

function formatMessage(msg) {
    const isThem = msg.sender_id === state.activeChatUser;
    const align = isThem ? 'flex-start' : 'flex-end';
    const bg = isThem ? '#444' : '#bb86fc';
    const color = isThem ? '#e0e0e0' : '#000';

    let nickname = "User " + msg.sender_id;
    if (isThem) {
        const u = state.users.find(u => u.id === msg.sender_id);
        if (u) nickname = u.nickname;
    } else {
        nickname = "Me";
    }

    return `
        <div style="display: flex; justify-content: ${align}; margin-bottom: 0.5rem; width: 100%;">
            <div style="background: ${bg}; color: ${color}; padding: 0.5rem 1rem; border-radius: 4px; max-width: 70%; word-break: break-word;">
                <div style="font-size: 0.7rem; font-weight: bold; margin-bottom: 0.2rem; opacity: 0.8;">${nickname}</div>
                ${msg.content}
                <div style="font-size: 0.6rem; opacity: 0.7; text-align: right; margin-top: 0.2rem;">
                    ${new Date(msg.created_at || msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>
        </div>
    `;
}
function formatMessageContent(msg) { return formatMessage(msg); }

function closeChat() {
    state.activeChatUser = null;
    document.getElementById('chat-view').innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#666;">Select a user to chat</div>';
}

async function renderHome() {
    app.innerHTML = `
        <div class="container" style="display: flex; align-items: flex-start; gap: 1rem; max-width: 1200px;">
            <div class="card" style="width: 250px; flex-shrink: 0; padding: 1rem; height: 80vh; overflow-y: auto;">
                <h3 style="margin-bottom: 1rem; color: #bb86fc;">Users</h3>
                <div id="user-list">Loading...</div>
            </div>

            <div style="flex: 1; width: 100%;">
                <div id="chat-view" style="margin-bottom: 2rem; height: 400px; display: block;">
                    <div style="height:100%; display:flex; align-items:center; justify-content:center; color:#666; border: 1px dashed #444;">Select a user to chat</div>
                </div>

                <div class="card" style="margin-bottom: 2rem;">
                    <h2>Create Post</h2>
                    <div id="home-error" class="error-msg"></div>
                    <form id="create-post-form">
                        <div class="input-group">
                            <label>Title</label>
                            <input type="text" name="title" required>
                        </div>
                        <div class="input-group">
                            <label>Category</label>
                            <select name="category" style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;">
                                ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                            </select>
                        </div>
                        <div class="input-group">
                            <label>Content</label>
                            <textarea name="content" rows="4" style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;" required></textarea>
                        </div>
                        <button type="submit" class="btn">Post</button>
                    </form>
                </div>

                <div id="posts-container" class="post-list">
                    <p>Loading posts...</p>
                </div>
            </div>
        </div>
    `;

    document.getElementById('create-post-form').addEventListener('submit', handleCreatePost);
    loadPosts();
    await loadUsers(); // Await this!
}

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        state.users = users;

        const list = document.getElementById('user-list');
        list.innerHTML = users.map(u => `
            <div onclick="renderChat(${u.id}, '${u.nickname}')" style="cursor: pointer; padding: 0.5rem; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
                <span id="user-name-${u.id}">${u.nickname}</span>
                <span id="user-status-${u.id}" style="color: #888;">○</span>
            </div>
        `).join('');
    } catch (e) {
        console.error(e);
    }
}

async function loadPosts() {
    const container = document.getElementById('posts-container');
    try {
        const response = await fetch('/api/posts');
        if (!response.ok) throw new Error('Failed to load posts');

        const posts = await response.json();
        if (!posts || posts.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #888;">No posts yet. Be the first!</p>';
            return;
        }

        container.innerHTML = posts.map(post => `
            <div class="post">
                <div class="post-header">
                    <span>${post.nickname}</span>
                    <span>${new Date(post.created_at).toLocaleString()}</span>
                </div>
                <h3 style="margin: 0.5rem 0; color: #bb86fc;">${post.title} <span style="font-size: 0.8em; color: #e0e0e0; border: 1px solid #666; padding: 2px 6px; border-radius: 4px; margin-left: 10px;">${post.category}</span></h3>
                <p>${post.content}</p>
                 <button class="btn-link" style="text-align: left; margin: 0; padding: 0;" onclick='renderPostDetail(${JSON.stringify(post).replace(/'/g, "&#39;")})'>View Comments</button>
            </div>
        `).join('');

    } catch (e) {
        if (container) container.innerHTML = `<p class="error-msg" style="display:block;">Error loading posts: ${e.message}</p>`;
    }
}

async function renderPostDetail(post) {
    app.innerHTML = `
         <div class="container" style="display: block;">
            <button class="btn-link" style="text-align: left; margin-bottom: 1rem;" onclick="renderHome()">← Back to Feed</button>
            <div class="card" style="margin-bottom: 2rem; border-color: #bb86fc;">
                <div class="post-header">
                    <span>${post.nickname}</span>
                    <span>${new Date(post.created_at).toLocaleString()}</span>
                </div>
                <h2 style="margin: 0.5rem 0; border: none;">${post.title} <span style="font-size: 0.6em; color: #e0e0e0; border: 1px solid #666; padding: 2px 6px; border-radius: 4px; vertical-align: middle;">${post.category}</span></h2>
                <p style="font-size: 1.1rem; line-height: 1.5;">${post.content}</p>
            </div>
            <div class="card">
                <h3>Comments</h3>
                 <div id="comments-list" style="margin-bottom: 1rem;">
                    <p>Loading comments...</p>
                </div>
                <div id="comment-error" class="error-msg"></div>
                <form id="comment-form">
                    <input type="hidden" name="post_id" value="${post.id}">
                    <div class="input-group">
                        <textarea name="content" rows="2" placeholder="Write a comment..." style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;" required></textarea>
                    </div>
                    <button type="submit" class="btn" style="padding: 0.5rem;">Add Comment</button>
                </form>
            </div>
        </div>
    `;
    document.getElementById('comment-form').addEventListener('submit', (e) => handleCreateComment(e, post.id));
    loadComments(post.id);
}

async function loadComments(postId) {
    const list = document.getElementById('comments-list');
    try {
        const response = await fetch(`/api/comments?post_id=${postId}`);
        const comments = await response.json();
        if (!comments || comments.length === 0) {
            list.innerHTML = '<p style="color: #666; font-style: italic;">No comments yet.</p>';
            return;
        }
        list.innerHTML = comments.map(c => `
            <div style="border-bottom: 1px solid #444; padding: 0.5rem 0; margin-bottom: 0.5rem;">
                <div style="font-size: 0.8rem; color: #888; margin-bottom: 0.2rem;">
                    <span style="color: #bb86fc;">${c.nickname}</span> • ${new Date(c.created_at).toLocaleString()}
                </div>
                <p>${c.content}</p>
            </div>
         `).join('');
    } catch (e) {
        list.innerHTML = `<p class="error-msg">Error loading comments</p>`;
    }
}

function renderLogin() {
    app.innerHTML = `
        <div class="auth-box">
            <h2>Login</h2>
            <div id="error-box" class="error-msg"></div>
            <form id="login-form">
                <div class="input-group">
                    <label>Email or Nickname</label>
                    <input type="text" name="identifier" required>
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" name="password" required>
                </div>
                <button type="submit" class="btn">Login</button>
            </form>
            <p>Don't have an account? <button class="btn-link" onclick="renderRegister()">Register</button></p>
        </div>
    `;
    document.getElementById('login-form').addEventListener('submit', handleLogin);
}

function renderRegister() {
    app.innerHTML = `
        <div class="auth-box">
            <h2>Register</h2>
            <div id="error-box" class="error-msg"></div>
            <form id="register-form">
                <div class="input-group">
                    <label>Nickname</label>
                    <input type="text" name="nickname" required>
                </div>
                <div class="input-group">
                    <label>Age</label>
                    <input type="number" name="age" required>
                </div>
                <div class="input-group">
                    <label>Gender</label>
                    <select name="gender" style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>First Name</label>
                    <input type="text" name="first_name" required>
                </div>
                <div class="input-group">
                    <label>Last Name</label>
                    <input type="text" name="last_name" required>
                </div>
                <div class="input-group">
                    <label>Email</label>
                    <input type="email" name="email" required>
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" name="password" required>
                </div>
                <button type="submit" class="btn">Register</button>
            </form>
            <p>Already have an account? <button class="btn-link" onclick="renderLogin()">Login</button></p>
        </div>
    `;
    document.getElementById('register-form').addEventListener('submit', handleRegister);
}

// Handlers
async function handleLogin(e) { e.preventDefault(); submitAuthForm(e, '/api/login', () => { state.isLoggedIn = true; logoutBtn.style.display = 'block'; initWebSocket(); renderHome(); }); }
async function handleRegister(e) { e.preventDefault(); submitAuthForm(e, '/api/register', () => { alert('Success'); renderLogin(); }); }
async function handleCreateComment(e, postId) { e.preventDefault(); /* ... */ const formData = new FormData(e.target); const data = Object.fromEntries(formData.entries()); const errorBox = document.getElementById('comment-error'); data.post_id = parseInt(data.post_id); try { const response = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { e.target.reset(); loadComments(postId); } else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; } } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; } }
async function handleCreatePost(e) { e.preventDefault(); const formData = new FormData(e.target); const data = Object.fromEntries(formData.entries()); const errorBox = document.getElementById('home-error'); try { const response = await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { e.target.reset(); loadPosts(); } else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; } } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; } }

async function submitAuthForm(e, url, onSuccess) {
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    if (data.age) data.age = parseInt(data.age);
    const errorBox = document.getElementById('error-box');
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (response.ok) { onSuccess(); }
        else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; }
    } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; }
}

logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    document.cookie = 'session_token=; Max-Age=0; path=/;';
    state.isLoggedIn = false;
    logoutBtn.style.display = 'none';
    if (state.socket) state.socket.close();
    renderLogin();
});

// Expose globals
window.renderLogin = renderLogin;
window.renderRegister = renderRegister;
window.renderHome = renderHome;
window.renderPostDetail = renderPostDetail;
window.renderChat = renderChat;
window.closeChat = closeChat;
