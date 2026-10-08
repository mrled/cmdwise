// Opt-in GTK/KDE workaround: a maximize round trip refreshes Wayland decorations.
// Pake runs this at DOMContentLoaded; window operations still require permitted IPC.
(async () => {
  if (!/linux/i.test(navigator.platform || "")) return;
  if (window.pakeConfig?.fullscreen) return;
  const appWindow = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!appWindow?.toggleMaximize) return;

  // Avoid repeating on same-origin navigation; do not persist across app sessions.
  const marker = "pake-app.titlebar-refreshed";
  try { if (sessionStorage.getItem(marker)) return; } catch (_) {}

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Do not reveal tray-hidden windows. Timers avoid suspended animation callbacks.
  while (document.visibilityState === "hidden") await delay(250);
  await delay(300);
  if (document.visibilityState === "hidden") return;

  // Two toggles preserve the starting state, without needing isMaximized permission.
  // Let GTK process the first configure event before requesting the second.
  await appWindow.toggleMaximize();
  await delay(200);
  await appWindow.toggleMaximize();
  try { sessionStorage.setItem(marker, "1"); } catch (_) {}
})().catch((error) => {
  console.warn("[pake-app] titlebar refresh failed; try manual maximize/restore or XWayland", error);
});
