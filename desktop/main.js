// Kanbo desktop shell. It loads the deployed web app in a sandboxed window, so the desktop
// app is always the same version as the site and ships no copy of the server code or secrets.
const { app, BrowserWindow, Menu, Tray, shell, session, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = process.env.KANBO_URL || "https://kanbo-orcin.vercel.app";
const APP_ORIGIN = new URL(APP_URL).origin;

// Hosts the window may navigate to itself. Google sign-in redirects through accounts.google.com
// and back via the Supabase project; everything else opens in the user's browser.
const AUTH_HOSTS = new Set(["accounts.google.com"]);
const SUPABASE_HOST_SUFFIX = ".supabase.co";

let mainWindow = null;
let tray = null;
let quitting = false;

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

function openExternal(url) {
  if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
}

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) return saved;
  } catch {
    /* first run or unreadable state: use defaults */
  }
  return { width: 1280, height: 820 };
}

function saveWindowState(win) {
  if (win.isMinimized() || win.isFullScreen()) return;
  try {
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }),
    );
  } catch {
    /* losing the remembered size is harmless */
  }
}

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: "#fff8f6",
    title: "Kanbo",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  win.on("resize", () => saveWindowState(win));
  win.on("move", () => saveWindowState(win));
  // Closing the window keeps Kanbo in the tray so notifications keep arriving.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  win.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    // -3 is a cancelled navigation (redirect); anything else on the main frame is offline.
    if (isMainFrame && code !== -3) void win.loadFile(path.join(__dirname, "offline.html"));
  });

  void win.loadURL(`${APP_URL}/projects`);
  return win;
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "build", "icon.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Kanbo");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Kanbo", click: showWindow },
      { label: "My tasks", click: () => (showWindow(), mainWindow?.loadURL(`${APP_URL}/my-tasks`)) },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

function startAutoUpdates() {
  if (!app.isPackaged) return;
  // Loaded lazily so a dev run without the dependency installed still works.
  const { autoUpdater } = require("electron-updater");
  autoUpdater.on("error", () => {
    /* offline or no release yet: try again next launch */
  });
  void autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("app.kanbo.desktop");
    // Allow the web app's own notifications and clipboard use, nothing else.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "notifications" || permission === "clipboard-sanitized-write");
    });
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    startAutoUpdates();
    app.on("activate", showWindow);
  });
}
