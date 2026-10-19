# Kanbo for Windows

A thin Electron shell that opens the deployed Kanbo site in its own window. It contains no server
code or secrets, so it is always the same version as the website.

```
cd desktop
npm install
node node_modules/electron/install.js   # downloads the Electron binary (npm may skip this script)
npm start                               # run it
npm run dist                            # build dist/Kanbo-Setup-<v>.exe and dist/Kanbo-Portable-<v>.exe
```

Set `KANBO_URL` to point it at another deployment (for example a preview URL).

The builds are **unsigned**. Windows SmartScreen will warn, and PCs with an Application Control
policy (like the dev machine) refuse to run them. Signing needs a code-signing certificate.

Web push does not work inside Electron (it has no push service). Use the installed web app
(Edge or Chrome, "Install Kanbo") when you want push notifications on Windows.

## Releases and auto-update

Push a tag to build and publish the installer to GitHub Releases:

```
git tag desktop-v0.2.0 && git push origin desktop-v0.2.0
```

Installed copies check for a newer release on launch and update themselves. The app lives in the
system tray; closing the window hides it, and the tray menu has Quit.

To sign the installer, add `WIN_CSC_LINK` (base64 `.pfx`) and `WIN_CSC_KEY_PASSWORD` as repository
secrets. An EV or standard code-signing certificate removes the SmartScreen warning.
