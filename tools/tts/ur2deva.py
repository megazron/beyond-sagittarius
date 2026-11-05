"""Urdu (Perso-Arabic script) -> Devanagari, for driving a Hindi TTS front-end
with the *Urdu line's own words*.

Urdu script omits most short vowels, so a purely rule-based transliteration is
ambiguous. We therefore use the parallel Hindi line only as a *spelling
dictionary*: each Urdu word is reduced to a consonant/long-vowel "skeleton"; if
a word of the parallel Hindi line has the same skeleton, it is the same word
and its Devanagari spelling is used. Words with no match (Urdu-specific
vocabulary, different loanword spellings) fall back to rule-based
transliteration. The spoken words are always the Urdu line's words.

Pure Python, no third-party code.
"""
from __future__ import annotations

import re
import unicodedata

# --- skeletons ---------------------------------------------------------------
# Consonant classes shared by both scripts (nukta/retroflex-flap differences and
# Arabic-only letters are folded so that equivalent spellings collide).
_UR_SK = {
    'ب': 'B', 'پ': 'P', 'ت': 'T', 'ٹ': 'X', 'ث': 'S', 'ج': 'J', 'چ': 'C', 'ح': 'H',
    'خ': 'K', 'د': 'D', 'ڈ': 'Q', 'ذ': 'J', 'ر': 'R', 'ڑ': 'Q', 'ز': 'J', 'ژ': 'J',
    'س': 'S', 'ش': 'Z', 'ص': 'S', 'ض': 'J', 'ط': 'T', 'ظ': 'J', 'ع': '', 'غ': 'G',
    'ف': 'F', 'ق': 'K', 'ک': 'K', 'ك': 'K', 'گ': 'G', 'ل': 'L', 'م': 'M', 'ن': 'N',
    'ں': 'N', 'و': 'W', 'ؤ': 'W', 'ہ': 'H', 'ه': 'H', 'ۂ': 'H', 'ھ': 'H', 'ء': '',
    'ی': 'Y', 'ي': 'Y', 'ے': 'Y', 'ئ': 'Y', 'ۓ': 'Y', 'ا': 'A', 'آ': 'A', 'ى': 'Y',
    'ة': 'T',
}
_HI_SK = {
    'क': 'K', 'ख': 'KH', 'ग': 'G', 'घ': 'GH', 'ङ': 'N', 'च': 'C', 'छ': 'CH', 'ज': 'J',
    'झ': 'JH', 'ञ': 'N', 'ट': 'X', 'ठ': 'XH', 'ड': 'Q', 'ढ': 'QH', 'ण': 'N', 'त': 'T',
    'थ': 'TH', 'द': 'D', 'ध': 'DH', 'न': 'N', 'प': 'P', 'फ': 'F', 'ब': 'B', 'भ': 'BH',
    'म': 'M', 'य': 'Y', 'र': 'R', 'ल': 'L', 'व': 'W', 'श': 'Z', 'ष': 'Z', 'स': 'S',
    'ह': 'H', 'ा': 'A', 'ि': '', 'ी': 'Y', 'ु': '', 'ू': 'W', 'ृ': 'R', 'े': 'Y',
    'ै': 'Y', 'ो': 'W', 'ौ': 'W', 'ं': 'N', 'ँ': 'N', '्': '', '़': '', 'ः': 'H',
    'अ': 'A', 'आ': 'A', 'इ': 'A', 'ई': 'AY', 'उ': 'A', 'ऊ': 'AW', 'ए': 'AY', 'ऐ': 'AY',
    'ओ': 'AW', 'औ': 'AW', 'ऑ': 'A', 'ॉ': 'A', 'ऋ': 'R',
}
# Phonetic aspirates written with ھ in Urdu are written as a single letter in
# Hindi; both reduce to <consonant>H. Hindi फ is usually Urdu ف or پھ.
_UR_DIACRITICS = re.compile('[ً-ٰٟ۪-ۭ]')


def _collapse(s: str) -> str:
    return re.sub(r'(.)\1+', r'\1', s)


def ur_skeleton(w: str) -> str:
    w = _UR_DIACRITICS.sub('', w)
    s = ''.join(_UR_SK.get(c, '') for c in w)
    if w.endswith(('ے', 'ۓ')):
        s = s[:-1] + 'E'          # final bari-ye = e/ai, distinct from final i
    s = s.replace('PH', 'F')
    return _collapse(s)


def hi_skeleton(w: str) -> str:
    w = unicodedata.normalize('NFD', w)
    s = ''.join(_HI_SK.get(c, '') for c in w)
    if w.rstrip('ंँ').endswith(('े', 'ै', 'ए', 'ऐ')):
        s = s[:-1] + 'E' if not w.endswith(('ं', 'ँ')) else s
    s = s.replace('PH', 'F')
    return _collapse(s)


# --- rule-based fallback -------------------------------------------------------
_CONS = {
    'ب': 'ब', 'پ': 'प', 'ت': 'त', 'ٹ': 'ट', 'ث': 'स', 'ج': 'ज', 'چ': 'च', 'ح': 'ह',
    'خ': 'ख़', 'د': 'द', 'ڈ': 'ड', 'ذ': 'ज़', 'ر': 'र', 'ڑ': 'ड़', 'ز': 'ज़', 'ژ': 'झ़',
    'س': 'स', 'ش': 'श', 'ص': 'स', 'ض': 'ज़', 'ط': 'त', 'ظ': 'ज़', 'غ': 'ग़', 'ف': 'फ़',
    'ق': 'क़', 'ک': 'क', 'ك': 'क', 'گ': 'ग', 'ل': 'ल', 'م': 'म', 'ن': 'न', 'ہ': 'ह',
    'ه': 'ह', 'ة': 'त',
}
_ASP = {'ब': 'भ', 'प': 'फ', 'त': 'थ', 'ट': 'ठ', 'ज': 'झ', 'च': 'छ', 'द': 'ध', 'ड': 'ढ',
        'क': 'ख', 'ग': 'घ', 'ड़': 'ढ़'}
