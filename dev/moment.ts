// Dev-only stage for the choice layer (ui/moment.ts) over a still: ?bg=stills/x.jpg&lang=en&dev=kbm|pad|touch
// &show=fork|act|three|press|hold|beat|ledger|bonds&faces=x,y,r;x,y,r (CSS px, fake faces for placement)
// &look=large,contrast,still. Never shipped. Stills in dev/stills are not committed.
import '../src/style.css';
import { setLang } from '../src/i18n';
import { initGlyphs } from '../src/ui/glyphs';
import { MomentLayer } from '../src/ui/moment';
import type { Input } from '../src/game/input';

const q = new URLSearchParams(location.search);
const lang = (q.get('lang') ?? 'en') as 'en' | 'hi' | 'ur';
setLang(lang); document.body.classList.add(`lang-${lang}`); document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
const dev = q.get('dev') ?? 'kbm';
if (dev === 'touch') document.body.classList.add('touch');
initGlyphs({ device: dev, padStyle: q.get('pad') ?? 'xbox', onDevice() {}, binds: { kb: {}, pad: {} } } as unknown as Input);
for (const k of (q.get('look') ?? '').split(',').filter(Boolean)) document.body.classList.add(`mo-${k}`);
document.body.style.backgroundImage = `url(${q.get('bg') ?? 'stills/fork.jpg'})`;
const faces = (q.get('faces') ?? '').split(';').filter(Boolean).map((s) => { const [x, y, r] = s.split(',').map(Number); return { x, y, r }; });
(MomentLayer as unknown as { fakeFaces: unknown }).fakeFaces = faces;
const m = new MomentLayer();
(window as unknown as { mo: MomentLayer }).mo = m;
const show = (q.get('show') ?? 'fork').split(',');
const noop = () => {};
// literal strings (t() hands back an unknown key as it is), per language
const D = {
  en: { prompt: 'A placeholder question for the dev stage, about this long.', a: 'First answer', b: 'Second answer', c: 'A third, longer answer here', actp: 'A placeholder for a physical choice.', x: 'Reach left', y: 'Reach right', hold: 'Keep holding', breath: 'On the beat', grab: 'Press now', ledger: 'A placeholder note in the hand, two lines long so the strip wraps.' },
  hi: { prompt: 'डेव मंच के लिए एक नमूना सवाल, लगभग इतना लंबा।', a: 'पहला जवाब', b: 'दूसरा जवाब', c: 'तीसरा, थोड़ा लंबा जवाब', actp: 'किसी काम वाले चुनाव का नमूना।', x: 'बाएँ पकड़ो', y: 'दाएँ पकड़ो', hold: 'पकड़े रहो', breath: 'धड़कन पर', grab: 'अभी दबाओ', ledger: 'हाथ से लिखा एक नमूना नोट, दो पंक्तियों जितना लंबा।' },
  ur: { prompt: 'ڈیو اسٹیج کے لیے ایک نمونہ سوال، تقریباً اتنا لمبا۔', a: 'پہلا جواب', b: 'دوسرا جواب', c: 'تیسرا، ذرا لمبا جواب', actp: 'کسی کام والے انتخاب کا نمونہ۔', x: 'بائیں پکڑو', y: 'دائیں پکڑو', hold: 'پکڑے رہو', breath: 'دھڑکن پر', grab: 'ابھی دباؤ', ledger: 'ہاتھ سے لکھا ایک نمونہ نوٹ، دو سطروں جتنا لمبا۔' },
}[lang];
for (const s of show) {
  if (s === 'fork') m.choose({ who: 'crew.scientist.name', prompt: D.prompt, style: 'talk', seconds: +(q.get('sec') ?? 8), fallback: 1, options: [{ label: D.a, tone: 'truth' }, { label: D.b, tone: 'kind' }], onDone: noop });
  if (s === 'three') m.choose({ who: 'crew.scientist.name', prompt: D.prompt, style: 'talk', seconds: q.get('sec') === '0' ? null : +(q.get('sec') ?? 8), fallback: 1, options: [{ label: D.a, tone: 'truth' }, { label: D.b, tone: 'kind' }, { label: D.c, tone: 'joke' }], onDone: noop });
  if (s === 'act') m.choose({ as: 'crew.medic.name', prompt: D.actp, style: 'act', seconds: 5, fallback: 0, options: [{ label: D.x, tone: 'nerve' }, { label: D.y, tone: 'kind' }], onDone: noop });
  if (s === 'press' || s === 'hold' || s === 'beat') m.quick({ kind: s, label: s === 'hold' ? D.hold : s === 'beat' ? D.breath : D.grab, as: s === 'hold' ? 'crew.strong.name' : undefined, seconds: s === 'hold' ? 3 : 2.2, count: 4, onDone: noop });
  if (s === 'ledger') m.ledger(D.ledger);
  if (s === 'bonds') m.bond([{ from: 'builder', to: 'medic', before: 1, after: 3 }, { from: 'social', to: 'medic', before: 0, after: -2 }]);
}
// a stepped clock: ?t=seconds advances the layer by that much (the fuse, the beats)
const T = +(q.get('t') ?? 0);
for (let i = 0; i < T * 60; i++) m.update(1 / 60);
(window as unknown as { step: (s: number) => void }).step = (s: number) => { for (let i = 0; i < s * 60; i++) m.update(1 / 60); };
// ?answer=N: press N (1-based) 1.3 s in, to see the taken slip and the others swept off
if (q.get('answer')) setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${q.get('answer')}` })), 1300);
// ?press=1: a reflex press/hold 1.0 s in (hold: kept down)
if (q.get('press')) setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })), 1000);
// the layer runs on update(): a real clock here, so the fuse burns while the page is up
let last = performance.now();
const tick = () => { const n = performance.now(); m.update(Math.min(0.1, (n - last) / 1000)); last = n; requestAnimationFrame(tick); };
if (q.get('live')) requestAnimationFrame(tick);
