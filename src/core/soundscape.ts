import { audio } from './audio';
import { LAKE } from '../world/heightfield';

/**
 * What you hear where you are. Every frame main.ts says where the game is (title, the Vault, Zenvora, the take-off,
 * the deck, the planet by day or night, an away stage, a fight); this picks the music and the ambience beds and
 * crossfades only when that changes. Positional sounds (footsteps, a fire, engines) are placed by their owners
 * through `audio.sample(..., { at })` and `audio.emitter`; the ears follow the camera (`listen`).
 */
export type Where = {
  state: string;
  mode?: string;
  /** Away stage id: 'city', 'ring', 'scree', 'wreck', 'moon', 'clouds'. */
  away?: string | null;
  /** In the friends' flat in Zenvora. */
  indoors?: boolean;
  hours?: number;
  /** Player position on the planet. */
  pos?: { x: number; z: number };
  danger?: boolean;
  fire?: { x: number; y: number; z: number } | null;
  /** 0..1 rain, when the world has weather. */
  rain?: number;
  dt?: number;
};

/** One-shots that make a place alive: each kind comes back at a random interval, from a random spot around the ears. */
type Spot = { name: string; every: [number, number]; vol: number; dist: [number, number]; height: number; near: number; far: number; outside?: boolean; rate?: [number, number] };
const CITY: Spot[] = [
  { name: 'siren', every: [28, 70], vol: 0.55, dist: [90, 160], height: 4, near: 40, far: 600, outside: true },
  { name: 'horn', every: [9, 26], vol: 0.35, dist: [25, 60], height: 1.5, near: 8, far: 200, outside: true, rate: [0.9, 1.1] },
  { name: 'hover_pass', every: [7, 18], vol: 0.6, dist: [10, 24], height: 3, near: 6, far: 120, outside: true },
  { name: 'bird', every: [6, 16], vol: 0.3, dist: [8, 25], height: 9, near: 4, far: 60, outside: true, rate: [0.9, 1.15] },
];
const PLANET_DAY: Spot[] = [
  // the planet's own birds: the same calls slower and lower, from the trees
  { name: 'bird', every: [4, 11], vol: 0.35, dist: [12, 40], height: 7, near: 5, far: 90, rate: [0.6, 0.8] },
];
const next = new Map<string, number>();
let clock = 0;
function spots(list: Spot[], dt: number, indoors: boolean) {
  clock += dt;
  const ear = audio.earPos;
  for (const s of list) {
    const due = next.get(s.name);
    if (due === undefined) { next.set(s.name, clock + s.every[0] * Math.random()); continue; }
    if (clock < due) continue;
    next.set(s.name, clock + s.every[0] + Math.random() * (s.every[1] - s.every[0]));
    const a = Math.random() * Math.PI * 2, d = s.dist[0] + Math.random() * (s.dist[1] - s.dist[0]);
    const r = s.rate ? s.rate[0] + Math.random() * (s.rate[1] - s.rate[0]) : 1;
    audio.sample(s.name, s.vol * (indoors && s.outside ? 0.7 : 1), { at: { x: ear.x + Math.cos(a) * d, y: ear.y + s.height, z: ear.z + Math.sin(a) * d }, near: s.near, far: s.far, outside: s.outside, rate: r });
  }
}

