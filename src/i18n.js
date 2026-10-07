/**
 * Every piece of on-screen text the bot looks for, in every UI language it
 * understands.
 *
 * The Gemini Enterprise UI and Google's sign-in / consent screens follow the
 * account's language, so an account set to Spanish shows "Permitir" instead of
 * "Allow". Every selector in src/steps builds its patterns from this table
 * instead of hard-coding English.
 *
 * Adding a language or a wording the app started using = add strings here.
 * Nothing else needs to change. Matching is case-insensitive and ignores
 * accents, so "Instalar" / "instalar" and "Ações" / "Acoes" are all the same.
 * Korean (Hangul) goes through the same code - see fold() and WORD_CHAR.
 *
 * NOTE: apart from Korean, the non-English Gemini Enterprise strings were not
 * captured from a live account; they are the usual Google translations plus
 * common variants. The Korean Gemini Enterprise labels (시작하기, 파일 추가 /
 * 도구 선택 / 소스, 작업 사용 설정 / 작업 사용 중지, 스킬, 스킬 둘러보기, 설치) and the Korean
 * consent buttons (계속, 허용) were read off a real Korean account.
 * If a run stops on a button, check the screenshot for the exact wording and
 * add it to the right list.
 */
export const LANGUAGES = ['en', 'es', 'pt', 'fr', 'de', 'it', 'ko'];

