import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, setPersistence, browserLocalPersistence, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC_BtuwYiwwmDpAJQuRt4x30YyPGTYvZ7s",
  authDomain: "lyfe-cacf7.firebaseapp.com",
  projectId: "lyfe-cacf7",
  storageBucket: "lyfe-cacf7.firebasestorage.app",
  messagingSenderId: "119442487958",
  appId: "1:119442487958:web:e218fafb50513ad717e0b7",
  measurementId: "G-WE8CC23QSC"
};

const ALLOWED_USERS = {
  "sebastiansiatkowski@gmail.com": "Sebo",
  "alomip@gmail.com": "Alomi"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

function renderGate(message = "Sign in with an approved Google account to use Lyfe.") {
  let gate = document.getElementById("auth-gate");
  if (!gate) {
    gate = document.createElement("div");
    gate.id = "auth-gate";
    gate.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px;max-width:360px;width:calc(100% - 40px);box-shadow:0 12px 40px rgba(0,0,0,.2);text-align:center;font-family:Roboto,Arial,sans-serif">
        <h1 style="margin:0 0 12px;color:#1683f3">Lyfe</h1>
        <p id="auth-gate-message" style="margin:0 0 20px;line-height:1.4"></p>
        <button id="google-sign-in" style="border:0;border-radius:10px;padding:12px 18px;font-size:16px;cursor:pointer">Sign in with Google</button>
      </div>`;
    Object.assign(gate.style, { position:"fixed", inset:"0", zIndex:"99999", background:"rgba(245,247,250,.98)", display:"flex", alignItems:"center", justifyContent:"center" });
    document.body.appendChild(gate);
    document.getElementById("google-sign-in").addEventListener("click", async () => {
      const button = document.getElementById("google-sign-in");
      const messageEl = document.getElementById("auth-gate-message");
      try {
        button.disabled = true;
        messageEl.textContent = "Opening Google sign-in…";
        await setPersistence(auth, browserLocalPersistence);

        // Lyfe is hosted on GitHub Pages while Firebase Auth uses firebaseapp.com.
        // Redirect auth depends on cross-origin storage that modern Safari blocks.
        // Popup auth avoids that redirect-storage dependency and works from the
        // user's direct button press on desktop, mobile Safari, and the PWA.
        const result = await signInWithPopup(auth, provider);
        await acceptUser(result.user);
      } catch (err) {
        console.error("Lyfe Google sign-in error", err);
        if (err?.code === "auth/popup-blocked") {
          messageEl.textContent = "Google sign-in was blocked. Allow pop-ups for this site and try again.";
        } else if (err?.code === "auth/popup-closed-by-user" || err?.code === "auth/cancelled-popup-request") {
          messageEl.textContent = "Google sign-in was cancelled. Tap the button to try again.";
        } else {
          messageEl.textContent = err?.message || String(err);
        }
      } finally {
        button.disabled = false;
      }
    });
  }
  document.getElementById("auth-gate-message").textContent = message;
  gate.style.display = "flex";
}

function hideGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) gate.style.display = "none";
}

async function acceptUser(user) {
  const email = (user?.email || "").toLowerCase();
  const lyfeUser = ALLOWED_USERS[email];
  if (!lyfeUser) {
    if (user) await signOut(auth);
    renderGate("That Google account is not authorized for Lyfe.");
    return false;
  }
  localStorage.setItem("currentUser", lyfeUser);
  localStorage.setItem("lyfeAuthenticatedEmail", email);
  hideGate();
  return true;
}

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (err) {
  console.error("Lyfe auth persistence error", err);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderGate();
    return;
  }
  await acceptUser(user);
});

window.lyfeSignOut = () => signOut(auth).then(() => location.reload());
