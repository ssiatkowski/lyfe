import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { getMessaging, getToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyC_BtuwYiwwmDpAJQuRt4x30YyPGTYvZ7s",
  authDomain: "lyfe-cacf7.firebaseapp.com",
  projectId: "lyfe-cacf7",
  storageBucket: "lyfe-cacf7.firebasestorage.app",
  messagingSenderId: "119442487958",
  appId: "1:119442487958:web:e218fafb50513ad717e0b7",
  measurementId: "G-WE8CC23QSC"
};

const VAPID_KEY = "BBWG6zMC5ezp6GeYGTw61llTBO97hfSoCxN0J_0vLlf5taCHnTZVpvCPlGu3B_Vx4_cIgkiBHuXtOehKc6DffT4";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const VALID_NOTIFICATION_OWNERS = new Set(["Sebo", "Alomi"]);
const DEVICE_ID_KEY = "lyfeNotificationDeviceId";

let messaging = null;
let serviceWorkerRegistration = null;
let notificationButton = null;
let notificationStatus = null;
let statusTimer = null;

function getCurrentOwner() {
  const owner = localStorage.getItem("currentUser");
  return VALID_NOTIFICATION_OWNERS.has(owner) ? owner : null;
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function setButtonState(text, disabled = false, title = "") {
  if (!notificationButton) return;
  notificationButton.textContent = text;
  notificationButton.disabled = disabled;
  if (title) notificationButton.title = title;
}

function setStatus(text = "", autoHideMs = 0) {
  if (!notificationStatus) return;
  clearTimeout(statusTimer);
  notificationStatus.textContent = text;
  notificationStatus.style.display = text ? "block" : "none";
  if (text && autoHideMs) {
    statusTimer = setTimeout(() => {
      notificationStatus.style.display = "none";
    }, autoHideMs);
  }
}

function formatError(err) {
  const parts = [];
  if (err?.code) parts.push(`code=${String(err.code)}`);
  const custom = err?.customData || {};
  if (custom.requestName) parts.push(`request=${custom.requestName}`);
  if (custom.serverCode) parts.push(`serverCode=${custom.serverCode}`);
  if (custom.serverStatus) parts.push(`serverStatus=${custom.serverStatus}`);
  if (custom.serverMessage) parts.push(`serverMessage=${custom.serverMessage}`);
  if (parts.length) return parts.join(" | ");
  return err?.message ? String(err.message) : String(err) || "Unknown notification error";
}

async function saveSubscription(token, owner) {
  await setDoc(doc(db, "notificationSubscriptions", getDeviceId()), {
    token,
    owner,
    updatedAt: Date.now()
  });
}

async function syncNotificationOwner() {
  if (!messaging || Notification.permission !== "granted") return;
  const owner = getCurrentOwner();
  if (!owner) {
    setButtonState("🔔", true, "Select Sebo or Alomi to use notifications");
    setStatus("Notifications are tied to one specific user, not All.", 3500);
    return;
  }

  try {
    setStatus("");
    const token = await getToken(messaging, {
      serviceWorkerRegistration,
      vapidKey: VAPID_KEY
    });
    if (!token) throw new Error("Firebase did not return a messaging token");

    await saveSubscription(token, owner);
    setButtonState("🔔", false, `Notifications registered for ${owner}`);
    setStatus(`Notifications registered for ${owner}.`, 1800);
  } catch (err) {
    console.error("Unable to sync notification subscription", err);
    setButtonState("🔔!", false, "Retry notifications");
    setStatus(formatError(err));
  }
}

async function enableNotifications() {
  const owner = getCurrentOwner();
  if (!owner) {
    setButtonState("🔔", true, "Select Sebo or Alomi");
    setStatus("Choose Sebo or Alomi first.", 3000);
    return;
  }

  setButtonState("…", true, "Enabling notifications");
  setStatus("");
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setButtonState("🔕", false, "Enable notifications");
      setStatus(`Notification permission is ${permission}.`, 3500);
      return;
    }
    await syncNotificationOwner();
  } catch (err) {
    console.error("Unable to enable notifications", err);
    setButtonState("🔔!", false, "Retry notifications");
    setStatus(formatError(err));
  } finally {
    if (notificationButton) notificationButton.disabled = false;
  }
}

function installNotificationControls() {
  const headerActions = document.querySelector(".header-actions");
  if (!headerActions) return;

  const wrapper = document.createElement("div");
  wrapper.id = "notification-controls";

  notificationButton = document.createElement("button");
  notificationButton.type = "button";
  notificationButton.id = "notification-toggle";
  notificationButton.textContent = Notification.permission === "granted" ? "🔔" : "🔕";
  notificationButton.title = Notification.permission === "granted" ? "Notifications" : "Enable notifications";
  notificationButton.setAttribute("aria-label", notificationButton.title);
  notificationButton.addEventListener("click", enableNotifications);

  notificationStatus = document.createElement("small");
  notificationStatus.id = "notification-status";
  notificationStatus.style.display = "none";

  wrapper.appendChild(notificationButton);
  wrapper.appendChild(notificationStatus);
  headerActions.appendChild(wrapper);
}

async function initializeNotifications() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;

  installNotificationControls();

  const supported = await isSupported();
  if (!supported) {
    setButtonState("🔕", true, "Notifications unsupported");
    return;
  }

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./firebase-messaging-sw.js", { scope: "./" });
    messaging = getMessaging(app);
  } catch (err) {
    console.error("PWA notification initialization failed", err);
    setButtonState("🔔!", false, "Retry notifications");
    setStatus(formatError(err));
    return;
  }

  const userSelect = document.getElementById("user-select");
  userSelect?.addEventListener("change", () => {
    if (Notification.permission === "granted") syncNotificationOwner();
  });

  if (Notification.permission === "granted") await syncNotificationOwner();

  onMessage(messaging, payload => {
    if (!payload.notification || !serviceWorkerRegistration) return;
    const { title, body } = payload.notification;
    if (title) serviceWorkerRegistration.showNotification(title, { body });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initializeNotifications().catch(err => {
    console.error("PWA notification initialization failed", err);
    setButtonState("🔔!", false, "Retry notifications");
    setStatus(formatError(err));
  });
});
