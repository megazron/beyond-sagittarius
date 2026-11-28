import sealedText from './mystery.sealed?raw';
import { unseal } from './sealed';
import { addStrings } from '../../i18n';
import { MYSTERY, setMystery, type MyData } from './mysterydata';
export * from './mysterydata';

/**
 * The Ledger's second view and what feeds it (sealed like the episodes' data; the plain master copy is private): the open
 * questions and their stages, the things he notices (each tied to a level), the short beat at the end of each level, the
 * small things off the path, the "previously" lines and their strings. Nothing here is read until `mysteryReady`.
 */
export const mysteryReady: Promise<void> = unseal<MyData>(sealedText).then((d) => {
  setMystery(d);
  if (d.strings) addStrings(d.strings);
}).catch((e) => { console.warn('the Ledger questions did not load', e); });
export const mysteryLoaded = () => !!MYSTERY;