const T = {
  /* ------------------------------ sign-in ------------------------------ */
  next: {
    en: ['Next', 'Continue', 'Sign in', 'Log in', 'Submit'],
    es: ['Siguiente', 'Continuar', 'Iniciar sesión', 'Acceder'],
    pt: ['Avançar', 'Próxima', 'Próximo', 'Seguinte', 'Continuar', 'Fazer login', 'Entrar', 'Iniciar sessão'],
    fr: ['Suivant', 'Continuer', 'Se connecter', 'Connexion'],
    de: ['Weiter', 'Anmelden', 'Fortfahren'],
    it: ['Avanti', 'Continua', 'Accedi'],
    ko: ['다음', '계속', '로그인'],
  },
  emailField: {
    en: ['Email', 'E-mail', 'Username', 'Email or phone'],
    es: ['Correo electrónico', 'Correo', 'Usuario', 'Correo electrónico o teléfono'],
    pt: ['E-mail', 'Email', 'Usuário', 'Utilizador', 'E-mail ou telefone'],
    fr: ['Adresse e-mail', 'E-mail', 'Adresse e-mail ou numéro de téléphone', "Nom d'utilisateur"],
    de: ['E-Mail', 'E-Mail-Adresse', 'Nutzername', 'E-Mail-Adresse oder Telefonnummer'],
    it: ['Indirizzo email', 'Email', 'Nome utente', 'Indirizzo email o numero di telefono'],
    ko: ['이메일', '이메일 주소', '이메일 또는 휴대전화', '사용자 이름'],
  },
  passwordField: {
    en: ['Password'],
    es: ['Contraseña'],
    pt: ['Senha', 'Palavra-passe'],
    fr: ['Mot de passe'],
    de: ['Passwort'],
    it: ['Password'],
    ko: ['비밀번호', '비밀번호 입력'],
  },
  signInRejected: {
    en: ['Wrong password', 'Incorrect password', "Couldn't sign you in", "Couldn't find your Google Account", 'Enter a valid email'],
    es: ['Contraseña incorrecta', 'No se ha podido iniciar sesión', 'No se ha podido encontrar tu cuenta de Google', 'No pudimos encontrar tu cuenta de Google', 'Introduce un correo electrónico válido'],
    pt: ['Senha incorreta', 'Palavra-passe incorreta', 'Não foi possível fazer login', 'Não foi possível encontrar sua Conta do Google', 'Digite um e-mail válido'],
    fr: ['Mot de passe incorrect', 'Impossible de vous connecter', 'Impossible de trouver votre compte Google', 'Saisissez une adresse e-mail valide'],
    de: ['Falsches Passwort', 'Anmeldung nicht möglich', 'Google-Konto konnte nicht gefunden werden', 'Gib eine gültige E-Mail-Adresse ein'],
    it: ['Password errata', 'Impossibile eseguire l’accesso', 'Impossibile trovare il tuo Account Google', 'Inserisci un indirizzo email valido'],
    ko: ['잘못된 비밀번호입니다', '비밀번호가 잘못되었습니다', '로그인할 수 없음', '로그인할 수 없습니다', 'Google 계정을 찾을 수 없습니다', '올바른 이메일 주소를 입력하세요', '올바른 이메일 또는 전화번호를 입력하세요', '유효한 이메일 또는 전화번호를 입력하세요'],
  },
  // Headline of a 2FA / device-check screen. Its disappearance = challenge done.
  challenge: {
    en: ['2-Step Verification', "Verify it's you", 'Check your phone', 'Check your device'],
    es: ['Verificación en 2 pasos', 'Verifica que eres tú', 'Confirma que eres tú', 'Consulta tu teléfono', 'Revisa tu teléfono'],
    pt: ['Verificação em duas etapas', 'Confirme que é você', 'Verifique se é você', 'Verifique seu smartphone', 'Verifique seu telefone'],
    fr: ['Validation en deux étapes', "Confirmez qu'il s'agit bien de vous", 'Consultez votre téléphone'],
    de: ['Bestätigung in zwei Schritten', 'Bestätigen Sie Ihre Identität', 'Identität bestätigen', 'Smartphone prüfen'],
    it: ['Verifica in due passaggi', 'Verifica la tua identità', 'Controlla il telefono'],
    ko: ['2단계 인증', '본인 인증', '본인 확인', '휴대전화를 확인하세요', '기기를 확인하세요'],
  },
  // Extra hints that a challenge started (only used for detection).
  challengeDetail: {
    en: ['Enter the code', 'Passkey', 'Authenticator'],
    es: ['Introduce el código', 'Ingresa el código', 'Llave de acceso'],
    pt: ['Digite o código', 'Insira o código', 'Chave de acesso'],
    fr: ['Saisissez le code', "Clé d'accès"],
    de: ['Code eingeben', 'Passkey'],
    it: ['Inserisci il codice', 'Passkey'],
    ko: ['코드 입력', '코드를 입력하세요', '패스키', '인증 앱'],
  },

  /* ----------------------------- onboarding ---------------------------- */
  understand: {
    en: ['I understand', 'Got it', 'I agree'],
    es: ['Entiendo', 'Lo entiendo', 'Entendido', 'Acepto', 'Estoy de acuerdo'],
    pt: ['Entendi', 'Compreendo', 'Eu entendo', 'Concordo', 'Aceito'],
    fr: ["J'ai compris", 'Je comprends', "J'accepte"],
    de: ['Verstanden', 'Ich verstehe', 'Ich stimme zu'],
    it: ['Ho capito', 'Capito', 'Accetto'],
    ko: ['이해함', '이해했습니다', '알겠습니다', '동의함', '동의합니다'],
  },
  getStarted: {
    en: ['Get started', "Let's go"],
    es: ['Comenzar', 'Empezar', 'Comienza', 'Empieza', 'Primeros pasos'],
    pt: ['Começar', 'Vamos começar', 'Iniciar', 'Primeiros passos'],
    fr: ['Commencer', "C'est parti"],
    de: ['Jetzt starten', "Los geht's", 'Loslegen'],
    it: ['Inizia', 'Iniziamo', 'Comincia'],
    ko: ['시작하기', '시작'],
  },

  /* ------------------------------ composer ----------------------------- */
  // aria-labels of the three icon-only composer buttons
  sources: {
    en: ['Sources', 'Connectors'],
    es: ['Fuentes', 'Conectores', 'Orígenes'],
    pt: ['Fontes', 'Conectores', 'Origens'],
    fr: ['Sources', 'Connecteurs'],
    de: ['Quellen', 'Connectors', 'Konnektoren'],
    it: ['Fonti', 'Connettori', 'Origini'],
    ko: ['소스', '커넥터', '데이터 소스'],
  },
  addFiles: {
    en: ['Add files'],
    es: ['Añadir archivos', 'Agregar archivos'],
    pt: ['Adicionar arquivos', 'Adicionar ficheiros'],
    fr: ['Ajouter des fichiers'],
    de: ['Dateien hinzufügen'],
    it: ['Aggiungi file'],
    ko: ['파일 추가', '파일 업로드'],
  },
  selectTools: {
    en: ['Select tools', 'Tools'],
    es: ['Seleccionar herramientas', 'Herramientas'],
    pt: ['Selecionar ferramentas', 'Ferramentas'],
    fr: ['Sélectionner des outils', 'Outils'],
    de: ['Tools auswählen', 'Tools'],
    it: ['Seleziona strumenti', 'Strumenti'],
    ko: ['도구 선택', '도구'],
  },
  enableActions: {
    en: ['Enable actions'],
    es: ['Habilitar acciones', 'Activar acciones'],
    pt: ['Ativar ações', 'Habilitar ações'],
    fr: ['Activer les actions'],
    de: ['Aktionen aktivieren'],
    it: ['Attiva azioni', 'Abilita azioni'],
    ko: ['작업 사용 설정', '작업 활성화', '액션 사용 설정', '액션 활성화'],
  },
  disableActions: {
    en: ['Disable actions'],
    es: ['Inhabilitar acciones', 'Deshabilitar acciones', 'Desactivar acciones'],
    pt: ['Desativar ações', 'Desabilitar ações'],
    fr: ['Désactiver les actions'],
    de: ['Aktionen deaktivieren'],
    it: ['Disattiva azioni', 'Disabilita azioni'],
    ko: ['작업 사용 중지', '작업 사용 안함', '작업 비활성화', '액션 사용 중지', '액션 비활성화'],
  },
  home: {
    en: ['Chat', 'Home', 'New chat'],
    es: ['Chat', 'Inicio', 'Nuevo chat'],
    pt: ['Chat', 'Início', 'Novo chat', 'Nova conversa'],
    fr: ['Chat', 'Accueil', 'Nouveau chat', 'Nouvelle discussion'],
    de: ['Chat', 'Startseite', 'Neuer Chat'],
    it: ['Chat', 'Home', 'Nuova chat'],
    ko: ['채팅', '홈', '새 채팅'],
  },

  /* ---------------------------- OAuth consent -------------------------- */
  chooseAccount: {
    en: ['Choose an account'],
    es: ['Elige una cuenta', 'Selecciona una cuenta'],
    pt: ['Escolha uma conta', 'Selecione uma conta'],
    fr: ['Choisissez un compte', 'Choisir un compte'],
    de: ['Konto auswählen', 'Wählen Sie ein Konto aus'],
    it: ['Scegli un account'],
    ko: ['계정 선택', '계정을 선택하세요'],
  },
  continue: {
    en: ['Continue'],
    es: ['Continuar'],
    pt: ['Continuar'],
    fr: ['Continuer'],
    de: ['Weiter', 'Fortfahren'],
    it: ['Continua'],
    ko: ['계속', '계속하기'],
  },
  selectAll: {
    en: ['Select all'],
    es: ['Seleccionar todo', 'Seleccionar todos'],
    pt: ['Selecionar tudo', 'Selecionar todos'],
    fr: ['Tout sélectionner'],
    de: ['Alle auswählen'],
    it: ['Seleziona tutto', 'Seleziona tutti'],
    ko: ['모두 선택', '전체 선택'],
  },
  allow: {
    en: ['Allow'],
    es: ['Permitir'],
    pt: ['Permitir'],
    fr: ['Autoriser'],
    de: ['Zulassen'],
    it: ['Consenti'],
    ko: ['허용'],
  },
  // Looser last-resort wording for the consent button
  allowLoose: {
    en: ['Allow', 'Approve', 'Authorize', 'Accept'],
    es: ['Permitir', 'Aprobar', 'Autorizar', 'Aceptar'],
    pt: ['Permitir', 'Aprovar', 'Autorizar', 'Aceitar'],
    fr: ['Autoriser', 'Approuver', 'Accepter'],
    de: ['Zulassen', 'Genehmigen', 'Autorisieren', 'Akzeptieren'],
    it: ['Consenti', 'Approva', 'Autorizza', 'Accetta'],
    ko: ['허용', '승인', '수락'],
  },

  /* ------------------------------- skills ------------------------------ */
  skills: {
    en: ['Skills'],
    es: ['Habilidades', 'Skills', 'Competencias'],
    pt: ['Habilidades', 'Skills', 'Competências'],
    fr: ['Compétences', 'Skills'],
    de: ['Fähigkeiten', 'Skills', 'Kompetenzen'],
    it: ['Competenze', 'Abilità', 'Skills'],
    ko: ['스킬'],
  },
  browseSkills: {
    en: ['Browse skills'],
    es: ['Explorar habilidades', 'Buscar habilidades', 'Explorar skills'],
    pt: ['Explorar habilidades', 'Procurar habilidades', 'Navegar pelas habilidades', 'Explorar skills'],
    fr: ['Parcourir les compétences', 'Explorer les compétences'],
    de: ['Fähigkeiten durchsuchen', 'Skills durchsuchen'],
    it: ['Sfoglia competenze', 'Esplora competenze'],
    ko: ['스킬 둘러보기', '스킬 살펴보기', '스킬 찾아보기', '스킬 탐색'],
  },
  addSkill: {
    en: ['browse skill', 'add skill', 'new skill', 'install skill', 'create skill'],
    es: ['explorar habilidad', 'añadir habilidad', 'agregar habilidad', 'nueva habilidad', 'crear habilidad'],
    pt: ['explorar habilidade', 'adicionar habilidade', 'nova habilidade', 'criar habilidade'],
    fr: ['parcourir les compétences', 'ajouter une compétence', 'nouvelle compétence', 'créer une compétence'],
    de: ['fähigkeit hinzufügen', 'neue fähigkeit', 'fähigkeit erstellen'],
    it: ['aggiungi competenza', 'nuova competenza', 'crea competenza'],
    ko: ['스킬 둘러보기', '스킬 살펴보기', '스킬 찾아보기', '스킬 추가', '새 스킬', '스킬 설치', '스킬 만들기'],
  },
  install: {
    en: ['Install'],
    es: ['Instalar'],
    pt: ['Instalar'],
    fr: ['Installer'],
    de: ['Installieren'],
    it: ['Installa'],
    ko: ['설치'],
  },
  installed: {
    en: ['Installed', 'Uninstall', 'Open', 'Remove', 'Added'],
    es: ['Instalado', 'Instalada', 'Desinstalar', 'Abrir', 'Quitar', 'Eliminar', 'Añadido', 'Añadida'],
    pt: ['Instalado', 'Instalada', 'Desinstalar', 'Abrir', 'Remover', 'Adicionado', 'Adicionada'],
    fr: ['Installé', 'Installée', 'Désinstaller', 'Ouvrir', 'Supprimer', 'Ajouté', 'Ajoutée'],
    de: ['Installiert', 'Deinstallieren', 'Öffnen', 'Entfernen', 'Hinzugefügt'],
    it: ['Installato', 'Installata', 'Disinstalla', 'Apri', 'Rimuovi', 'Aggiunto', 'Aggiunta'],
    ko: ['설치됨', '설치 완료', '설치 제거', '제거', '열기', '삭제', '추가됨'],
  },
};

