import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, arrayUnion, arrayRemove, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Volleyball data ──────────────────────────────────────────────────────────

const POSITIONS = [
  { id: "oh",  label: "Outside Hitter"  },
  { id: "mb",  label: "Middle Blocker"  },
  { id: "opp", label: "Opposite / RS"   },
  { id: "set", label: "Setter"          },
  { id: "lib", label: "Libero / DS"     },
];

const STATS = ["Attacking", "Serving", "Passing", "Setting", "Blocking", "Defense"];
const STAT_COLORS = ["#D85A30", "#378ADD", "#1D9E75", "#7F77DD", "#BA7517", "#0F6E56"];
const ALL_PLAYERS_VIEW = "__all__";
const POSITION_VIEW_PREFIX = "__position__:";

const POSITION_WEIGHTS = {
  oh:  [1.0, 0.8, 0.9, 0.4, 0.7, 0.9],
  mb:  [0.9, 0.7, 0.5, 0.3, 1.0, 0.7],
  opp: [1.0, 0.9, 0.7, 0.3, 0.8, 0.8],
  set: [0.5, 0.7, 0.6, 1.0, 0.5, 0.7],
  lib: [0.0, 0.8, 1.0, 0.2, 0.0, 1.0],
};

const ACTIONS = [
  { id: "kill",         label: "Kill",          category: "attacking", stats: [0],    value:  10, positions: ["oh","mb","opp","set"] },
  { id: "tip",          label: "Tip / Dump",    category: "attacking", stats: [0],    value:   7, positions: ["oh","mb","opp","set"] },
  { id: "attack_err",   label: "Attack Error",  category: "attacking", stats: [0],    value:  -4, positions: ["oh","mb","opp","set"] },
  { id: "ace",          label: "Ace",           category: "serving",   stats: [1],    value:  10, positions: ["oh","mb","opp","set","lib"] },
  { id: "serve_in",     label: "Serve In",      category: "serving",   stats: [1],    value:   5, positions: ["oh","mb","opp","set","lib"] },
  { id: "serve_err",    label: "Serve Error",   category: "serving",   stats: [1],    value:  -3, positions: ["oh","mb","opp","set","lib"] },
  { id: "perfect_pass", label: "Perfect Pass",  category: "passing",   stats: [2],    value:  10, positions: ["oh","opp","lib"] },
  { id: "pass",         label: "Pass",          category: "passing",   stats: [2],    value:   5, positions: ["oh","opp","lib"] },
  { id: "pass_err",     label: "Pass Error",    category: "passing",   stats: [2],    value:  -3, positions: ["oh","opp","lib"] },
  { id: "assist",       label: "Assist",        category: "setting",   stats: [3],    value:  10, positions: ["set","oh","opp"] },
  { id: "set_good",     label: "Good Set",      category: "setting",   stats: [3],    value:   5, positions: ["set"] },
  { id: "set_err",      label: "Set Error",     category: "setting",   stats: [3],    value:  -3, positions: ["set"] },
  { id: "kill_block",   label: "Kill Block",    category: "blocking",  stats: [4, 5], value:  10, positions: ["oh","mb","opp","set"] },
  { id: "block_touch",  label: "Block Touch",   category: "blocking",  stats: [4],    value:   5, positions: ["oh","mb","opp","set"] },
  { id: "block_err",    label: "Block Error",   category: "blocking",  stats: [4],    value:  -2, positions: ["oh","mb","opp","set"] },
  { id: "dig",          label: "Dig",           category: "defense",   stats: [5],    value:  10, positions: ["oh","mb","opp","set","lib"] },
  { id: "dig_err",      label: "Dig Error",     category: "defense",   stats: [5],    value:  -3, positions: ["oh","mb","opp","set","lib"] },
];

// ─── App state ────────────────────────────────────────────────────────────────

let currentUser     = null;
let currentMatchId  = null;
let currentMatchDoc = null;   // cached Firestore match data
let currentPosition = "oh";
let viewingPlayer   = ALL_PLAYERS_VIEW;   // uid, "__all__", or "__position__:id"
let chart;

