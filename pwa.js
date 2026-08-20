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

function setButtonState(text, disabled = false) {
  if (!notificationButton) return;
  notificationButton.textContent = text;
  notificationButton.disabled = disabled;
}

function setStatus(text = "") {
  if (!notificationStatus) return;
  notificationStatus.textContent = text;
  notificationStatus.style.display = text ? "block" : "none";
}

function formatError(err) {
  const code = err?.code ? String(err.code) : "";
  const message = err?.message ? String(err.message) : "";
  if (code && message && !message.includes(code)) return `${code}: ${message}`;
  return code || message || String(err) || "Unknown notification error";
}

async function saveSubscription(token, owner) {
  // Stable document ID means token refreshes or owner switches overwrite the
  // same device record instead of accumulating stale subscriptions/writes.
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
    setButtonState("Select Sebo or Alomi", true);
    setStatus("Notifications are tied to one specific user, not All.");
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
    setButtonState(`Notifications: ${owner}`);
    setStatus("Registered successfully.");
  } catch (err) {
    console.error("Unable to sync notification subscription", err);
    const detail = formatError(err);
    setButtonState("Retry Notifications");
    setStatus(detail);
  }
}

async function enableNotifications() {
  const owner = getCurrentOwner();
  if (!owner) {
    setButtonState("Select Sebo or Alomi", true);
    setStatus("Choose Sebo or Alomi first.");
    return;
  }

  setButtonState("Enabling…", true);
  setStatus("");
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setButtonState("Enable Notifications");
      setStatus(`Notification permission is ${permission}.`);
      return;
    }
    await syncNotificationOwner();
  } catch (err) {
    console.error("Unable to enable notifications", err);
    setButtonState("Retry Notifications");
    setStatus(formatError(err));
  } finally {
    if (notificationButton) notificationButton.disabled = false;
  }
}

function installNotificationControls() {
  const userSelector = document.querySelector(".user-selector");
  if (!userSelector) return;

  const wrapper = document.createElement("div");
  wrapper.id = "notification-controls";
  wrapper.style.marginTop = "6px";
  wrapper.style.textAlign = "center";

  notificationButton = document.createElement("button");
  notificationButton.type = "button";
  notificationButton.id = "notification-toggle";
  notificationButton.textContent = Notification.permission === "granted"
    ? "Notifications enabled"
    : "Enable Notifications";
  notificationButton.addEventListener("click", enableNotifications);

  notificationStatus = document.createElement("small");
  notificationStatus.id = "notification-status";
  notificationStatus.style.display = "none";
  notificationStatus.style.marginTop = "4px";
  notificationStatus.style.maxWidth = "360px";
  notificationStatus.style.overflowWrap = "anywhere";

  wrapper.appendChild(notificationButton);
  wrapper.appendChild(notificationStatus);
  userSelector.appendChild(wrapper);
}

async function initializeNotifications() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;

  installNotificationControls();

  const supported = await isSupported();
  if (!supported) {
    setButtonState("Notifications unsupported", true);
    setStatus("Firebase Messaging reports that this browser/app context does not support web push.");
    return;
  }

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./firebase-messaging-sw.js", {
      scope: "./"
    });
    messaging = getMessaging(app);
  } catch (err) {
    console.error("PWA notification initialization failed", err);
    setButtonState("Retry Notifications");
    setStatus(formatError(err));
    return;
  }

  const userSelect = document.getElementById("user-select");
  userSelect?.addEventListener("change", () => {
    if (Notification.permission === "granted") syncNotificationOwner();
  });

  if (Notification.permission === "granted") {
    await syncNotificationOwner();
  }

  onMessage(messaging, payload => {
    if (!payload.notification || !serviceWorkerRegistration) return;
    const { title, body } = payload.notification;
    if (title) serviceWorkerRegistration.showNotification(title, { body });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initializeNotifications().catch(err => {
    console.error("PWA notification initialization failed", err);
    setButtonState("Retry Notifications");
    setStatus(formatError(err));
  });
});
