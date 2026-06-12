import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let isAuthAction = false;

// Redirect to app if already logged in
onAuthStateChanged(auth, user => {
  if (user && !isAuthAction) {
    window.location.href = "app.html";
  }
});

function emailKey(email) {
  return email.toLowerCase().replace(/\./g, ",");
}

async function saveUserProfile(user, displayName, email) {
  const normalizedEmail = email.toLowerCase();
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
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

// Tab switching

window.showTab = function(tab) {
  document.getElementById("form-login").style.display  = tab === "login"  ? "block" : "none";
  document.getElementById("form-signup").style.display = tab === "signup" ? "block" : "none";
  document.getElementById("tab-login").classList.toggle("active",  tab === "login");
  document.getElementById("tab-signup").classList.toggle("active", tab === "signup");
  document.getElementById("auth-error").textContent = "";
};

// Login

window.login = async function() {
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl    = document.getElementById("auth-error");
  errEl.textContent = "";
  try {
    isAuthAction = true;
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await saveUserProfile(
      cred.user,
      cred.user.displayName || cred.user.email,
      cred.user.email
    );
    window.location.href = "app.html";
  } 
  catch (e) {
    errEl.textContent = friendlyError(e.code);
  } 
  finally {
    isAuthAction = false;
  }
};

// Sign Up

window.signup = async function() {
  const name     = document.getElementById("signup-name").value.trim();
  const email    = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const errEl    = document.getElementById("auth-error");
  errEl.textContent = "";

  if (!name) { 
    errEl.textContent = "Please enter a display name."; return; 
  }

  try {
    isAuthAction = true;
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    await saveUserProfile(cred.user, name, email);

    window.location.href = "app.html";
  } 
  catch (e) {
    console.error("FIRESTORE REJECTION:", e);
    errEl.textContent = friendlyError(e.code);
  } finally {
    isAuthAction = false;
  }
};

// Error messages

function friendlyError(code) {
  const map = {
    "auth/invalid-email":          "Invalid email address.",
    "auth/user-not-found":         "No account found with that email.",
    "auth/wrong-password":         "Incorrect password.",
    "auth/email-already-in-use":   "An account with that email already exists.",
    "auth/weak-password":          "Password must be at least 6 characters.",
    "auth/too-many-requests":      "Too many attempts. Please try again later.",
  };
  return map[code] || "Something went wrong. Please try again.";
}