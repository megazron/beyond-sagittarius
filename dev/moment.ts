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
  en: { prompt: 'The needle moved again. A sensor fault, surely.', a: 'Tell them now', b: 'Check it again', c: 'Make a joke of it', actp: 'Nuvexa is sliding past. Bolzar is going down. One hand.', x: 'Catch Nuvexa', y: 'Catch Bolzar', hold: 'Hold Bolzar', breath: 'Hold your breath', grab: 'Grab the console', ledger: 'Bolzar will remember whose hand it was. Nuvexa hit the wall alone.' },
  hi: { prompt: 'सुई फिर हिली। ज़रूर सेंसर की गड़बड़ है।', a: 'अभी सबको बता दो', b: 'एक बार और जाँचो', c: 'मज़ाक में टाल दो', actp: 'नुवेक्सा फिसल रही है। बोल्ज़ार गिर रहा है। एक ही हाथ।', x: 'नुवेक्सा को पकड़ो', y: 'बोल्ज़ार को पकड़ो', hold: 'बोल्ज़ार को थामे रहो', breath: 'साँस रोको', grab: 'कंसोल पकड़ो', ledger: 'बोल्ज़ार याद रखेगा कि हाथ किसका था। नुवेक्सा अकेली दीवार से टकराई।' },
  ur: { prompt: 'سوئی پھر ہلی۔ ضرور سینسر کی خرابی ہے۔', a: 'ابھی سب کو بتا دو', b: 'ایک بار اور جانچو', c: 'مذاق میں ٹال دو', actp: 'نوویکسا پھسل رہی ہے۔ بولزار گر رہا ہے۔ ایک ہی ہاتھ۔', x: 'نوویکسا کو پکڑو', y: 'بولزار کو پکڑو', hold: 'بولزار کو تھامے رکھو', breath: 'سانس روکو', grab: 'کنسول پکڑو', ledger: 'بولزار یاد رکھے گا کہ ہاتھ کس کا تھا۔ نوویکسا اکیلی دیوار سے ٹکرائی۔' },
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