/* ------------------------------------------------------------------ */

/** Every wording for `key` across all languages, de-duplicated. */
export function words(key) {
  const entry = T[key];
  if (!entry) throw new Error(`i18n: unknown key "${key}"`);
  return [...new Set(LANGUAGES.flatMap((lang) => entry[lang] || []))];
}

/**
 * Lower-cases and strips accents, so "Ações" and "acoes" compare equal.
 *
 * The final NFC is what keeps Korean working: NFD splits every Hangul
 * syllable into its jamo ("설" -> "ᄉ" "ᅥ" "ᆯ"), which are letters, not
 * accents, so they survive the strip. Without recomposing, a regex built
 * from "설치" would look for loose jamo and never match the page's "설치".
 */
export const fold = (text) =>
  (text || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[’`]/g, "'")
    .toLowerCase();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex source matching any wording for `key`, tolerant of accents
 * (each vowel/c/n also matches its accented forms) and of flexible spacing.
 */
function alternation(key) {
  const variants = {
    a: 'aàáâãäå', e: 'eèéêë', i: 'iìíîï', o: 'oòóôõö', u: 'uùúûü', c: 'cç', n: 'nñ',
  };
  return words(key)
    .map((w) =>
      [...fold(w)]
        .map((ch) => {
          if (variants[ch]) return `[${variants[ch]}]`;
          if (ch === ' ') return '\\s+';
          if (ch === "'") return "['’`]";
          return escapeRe(ch);
        })
        .join(''),
    )
    .sort((a, b) => b.length - a.length) // longest first, so "Iniciar sesión" wins over "Iniciar"
    .join('|');
}

