// The game's pictograms. Drawn by hand on a 24 unit grid in the style of stamped
// equipment plates: straight strokes, square ends, no gradients. `s` paths are
// stroked with currentColor, `f` paths are filled.
const s = (d: string) => `<path d="${d}"/>`;
const f = (d: string) => `<path class="f" d="${d}"/>`;

const ICONS: Record<string, string> = {
  // stats
  health: s('M9 3h6v6h6v6h-6v6H9v-6H3V9h6z'),
  thirst: s('M12 2l7 10v4l-4 5H9l-4-5v-4zM9 14v2l2 2'),
  hunger: s('M4 9h16v11H4zM4 9l2-4h12l2 4M4 14h16M9 17h6'),
  stamina: s('M14 2L5 14h6l-1 8 9-13h-6z'),
  suit: s('M5 13V9l3-5h8l3 5v4l-2 7H7zM8 9h8v4H8z'),
  signal: s('M12 11v10M8 21h8M7 4L4 8.5l3 4.5M17 4l3 4.5-3 4.5') + f('M10.5 7h3v3h-3z'),
  noSignal: s('M12 11v10M8 21h8M7 4L4 8.5l3 4.5M17 4l3 4.5-3 4.5M3 3l18 18'),
  // items
  stone: s('M4 19L3 11l5-6 8-1 5 7-2 8zM8 5l3 6-8 0M11 11l5 8M11 11l5-7'),
  branch: s('M3 21l17-18M9 15V8M13 11h7M6 18H3M16 7l4 1'),
  fruit: s('M12 6l5 4v5l-5 6-5-6v-5zM12 6V3M9 3h6') + f('M11 11h2v4h-2z'),
  redFruit: s('M12 7l5 4v4l-5 5-5-5v-4zM12 7V3M17 11l3-2M7 11L4 9M17 15l3 2M7 15l-3 2'),
  tinder: s('M3 20h18M6 20l-1-6 3 3 1-8 3 6 2-9 2 8 3-4-1 10'),
  frond: s('M4 21l1-11 7-7 8 1-1 8-7 7zM4 21L15 9M9 16V9M12 13h6'),
  flint: s('M12 2l7 11-6 9-7-7zM12 2v11h7M12 13l1 9'),
  vine: s('M3 21c5 0 4-4 8-4s4-3 0-5 0-4 4-5 3-4 6-4M7 18v3M15 8h4'),
  scrap: s('M3 8l11-4 7 5-3 11-11 1z') + f('M7 10h2v2H7zM15 9h2v2h-2zM12 15h2v2h-2z'),
  spear: s('M3 21L16 8M16 8l1-5 4 4-5 1zM6 13l5 5'),
  transmitter: s('M4 11h16v10H4zM7 11L18 3M8 16h3M15 15v2M18 15v2'),
  water: s('M2 8l5-3 5 3 5-3 5 3M2 14l5-3 5 3 5-3 5 3M2 20l5-3 5 3 5-3 5 3'),
  pot: s('M8 3h8l-1 4 4 5v5l-3 4H8l-3-4v-5l4-5zM5 13h14'),
  crystal: s('M12 2l7 7-7 13L5 9zM5 9h14M9 9l3 13 3-13'),
  codex: s('M4 4h7l1 2 1-2h7v16h-7l-1 2-1-2H4zM12 6v14M7 9h2M7 13h2M15 9h2M15 13h2'),
  // buttons and menus
  pause: f('M6 4h4v16H6zM14 4h4v16h-4z'),
  play: f('M6 3l14 9-14 9z'),
  objectives: s('M6 22V3M6 4h13l-3 4 3 4H6'),
  crew: s('M10 3h4v4h-4zM4 8h4v4H4zM16 8h4v4h-4zM8 21v-9h8v9M2 20v-5h3M22 20v-5h-3'),
  inventory: s('M6 9h12v12H6zM9 9V5l2-2h2l2 2v4M6 14h12M10 14v3h4v-3'),
  settings: s('M3 7h9M18 7h3M12 4h6v6h-6zM3 17h3M12 17h9M6 14h6v6H6z'),
  back: s('M10 5l-7 7 7 7M3 12h18'),
  close: s('M5 5l14 14M19 5L5 19'),
  quit: s('M14 3H5v18h9M11 12h10M17 8l4 4-4 4'),
  look: s('M7 11V7l3-3h4l3 3v4M7 11v4l3 5h4l3-5v-4M4 11h16M10 14v1M14 14v1'),
  skins: s('M8 3L3 7l3 3 2-1v12h8V9l2 1 3-3-5-4-2 2h-4z'),
  language: s('M3 4h18v13H10l-5 4v-4H3zM8 14l3.5-7 3.5 7M9.5 12h4'),
  sound: s('M3 9v6h4l6 5V4L7 9zM16 9l2 3-2 3M19 6l3 6-3 6'),
  display: s('M3 4h18v13H3zM9 21h6M12 17v4'),
  controls: s('M6 7h12l4 11-3 2-4-4H9l-4 4-3-2zM8 10v4M6 12h4') + f('M14 11h2v2h-2zM17 9h2v2h-2z'),
  system: s('M12 2l9 5v10l-9 5-9-5V7zM12 9l3 1.5v3L12 15l-3-1.5v-3z'),
  legal: s('M6 2h9l4 4v16H6zM15 2v5h4M9 11h7M9 15h7M9 19h4'),
  download: s('M12 3v13M6 11l6 6 6-6M4 21h16'),
  jump: s('M12 16V4M6 10l6-6 6 6M5 20h14'),
  sprint: s('M4 5l7 7-7 7M12 5l7 7-7 7'),
  use: s('M8 13V5h2.5v6M10.5 11V3H13v8M13 11V5h2.5v7M15.5 12V8H18v8l-3 6H9l-5-7 2-1 2 2'),
  random: s('M4 4h16v16H4z') + f('M7 7h3v3H7zM14 7h3v3h-3zM10.5 10.5h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3z'),
  reset: s('M5 8a8.5 8.5 0 1 1-1 6M4 3v5.5h5.5'),
  check: s('M4 13l5 5L20 6'),
  lock: s('M5 11h14v10H5zM8 11V7l2-3h4l2 3v4M12 15v2'),
  skip: s('M3 5l7 7-7 7M11 5l7 7-7 7M21 5v14'),
  up: s('M5 15l7-7 7 7'), down: s('M5 9l7 7 7-7'), left: s('M15 5l-7 7 7 7'), right: s('M9 5l7 7-7 7'),
  // input
  mouse: s('M8 3h8l2 3v12l-2 3H8l-2-3V6zM12 3v6'),
  tap: s('M12 2v2M4 11H2M6 5L4.5 3.5M18 5l1.5-1.5M10 22V10h3v6h6v6'),
  drag: s('M9 22V11h3v5h6v6M3 6h13M13 3l3 3-3 3M6 3L3 6l3 3'),
  stick: s('M8 8h8v8H8zM12 1l-2.5 3h5zM12 23l-2.5-3h5zM1 12l3-2.5v5zM23 12l-3-2.5v5z'),
  dpad: s('M9 3h6v6h6v6h-6v6H9v-6H3V9h6z') + f('M11 11h2v2h-2z'),
  // face buttons on PlayStation style pads
  'ps-cross': s('M6 6l12 12M18 6L6 18'),
  'ps-circle': s('M12 5a7 7 0 1 0 .01 0'),
  'ps-square': s('M6 6h12v12H6z'),
  'ps-triangle': s('M12 5l7 13H5z'),
  // compass and map
  marker: f('M12 3l8 9-8 9-8-9z'),
  camp: s('M3 20L12 5l9 15zM12 5v3M10 20l2-5 2 5'),
  danger: s('M12 3l10 18H2zM12 10v6') + f('M11 17.5h2v2h-2z'),
  // crew
  scientist: s('M8 3h8M10 3v6L4 21h16L14 9V3M7.5 15h9'),
  strong: s('M3 6h14l4 3-6 4v3h3v4H6v-4h3v-3C5 13 3 10 3 6z'),
  medic: s('M3 3h18v18H3zM12 7v10M7 12h10'),
  explorer: s('M12 2l8 5v10l-8 5-8-5V7zM16 8l-2.5 5.5L8 16l2.5-5.5z'),
  builder: s('M3 21l9-9M9 8l5-5 7 7-5 5z'),
  social: s('M3 10v4h3l11 5V5L6 10zM8 15l1 6h3l-1-4M20 9v6'),
  // codex
  book: s('M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3zM12 7v15'),
  planet: s('M12 5.5a6.5 6.5 0 1 0 .01 0M2 19C7 18 17 11 22 5'),
  creature: s('M4 9l4-5 4 3 4-3 4 5v6l-4 6H8l-4-6z') + f('M7.5 10h2v2h-2zM14.5 10h2v2h-2zM8.5 13.5h2v2h-2zM13.5 13.5h2v2h-2zM11 11h2v2h-2zM11 15h2v2h-2z'),
  plant: s('M12 21V10M12 13C8 13 5 11 4 6c5 0 8 2 8 7zM12 10c0-4 3-6 8-6 0 4-3 6-8 6z'),
  note: s('M5 3h14v18H5zM9 8h6M9 12h6M9 16h3'),
};

export function icon(name: string, cls = ''): string {
  const body = ICONS[name] ?? ICONS.marker;
  return `<svg class="ic${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

/** Fills every <i data-icon="name"> under root. */
export function applyIcons(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon!); });
}