_IND = {'ा': 'आ', 'ी': 'ई', 'े': 'ए', 'ो': 'ओ', 'ू': 'ऊ', 'ै': 'ऐ', 'ौ': 'औ'}


def rule_translit(w: str) -> str:
    w = _UR_DIACRITICS.sub('', w)
    out: list[str] = []          # list of syllable pieces
    prev_cons = False            # last emitted item is a bare consonant
    n = len(w)
    i = 0
    while i < n:
        c = w[i]
        nxt = w[i + 1] if i + 1 < n else ''
        first = i == 0
        last = i == n - 1
        if c == 'ھ':
            if out and out[-1] in _ASP:
                out[-1] = _ASP[out[-1]]
            else:
                out.append('ह')
                prev_cons = True
        elif c == 'آ':
            out.append('आ'); prev_cons = False
        elif c == 'ا':
            if first:
                if nxt == 'و':
                    out.append('ओ'); i += 1
                elif nxt in ('ی', 'ي'):
                    out.append('ए'); i += 1
                else:
                    out.append('अ')
            else:
                out.append('ा' if prev_cons else 'आ')
            prev_cons = False
        elif c in ('و', 'ؤ'):
            if first or (nxt in ('ا', 'ی', 'ے') and not last) and prev_cons is False:
                out.append('व'); prev_cons = True
            elif prev_cons:
                out.append('ो'); prev_cons = False
            else:
                out.append('ओ'); prev_cons = False
        elif c in ('ی', 'ي', 'ى'):
            if first:
                out.append('य'); prev_cons = True
            elif nxt == 'ا':
                out.append('्य' if prev_cons else 'य'); prev_cons = True
            elif prev_cons:
                out.append('ी' if last else 'े'); prev_cons = False
            else:
                out.append('ई' if last else 'ए'); prev_cons = False
        elif c in ('ے', 'ۓ'):
            out.append('े' if prev_cons else 'ए'); prev_cons = False
        elif c == 'ئ':
            if nxt in ('ی', 'ي'):
                out.append('ई'); i += 1
            elif nxt in ('ے', 'ۓ'):
                out.append('ए'); i += 1
            elif nxt == 'و':
                out.append('ओ'); i += 1
            else:
                out.append('ई')
            prev_cons = False
        elif c == 'ں':
            out.append('ं'); prev_cons = False
        elif c == 'ن' and nxt and nxt in _CONS and nxt not in ('ہ', 'ه') and not first:
            out.append('ं'); prev_cons = False
        elif c == 'ع' and first:
            out.append('अ'); prev_cons = False
        elif c in ('ع', 'ء'):
            pass
        elif c in ('ہ', 'ه', 'ۂ') and last and not first and n > 2 and prev_cons:
            out.append('ा'); prev_cons = False   # silent final he: ناشتہ -> नाश्ता
        elif c in _CONS:
            out.append(_CONS[c]); prev_cons = True
        else:
            out.append(c); prev_cons = False
        i += 1
    s = ''.join(out)
    return unicodedata.normalize('NFC', s)


_WORD = re.compile('(?:[^\\W\\d_]|[ً-ٰٟ])+')

# Very frequent short words whose vowels the skeleton cannot recover.
_EXCEPT = {
    'کہ': 'कि', 'یہ': 'यह', 'وہ': 'वह', 'نہ': 'न', 'اس': 'इस', 'ان': 'इन', 'اُس': 'उस',
    'کیا': 'क्या', 'ہے': 'है', 'ہیں': 'हैं', 'ہو': 'हो', 'تم': 'तुम', 'ہم': 'हम',
    'کو': 'को', 'سے': 'से', 'پر': 'पर', 'تو': 'तो', 'بھی': 'भी', 'گی': 'गी', 'گا': 'गा',
    'گے': 'गे', 'کی': 'की', 'کے': 'के', 'کا': 'का', 'لیے': 'लिए', 'ہوئی': 'हुई',
}


def urdu_line_to_devanagari(ur: str, hi_parallel: str = '') -> tuple[str, dict]:
    """Return (devanagari_text, stats). Punctuation/digits are kept as is."""
    lex: dict[str, str] = {}
    for hw in re.findall('[ऀ-ॣ०-ॿ]+', hi_parallel or ''):
        lex.setdefault(hi_skeleton(hw), hw)
    stats = {'words': 0, 'matched': 0, 'rule': 0}

    def sub(m: re.Match) -> str:
        w = m.group(0)
        izafat = w.endswith('\u0650') and len(w) > 2   # نظامِ -> nizaam-e
        w = _UR_DIACRITICS.sub('', w)
        stats['words'] += 1
        if w in _EXCEPT:
            stats['matched'] += 1
            return _EXCEPT[w]
        sk = ur_skeleton(w)
        if izafat:
            return (lex.get(sk) or rule_translit(w)) + 'े'
        if sk and sk in lex:
            stats['matched'] += 1
            return lex[sk]
        stats['rule'] += 1
        return rule_translit(w)

    out = _WORD.sub(sub, ur)
    out = out.replace('۔', '.').replace('،', ',').replace('؟', '?').replace('٪', '%')
    return out, stats