/**
 * Letters and digits for the whole-word check: ASCII plus Latin-1 and Latin
 * Extended (covers every accented letter in es / pt / fr / de / it), plus
 * Hangul syllables and jamo for ko - so "설치" (Install) is not found inside
 * "설치됨" (Installed), nor "활성화" (enable) inside "비활성화" (disable).
 */
const WORD_CHAR =
  'A-Za-z0-9\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F' +
  '\\u1100-\\u11FF\\u3130-\\u318F\\uA960-\\uA97F\\uAC00-\\uD7A3\\uD7B0-\\uD7FF';

/**
 * Case-insensitive regex for `key`.
 *
 *   exact: true  -> the whole string must be one of the wordings (default)
 *   exact: false -> a wording may appear anywhere, but only as a whole word.
 *
 * The whole-word rule matters: "Deshabilitar acciones" contains
 * "habilitar acciones", and "Desinstalar" contains "instalar". Without it the
 * bot would mistake an already-enabled connector for one still to enable.
 *
 * Deliberately NO "u" flag. Playwright embeds a unicode regex in the selector
 * string verbatim, and as soon as the locator is chained - `.first()`, which
 * firstVisible() always calls, appends " >> nth=0" - it fails to parse
 * ("Invalid flags supplied to RegExp constructor 'iu >> nth=0'"). The failure
 * is silent in the bot: a broken locator simply never becomes visible.
 * `npm run test:i18n` checks this path for every wording.
 */