// ─── Auth guard ───────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  await ensureUserProfile(user);
  document.getElementById("nav-username").textContent = user.displayName || user.email;
  buildPositionTabs();
  buildActionGrid();
  initChart();
  renderStatBars([0,0,0,0,0,0]);
});

window.logout = () => signOut(auth);

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  const normalizedEmail = user.email.toLowerCase();
  const displayName = user.displayName || user.email;
  const userData = userSnap.exists() ? userSnap.data() : {};

  await setDoc(userRef, {
    uid: user.uid,
    displayName,
    email: normalizedEmail,
    friends: userData.friends || [],
    createdAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, "userEmails", emailKey(normalizedEmail)), {
    uid: user.uid,
    email: normalizedEmail,
  }, { merge: true });
}

function emailKey(email) {
  return email.toLowerCase().replace(/\./g, ",");
}

async function findUserByEmail(email) {
  const emailSnap = await getDoc(doc(db, "userEmails", emailKey(email)));
  if (emailSnap.exists()) {
    const uid = emailSnap.data().uid;
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) return userSnap;
  }

  const q = query(collection(db, "users"), where("email", "==", email));
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0];
}

async function getMyUserData() {
  await ensureUserProfile(currentUser);
  const myDocSnap = await getDoc(doc(db, "users", currentUser.uid));
  if (!myDocSnap.exists()) {
    throw new Error("Your profile could not be created in Firestore.");
  }
  return myDocSnap.data();
}
// ─── Side panels ─────────────────────────────────────────────────────────────

window.showPanel = function(name) {
  document.querySelectorAll(".side-panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("overlay").classList.remove("hidden");
  document.getElementById(`panel-${name}`).classList.remove("hidden");
  if (name === "friends") loadFriendsPanel();
  if (name === "matches") loadMatchesPanel();
};

window.closePanel = function() {
  document.querySelectorAll(".side-panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("overlay").classList.add("hidden");
};

// ─── Friends ──────────────────────────────────────────────────────────────────

// ─── Send Friend Request / Add Friend ─────────────────────────────────────────

window.sendFriendRequest = async function() {
  const emailInput = document.getElementById("friend-email").value.trim();
  const msgEl = document.getElementById("friend-msg");
  msgEl.textContent = "";

  if (!emailInput) return;
  
  // Force lowercase to match the exact format saved during signup in auth.js
  const targetEmail = emailInput.toLowerCase();

  if (targetEmail === currentUser.email.toLowerCase()) {
    msgEl.textContent = "That's your own email."; 
    return;
  }

  try {
    await ensureUserProfile(currentUser);
    const targetDoc = await findUserByEmail(targetEmail);
    
    if (!targetDoc) { 
      msgEl.textContent = "No profile found for that email. Ask them to log in once, then try again."; 
      return; 
    }

    // 2. Safely grab the target user's data and internal UID field
    const targetData = targetDoc.data();
    const targetUid = targetData.uid || targetDoc.id; 

    // 3. Get your own document data to check friendship status
    const myData = await getMyUserData();
    const myFriendsList = myData.friends || [];

    // Check if you are already friends
    if (myFriendsList.includes(targetUid)) {
      msgEl.textContent = "You're already friends."; 
      return;
    }

    // 4. Create the formal pending request document
    await setDoc(doc(db, "friendRequests", `${currentUser.uid}_${targetUid}`), {
      from:          currentUser.uid,
      fromName:      currentUser.displayName || currentUser.email,
      fromEmail:     currentUser.email,
      to:            targetUid,
      toEmail:       targetEmail,
      status:        "pending",
      createdAt:     serverTimestamp(),
    });

    msgEl.textContent = `Friend request sent to ${targetData.displayName}.`;
    document.getElementById("friend-email").value = "";

  } catch (error) {
    console.error("Error sending friend request:", error);
    msgEl.textContent = "An error occurred. Please check your browser console.";
  }
};

async function loadFriendsPanel() {
  await loadPendingRequests();
  await loadFriendsList();
}

async function loadPendingRequests() {
  const list = document.getElementById("pending-list");
  list.innerHTML = "";

  const q = query(collection(db, "friendRequests"),
    where("to", "==", currentUser.uid), where("status", "==", "pending"));
  const snap = await getDocs(q);

  if (snap.empty) {
    list.innerHTML = "<li class='empty'>No pending requests.</li>"; return;
  }

  snap.forEach(d => {
    const req = d.data();
    const li = document.createElement("li");
    li.className = "friend-item";
    li.innerHTML = `
      <span class="friend-name">${req.fromName} <span class="friend-email">${req.fromEmail}</span></span>
      <div class="friend-actions">
        <button class="btn-small accept" onclick="acceptRequest('${d.id}', '${req.from}')">Accept</button>
        <button class="btn-small decline" onclick="declineRequest('${d.id}')">Decline</button>
      </div>`;
    list.appendChild(li);
  });
}

window.acceptRequest = async function(reqId, fromUid) {
  // Mutually add each other as friends
  await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayUnion(fromUid) });
  await updateDoc(doc(db, "users", fromUid),         { friends: arrayUnion(currentUser.uid) });
  await deleteDoc(doc(db, "friendRequests", reqId));
  loadFriendsPanel();
};

