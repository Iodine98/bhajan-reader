/**
 * i18n.js — UI string translations.
 * Add a new top-level key to STRINGS to support additional languages.
 */

const STRINGS = {
  en: {
    // Header buttons
    upload: 'Upload', uploadTitle: 'Upload .bhajan file',
    export: 'Export', exportTitle: 'Export translation as JSON',
    settingsBtnTitle: 'Settings',

    // Theme
    themeToDark: 'Switch to dark theme',
    themeToLight: 'Switch to light theme',

    // Lang select options
    langEn: 'English', langNl: 'Dutch',

    // Panel label (current translation language)
    panelCurrent: 'English',

    // Nav buttons
    beginningTitle: 'Go to beginning',
    prevPhraseTitle: 'Previous phrase (↑)',
    prevWordTitle: 'Previous word (←)',
    nextWordTitle: 'Next word (Space / →)',
    nextPhraseTitle: 'Next phrase (↓)',

    // Mic
    micEnableTitle: 'Enable microphone',
    micOnsetOffTitle: 'Disable microphone onset detection',
    micSpeechOffTitle: 'Disable speech recognition',
    micOff: 'Mic off', micOn: 'Mic on', listening: 'Listening…',
    micModeTitle: 'Microphone mode',
    modeOnset: 'Onset', modeSpeech: 'Speech',

    // Status bar
    initialStatus: 'Upload a .bhajan file to begin.',
    ready: 'Ready. Use Space / → to advance.',
    waitingOperator: 'Waiting for operator…',
    phrase: (cur, total) =>
      `Phrase ${cur} / ${total}  ·  Space or → to advance  ·  ↑/↓ for phrases`,

    // Empty state
    emptyText: 'Upload a .bhajan file to begin',
    emptyHint: 'Drag & drop or click Upload',

    // Drop overlay
    dropHint: 'Drop your .bhajan file here',

    // Loading messages
    loadingParsing: 'Parsing file…',
    loadingCache: 'Loaded from cache.',
    loadingSaved: 'Loaded from saved translation.',
    loadingNoKey: 'No API key — showing transliteration only.',
    loadingTranslating: 'Translating with Claude…',
    loadingDone: 'Translation complete.',

    // Settings modal
    settingsHeading: 'Settings',
    apiKeyLabel: 'Claude API Key',
    apiKeyHint: 'Required for translation. Your key is stored only in this browser.',
    hintValid: 'valid', hintInvalid: 'invalid',
    hintUnknown: 'could not reach the API — your key may still work',
    verify: 'Verify', verifyTitle: 'Verify API key',
    thresholdLabel: 'Onset Detection Threshold',
    thresholdHint: 'Higher = less sensitive, fewer false triggers in noisy rooms.',
    refractoryLabel: 'Refractory Period',
    refractoryHint: 'Minimum gap between detected onsets. Increase for slower chanting.',
    speechLangLabel: 'Recognition Language',
    speechLangHint: 'Hindi works best for Sanskrit chanting in most browsers.',
    speechHindi: 'Hindi (recommended for Sanskrit)',
    speechSanskrit: 'Sanskrit',
    speechEnglish: 'English (phonetic)',
    displayLabel: 'Projected Display',
    openDisplay: 'Open Display Window',
    displayHint: 'Opens a fullscreen audience view. Keep this window open as the operator.',
    closeTitle: 'Close',
  },

  nl: {
    // Header buttons
    upload: 'Uploaden', uploadTitle: '.bhajan bestand uploaden',
    export: 'Exporteren', exportTitle: 'Vertaling exporteren als JSON',
    settingsBtnTitle: 'Instellingen',

    // Theme
    themeToDark: 'Naar donker thema',
    themeToLight: 'Naar licht thema',

    // Lang select options
    langEn: 'Engels', langNl: 'Nederlands',

    // Panel label
    panelCurrent: 'Nederlands',

    // Nav buttons
    beginningTitle: 'Naar het begin',
    prevPhraseTitle: 'Vorige zin (↑)',
    prevWordTitle: 'Vorig woord (←)',
    nextWordTitle: 'Volgend woord (Spatie / →)',
    nextPhraseTitle: 'Volgende zin (↓)',

    // Mic
    micEnableTitle: 'Microfoon inschakelen',
    micOnsetOffTitle: 'Microfoon aanvangsdetectie uitschakelen',
    micSpeechOffTitle: 'Spraakherkenning uitschakelen',
    micOff: 'Mic uit', micOn: 'Mic aan', listening: 'Luisteren…',
    micModeTitle: 'Microfoonmodus',
    modeOnset: 'Aanvang', modeSpeech: 'Spraak',

    // Status bar
    initialStatus: 'Upload een .bhajan bestand om te beginnen.',
    ready: 'Klaar. Gebruik Spatie / → om door te gaan.',
    waitingOperator: 'Wachten op operator…',
    phrase: (cur, total) =>
      `Zin ${cur} / ${total}  ·  Spatie of → voor verder  ·  ↑/↓ voor zinnen`,

    // Empty state
    emptyText: 'Upload een .bhajan bestand om te beginnen',
    emptyHint: 'Sleep hier naartoe of klik op Uploaden',

    // Drop overlay
    dropHint: 'Sleep uw .bhajan bestand hier naartoe',

    // Loading messages
    loadingParsing: 'Bestand verwerken…',
    loadingCache: 'Geladen uit cache.',
    loadingSaved: 'Geladen uit opgeslagen vertaling.',
    loadingNoKey: 'Geen API sleutel — alleen transliteratie weergegeven.',
    loadingTranslating: 'Vertalen met Claude…',
    loadingDone: 'Vertaling voltooid.',

    // Settings modal
    settingsHeading: 'Instellingen',
    apiKeyLabel: 'Claude API Sleutel',
    apiKeyHint: 'Vereist voor vertaling. Uw sleutel wordt alleen in deze browser opgeslagen.',
    hintValid: 'geldig', hintInvalid: 'ongeldig',
    hintUnknown: 'kon de API niet bereiken — uw sleutel werkt mogelijk nog',
    verify: 'Verifiëren', verifyTitle: 'API sleutel verifiëren',
    thresholdLabel: 'Gevoeligheidsdrempel',
    thresholdHint: 'Hoger = minder gevoelig, minder valse triggers in rumoerige ruimtes.',
    refractoryLabel: 'Refractaire periode',
    refractoryHint: 'Minimale tussenruimte tussen aanvangen. Verhoog voor langzamer gezang.',
    speechLangLabel: 'Herkenningstaal',
    speechLangHint: 'Hindi werkt het beste voor Sanskrit gezang in de meeste browsers.',
    speechHindi: 'Hindi (aanbevolen voor Sanskrit)',
    speechSanskrit: 'Sanskrit',
    speechEnglish: 'Engels (fonetisch)',
    displayLabel: 'Geprojecteerde weergave',
    openDisplay: 'Weergavevenster openen',
    displayHint: 'Opent een schermvullende weergave. Houd dit venster open als operator.',
    closeTitle: 'Sluiten',
  },
};

let _lang = 'en';

/**
 * Set the active UI language. Falls back to 'en' for unsupported codes.
 * @param {string} lang - BCP 47-style language code ('en' or 'nl').
 */
export function setI18nLang(lang) {
  _lang = lang in STRINGS ? lang : 'en';
}

/**
 * Look up a UI string by key in the active language, falling back to English,
 * then to the key itself if missing entirely.
 *
 * Some values are functions rather than plain strings — this supports
 * interpolation (e.g. the 'phrase' key takes (current, total) arguments
 * so the caller can embed live numbers without string concatenation).
 *
 * @param {string} key - STRINGS key (e.g. 'upload', 'phrase').
 * @param {...*} args  - Forwarded to the value if it is a function.
 * @returns {string}
 */
export function t(key, ...args) {
  const val = STRINGS[_lang]?.[key] ?? STRINGS['en']?.[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}
