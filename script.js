// 0. FIREBASE INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyBnBaB7eTU8G70Q57cpISkL4hyXlwqvY_0",
  authDomain: "edumate-ai-198b4.firebaseapp.com",
  projectId: "edumate-ai-198b4",
  storageBucket: "edumate-ai-198b4.firebasestorage.app",
  messagingSenderId: "430698606885",
  appId: "1:430698606885:web:469b79664342b6dcb4aacc",
  measurementId: "G-WYZ4WQTMND"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// 1. GLOBAL STATE
let tasks = [];
let currentUser = null;

// DOM Elements
const authOverlay = document.getElementById('authOverlay');
const appMain = document.getElementById('appMain');
const authError = document.getElementById('authError');
const loginEmail = document.getElementById('loginEmail');
const loginPass = document.getElementById('loginPassword');
const signupEmail = document.getElementById('signupEmail');
const signupPass = document.getElementById('signupPassword');
const chatHistory = document.getElementById('chatHistory');
const chatInput = document.getElementById('chatInput');
const apiKeyInput = document.getElementById('geminiApiKey');

// 2. AUTHENTICATION LOGIC
auth.onAuthStateChanged(user => {
    if (user) {
        // User is logged in
        currentUser = user;
        authOverlay.classList.remove('active');
        appMain.classList.remove('blur-screen');
        loadUserData();
    } else {
        // User is logged out
        currentUser = null;
        authOverlay.classList.add('active');
        appMain.classList.add('blur-screen');
        tasks = [];
        renderTasks();
        chatHistory.innerHTML = ''; // Clear chat
    }
});

// Switch to Signup
document.getElementById('toSignup').onclick = () => {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('signupForm').classList.remove('hidden');
    document.getElementById('authSubtitle').innerText = "Create your EduMate account";
};

// Switch to Login
document.getElementById('toLogin').onclick = () => {
    document.getElementById('signupForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('authSubtitle').innerText = "Join your personalized student assistant";
};

// Handle Login
document.getElementById('loginBtn').onclick = async () => {
    const email = loginEmail.value.trim();
    const pass = loginPass.value;
    if (!email || !pass) return showAuthError("Please fill in all fields.");
    try {
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
        showAuthError(err.message);
    }
};

// Handle Signup
document.getElementById('signupBtn').onclick = async () => {
    const email = signupEmail.value.trim();
    const pass = signupPass.value;
    if (!email || pass.length < 6) return showAuthError("Email required and password must be 6+ characters.");
    try {
        await auth.createUserWithEmailAndPassword(email, pass);
    } catch (err) {
        showAuthError(err.message);
    }
};

// Handle Logout
document.getElementById('logoutBtn').onclick = () => auth.signOut();

function showAuthError(msg) {
    authError.innerText = msg;
    authError.classList.remove('hidden');
}

// 3. USER DATA PERSISTENCE (Scoped by UID)
function loadUserData() {
    if (!currentUser) return;
    const uid = currentUser.uid;
    
    // Load Tasks for this specific user
    tasks = JSON.parse(localStorage.getItem(`tasks_${uid}`)) || [];
    renderTasks();
    
    // Load Gemini API Key for this specific user
    const savedKey = localStorage.getItem(`api_key_${uid}`);
    if (savedKey) apiKeyInput.value = savedKey;
}

function saveTasks() {
    if (!currentUser) return;
    localStorage.setItem(`tasks_${currentUser.uid}`, JSON.stringify(tasks));
}

// 4. NAVIGATION LOGIC
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        if (item.classList.contains('logout-btn')) return;

        // Update active nav
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Update active view
        const targetId = item.getAttribute('data-target');
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');

        if (targetId === 'spots-view') setTimeout(initMap, 200);
    });
});

