import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** The things the pull's lines name, built for their insert shots (SHOTLIST_pull_and_fates: A3 the nav gauge, B2 the
 *  drink, C3 the warning, D1-D3 the cockpit and its attitude display, G2 the comms panel, G4 the readout). Each sits
 *  where it belongs on the deck (or in the cockpit, a small set of its own beside it), so a wide shot and its insert
 *  show the same object in the same place. Screens are canvases redrawn only when what they say changes. */

function canvasScreen(w: number, h: number, pxW = 512) {
  const c = document.createElement('canvas'); c.width = pxW; c.height = Math.round(pxW * h / w);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return { mesh, c, g: c.getContext('2d')!, tex, last: '' };
}

/** Lines of text on a screen, centred, in a colour; drawn only when they change. */
function writeScreen(s: ReturnType<typeof canvasScreen>, lines: string[], color: string, bg = '#04080c', size = 0.11) {
  const key = lines.join('|') + color + bg;
  if (s.last === key) return; s.last = key;
  const { c, g } = s; g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = color; g.globalAlpha = 0.35; g.lineWidth = 3; g.strokeRect(6, 6, c.width - 12, c.height - 12); g.globalAlpha = 1;
  const px = Math.round(c.height * size); g.font = `600 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.shadowColor = color; g.shadowBlur = px * 0.35;
  const lh = px * 1.35, y0 = c.height / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => g.fillText(l, c.width / 2, y0 + i * lh, c.width * 0.92));
  g.shadowBlur = 0; s.tex.needsUpdate = true;
}

export function createInserts(deck: THREE.Group) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b1f26, metalness: 0.8, roughness: 0.3 });
  const bezel = new THREE.MeshStandardMaterial({ color: 0x8a929c, metalness: 0.9, roughness: 0.25 });

  // ---- A3: the nav gauge, at the console's left end; the needle creeps a hair left ----
  // on the console's front face (the top is the tilted screen), facing the room, below Zenvik's eyes
  const gauge = new THREE.Group(); gauge.position.set(-0.85, -1.52, -0.945); deck.add(gauge);
  {
    const face = canvasScreen(0.16, 0.16, 512), { g, c } = face;
    g.fillStyle = '#0b1016'; g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2);
    g.strokeStyle = '#cfe6ff'; g.fillStyle = '#cfe6ff'; g.lineWidth = 4;
    for (let i = -10; i <= 10; i++) { const a = (i / 10) * 1.2 - Math.PI / 2, r0 = i % 5 === 0 ? 150 : 175; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * 200, Math.sin(a) * 200); g.stroke(); }
    g.font = '600 46px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.fillText('NAV DRIFT', 0, 90); g.font = '500 34px sans-serif'; g.fillText('0', 0, -112);
    g.fillStyle = '#ff9a3a'; g.fillRect(-4, -205, 8, 30);
    face.tex.needsUpdate = true;
    gauge.add(new THREE.Mesh(new THREE.CircleGeometry(0.08, 48), new THREE.MeshBasicMaterial({ map: face.tex, toneMapped: false })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.008, 10, 48), bezel); gauge.add(ring);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.08, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false })); glass.position.z = 0.006; gauge.add(glass);
  }
  const needle = new THREE.Group(); needle.position.z = 0.003; gauge.add(needle);
  { const n = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.064, 0.0015), new THREE.MeshBasicMaterial({ color: 0xff5a2a, toneMapped: false })); n.position.y = 0.03; needle.add(n);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 16), bezel); hub.rotation.x = Math.PI / 2; needle.add(hub); }

  // ---- B2: Draxum's drink. The same terracotta cup he holds, open, with the drink in it. Its surface stays square to
  // "down" inside the ship; when the thrust turns, down turns, and the surface leans and climbs one side ----
  const cup = new THREE.Group(); deck.add(cup); cup.visible = false;
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xb5563a, roughness: 0.7, side: THREE.DoubleSide });
  { const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.075, 32, 1, true), cupMat); cup.add(wall);
    const base = new THREE.Mesh(new THREE.CircleGeometry(0.028, 32), cupMat); base.rotation.x = -Math.PI / 2; base.position.y = -0.0375; cup.add(base);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0018, 8, 40), cupMat); lip.rotation.x = Math.PI / 2; lip.position.y = 0.0375; cup.add(lip); }
  // the liquid: a disc clipped to the cup's inside by drawing it only within the cup's radius at each height (a
  // stencil-free trick: the disc is an ellipse fitted to the tilted plane's cut through a cylinder)
  const liquidMat = new THREE.MeshStandardMaterial({ color: 0x5fe0c0, roughness: 0.04, metalness: 0.15, emissive: 0x0f5a48, side: THREE.DoubleSide }); // a pale green soda: it reads against the terracotta
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(0.0315, 40), liquidMat); liquid.rotation.x = -Math.PI / 2; cup.add(liquid);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), liquidMat); drop.visible = false; cup.add(drop);

  // ---- C3: the console's screen, readable straight on ----
  const warn = canvasScreen(2.2, 0.6, 1024); warn.mesh.rotation.x = -Math.PI / 3; warn.mesh.position.set(0, -1.278, -1.248); deck.add(warn.mesh); warn.mesh.visible = false;

  // ---- G2 and G4: a comms panel and the nav readout on the wall by the hatch (screen right, +x end) ----
  const comms = canvasScreen(0.5, 0.28, 512); comms.mesh.position.set(5.2, -0.6, 1.2); comms.mesh.rotation.y = -Math.PI / 2; deck.add(comms.mesh);
  const commsBox = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.58), metal); commsBox.position.set(5.24, -0.6, 1.2); deck.add(commsBox);
  const readout = canvasScreen(0.9, 0.5, 768); readout.mesh.position.set(5.2, -0.6, -0.2); readout.mesh.rotation.y = -Math.PI / 2; deck.add(readout.mesh);
  const readBox = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.56, 0.98), metal); readBox.position.set(5.24, -0.6, -0.2); deck.add(readBox);
  writeScreen(comms, ['COMMS', 'LINK OK'], '#7fe9ff'); writeScreen(readout, ['NAV', 'COURSE NOMINAL'], '#7fe9ff');

  // ---- D1-D3: the cockpit, a set of its own 30 m forward of the deck (never in the same frame) ----
  // A small flight deck: the pilot's seat facing -z, a yoke out of the instrument panel, a glare shield over three
  // displays, side consoles with a throttle, the canopy frame open to space. Dark, matte surfaces so the only bright
  // things are the displays, the buttons and the black hole through the canopy.
  const cockpit = new THREE.Group(); cockpit.position.set(30, 0, 0); deck.parent ? deck.parent.add(cockpit) : deck.add(cockpit);
  const att = canvasScreen(0.42, 0.3, 512), mfdL = canvasScreen(0.34, 0.26, 512), mfdR = canvasScreen(0.34, 0.26, 512);
  const hull = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.35, roughness: 0.62 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.5, roughness: 0.45 });
  const fabric = new THREE.MeshStandardMaterial({ color: 0x1c2330, metalness: 0, roughness: 0.92 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    // rounded edges (a moulded flight deck, not plain boxes): the bevel catches the light along every edge
    const rr = Math.min(0.035, Math.min(w, h, d) * 0.3);
    const o = new THREE.Mesh(rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 3, rr) : new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); cockpit.add(o); return o; };
  {
    // shell: floor, rear bulkhead, side walls with ribs, ceiling
    box(2.9, 0.06, 3.2, trim, 0, -2.23, -0.3);
    box(2.9, 2.6, 0.08, hull, 0, -0.95, 1.25);
    for (const sx of [-1, 1]) {
      box(0.08, 2.6, 3.2, hull, sx * 1.42, -0.95, -0.3);
      for (const z of [-1.3, -0.4, 0.5]) box(0.07, 2.5, 0.12, trim, sx * 1.36, -0.95, z);
      box(0.06, 0.02, 2.4, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.4) }), sx * 1.37, -1.55, -0.2); // floor-level light strip
    }
    box(2.9, 0.08, 2.6, hull, 0, 0.32, 0.0);
    // the overhead panel: a sloped box with rows of switches
    box(1.1, 0.06, 0.55, trim, 0, 0.18, -0.55, 0.45);
    // canopy frame: sill, header, two pillars and corner braces; space shows through the opening
    box(2.9, 0.12, 0.22, trim, 0, -0.98, -1.95);
    box(2.9, 0.14, 0.22, trim, 0, 0.28, -1.75, -0.35);
    for (const sx of [-1, 1]) { box(0.14, 1.4, 0.2, trim, sx * 1.33, -0.33, -1.88, -0.18); box(0.5, 0.1, 0.18, trim, sx * 1.12, 0.12, -1.8, -0.3, 0, sx * 0.6); box(0.4, 0.1, 0.18, trim, sx * 1.15, -0.85, -1.93, 0, 0, -sx * 0.6); }
    // glare shield and instrument panel, tilted back towards the pilot
    box(2.2, 0.07, 0.55, trim, 0, -1.0, -1.42, 0.05);
    const face = box(2.2, 0.5, 0.06, hull, 0, -1.3, -1.17, -0.32);
    att.mesh.position.set(0, -1.29, -1.135); att.mesh.rotation.x = -0.32; cockpit.add(att.mesh);
    mfdL.mesh.position.set(-0.55, -1.3, -1.135); mfdL.mesh.rotation.x = -0.32; cockpit.add(mfdL.mesh);
    mfdR.mesh.position.set(0.55, -1.3, -1.135); mfdR.mesh.rotation.x = -0.32; cockpit.add(mfdR.mesh);
    for (const s of [att, mfdL, mfdR]) s.mesh.position.z += 0.001;
    void face;
    // knee well under the panel, and the side consoles
    box(2.2, 0.7, 0.06, trim, 0, -1.9, -1.25);
    for (const sx of [-1, 1]) box(0.36, 0.5, 1.3, hull, sx * 0.62, -1.98, -0.35);
    // buttons: small lit caps in rows on the panel face, the consoles and the overhead
    const caps: [number, number, number, number, number][] = [];
    for (let i = 0; i < 9; i++) for (let r = 0; r < 2; r++) { caps.push([-1.0 + i * 0.045 * (i > 4 ? 1 : 1), -1.14 - r * 0.05, -1.21 + r * 0.016, -0.32, i]); caps.push([0.78 + (i % 6) * 0.045, -1.14 - r * 0.05, -1.21 + r * 0.016, -0.32, i + 3]); }
    for (let i = 0; i < 6; i++) for (let r = 0; r < 3; r++) for (const sx of [-1, 1]) caps.push([sx * (0.52 + (i % 3) * 0.08), -1.72, -0.75 + r * 0.12 + Math.floor(i / 3) * 0.4, 0, i + r]);
    for (let i = 0; i < 12; i++) caps.push([-0.4 + i * 0.07, 0.14, -0.62, 0.45, i * 2]);
    const capG = new THREE.BoxGeometry(0.022, 0.012, 0.022), cols = [0x7fe9ff, 0xffb347, 0x7dff9a, 0xff5a3a, 0xffffff];
    caps.forEach(([x, y, z, rx, c]) => { const m = new THREE.Mesh(capG, new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[c % cols.length]).multiplyScalar(c % 4 === 0 ? 1.4 : 0.55) })); m.position.set(x, y, z); m.rotation.x = rx + Math.PI / 2 * (Math.abs(rx) > 0.3 ? 0 : 0); cockpit.add(m); });
    // the seat: cushion, back with bolsters, headrest, on a pedestal
    box(0.18, 0.4, 0.18, trim, 0, -2.0, -0.05);
    box(0.56, 0.1, 0.52, fabric, 0, -1.75, -0.12);
    box(0.56, 0.78, 0.1, fabric, 0, -1.3, 0.2, 0.12);
    for (const sx of [-1, 1]) box(0.08, 0.6, 0.16, fabric, sx * 0.3, -1.36, 0.16, 0.12);
    box(0.32, 0.2, 0.09, fabric, 0, -0.82, 0.28, 0.12);
    // the throttle on the left console
    const thr = box(0.025, 0.16, 0.025, trim, -0.56, -1.66, -0.45, 0.3); void thr;
    box(0.06, 0.04, 0.08, new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.35 }), -0.56, -1.58, -0.48, 0.3);
    writeScreen(mfdL, ['THRUST', '100%'], '#7fe9ff', '#04080c', 0.2);
    writeScreen(mfdR, ['NAV', 'ON COURSE'], '#7fe9ff', '#04080c', 0.2);
  }
  // the yoke: a column out of the panel, a bar and two horns; it rolls about the column and slides in and out
  // out of the panel face, at the seated pilot's reach
  const stick = new THREE.Group(); stick.position.set(0, -1.3, -0.4); cockpit.add(stick); // in reach: at -0.56 her arms ran out 5 to 10 cm short and the wrists wandered on the horns
  const grips = { L: new THREE.Vector3(0.17, 0.02, 0), R: new THREE.Vector3(-0.17, 0.02, 0) };
  { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.72, 14), bezel); col.rotation.x = Math.PI / 2; col.position.z = -0.36; stick.add(col);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.035), metal); stick.add(bar);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20), metal); hub.rotation.x = Math.PI / 2; stick.add(hub);
    for (const sx of [-1, 1]) { const horn = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.1, 4, 12), new THREE.MeshStandardMaterial({ color: 0x101215, roughness: 0.75 })); horn.position.set(sx * 0.17, 0.035, 0); stick.add(horn); } }
  // the displays' own glow on her from below (cool, soft: the orange lamp here lit her harsh orange)
  const cockLight = new THREE.PointLight(0x9cc4ff, 1.3, 3, 2); cockLight.position.set(0, -1.0, -1.0); cockpit.add(cockLight);
  const cockKey = new THREE.PointLight(0xcfe6ff, 3, 6, 1.8); cockKey.position.set(0.5, 0.1, 0.6); cockpit.add(cockKey);
  // off the yoke's axis: it blew a highlight on the hub in front of the display
  const cockFill = new THREE.PointLight(0x7fd0ff, 0.8, 3, 2); cockFill.position.set(0.55, -0.85, -0.7); cockpit.add(cockFill);
  cockpit.visible = false;

  return {
    cockpit, stick,
    /** World points (wrists) and directions for the pilot's hands on the yoke's horns, refreshed each frame. */
    yokeHold(out: { L: { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3 }; R: { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3 } }) {
      stick.updateWorldMatrix(true, false);
      const q = stick.getWorldQuaternion(new THREE.Quaternion());
      for (const sd of ['L', 'R'] as const) {
        const sx = sd === 'R' ? -1 : 1, o = out[sd]; // facing -z, the rig's right hand is on -x (measured)
        // the wrist sits just outside and behind the horn; the fingers go forward round it; the palm faces in
        o.at.copy(grips[sd]).add(new THREE.Vector3(sx * 0.045, -0.02, 0.07)).applyMatrix4(stick.matrixWorld);
        o.fingers.set(-sx * 0.35, -0.15, -1).applyQuaternion(q);
        o.palm.set(-sx, 0, 0.15).applyQuaternion(q);
      }
    },
    /** D: what the two side displays say. */
    mfd(left: string[], right: string[], color = '#7fe9ff') { writeScreen(mfdL, left, color, '#04080c', 0.2); writeScreen(mfdR, right, color, '#04080c', 0.2); },
    /** A3: needle angle in radians from straight up (negative is left). */
    gauge(angle: number) { needle.rotation.z = -angle; },
    gaugeAt: gauge,
    /** B2: place the cup (deck coordinates) and lean the drink: `lean` radians of "down" turning, `climb` 0..1 the
     *  liquid riding up the low side, `dropK` 0..1 a drop climbing over the rim. */
    cup(pos: THREE.Vector3 | null, lean = 0, climb = 0, dropK = 0) {
      cup.visible = !!pos; if (!pos) return;
      cup.position.copy(pos);
      const a = Math.min(0.5, lean + climb * 0.2); // the high edge stays under the rim
      liquid.rotation.set(-Math.PI / 2 - a, 0, 0); // the high side towards the lens, where the drop climbs
      liquid.position.set(0, 0.016 - climb * 0.003, 0);
      liquid.scale.set(1, 1 / Math.cos(a) * 0.98, 1);
      drop.visible = dropK > 0.02; drop.position.set(0, 0.03 + dropK * 0.009, 0.031 + dropK * 0.004); // on the rim facing the lens
    },
    /** C3: the console screen readable, or back to the holo-only look. */
    warn(lines: string[] | null, color = '#ffb347') { warn.mesh.visible = !!lines; if (lines) writeScreen(warn, lines, color, '#0d0703', 0.16); },
    /** D3: roll (rad) and pitch (-1..1) of the attitude display's horizon; `fail` turns it amber. */
    attitude(roll: number, pitch: number, fail = false) {
      const key = `${roll.toFixed(3)}|${pitch.toFixed(3)}|${fail}`; if (att.last === key) return; att.last = key;
      const { g, c } = att, w = c.width, h = c.height;
      g.save(); g.fillStyle = '#05080c'; g.fillRect(0, 0, w, h); g.translate(w / 2, h / 2); g.rotate(roll);
      g.fillStyle = '#1d4f7a'; g.fillRect(-w, -h * 2 + pitch * h * 0.4, w * 2, h * 2);
      g.fillStyle = '#5a3d22'; g.fillRect(-w, pitch * h * 0.4, w * 2, h * 2);
      g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.beginPath(); g.moveTo(-w, pitch * h * 0.4); g.lineTo(w, pitch * h * 0.4); g.stroke();
      g.restore();
      g.strokeStyle = fail ? '#ffb347' : '#7fe9ff'; g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2 - 90, h / 2); g.lineTo(w / 2 - 30, h / 2); g.lineTo(w / 2, h / 2 + 20); g.lineTo(w / 2 + 30, h / 2); g.lineTo(w / 2 + 90, h / 2); g.stroke();
      g.font = '600 30px "Barlow Condensed", sans-serif'; g.fillStyle = fail ? '#ffb347' : '#7fe9ff'; g.textAlign = 'left'; g.fillText(fail ? 'CORRECTION FAILED' : 'ATTITUDE', 16, 36);
      att.tex.needsUpdate = true;
    },
    comms(lines: string[], color = '#7fe9ff') { writeScreen(comms, lines, color); },
    readout(lines: string[], color = '#7fe9ff') { writeScreen(readout, lines, color, '#04080c', 0.13); },
    commsAt: comms.mesh, readoutAt: readout.mesh, warnAt: warn.mesh, attAt: att.mesh,
  };
}
export type Inserts = ReturnType<typeof createInserts>;
