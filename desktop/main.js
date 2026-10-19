// Kanbo desktop shell. It loads the deployed web app in a sandboxed window, so the desktop
// app is always the same version as the site and ships no copy of the server code or secrets.
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const path = require("node:path");

const APP_URL = process.env.KANBO_URL || "https://kanbo-orcin.vercel.app";
const APP_ORIGIN = new URL(APP_URL).origin;

// Hosts the window may navigate to itself. Google sign-in redirects through accounts.google.com
// and back via the Supabase project; everything else opens in the user's browser.
const AUTH_HOSTS = new Set(["accounts.google.com"]);
const SUPABASE_HOST_SUFFIX = ".supabase.co";

function isInternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.origin !== APP_ORIGIN) return false;
    return (
      parsed.origin === APP_ORIGIN ||
      AUTH_HOSTS.has(parsed.hostname) ||
      parsed.hostname.endsWith(SUPABASE_HOST_SUFFIX)
    );
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: "#fff8f6",
    title: "Kanbo",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: "allow" };
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    // -3 is a cancelled navigation (redirect); anything else on the main frame is offline.
    if (isMainFrame && code !== -3) {
      void win.loadURL(`${APP_ORIGIN}/offline`).catch(() => {
        void win.loadFile(path.join(__dirname, "offline.html"));
      });
    }
  });

  void win.loadURL(`${APP_URL}/projects`);
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // Allow the web app's own notifications and clipboard use, nothing else.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "notifications" || permission === "clipboard-sanitized-write");
    });
    Menu.setApplicationMenu(null);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
