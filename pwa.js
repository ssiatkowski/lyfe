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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const VALID_NOTIFICATION_OWNERS = new Set(["Sebo", "Alomi"]);
const DEVICE_ID_KEY = "lyfeNotificationDeviceId";

let messaging = null;
let serviceWorkerRegistration = null;
let notificationButton = null;

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
    return;
  }

  try {
    // Firebase supplies a default VAPID key when one is not passed. If a
    // browser later requires a project-specific key, this is the only call
    // that needs the optional vapidKey setting added.
    const token = await getToken(messaging, { serviceWorkerRegistration });
    if (token) {
      await saveSubscription(token, owner);
      setButtonState(`Notifications: ${owner}`);
    }
  } catch (err) {
    console.error("Unable to sync notification subscription", err);
    setButtonState("Notifications unavailable");
  }
}

async function enableNotifications() {
  const owner = getCurrentOwner();
  if (!owner) {
    setButtonState("Select Sebo or Alomi", true);
    return;
  }

  setButtonState("Enabling…", true);
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setButtonState("Enable Notifications");
      return;
    }
    await syncNotificationOwner();
  } finally {
    if (notificationButton) notificationButton.disabled = false;
  }
}

function installNotificationButton() {
  const userSelector = document.querySelector(".user-selector");
  if (!userSelector) return;

  notificationButton = document.createElement("button");
  notificationButton.type = "button";
  notificationButton.id = "notification-toggle";
  notificationButton.textContent = Notification.permission === "granted"
    ? "Notifications enabled"
    : "Enable Notifications";
  notificationButton.style.marginLeft = "8px";
  notificationButton.addEventListener("click", enableNotifications);
  userSelector.appendChild(notificationButton);
}

async function initializeNotifications() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
  if (!(await isSupported())) return;

  serviceWorkerRegistration = await navigator.serviceWorker.register("./firebase-messaging-sw.js", {
    scope: "./"
  });
  messaging = getMessaging(app);
  installNotificationButton();

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
  });
});