window.declineRequest = async function(reqId) {
  await deleteDoc(doc(db, "friendRequests", reqId));
  loadFriendsPanel();
};

async function loadFriendsList() {
  const list = document.getElementById("friends-list");
  list.innerHTML = "";

  const mySnap = await getDoc(doc(db, "users", currentUser.uid));
  const friendUids = mySnap.data().friends || [];

  if (friendUids.length === 0) {
    list.innerHTML = "<li class='empty'>No friends yet.</li>"; return;
  }

  for (const uid of friendUids) {
    const fSnap = await getDoc(doc(db, "users", uid));
    if (!fSnap.exists()) continue;
    const f = fSnap.data();
    const li = document.createElement("li");
    li.className = "friend-item";
    li.innerHTML = `
      <span class="friend-name">${f.displayName} <span class="friend-email">${f.email}</span></span>
      <button class="btn-small decline" onclick="removeFriend('${uid}')">Remove</button>`;
    list.appendChild(li);
  }
}

window.removeFriend = async function(uid) {
  await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayRemove(uid) });
  await updateDoc(doc(db, "users", uid),             { friends: arrayRemove(currentUser.uid) });
  loadFriendsPanel();
};

// Matches

window.createMatch = async function() {
  const name = document.getElementById("match-name-input").value.trim();
  if (!name) return;

  const ref = await addDoc(collection(db, "matches"), {
    name,
    ownerUid:    currentUser.uid,
    ownerName:   currentUser.displayName,
    sharedWith:  [],                        // array of uids
    players:     {},                        // { uid: { displayName, position, rawScores[] } }
    actionLog:   [],                        // array of log entries
    createdAt:   serverTimestamp(),
  });

  document.getElementById("match-name-input").value = "";
  loadMatch(ref.id, name);
  loadMatchesPanel();
};

async function loadMatchesPanel() {
  await loadMyMatches();
  await loadSharedMatches();
}

async function loadMyMatches() {
  const list = document.getElementById("matches-list");
  list.innerHTML = "";

  const q = query(collection(db, "matches"), where("ownerUid", "==", currentUser.uid));
  const snap = await getDocs(q);

  if (snap.empty) { list.innerHTML = "<li class='empty'>No matches yet.</li>"; return; }

  snap.forEach(d => {
    const li = document.createElement("li");
    li.className = "match-item" + (d.id === currentMatchId ? " active" : "");
    li.innerHTML = `<span class="match-name">${d.data().name}</span>
      <button class="btn-small" onclick="loadMatch('${d.id}', '${d.data().name.replace(/'/g,"\\'")}')">Open</button>`;
    list.appendChild(li);
  });
}

