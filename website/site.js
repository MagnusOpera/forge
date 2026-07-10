const root = document.documentElement;
const toggle = document.querySelector("[data-theme-toggle]");
const previewImage = document.querySelector("[data-preview-image]");
const previewTheme = document.querySelector("[data-preview-theme]");
const platformTabsRoot = document.querySelector("[data-platform-tabs]");

function preferredTheme() {
  const stored = window.localStorage.getItem("forge-site-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return "light";
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

function setupPlatformTabs() {
  if (!platformTabsRoot) {
    return;
  }

  const tabs = Array.from(platformTabsRoot.querySelectorAll("[data-platform-tab]"));
  const panels = Array.from(platformTabsRoot.querySelectorAll("[data-platform-panel]"));
  if (tabs.length === 0 || panels.length === 0) {
    return;
  }

  function selectPlatform(platform, shouldFocus = false) {
    tabs.forEach((tab) => {
      const selected = tab.dataset.platformTab === platform;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && shouldFocus) {
        tab.focus();
      }
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.platformPanel !== platform;
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      selectPlatform(tab.dataset.platformTab);
    });

    tab.addEventListener("keydown", (event) => {
      const lastIndex = tabs.length - 1;
      const nextIndex = index === lastIndex ? 0 : index + 1;
      const previousIndex = index === 0 ? lastIndex : index - 1;
      let targetIndex = null;

      if (event.key === "ArrowRight") {
        targetIndex = nextIndex;
      } else if (event.key === "ArrowLeft") {
        targetIndex = previousIndex;
      } else if (event.key === "Home") {
        targetIndex = 0;
      } else if (event.key === "End") {
        targetIndex = lastIndex;
      }

      if (targetIndex === null) {
        return;
      }

      event.preventDefault();
      selectPlatform(tabs[targetIndex].dataset.platformTab, true);
    });
  });
}

setupPlatformTabs();