export function re(key, { exact = true } = {}) {
  const body = alternation(key);
  return exact
    ? new RegExp(`^\\s*(?:${body})\\s*$`, 'i')
    : new RegExp(`(?<![${WORD_CHAR}])(?:${body})(?![${WORD_CHAR}])`, 'i');
}

/**
 * CSS attribute selector matching an aria-label equal to any wording, e.g.
 * `[aria-label="Sources" i], [aria-label="Fuentes" i], ...`
 */
export function ariaEquals(key) {
  return words(key)
    .map((w) => `[aria-label="${w.replace(/"/g, '\\"')}" i]`)
    .join(', ');
}

/** Same as ariaEquals, but a substring match. */
export function ariaContains(key) {
  return words(key)
    .map((w) => `[aria-label*="${w.replace(/"/g, '\\"')}" i]`)
    .join(', ');
}

/**
 * Removes every wording for `keys` from `text` (used to isolate row labels).
 *
 * No whole-word rule here: a row's text is often glued together, e.g.
 * "Google DriveHabilitar acciones". All keys go into ONE alternation, so
 * "Deshabilitar acciones" is removed whole - scanning left to right, the
 * regex reaches its "D" before the "habilitar" inside it.
 */
export function strip(text, ...keys) {
  const all = new RegExp(keys.map(alternation).join('|'), 'gi');
  return (text || '').replace(all, ' ');
}