async function loadSharedMatches() {
  const list = document.getElementById("shared-list");
  list.innerHTML = "";

  const q = query(collection(db, "matches"), where("sharedWith", "array-contains", currentUser.uid));
  const snap = await getDocs(q);

  if (snap.empty) { list.innerHTML = "<li class='empty'>None shared with you.</li>"; return; }

  snap.forEach(d => {
    const li = document.createElement("li");
    li.className = "match-item" + (d.id === currentMatchId ? " active" : "");
    li.innerHTML = `<span class="match-name">${d.data().name} <span class="owner-tag">by ${d.data().ownerName}</span></span>
      <button class="btn-small" onclick="loadMatch('${d.id}', '${d.data().name.replace(/'/g,"\\'")}')">Open</button>`;
    list.appendChild(li);
  });
}

window.loadMatch = async function(matchId, matchName) {
  currentMatchId = matchId;
  const snap = await getDoc(doc(db, "matches", matchId));
  currentMatchDoc = snap.data();
  normalizeMatchPlayers();

  document.getElementById("match-title").textContent = matchName;
  document.getElementById("match-meta").textContent  =
    `Owner: ${currentMatchDoc.ownerName} · ${currentMatchDoc.sharedWith.length} collaborator(s)`;

  document.getElementById("share-btn").style.display   = "inline-block";
  document.getElementById("refresh-btn").style.display = "inline-block";

  // Make sure this user exists in players map
  if (!currentMatchDoc.players[currentUser.uid]) {
    await updateDoc(doc(db, "matches", matchId), {
      [`players.${currentUser.uid}`]: {
        displayName: currentUser.displayName,
        position:    currentPosition,
        positionScores: createEmptyPositionScores(),
        rawScores:   [0,0,0,0,0,0],
      }
    });
    currentMatchDoc.players[currentUser.uid] = {
      displayName: currentUser.displayName,
      position: currentPosition,
      positionScores: createEmptyPositionScores(),
      rawScores: [0,0,0,0,0,0],
    };
  }

  rebuildPlayerSelect();
  renderLog();
  updateChart();
  closePanel();
};

window.refreshStats = async function() {
  if (!currentMatchId) return;
  const snap = await getDoc(doc(db, "matches", currentMatchId));
  currentMatchDoc = snap.data();
  normalizeMatchPlayers();
  rebuildPlayerSelect();
  renderLog();
  updateChart();
};

// Share modal

window.openShareModal = async function() {
  if (!currentMatchId) return;
  document.getElementById("share-modal").classList.remove("hidden");
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("share-msg").textContent = "";

  const list = document.getElementById("share-friends-list");
  list.innerHTML = "";

  const mySnap = await getDoc(doc(db, "users", currentUser.uid));
  const friendUids = mySnap.data().friends || [];

  if (friendUids.length === 0) {
    list.innerHTML = "<li class='empty'>Add friends first.</li>"; return;
  }

  const alreadyShared = currentMatchDoc.sharedWith || [];

  for (const uid of friendUids) {
    const fSnap = await getDoc(doc(db, "users", uid));
    if (!fSnap.exists()) continue;
    const f = fSnap.data();
    const isShared = alreadyShared.includes(uid);
    const li = document.createElement("li");
    li.className = "friend-item";
    li.innerHTML = `
      <span class="friend-name">${f.displayName}</span>
      <button class="btn-small ${isShared ? "decline" : "accept"}"
        onclick="toggleShare('${uid}', '${f.displayName}', ${isShared})">
        ${isShared ? "Unshare" : "Share"}
      </button>`;
    list.appendChild(li);
  }
};

window.toggleShare = async function(uid, name, isShared) {
  const ref = doc(db, "matches", currentMatchId);
  if (isShared) {
    await updateDoc(ref, { sharedWith: arrayRemove(uid) });
    document.getElementById("share-msg").textContent = `Unshared from ${name}.`;
  } else {
    await updateDoc(ref, { sharedWith: arrayUnion(uid) });
    document.getElementById("share-msg").textContent = `Shared with ${name}.`;
  }
  const snap = await getDoc(ref);
  currentMatchDoc = snap.data();
  openShareModal();
};

