const THEME_KEY = "gamepad-tester-theme";

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || "amber";
}

export function setTheme(themeId) {
  localStorage.setItem(THEME_KEY, themeId);
}
