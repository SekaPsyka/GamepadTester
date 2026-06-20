import xboxImage from "./assets/controllers/xbox.svg?url";
import playstationImage from "./assets/controllers/playstation.svg?url";

// Coordonnées relevées visuellement sur les SVG sources (unités du viewBox d'origine).
// Les zones de surbrillance sont nos propres formes simples positionnées sur la silhouette
// officielle, plutôt que les calques de surbrillance du pack d'origine: ces derniers sont
// répartis de façon incohérente entre manettes (label Inkscape direct pour certains boutons,
// simple commentaire d'export pour d'autres), trop risqué à extraire fiablement à la main.
const LAYOUTS = {
  xbox: {
    image: xboxImage,
    viewBox: { w: 1534.7274, h: 954.01408 },
    buttons: {
      0: { x: 1183, y: 518, r: 55 }, // A
      1: { x: 1297, y: 410, r: 55 }, // B
      2: { x: 1077, y: 423, r: 55 }, // X
      3: { x: 1183, y: 313, r: 55 }, // Y
      4: { x: 386, y: 111, r: 45 }, // LB
      5: { x: 1148, y: 111, r: 45 }, // RB
      6: { x: 305, y: 41, r: 40 }, // LT
      7: { x: 1229, y: 41, r: 40 }, // RT
      8: { x: 652, y: 425, r: 32 }, // View
      9: { x: 887, y: 425, r: 32 }, // Menu
      16: { x: 770, y: 266, r: 55 }, // Guide (logo Xbox)
      12: { x: 557, y: 600, r: 35 }, // D-pad haut
      13: { x: 557, y: 718, r: 35 }, // D-pad bas
      14: { x: 497, y: 659, r: 35 }, // D-pad gauche
      15: { x: 617, y: 659, r: 35 }, // D-pad droite
    },
    sticks: {
      left: { x: 352, y: 423, r: 90 },
      right: { x: 980, y: 653, r: 90 },
    },
    stickButtons: { left: 10, right: 11 },
  },
  playstation: {
    image: playstationImage,
    viewBox: { w: 544.70661, h: 302.91098 },
    buttons: {
      0: { x: 449, y: 196, r: 24 }, // Croix
      1: { x: 492, y: 161, r: 24 }, // Cercle
      2: { x: 407, y: 161, r: 24 }, // Carré
      3: { x: 449, y: 126, r: 24 }, // Triangle
      4: { x: 117, y: 36, r: 13 }, // L1
      5: { x: 431, y: 36, r: 13 }, // R1
      6: { x: 117, y: 22, r: 13 }, // L2
      7: { x: 431, y: 22, r: 13 }, // R2
      8: { x: 138, y: 102, r: 11 }, // Create/Share
      9: { x: 408, y: 102, r: 11 }, // Options
      16: { x: 279, y: 218, r: 14 }, // Bouton PS
      12: { x: 97, y: 138, r: 18 }, // D-pad haut
      13: { x: 97, y: 182, r: 18 }, // D-pad bas
      14: { x: 75, y: 160, r: 18 }, // D-pad gauche
      15: { x: 119, y: 160, r: 18 }, // D-pad droite
    },
    sticks: {
      left: { x: 184, y: 228, r: 36 },
      right: { x: 361, y: 228, r: 36 },
    },
    stickButtons: { left: 10, right: 11 },
  },
};

export function createSilhouette(container) {
  container.innerHTML = `
    <div class="silhouette-frame hidden">
      <img class="silhouette-img" alt="Silhouette de la manette détectée" />
      <div class="silhouette-dots"></div>
    </div>
  `;
  return {
    frame: container.querySelector(".silhouette-frame"),
    img: container.querySelector(".silhouette-img"),
    dotsLayer: container.querySelector(".silhouette-dots"),
    layout: null,
    dotEls: {},
    stickEls: {},
  };
}

function placeEl(el, pos, viewBox) {
  el.style.left = `${(pos.x / viewBox.w) * 100}%`;
  el.style.top = `${(pos.y / viewBox.h) * 100}%`;
  el.style.width = `${((pos.r * 2) / viewBox.w) * 100}%`;
  el.style.height = `${((pos.r * 2) / viewBox.h) * 100}%`;
}

export function setSilhouetteType(instance, controllerType) {
  const layout = LAYOUTS[controllerType] || null;
  instance.layout = layout;
  instance.dotsLayer.innerHTML = "";
  instance.dotEls = {};
  instance.stickEls = {};

  if (!layout) {
    instance.frame.classList.add("hidden");
    return;
  }

  instance.frame.classList.remove("hidden");
  instance.img.src = layout.image;
  instance.frame.style.aspectRatio = `${layout.viewBox.w} / ${layout.viewBox.h}`;

  for (const [index, pos] of Object.entries(layout.buttons)) {
    const dot = document.createElement("div");
    dot.className = "silhouette-dot";
    placeEl(dot, pos, layout.viewBox);
    instance.dotsLayer.appendChild(dot);
    instance.dotEls[index] = dot;
  }

  for (const side of ["left", "right"]) {
    const stick = layout.sticks[side];
    const el = document.createElement("div");
    el.className = "silhouette-stick";
    placeEl(el, stick, layout.viewBox);
    instance.dotsLayer.appendChild(el);
    instance.stickEls[side] = el;
  }
}

// Déplacement volontairement discret (35% du rayon du repère): le SVG montre déjà le stick,
// ce halo ne fait que confirmer la direction sans se substituer au rendu du canvas dédié.
const STICK_VISUAL_TRAVEL_PERCENT = 35;

export function updateSilhouette(instance, pad) {
  const layout = instance.layout;
  if (!layout || !pad) return;

  for (const [index, dot] of Object.entries(instance.dotEls)) {
    const btn = pad.buttons[index];
    dot.style.opacity = btn ? Math.max(btn.value, btn.pressed ? 1 : 0) : 0;
  }

  const axes = pad.axes || [];
  for (const side of ["left", "right"]) {
    const el = instance.stickEls[side];
    const ax = side === "left" ? axes[0] ?? 0 : axes[2] ?? 0;
    const ay = side === "left" ? axes[1] ?? 0 : axes[3] ?? 0;
    el.style.transform = `translate(-50%, -50%) translate(${ax * STICK_VISUAL_TRAVEL_PERCENT}%, ${ay * STICK_VISUAL_TRAVEL_PERCENT}%)`;
    const stickBtn = pad.buttons[layout.stickButtons[side]];
    const pressed = stickBtn ? stickBtn.pressed || stickBtn.value > 0.08 : false;
    el.classList.toggle("active", pressed);
  }
}