window.closeShareModal = function() {
  document.getElementById("share-modal").classList.add("hidden");
  document.getElementById("modal-overlay").classList.add("hidden");
};

// Player select / view

function rebuildPlayerSelect() {
  const sel = document.getElementById("player-select");
  const previousView = viewingPlayer;
  sel.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = ALL_PLAYERS_VIEW;
  allOpt.textContent = "All players";
  sel.appendChild(allOpt);

  const positionGroup = document.createElement("optgroup");
  positionGroup.label = "Positions";
  POSITIONS.forEach(pos => {
    const count = getPlayersByPosition(pos.id).length;
    const opt = document.createElement("option");
    opt.value = POSITION_VIEW_PREFIX + pos.id;
    opt.textContent = `${pos.label} (${count})`;
    positionGroup.appendChild(opt);
  });
  sel.appendChild(positionGroup);

  const playerGroup = document.createElement("optgroup");
  playerGroup.label = "Players";

  Object.entries(currentMatchDoc.players || {}).forEach(([uid, p]) => {
    const opt = document.createElement("option");
    opt.value = uid;
    opt.textContent = `${p.displayName} - ${getPositionLabel(p.position)}${uid === currentUser.uid ? " (you)" : ""}`;
    playerGroup.appendChild(opt);
  });
  sel.appendChild(playerGroup);

  // Set position to what's stored for current user
  const myPlayer = currentMatchDoc.players[currentUser.uid];
  if (myPlayer) {
    currentPosition = myPlayer.position || "oh";
    buildPositionTabs();
    buildActionGrid();
  }

  const hasPreviousView = Array.from(sel.options).some(opt => opt.value === previousView);
  viewingPlayer = hasPreviousView ? previousView : ALL_PLAYERS_VIEW;
  sel.value = viewingPlayer;
}

window.switchViewPlayer = function() {
  viewingPlayer = document.getElementById("player-select").value;
  updateChart();
};

function getPositionLabel(positionId) {
  return POSITIONS.find(pos => pos.id === positionId)?.label || "Unassigned";
}

function getPlayersByPosition(positionId) {
  return Object.values(currentMatchDoc?.players || {})
    .filter(player => (player.position || "oh") === positionId);
}

// Position tabs

function buildPositionTabs() {
  const container = document.getElementById("position-tabs");
  container.innerHTML = "";
  POSITIONS.forEach(pos => {
    const btn = document.createElement("button");
    btn.textContent = pos.label;
    btn.className = "pos-tab" + (pos.id === currentPosition ? " active" : "");
    btn.addEventListener("click", async () => {
      currentPosition = pos.id;
      if (currentMatchDoc?.players?.[currentUser.uid]) {
        currentMatchDoc.players[currentUser.uid].position = pos.id;
      }
      buildPositionTabs();
      buildActionGrid();
      if (currentMatchId) {
        await updateDoc(doc(db, "matches", currentMatchId), {
          [`players.${currentUser.uid}.position`]: pos.id
        });
        rebuildPlayerSelect();
        updateChart();
      }
    });
    container.appendChild(btn);
  });
}

// Action grid

function buildActionGrid() {
  const grid = document.getElementById("action-grid");
  grid.innerHTML = "";
  const loggingAs = document.getElementById("player-logging-as");
  loggingAs.textContent = currentMatchId
    ? `Logging as: ${currentUser.displayName} - ${getPositionLabel(currentPosition)}`
    : "Open a match to start logging.";

  ACTIONS.filter(a => a.positions.includes(currentPosition)).forEach(action => {
    const btn = document.createElement("button");
    btn.className = `action-btn cat-${action.category}`;
    btn.disabled = !currentMatchId;
    btn.innerHTML = `
      <span class="action-label">${action.label}</span>
      <span class="action-pts">${action.value > 0 ? "+" + action.value : action.value} pts</span>
    `;
    btn.addEventListener("click", () => logAction(action));
    grid.appendChild(btn);
  });
}