let key = '';
let scene: { music: string | null; vol: number; beds?: Record<string, number> } | null = null;
/** A scene takes over the music (and beds) for as long as it plays: the black hole's pull, the take-off. null hands it back. */
export function sceneSound(s: { music: string | null; vol?: number; beds?: Record<string, number> } | null) { scene = s ? { vol: 0.7, ...s } : null; }
let fire: ReturnType<typeof audio.emitter> | null = null;
let fireAt = '';
let lakeK = -1;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function soundscape(w: Where) {
  let music: string | null = null, mvol = 0.6;
  let beds: Record<string, number> = {};
  const night = w.hours !== undefined ? 1 - smooth(5, 7, w.hours) + smooth(18.5, 20.5, w.hours) : 0;
  switch (w.state) {
    case 'title': music = 'title'; mvol = 0.55; break;
    case 'narrator': music = 'vault'; mvol = 0.55; break;
    case 'cinematic': music = 'deck'; mvol = 0.45; beds = { amb_ship: 0.35 }; break;
    case 'flashback': music = 'deck'; mvol = 0.3; beds = { amb_ship: 0.3 }; break;
    case 'film': break; // the title sequence has its own score
    case 'game':
      if (w.mode === 'away' && w.away === 'city') {
        music = 'zenvora'; mvol = w.indoors ? 0.22 : 0.42;
        // indoors the street beds stay up: the walls (setIndoors) take their top off, which is what makes it sound inside
        beds = w.indoors ? { amb_room: 0.5, amb_street: 0.35, amb_traffic: 0.25, amb_walla: 0.2 } : { amb_bazaar: 0.75, amb_street: 0.55, amb_traffic: 0.4, amb_walla: 0.45 };
      } else if (w.mode === 'away') {
        music = 'planet_night'; mvol = 0.32;
        beds = w.away === 'wreck' || w.away === 'scree' ? { amb_ship: 0.45 } : { amb_wind: 0.55 };
      } else if (w.mode && w.mode !== 'away') {
        music = w.danger ? 'danger' : night > 0.5 ? 'planet_night' : 'planet_day';
        mvol = w.danger ? 0.55 : 0.3;
        const day = Math.round((1 - night) * 10) / 10;
        beds = { amb_planet_day: 0.5 * day, amb_planet_night: 0.5 * (1 - day), amb_wind: 0.22 };
        if (w.pos) {
          const d = Math.hypot(w.pos.x - LAKE.x, w.pos.z - LAKE.z) - LAKE.r;
          const k = Math.round(Math.max(0, 1 - d / 45) * 10) / 10;
          beds.amb_lake = 0.55 * k;
          lakeK = k;
        }
      }
      break;
  }
  // rain over whatever else is outside, heard through the roof when you are in
  const rain = Math.round((w.rain ?? 0) * 10) / 10;
  if (rain > 0 && w.state === 'game') { if (w.indoors) beds.amb_rain_in = 0.5 * rain; else beds.amb_rain = 0.6 * rain; }
  // the space the ears are in, for the reverb; and whether the outside is through a wall
  const city = w.state === 'game' && w.mode === 'away' && w.away === 'city';
  audio.setSpace(w.state === 'narrator' ? 'hall' : w.state === 'cinematic' || w.state === 'flashback' ? 'ship' : city ? (w.indoors ? 'room' : 'street')
    : w.state === 'game' && w.mode === 'away' && (w.away === 'wreck' || w.away === 'scree') ? 'ship' : 'open');
  audio.setIndoors(city && w.indoors ? 1 : 0);
  if (w.dt && w.state === 'game' && !scene) {
    if (city) spots(CITY, w.dt, !!w.indoors);
    else if (w.mode && w.mode !== 'away' && night < 0.5) spots(PLANET_DAY, w.dt, false);
  }
  if (scene && w.state !== 'title') { music = scene.music; mvol = scene.vol; if (scene.beds) beds = scene.beds; }
  const k = JSON.stringify([music, mvol, beds, !!audio.ctx]); // again once sound is allowed to start
  if (k !== key) {
    key = k;
    audio.music(music, mvol);
    audio.setBeds(Object.fromEntries(Object.entries(beds).filter(([, v]) => v > 0.001)));
  }
  // the camp fire is heard where it burns
  const fk = w.fire && audio.ctx && w.state === 'game' && w.mode !== 'away' ? `${w.fire.x.toFixed(1)},${w.fire.z.toFixed(1)}` : '';
  if (fk !== fireAt) {
    fireAt = fk;
    fire?.stop(); fire = null;
    if (fk && w.fire) fire = audio.emitter('amb_fire', { x: w.fire.x, y: w.fire.y + 0.4, z: w.fire.z }, 0.9, 2.5, 35);
  }
  void lakeK;
}

/** For the tests: what is playing. */
export function soundscapeState() { return { music: audio.musicPlaying, beds: audio.bedsPlaying, key }; }
