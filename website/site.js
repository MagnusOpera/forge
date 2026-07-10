const root = document.documentElement;
const toggle = document.querySelector("[data-theme-toggle]");
const previewImage = document.querySelector("[data-preview-image]");
const previewTheme = document.querySelector("[data-preview-theme]");

function preferredTheme() {
  const stored = window.localStorage.getItem("forge-site-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const preview = theme === "dark" ? "light" : "dark";
  root.dataset.theme = theme;
  toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  if (previewTheme) {
    previewTheme.textContent = preview;
  }
  if (previewImage) {
    previewImage.src = `screenshots/forge-${preview}.png`;
  }
}

applyTheme(preferredTheme());

toggle.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  window.localStorage.setItem("forge-site-theme", next);
  applyTheme(next);
});