// 5. AI CHAT MODULE (Context-Aware & Autonomous)
async function callGeminiAPI(text) {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        addMessage("⚠️ Please enter your Gemini API Key in the box above!", false);
        return;
    }

    // Save key specifically for the current user
    if (currentUser) localStorage.setItem(`api_key_${currentUser.uid}`, apiKey);

    // Show loading indicator
    const loadingId = 'loading-' + Date.now();
    const loadBubble = document.createElement('div');
    loadBubble.id = loadingId;
    loadBubble.className = 'message-bubble ai-bubble';
    loadBubble.innerHTML = `<div class="bubble-content"><div class="typing-indicator">Typing...</div></div>`;
    chatHistory.appendChild(loadBubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    try {
        const now = new Date();
        const pendingTasks = tasks.filter(t => new Date(t.deadline) > now);
        let taskContext = "The student currently has NO upcoming tasks.";
        if (pendingTasks.length > 0) {
            taskContext = "The student has the following upcoming deadlines:\n" + pendingTasks.map(t => `- ${t.title} (Due: ${new Date(t.deadline).toLocaleString()})`).join('\n');
        }

        const systemPrompt = `System Instructions: You are a highly intelligent student assistant. Current Time: ${now.toLocaleString()}.
${taskContext}

Rules:
1. Alert for urgent deadlines.
2. Suggest study plans.
3. If user says to add a task/reminder, MUST include: [ADD_TASK: Task Name | YYYY-MM-DDTHH:MM] somewhere in your reply.`;

        const requestBody = {
            contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nUser Query: ${text}` }] }]
        };

        const models = ['gemini-flash-latest', 'gemini-1.5-flash', 'gemini-pro'];
        let res;

        for (const model of models) {
            res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            if (res.ok) break;
        }

        if (!res || !res.ok) throw new Error("API failed to respond.");

        const data = await res.json();
        let aiText = data.candidates[0].content.parts[0].text;
        
        // AUTO-SAVE TASKS FROM AI
        const taskRegex = /\[ADD_TASK:\s*(.+?)\s*\|\s*(.+?)\]/g;
        let match;
        let count = 0;
        while ((match = taskRegex.exec(aiText)) !== null) {
            tasks.push({ id: 't-'+Date.now()+Math.random(), title: match[1], deadline: match[2] });
            count++;
        }
        
        if (count > 0) {
            saveTasks();
            renderTasks();
            aiText = aiText.replace(/\[ADD_TASK:.*?\]/g, '').trim() + `\n\n*(✅ I have automatically saved ${count} task(s) to your personal account!)*`;
        }

        document.getElementById(loadingId).remove();
        addMessage(aiText, false);
    } catch (err) {
        document.getElementById(loadingId).remove();
        addMessage("❌ Error: " + err.message, false);
    }
}

function addMessage(text, isUser) {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isUser ? 'user-bubble' : 'ai-bubble'}`;
    bubble.innerHTML = `<div class="bubble-content">${isUser ? text : marked.parse(text)}</div>`;
    chatHistory.appendChild(bubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

document.getElementById('sendMessageBtn').onclick = () => {
    const val = chatInput.value.trim();
    if (!val) return;
    addMessage(val, true);
    chatInput.value = '';
    callGeminiAPI(val);
};

// 6. TASKS & SCHEDULE LOGIC
const taskListContainer = document.getElementById('taskList');
function renderTasks() {
    if (!taskListContainer) return;
    if (tasks.length === 0) {
        taskListContainer.innerHTML = '<div class="empty-state">No upcoming tasks!</div>';
        return;
    }
    taskListContainer.innerHTML = '';
    [...tasks].sort((a,b)=>new Date(a.deadline)-new Date(b.deadline)).forEach(task => {
        const d = new Date(task.deadline);
        const card = document.createElement('div');
        card.className = 'task-card';
        card.innerHTML = `
            <div class="task-info">
                <div class="task-time">${d.toLocaleDateString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
                <h3>${task.title}</h3>
            </div>
            <div class="task-actions">
                <button class="btn-icon" onclick="openGoogleCalendar('${task.title}', '${task.deadline}')" title="Add to Calendar">
                    <span class="material-symbols-outlined">event</span>
                </button>
                <button class="btn-icon" onclick="removeTask('${task.id}')" title="Delete">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>`;
        taskListContainer.appendChild(card);
    });
}

function openGoogleCalendar(title, deadline) {
    const formatDate = (date) => new Date(date).toISOString().replace(/-|:|\.\d+/g, '').substring(0,15) + 'Z';
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${formatDate(deadline)}/${formatDate(new Date(new Date(deadline).getTime()+3600000))}`;
    window.open(url, '_blank');
}

window.removeTask = (id) => { tasks = tasks.filter(x => x.id !== id); saveTasks(); renderTasks(); };

document.getElementById('addTaskBtn').onclick = () => {
    const title = document.getElementById('taskTitle').value;
    const deadline = document.getElementById('taskDeadline').value;
    if (!title || !deadline) return;
    tasks.push({ id: 't-'+Date.now(), title, deadline });
    saveTasks(); renderTasks();
};

// 7. MAPS LOGIC
let map, markerGroup;
function initMap() {
    if (map) return;
    map = L.map('mapContainer').setView([20, 78], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    markerGroup = L.layerGroup().addTo(map);
    navigator.geolocation.getCurrentPosition(p => {
        const lat = p.coords.latitude, lon = p.coords.longitude;
        map.setView([lat, lon], 14);
        fetchSpots(lat, lon, 'library');
    }, () => fetchSpots(20, 78, 'library'));
}

async function fetchSpots(lat, lon, type) {
    const query = `[out:json];node["amenity"="${type}"](around:5000,${lat},${lon});out;`;
    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
    const data = await res.json();
    markerGroup.clearLayers();
    data.elements.forEach(node => {
        L.marker([node.lat, node.lon]).addTo(markerGroup).bindPopup(node.tags.name || type);
    });
}

document.querySelectorAll('.btn-filter').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.btn-filter').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        if (map) fetchSpots(map.getCenter().lat, map.getCenter().lng, btn.getAttribute('data-type'));
    };
});
