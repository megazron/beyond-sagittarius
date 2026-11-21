import * as THREE from 'three';

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
  const liquidMat = new THREE.MeshStandardMaterial({ color: 0xa8641e, roughness: 0.05, metalness: 0.1, emissive: 0x3a1a06, side: THREE.DoubleSide });
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
  const cockpit = new THREE.Group(); cockpit.position.set(30, 0, 0); deck.parent ? deck.parent.add(cockpit) : deck.add(cockpit);
  const att = canvasScreen(0.42, 0.3, 512);
  {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x6f7782, metalness: 0.5, roughness: 0.5, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(2.6, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), shellMat); shell.position.y = -1.0; cockpit.add(shell);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.6, roughness: 0.5 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -2.2; cockpit.add(floor);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.7), metal); dash.position.set(0, -1.35, -1.55); dash.rotation.x = -0.35; cockpit.add(dash);
    att.mesh.position.set(0, -1.06, -1.34); att.mesh.rotation.x = -0.35 - 0.2; cockpit.add(att.mesh);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.6), metal); seat.position.set(0, -1.72, -0.2); cockpit.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.1), metal); back.position.set(0, -1.45, 0.14); back.rotation.x = 0.15; cockpit.add(back);
    // the window: an opening in the shell's front; the space dome shows through it
    const frame = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.05, 8, 48, Math.PI), metal); frame.position.set(0, -0.95, -2.2); cockpit.add(frame);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.0) })); strip.position.set(0, -1.08, -1.2); cockpit.add(strip);
  }
  const stick = new THREE.Group(); stick.position.set(0, -1.66, -0.78); cockpit.add(stick);
  { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.34, 12), bezel); s.position.y = 0.17; stick.add(s);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.08, 4, 12), metal); grip.position.y = 0.36; stick.add(grip); }
  const cockLight = new THREE.PointLight(0xffb070, 3, 6, 2); cockLight.position.set(0, -0.4, -0.9); cockpit.add(cockLight);
  const cockKey = new THREE.PointLight(0xcfe6ff, 4, 8, 1.8); cockKey.position.set(0.6, 0.4, 0.8); cockpit.add(cockKey);
  cockpit.visible = false;

  return {
    cockpit, stick,
    /** A3: needle angle in radians from straight up (negative is left). */
    gauge(angle: number) { needle.rotation.z = -angle; },
    gaugeAt: gauge,
    /** B2: place the cup (deck coordinates) and lean the drink: `lean` radians of "down" turning, `climb` 0..1 the
     *  liquid riding up the low side, `dropK` 0..1 a drop climbing over the rim. */
    cup(pos: THREE.Vector3 | null, lean = 0, climb = 0, dropK = 0) {
      cup.visible = !!pos; if (!pos) return;
      cup.position.copy(pos);
      const a = Math.min(0.7, lean + climb * 0.25);
      liquid.rotation.set(-Math.PI / 2 - a, 0, 0); // the high side towards the lens, where the drop climbs liquid.position.set(0, 0.012 - climb * 0.004, 0);
      liquid.scale.set(1, 1 / Math.cos(a) * 0.98, 1);
      drop.visible = dropK > 0.02; drop.position.set(0, 0.03 + dropK * 0.012, 0.031 + dropK * 0.004); // on the rim facing the lens
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