// Log an action & save to Firestore

async function logAction(action) {
  if (!currentMatchId || !currentMatchDoc) return;

  const myPlayer = currentMatchDoc.players[currentUser.uid] || {
    displayName: currentUser.displayName,
    position: currentPosition,
    positionScores: createEmptyPositionScores(),
    rawScores: [0,0,0,0,0,0]
  };

  const positionScores = myPlayer.positionScores || createEmptyPositionScores();
  const scores = [...getRawScoresForPosition(myPlayer, currentPosition)];
  const allScores = [...(myPlayer.rawScores || [0,0,0,0,0,0])];
  action.stats.forEach(i => {
    const delta = action.value > 0 ? action.value * 0.12 : action.value * 0.08;
    scores[i] = Math.max(0, Math.min(10, scores[i] + delta));
    allScores[i] = Math.max(0, Math.min(10, allScores[i] + delta));
  });

  const entry = {
    uid:         currentUser.uid,
    playerName:  currentUser.displayName,
    actionId:    action.id,
    actionLabel: action.label,
    value:       action.value,
    statIndices: action.stats,
    timestamp:   Date.now(),
  };

  // Optimistic local update
  currentMatchDoc.players[currentUser.uid] = {
    ...myPlayer,
    position: currentPosition,
    positionScores: {
      ...positionScores,
      [currentPosition]: scores,
    },
    rawScores: allScores,
  };
  currentMatchDoc.actionLog = [entry, ...(currentMatchDoc.actionLog || [])];

  // Save to Firestore
  const ref = doc(db, "matches", currentMatchId);
  await updateDoc(ref, {
    [`players.${currentUser.uid}.position`]: currentPosition,
    [`players.${currentUser.uid}.positionScores.${currentPosition}`]: scores,
    [`players.${currentUser.uid}.rawScores`]: allScores,
    actionLog: [entry, ...(currentMatchDoc.actionLog.slice(0, 199))],
  });

  renderLog();
  updateChart();
}

// Chart

function getScoresForView() {
  if (!currentMatchDoc) return [0,0,0,0,0,0];

  if (viewingPlayer.startsWith(POSITION_VIEW_PREFIX)) {
    const positionId = viewingPlayer.replace(POSITION_VIEW_PREFIX, "");
    return getAggregateScores(getPlayersByPosition(positionId));
  }

  if (viewingPlayer !== ALL_PLAYERS_VIEW) {
    const p = currentMatchDoc.players[viewingPlayer];
    if (!p) return [0,0,0,0,0,0];
    const pos = p.position || "oh";
    const w = POSITION_WEIGHTS[pos];
    return getRawScoresForPosition(p, pos).map((s, i) => Math.round(Math.max(0, Math.min(10, s * w[i]))));
  }

  // Aggregate all players
  return getAggregateScores(Object.values(currentMatchDoc.players || {}));
}

function getAggregateScores(players) {
  if (players.length === 0) return [0,0,0,0,0,0];

  const totals = [0,0,0,0,0,0];
  players.forEach(p => {
    const w = POSITION_WEIGHTS[p.position || "oh"];
    getRawScoresForPosition(p, p.position || "oh").forEach((s, i) => {
      totals[i] += Math.max(0, Math.min(10, s * w[i]));
    });
  });
  return totals.map(v => Math.round(v / players.length));
}

function createEmptyPositionScores() {
  return POSITIONS.reduce((scores, pos) => {
    scores[pos.id] = [0,0,0,0,0,0];
    return scores;
  }, {});
}

function getRawScoresForPosition(player, positionId) {
  if (player.positionScores) {
    return player.positionScores[positionId] || [0,0,0,0,0,0];
  }

  return (player.position || "oh") === positionId
    ? (player.rawScores || [0,0,0,0,0,0])
    : [0,0,0,0,0,0];
}

