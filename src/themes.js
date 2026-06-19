export const THEMES = {
  cyan: { label: "Cyan électrique", accent: "#00f0ff", accentAlt: "#ff00e6", bgTint: "#161a2c" },
  green: { label: "Vert néon", accent: "#39ff8c", accentAlt: "#c724ff", bgTint: "#10241c" },
  amber: { label: "Ambre / orange", accent: "#ffb000", accentAlt: "#00d2ff", bgTint: "#241a10" },
  purple: { label: "Violet", accent: "#b14cff", accentAlt: "#39ff8c", bgTint: "#1c1530" },
  red: { label: "Rouge / feu", accent: "#ff3b3b", accentAlt: "#00f0ff", bgTint: "#26121a" },
};

export function applyTheme(themeId) {
  const theme = THEMES[themeId] || THEMES.cyan;
  document.documentElement.style.setProperty("--accent", theme.accent);
  document.documentElement.style.setProperty("--accent-alt", theme.accentAlt);
  document.documentElement.style.setProperty("--bg-tint", theme.bgTint);
  return theme;
}