function normalizeMatchPlayers() {
  Object.values(currentMatchDoc.players || {}).forEach(player => {
    if (player.positionScores) return;
    const scores = createEmptyPositionScores();
    scores[player.position || "oh"] = player.rawScores || [0,0,0,0,0,0];
    player.positionScores = scores;
  });
}

function initChart() {
  const ctx = document.getElementById("radarChart");
  chart = new Chart(ctx, {
    type: "radar",
    data: {
      labels: STATS,
      datasets: [{
        label: "Stats",
        data: [0,0,0,0,0,0],
        backgroundColor: "rgba(55, 138, 221, 0.15)",
        borderColor: "#378ADD",
        borderWidth: 2,
        pointBackgroundColor: STAT_COLORS,
        pointBorderColor: "#fff",
        pointRadius: 5,
        pointHoverRadius: 7,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 10,
          ticks: { stepSize: 2, font: { size: 11 }, backdropColor: "transparent" },
          grid: { color: "rgba(0,0,0,0.08)" },
          angleLines: { color: "rgba(0,0,0,0.08)" },
          pointLabels: { font: { size: 12 } },
        }
      }
    }
  });
}

function updateChart() {
  const scores = getScoresForView();
  chart.data.datasets[0].data = scores;
  chart.data.datasets[0].label = getChartViewLabel();
  chart.update("active");
  document.getElementById("chart-title").textContent = getChartViewLabel();
  renderStatBars(scores);
}

function getChartViewLabel() {
  if (!currentMatchDoc) return "Stat Sheet";

  if (viewingPlayer.startsWith(POSITION_VIEW_PREFIX)) {
    const positionId = viewingPlayer.replace(POSITION_VIEW_PREFIX, "");
    return `${getPositionLabel(positionId)} Chart`;
  }

  if (viewingPlayer !== ALL_PLAYERS_VIEW) {
    const player = currentMatchDoc.players[viewingPlayer];
    return player ? `${player.displayName} Chart` : "Stat Sheet";
  }

  return "All Players Chart";
}

// Stat bars

function renderStatBars(scores) {
  const container = document.getElementById("stat-bars");
  container.innerHTML = "";
  scores.forEach((val, i) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <span class="stat-name">${STATS[i]}</span>
      <div class="stat-bar-bg">
        <div class="stat-bar-fill" style="width:${val*10}%;background:${STAT_COLORS[i]};"></div>
      </div>
      <span class="stat-val">${val}</span>`;
    container.appendChild(row);
  });
}

// Action log

function renderLog() {
  const list = document.getElementById("action-log");
  list.innerHTML = "";

  const entries = (currentMatchDoc?.actionLog || []).slice(0, 50);
  if (entries.length === 0) {
    list.innerHTML = "<li class='empty'>No actions logged yet.</li>"; return;
  }

  entries.forEach(entry => {
    const sign = entry.value > 0 ? "+" : "";
    const color = STAT_COLORS[entry.statIndices[0]];
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="log-dot" style="background:${color}"></span>
      <span class="log-player">${entry.playerName}</span>
      <span class="log-action">${entry.actionLabel}</span>
      <span class="log-pts">${sign}${entry.value}</span>`;
    list.appendChild(li);
  });
}

// Reset

window.resetCurrentMatch = async function() {
  if (!currentMatchId) return;
  if (!confirm("Reset all stats for this match? This cannot be undone.")) return;

  const resetPlayers = {};
  Object.entries(currentMatchDoc.players).forEach(([uid, p]) => {
    resetPlayers[uid] = {
      ...p,
      positionScores: createEmptyPositionScores(),
      rawScores: [0,0,0,0,0,0]
    };
  });

  await updateDoc(doc(db, "matches", currentMatchId), {
    players:   resetPlayers,
    actionLog: [],
  });

  currentMatchDoc.players   = resetPlayers;
  currentMatchDoc.actionLog = [];
  renderLog();
  updateChart();
};
