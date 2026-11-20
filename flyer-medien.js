// Bibliothek der Flyer-Seite (flyer.html, F3b): Datenmodell der Medien (Feld „medien“ oben im Paket, gilt für alle
// Versionen), Formate und Größen, Git-Blob-SHA, Status je Datei und der Laufzeit-Zwischenspeicher der Bilder.
// Im Paket stehen nur Metadaten (id m<n>, Name, Ordner, Art, MIME, Größe, Maße, Dauer, Dateiname im Repo, gitSha,
// Herkunft, Startbild, erstellt) – die Inhalte liegen auf dem Gerät (IndexedDB „aether-flyer“, Store „medien“, über
// AetherFlyerSpeicher) und online nur im privaten Repo konstantin9ezm/aether-medien (Ordner medien/), nie im Paket und
// nie im Repo aether-dashboard. Änderungen am Modell arbeiten wie in flyer-struktur.js auf einer Kopie des Pakets, die
// flyer.js übergibt, und werfen bei ungültigen Eingaben einen AppError (dann ändert flyer.js nichts).
// Git-Blob-SHA: SHA-1 über „blob <Größe>\0“ + Inhalt – bis 64 MiB mit Web Crypto (crypto.subtle), darüber (und ohne
// Web Crypto) mit dem eigenen SHA-1 unten, das die Datei stückweise liest (eine 500-MB-Datei läge sonst ganz im
// Speicher). Beide Wege ergeben dasselbe (Tests).
// Status je Datei (F3): „online“ (gleiche Git-Blob-SHA liegt in aether-medien/medien/), „geraet“ (nur auf diesem Gerät),
// „flyer“ (Grafik aus „Aus Flyern“). Kein Netz hier (das macht flyer-medien-online.js), kein Token.
(function () {
  'use strict';

  // E5: Upload im Browser (GitHub-Weboberfläche) höchstens 25 MiB je Datei – darüber ein deutlicher Hinweis
  const GRENZE_UPLOAD = 25 * 1024 * 1024;            // 26 214 400 Bytes
  // F4: Annahme bis 500 MB je Datei (500 MiB = 524 288 000 Bytes), wenn der Platz reicht
  const MAX_DATEI = 500 * 1024 * 1024;
  // Selbst gewählt: beim „Online prüfen“ nur Dateien bis 5 MiB nachladen, größere erst beim Öffnen bzw. Abspielen
  const AUTO_LADEN = 5 * 1024 * 1024;
  // Selbst gewählt: „Alle sichern“ als eine ZIP bis 512 MiB, darüber die Dateien einzeln (Teilen bzw. Herunterladen)
  const ZIP_MAX = 512 * 1024 * 1024;
  // Selbst gewählt: Web Crypto bis 64 MiB (ein Puffer), darüber das stückweise SHA-1 (Stücke zu 4 MiB)
  const WEBCRYPTO_MAX = 64 * 1024 * 1024;
  const STUECK = 4 * 1024 * 1024;
  // Selbst gewählt: Platzreserve beim Hinzufügen (5 % plus 10 MB für Startbilder und Datenbank)
  const RESERVE_BYTES = 10 * 1024 * 1024;
  const MAX_NAME = 120;
  const MAX_ORDNERNAME = 60;
  const MAX_ZULETZT = 12;
  const AUS_FLYERN = 'aus-flyern';   // virtueller Ordner „Aus Flyern“ (nur lesen, nie im Paket)
  const HINWEIS_GROSS = 'Zu groß für den Upload im Browser (GitHub: höchstens 25 MiB je Datei) – bleibt vorerst nur auf diesem Gerät.';
  const HINWEIS_SAFARI = 'Nur auf diesem Gerät: in Safari können Daten nach einigen Tagen ohne Besuch gelöscht werden – Home-Bildschirm-App nutzen oder online stellen';
  const REPO = 'konstantin9ezm/aether-medien';
  const REPO_ORDNER = 'medien';
  const UPLOAD_SEITE = 'https://github.com/konstantin9ezm/aether-medien/upload/main/medien';

  // F5: Formate nach Endung → { art, mime, kurz }. Animation (GIF, animiertes WebP/APNG) erkennt einlesen am Inhalt.
  const FORMATE = Object.freeze({
    jpg: { art: 'foto', mime: 'image/jpeg', kurz: 'JPG' }, jpeg: { art: 'foto', mime: 'image/jpeg', kurz: 'JPG' },
    png: { art: 'foto', mime: 'image/png', kurz: 'PNG' }, webp: { art: 'foto', mime: 'image/webp', kurz: 'WebP' },
    heic: { art: 'foto', mime: 'image/heic', kurz: 'HEIC' }, heif: { art: 'foto', mime: 'image/heif', kurz: 'HEIF' },
    gif: { art: 'animation', mime: 'image/gif', kurz: 'GIF' }, svg: { art: 'grafik', mime: 'image/svg+xml', kurz: 'SVG' },
    mp4: { art: 'video', mime: 'video/mp4', kurz: 'MP4' }, m4v: { art: 'video', mime: 'video/mp4', kurz: 'MP4' },
    mov: { art: 'video', mime: 'video/quicktime', kurz: 'MOV' }, webm: { art: 'video', mime: 'video/webm', kurz: 'WebM' }
  });
  const MIME_ENDUNG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v' };
  const ACCEPT_FOTOS = 'image/*,video/*';
  const ACCEPT_DATEIEN = '.jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.svg,.mp4,.m4v,.mov,.webm';
  const ART_NAME = { foto: 'Foto', video: 'Video', animation: 'Animation', grafik: 'Grafik' };

  function fehler(kind, title, text) {
    const G = window.AetherGemeinsam;
    if (G && typeof G.AppError === 'function') return new G.AppError(kind, title, text || '');
    const e = new Error(title); e.kind = kind; e.title = title; e.text = text || ''; return e;
  }
  function istObjekt(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* ---------- Texte ---------- */
  function zahlDe(x, stellen) { return x.toFixed(stellen).replace('.', ','); }
  // Größe kurz: „940 KB“, „2,1 MB“, „1,2 GB“ (1 MB = 1024 × 1024 Bytes wie im Rest der Seite)
  function groesseText(bytes) {
    const b = Math.max(0, Number(bytes) || 0);
    if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
    if (b < 1024 * 1024 * 1024) { const m = b / 1024 / 1024; return zahlDe(m, m >= 100 ? 0 : 1) + ' MB'; }
    return zahlDe(b / 1024 / 1024 / 1024, 1) + ' GB';
  }
  // Dauer „0:42“, „12:05“, „1:02:03“
  function dauerText(s) {
    const t = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
    const zz = (n) => (n < 10 ? '0' : '') + n;
    return h ? h + ':' + zz(m) + ':' + zz(x) : m + ':' + zz(x);
  }
  function endungVon(name) { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function ohneEndung(name) { return String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, ''); }
  // Kurzname des Formats für die Kachel („JPG“, „MP4“ …)
  function formatKurz(d) {
    const e = endungVon(d && d.datei);
    if (FORMATE[e]) return FORMATE[e].kurz;
    return String((d && d.mime) || '').split('/').pop().toUpperCase() || '?';
  }
  // E5: Hinweis über 25 MiB (genau 25 MiB ist noch erlaubt)
  function zuGrossFuerUpload(bytes) { return Number(bytes) > GRENZE_UPLOAD; }
  function groessenHinweis(bytes) { return zuGrossFuerUpload(bytes) ? HINWEIS_GROSS : ''; }

  // F1: Dateiname im Repo nur ASCII: <name-als-slug>_<id>.<endung>
  function slug(name) {
    let t = String(name || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    try { t = t.normalize('NFKD'); } catch (e) { /* ohne normalize */ }
    t = t.replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (t.length > 40) t = t.slice(0, 40).replace(/-+$/, '');
    return t || 'datei';
  }
  function dateiName(name, id, endung) {
    const e = String(endung || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
    return slug(name) + '_' + id + '.' + e;
  }

  /* ---------- Formate (F5) ---------- */
  // Format einer gewählten Datei (Endung zuerst, sonst MIME) → { art, mime, endung, kurz } | null
  function formatVon(name, mime) {
    let e = endungVon(name);
    if (!FORMATE[e]) e = MIME_ENDUNG[String(mime || '').toLowerCase()] || '';
    if (!FORMATE[e]) return null;
    return Object.assign({ endung: e === 'jpeg' ? 'jpg' : e }, FORMATE[e]);
  }

  // Animation am Inhalt erkennen und ihre Dauer (s) lesen: GIF (Bilder und Verzögerungen), APNG (acTL, fcTL),
  // WebP (VP8X-Animation, ANMF). → { animiert, dauer|null, bilder }
  function animationLesen(u8, endung) {
    try {
      if (endung === 'gif') return gifLesen(u8);
      if (endung === 'png') return apngLesen(u8);
      if (endung === 'webp') return webpLesen(u8);
    } catch (e) { /* unlesbar: wie ein Einzelbild */ }
    return { animiert: false, dauer: null, bilder: 1 };
  }
  function gifLesen(b) {
    if (b.length < 13 || String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') return { animiert: false, dauer: null, bilder: 1 };
    let p = 13;
    if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
    let bilder = 0, ms = 0, verz = 0;
    const bloecke = () => { while (p < b.length) { const n = b[p++]; if (!n) return; p += n; } };
    while (p < b.length) {
      const t = b[p++];
      if (t === 0x3b) break;
      if (t === 0x21) {
        const art = b[p++];
        if (art === 0xf9 && b[p] >= 4) verz = (b[p + 2] | (b[p + 3] << 8)) * 10;
        bloecke();
      } else if (t === 0x2c) {
        const flags = b[p + 8];
        p += 9;
        if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
        p++;            // LZW-Mindestgröße
        bloecke();
        bilder++; ms += verz || 100; verz = 0;
      } else break;
    }
    return { animiert: bilder > 1, dauer: bilder > 1 ? Math.round(ms) / 1000 : null, bilder: Math.max(1, bilder) };
  }
  function u32be(b, p) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
  function u16be(b, p) { return (b[p] << 8) + b[p + 1]; }
  function apngLesen(b) {
    if (b.length < 8 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return { animiert: false, dauer: null, bilder: 1 };
    let p = 8, actl = false, bilder = 0, s = 0;
    while (p + 8 <= b.length) {
      const n = u32be(b, p), typ = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (typ === 'acTL') actl = true;
      if (typ === 'fcTL' && p + 8 + 26 <= b.length) {
        const num = u16be(b, p + 8 + 20), den = u16be(b, p + 8 + 22) || 100;
        bilder++; s += num / den;
      }
      if (typ === 'IEND') break;
      p += 12 + n;
    }
    const an = actl && bilder > 1;
    return { animiert: an, dauer: an ? Math.round(s * 1000) / 1000 : null, bilder: Math.max(1, bilder) };
  }
  function webpLesen(b) {
    if (b.length < 16 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF' || String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'WEBP') return { animiert: false, dauer: null, bilder: 1 };
    let p = 12, flagAnim = false, bilder = 0, ms = 0;
    while (p + 8 <= b.length) {
      const typ = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
      const n = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | ((b[p + 7] << 24) >>> 0);
      if (typ === 'VP8X') flagAnim = !!(b[p + 8] & 0x02);
      if (typ === 'ANMF') { bilder++; ms += b[p + 8 + 12] | (b[p + 8 + 13] << 8) | (b[p + 8 + 14] << 16); }
      p += 8 + n + (n & 1);
    }
    const an = flagAnim && bilder > 1;
    return { animiert: an, dauer: an ? ms / 1000 : null, bilder: Math.max(1, bilder) };
  }

  /* ---------- Git-Blob-SHA (F3) ---------- */
  // Eigenes SHA-1 (FIPS 180-4) zum stückweisen Rechnen: neu(), weiter(u8), ende() → Hex
  function sha1() {
    const h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0]);
    const w = new Int32Array(80);
    const rest = new Uint8Array(64);
    let restN = 0, laenge = 0;
    function block(b, o) {
      for (let i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4];
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (bb & c) | (~bb & d); k = 0x5a827999; } else if (i < 40) { f = bb ^ c ^ d; k = 0x6ed9eba1; } else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc | 0; } else { f = bb ^ c ^ d; k = 0xca62c1d6 | 0; }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
    }
    function weiter(u8) {
      let i = 0;
      laenge += u8.length;
      if (restN) {
        const n = Math.min(64 - restN, u8.length);
        rest.set(u8.subarray(0, n), restN); restN += n; i = n;
        if (restN < 64) return;
        block(rest, 0); restN = 0;
      }
      for (; i + 64 <= u8.length; i += 64) block(u8, i);
      if (i < u8.length) { rest.set(u8.subarray(i), 0); restN = u8.length - i; }
    }
    function ende() {
      const bits = laenge * 8;
      const n = restN + 9 <= 64 ? 64 : 128;   // 0x80, Nullen, 64 Bit Länge – ein oder zwei Blöcke
      const fuell = new Uint8Array(n);
      fuell.set(rest.subarray(0, restN));
      fuell[restN] = 0x80;
      const hoch = Math.floor(bits / 0x100000000), tief = bits >>> 0;
      fuell[n - 8] = hoch >>> 24; fuell[n - 7] = (hoch >>> 16) & 255; fuell[n - 6] = (hoch >>> 8) & 255; fuell[n - 5] = hoch & 255;
      fuell[n - 4] = tief >>> 24; fuell[n - 3] = (tief >>> 16) & 255; fuell[n - 2] = (tief >>> 8) & 255; fuell[n - 1] = tief & 255;
      for (let o = 0; o < n; o += 64) block(fuell, o);
      let x = '';
      for (let i = 0; i < 5; i++) x += ('00000000' + (h[i] >>> 0).toString(16)).slice(-8);
      return x;
    }
    return { weiter: weiter, ende: ende };
  }
  function hex(buf) { return Array.from(new Uint8Array(buf), (b) => (b < 16 ? '0' : '') + b.toString(16)).join(''); }
  function kopfVon(groesse) { return new TextEncoder().encode('blob ' + groesse + '\0'); }
  // Stück eines Blobs als Uint8Array (Blob.arrayBuffer, sonst FileReader)
  function stueckLesen(blob, a, e) {
    const teil = blob.slice(a, e);
    if (typeof teil.arrayBuffer === 'function') return teil.arrayBuffer().then((x) => new Uint8Array(x));
    return new Promise((ok, nein) => { const r = new FileReader(); r.onload = () => ok(new Uint8Array(r.result)); r.onerror = () => nein(r.error); r.readAsArrayBuffer(teil); });
  }
  // Git-Blob-SHA eines Blobs (oder Uint8Array). opt.ohneWebCrypto / opt.fortschritt(0…1) → Promise<Hex (40)>
  async function gitSha(daten, opt) {
    const o = opt || {};
    const roh = ArrayBuffer.isView(daten) || Object.prototype.toString.call(daten) === '[object ArrayBuffer]';
    const blob = roh ? new Blob([daten]) : daten;
    const n = blob.size, kopf = kopfVon(n);
    const subtle = typeof crypto === 'object' && crypto && crypto.subtle && typeof crypto.subtle.digest === 'function' ? crypto.subtle : null;
    if (subtle && !o.ohneWebCrypto && n <= WEBCRYPTO_MAX) {
      const inhalt = await stueckLesen(blob, 0, n);
      const alles = new Uint8Array(kopf.length + inhalt.length);
      alles.set(kopf, 0); alles.set(inhalt, kopf.length);
      return hex(await subtle.digest('SHA-1', alles));
    }
    const s = sha1();
    s.weiter(kopf);
    for (let a = 0; a < n; a += STUECK) {
      s.weiter(await stueckLesen(blob, a, Math.min(n, a + STUECK)));
      if (typeof o.fortschritt === 'function') { try { o.fortschritt(Math.min(1, (a + STUECK) / n)); } catch (e) { /* egal */ } }
    }
    return s.ende();
  }
  // CRC-32 eines Blobs stückweise (für „Alle sichern“: ZIP ohne den Inhalt doppelt im Speicher)
  async function crc32Blob(blob) {
    const Z = window.AetherFlyerZip;
    let c;
    for (let a = 0; a < blob.size; a += STUECK) c = Z.crc32(await stueckLesen(blob, a, Math.min(blob.size, a + STUECK)), c);
    return c === undefined ? 0 : c;
  }

  /* ---------- Modell (auf einer Kopie des Pakets) ---------- */
  function medien(pk) { return pk && istObjekt(pk.medien) ? pk.medien : null; }
  function dateien(pk) { const m = medien(pk); return m && Array.isArray(m.dateien) ? m.dateien : []; }
  function ordnerListe(pk) { const m = medien(pk); return m && Array.isArray(m.ordner) ? m.ordner : []; }
  function sicherstellen(pk) {
    if (!istObjekt(pk.medien)) pk.medien = { zaehler: { datei: 0, ordner: 0 }, ordner: [], dateien: [] };
    const m = pk.medien;
    if (!istObjekt(m.zaehler)) m.zaehler = { datei: 0, ordner: 0 };
    if (!Array.isArray(m.ordner)) m.ordner = [];
    if (!Array.isArray(m.dateien)) m.dateien = [];
    return m;
  }
  function datei(pk, id) { return dateien(pk).find((d) => d.id === id) || null; }
  function dateiOderFehler(pk, id) {
    const d = datei(pk, id);
    if (!d) throw fehler('medien', 'Datei nicht gefunden.', 'Die Datei ' + id + ' gibt es in der Bibliothek nicht (mehr).');
    return d;
  }
  function ordnerVon(pk, id) { return ordnerListe(pk).find((o) => o.id === id) || null; }
  function ordnerOderFehler(pk, id) {
    const o = ordnerVon(pk, id);
    if (!o) throw fehler('medien', 'Ordner nicht gefunden.', 'Den Ordner gibt es in der Bibliothek nicht (mehr).');
    return o;
  }
  // Neue Kennung „<praefix><n>“: höher als der Zähler und jede vorhandene, nie eine vorhandene (nie wiederverwendet)
  function neueKennung(praefix, zaehler, vorhanden) {
    const re = new RegExp('^' + praefix + '([1-9]\\d*)$');
    let n = zaehler;
    for (const id of vorhanden) { const m = re.exec(id); if (m) n = Math.max(n, Number(m[1])); }
    n++;
    while (vorhanden.has(praefix + n)) n++;
    return { id: praefix + n, n: n };
  }
  function nameSauber(name, max, was) {
    const t = String(name === undefined || name === null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!t) throw fehler('medien', 'Name fehlt.', was + ' braucht einen Namen.');
    if (t.length > max) throw fehler('medien', 'Name zu lang.', 'Höchstens ' + max + ' Zeichen (jetzt ' + t.length + ').');
    return t;
  }
  // Neue Datei (Kennung m<n>). meta = { name, art, mime, groesse, breite, hoehe, dauer, endung, gitSha, herkunft, quelle,
  // startbild, erstellt, ordner } → die Datei (im Paket nur Metadaten)
  function dateiAnlegen(pk, meta) {
    const m = sicherstellen(pk);
    const ordner = Array.isArray(meta.ordner) ? meta.ordner.filter((x, i, a) => a.indexOf(x) === i) : [];
    for (const o of ordner) ordnerOderFehler(pk, o);
    if (!/^[0-9a-f]{40}$/.test(String(meta.gitSha || ''))) throw fehler('medien', 'Prüfsumme fehlt.', 'Die Datei hat keine gültige Git-Blob-SHA.');
    const k = neueKennung('m', m.zaehler.datei, new Set(m.dateien.map((d) => d.id)));
    let name = String(meta.name || '').replace(/\s+/g, ' ').trim();
    if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME).trim();
    if (!name) name = 'Datei ' + k.n;
    const d = {
      id: k.id, name: name, ordner: ordner, art: meta.art, mime: String(meta.mime || 'application/octet-stream'),
      groesse: Math.max(0, Math.floor(Number(meta.groesse) || 0)),
      breite: meta.breite > 0 ? meta.breite : null, hoehe: meta.hoehe > 0 ? meta.hoehe : null,
      dauer: typeof meta.dauer === 'number' && isFinite(meta.dauer) && meta.dauer >= 0 ? Math.round(meta.dauer * 1000) / 1000 : null,
      datei: dateiName(name, k.id, meta.endung), gitSha: String(meta.gitSha),
      herkunft: meta.herkunft === 'flyer-kopie' ? 'flyer-kopie' : 'eigen',
      startbild: typeof meta.startbild === 'number' && isFinite(meta.startbild) && meta.startbild >= 0 ? meta.startbild : null,
      erstellt: typeof meta.erstellt === 'string' && meta.erstellt ? meta.erstellt : new Date().toISOString()
    };
    if (d.herkunft === 'flyer-kopie') d.quelle = { version: String(meta.quelle.version), seite: String(meta.quelle.seite), grafik: Number(meta.quelle.grafik) };
    m.dateien.push(d);
    m.zaehler.datei = k.n;
    return d;
  }
  // Umbenennen ändert nur den Namen in der Bibliothek; der Dateiname im Repo (datei) bleibt (sonst wäre sie dort neu)
  function dateiUmbenennen(pk, id, name) { const d = dateiOderFehler(pk, id); d.name = nameSauber(name, MAX_NAME, 'Die Datei'); return d; }
  // „In Ordner …“: mehrere möglich, Reihenfolge der Bibliothek
  function dateiInOrdner(pk, id, ids) {
    const d = dateiOderFehler(pk, id), wahl = new Set(ids || []);
    for (const o of wahl) ordnerOderFehler(pk, o);
    d.ordner = ordnerListe(pk).filter((o) => wahl.has(o.id)).map((o) => o.id);
    return d;
  }
  function dateiLoeschen(pk, id) { const d = dateiOderFehler(pk, id); pk.medien.dateien = pk.medien.dateien.filter((x) => x.id !== id); return d; }
  function setzeStartbild(pk, id, sekunden) {
    const d = dateiOderFehler(pk, id);
    if (d.art !== 'video') throw fehler('medien', 'Kein Video.', 'Ein Startbild-Zeitpunkt gibt es nur bei Videos.');
    let t = Math.max(0, Number(sekunden) || 0);
    if (typeof d.dauer === 'number' && d.dauer > 0) t = Math.min(t, d.dauer);
    d.startbild = Math.round(t * 100) / 100;
    return d;
  }
  // Ordner der Bibliothek (getrennt von den Seiten-Ordnern; Kennung mo<n>)
  function kinderOrdner(pk, eltern) { return ordnerListe(pk).filter((o) => o.eltern === (eltern === undefined ? null : eltern)); }
  function ordnerName(pk, eltern, name, ausser) {
    const t = nameSauber(name, MAX_ORDNERNAME, 'Der Ordner');
    const v = (x) => String(x).trim().toLocaleLowerCase('de-DE');
    if (v(t) === v('Aus Flyern') && eltern === null) throw fehler('medien', 'Name schon vergeben.', '„Aus Flyern“ ist der automatische Ordner.');
    const gleich = kinderOrdner(pk, eltern).find((o) => o.id !== ausser && v(o.name) === v(t));
    if (gleich) throw fehler('medien', 'Name schon vergeben.', 'In diesem Ordner gibt es schon „' + gleich.name + '“.');
    return t;
  }
  function nachfahren(pk, id) {
    const r = new Set(), offen = [id];
    while (offen.length) { const x = offen.pop(); for (const o of ordnerListe(pk)) if (o.eltern === x && !r.has(o.id)) { r.add(o.id); offen.push(o.id); } }
    return r;
  }
  function pfad(pk, id) {
    const r = [], gesehen = new Set();
    let o = id === null || id === undefined ? null : ordnerVon(pk, id);
    while (o && !gesehen.has(o.id)) { gesehen.add(o.id); r.unshift(o); o = o.eltern === null ? null : ordnerVon(pk, o.eltern); }
    return r;
  }
  function ordnerBaum(pk) {
    const r = [];
    const geh = (e, ebene) => { for (const o of kinderOrdner(pk, e)) { r.push({ ordner: o, ebene: ebene }); geh(o.id, ebene + 1); } };
    geh(null, 0);
    return r;
  }
  function ordnerAnlegen(pk, eltern, name) {
    const m = sicherstellen(pk);
    if (eltern !== null) ordnerOderFehler(pk, eltern);
    const t = ordnerName(pk, eltern, name, null);
    const k = neueKennung('mo', m.zaehler.ordner, new Set(m.ordner.map((o) => o.id)));
    const o = { id: k.id, name: t, eltern: eltern };
    m.ordner.push(o);
    m.zaehler.ordner = k.n;
    return o;
  }
  function ordnerUmbenennen(pk, id, name) { const o = ordnerOderFehler(pk, id); o.name = ordnerName(pk, o.eltern, name, o.id); return o; }
  function ordnerVerschieben(pk, id, eltern) {
    const o = ordnerOderFehler(pk, id), ziel = eltern === undefined ? null : eltern;
    if (ziel !== null) {
      ordnerOderFehler(pk, ziel);
      if (ziel === id || nachfahren(pk, id).has(ziel)) throw fehler('medien', 'Verschieben nicht möglich.', 'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner.');
    }
    ordnerName(pk, ziel, o.name, o.id);
    o.eltern = ziel;
    return o;
  }
  // E2: Löschen – die Dateien bleiben (verlieren nur diese Zuordnung), Unterordner wandern in den Elternordner
  function ordnerLoeschen(pk, id) {
    const o = ordnerOderFehler(pk, id);
    for (const k of pk.medien.ordner) if (k.eltern === id) k.eltern = o.eltern;
    for (const d of pk.medien.dateien) d.ordner = d.ordner.filter((x) => x !== id);
    pk.medien.ordner = pk.medien.ordner.filter((x) => x.id !== id);
    return o;
  }

  /* ---------- Verwendung und Filter (E1) ---------- */
  // Verweise data-medium="m<n>" im HTML einer Seite (nur der Verweis steht im Paket, nie der Inhalt)
  const MEDIUM_RE = /\bdata-medium\s*=\s*["']?(m[1-9]\d*)\b/g;
  function verweiseIn(html) { const r = new Set(); let m; MEDIUM_RE.lastIndex = 0; while ((m = MEDIUM_RE.exec(String(html || '')))) r.add(m[1]); return r; }
  // Seiten, die die Datei verwenden → [{ version, seite, titel }]
  function verwendung(pk, id) {
    const r = [];
    for (const v of (pk && pk.versionen) || []) for (const s of v.seiten) if (verweiseIn(s.html).has(id)) r.push({ version: v.nummer, seite: s.id, titel: s.titel });
    return r;
  }
  // Dateien, die in Seiten der Version nummer vorkommen (null = in irgendeiner Version)
  function verwendetIn(pk, nummer) {
    const r = new Set();
    for (const v of (pk && pk.versionen) || []) {
      if (nummer !== null && v.nummer !== nummer) continue;
      for (const s of v.seiten) verweiseIn(s.html).forEach((x) => r.add(x));
    }
    return r;
  }
  // Filter „Version: Alle ▾“: 'alle' | '<nummer>' | 'nicht-verwendet' → Dateien in Reihenfolge der Bibliothek
  function gefiltert(pk, filter) {
    const alle = dateien(pk);
    if (!filter || filter === 'alle') return alle.slice();
    if (filter === 'nicht-verwendet') { const v = verwendetIn(pk, null); return alle.filter((d) => !v.has(d.id)); }
    const v = verwendetIn(pk, filter);
    return alle.filter((d) => v.has(d.id));
  }
  // Dateien direkt im Ordner (null: Dateien ohne Ordner)
  function inOrdner(liste, ordnerId) { return liste.filter((d) => (ordnerId === null ? d.ordner.length === 0 : d.ordner.indexOf(ordnerId) >= 0)); }
  // „Zuletzt hinzugefügt“: höchstens 12, neueste zuerst
  function zuletzt(liste) { return liste.slice().sort((a, b) => (a.erstellt < b.erstellt ? 1 : a.erstellt > b.erstellt ? -1 : 0)).slice(0, MAX_ZULETZT); }

  // Medium in einer Seite (Vorlage „Bild / Video“): nur der Verweis und die Einstellungen stehen im HTML –
  // data-medium="m<n>", data-ton="aus", data-schleife="an", data-autostart="an" (Standard: Ton an, Schleife und
  // Autostart aus). F7: Autostart nur zusammen mit „Ton aus“ (Browser starten Videos von selbst nur ohne Ton).
  const PLATZ_RE = /\bdata-medium\s*=/;
  function hatMediumPlatz(html) { return PLATZ_RE.test(String(html || '')); }
  function einstellungen(e) {
    return { medium: e.getAttribute('data-medium') || '', tonAus: e.getAttribute('data-ton') === 'aus',
      schleife: e.getAttribute('data-schleife') === 'an', autostart: e.getAttribute('data-autostart') === 'an' };
  }
  function mediumPlatz(html) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html');
    return { doc: doc, el: doc.body.querySelector('[data-medium]') };
  }
  // Einstellungen des Medium-Platzes einer Seite → { medium, tonAus, schleife, autostart } | null
  function mediumVon(html) { if (!hatMediumPlatz(html)) return null; const m = mediumPlatz(html); return m.el ? einstellungen(m.el) : null; }
  function htmlMitMedium(html, werte) {
    const m = mediumPlatz(html);
    if (!m.el) throw fehler('medien', 'Kein Medium-Platz.', 'Diese Seite hat keinen Platz für ein Medium (Vorlage „Bild / Video“).');
    const e = m.el, w = werte || {};
    if ('medium' in w) {
      if (w.medium && !/^m[1-9]\d*$/.test(String(w.medium))) throw fehler('medien', 'Ungültiges Medium.', String(w.medium));
      e.setAttribute('data-medium', w.medium || '');
    }
    const schalter = (an, attr, wert) => { if (an) e.setAttribute(attr, wert); else e.removeAttribute(attr); };
    if ('tonAus' in w) schalter(w.tonAus === true, 'data-ton', 'aus');
    if ('schleife' in w) schalter(w.schleife === true, 'data-schleife', 'an');
    if ('autostart' in w) schalter(w.autostart === true, 'data-autostart', 'an');
    const neu = einstellungen(e);
    if (neu.autostart && !neu.tonAus) throw fehler('medien', 'Autostart nur mit „Ton aus“.', 'Browser starten ein Video von selbst nur ohne Ton – erst „Ton aus“ wählen.');
    return m.doc.body.innerHTML;
  }
  function seiteMitMedium(pk, nummer, seiteId, werte) {
    const v = (pk.versionen || []).find((x) => x.nummer === nummer);
    const s = v ? v.seiten.find((x) => x.id === seiteId) : null;
    if (!s) throw fehler('medien', 'Seite nicht gefunden.', 'Seite ' + seiteId + ' gibt es in Version ' + nummer + ' nicht (mehr).');
    if (werte && werte.medium && !datei(pk, werte.medium)) throw fehler('medien', 'Datei nicht gefunden.', 'Die Datei ' + werte.medium + ' gibt es in der Bibliothek nicht.');
    s.html = htmlMitMedium(s.html, werte);
    return s;
  }

  /* ---------- Status (F3) und Hinweise ---------- */
  // onlineShas = Set der Git-Blob-SHAs in aether-medien/medien/ (null = noch nie geprüft)
  function status(d, onlineShas) { if (!d) return 'flyer'; return onlineShas && onlineShas.has(d.gitSha) ? 'online' : 'geraet'; }
  const STATUS_TEXT = { online: 'online', geraet: 'nur Gerät', flyer: 'Flyer' };
  // F10: Safari außerhalb der Home-Bildschirm-App? (WebKit-Safari, nicht Chrome/Firefox/Edge; Home-App an
  // display-mode: standalone bzw. navigator.standalone)
  function istSafari(ua) {
    const u = String(ua || '');
    return /Safari\//.test(u) && /AppleWebKit\//.test(u) && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR|Android|SamsungBrowser)\//.test(u);
  }
  function safariHinweisNoetig(ua, standalone, nurGeraet) { return !!nurGeraet && istSafari(ua) && !standalone; }
  function laeuftAlsApp() {
    try { if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true; } catch (e) { /* egal */ }
    try { return window.navigator && window.navigator.standalone === true; } catch (e) { return false; }
  }
  // F4: Reicht der Platz? platz = { frei } | null (unbekannt → ja). → '' oder Meldungstext
  function platzMeldung(bytes, platz) {
    if (!platz || typeof platz.frei !== 'number') return '';
    const noetig = Math.ceil(bytes * 1.05) + RESERVE_BYTES;
    if (platz.frei >= noetig) return '';
    return 'Nicht genug Speicher auf diesem Gerät: frei ' + groesseText(platz.frei) + ', nötig etwa ' + groesseText(noetig) + '. Bitte Platz schaffen oder Dateien online stellen und hier löschen.';
  }
  // F4: Annahme prüfen → '' (angenommen) oder Meldung (nie still abgelehnt)
  function annahmeMeldung(bytes) {
    if (Number(bytes) > MAX_DATEI) return 'Datei zu groß: ' + groesseText(bytes) + ' (höchstens 500 MB je Datei).';
    return '';
  }

  /* ---------- Laufzeit: Bilder, Inhalte, Online-Stand (nur im Browser) ---------- */
  const S = () => window.AetherFlyerSpeicher || null;
  const urls = new Map();      // 'b:'|'k:' + id → { url (Object-URL), daten (data:-URL) }
  const laeuft = new Map();    // Schlüssel → Promise
  let online = { shas: null, geprueft: null, zugriff: null };
  let aufGeraet = new Set();
  let laderOnline = null;      // (datei) → Promise<Blob|null> (flyer-medien-online.js)
  function melde(detail) { try { document.dispatchEvent(new CustomEvent('flyer:medien', { detail: detail || {} })); } catch (e) { /* egal */ } }
  function datenUrlVon(blob) {
    return new Promise((ok) => {
      try { const r = new FileReader(); r.onload = () => ok(String(r.result || '')); r.onerror = () => ok(''); r.readAsDataURL(blob); } catch (e) { ok(''); }
    });
  }
  // Bild einer Datei bereitstellen (aus dem Speicher) → Promise<{ url, daten }|null>
  function bildLaden(id, art) {
    const key = art + ':' + id;
    if (urls.has(key)) return Promise.resolve(urls.get(key));
    if (laeuft.has(key)) return laeuft.get(key);
    const p = (async () => {
      const s = S();
      const blob = s && typeof s.ladeMedienBild === 'function' ? await s.ladeMedienBild(id, art) : null;
      if (!blob) return null;
      const e = { url: URL.createObjectURL(blob), daten: await datenUrlVon(blob), groesse: blob.size };
      urls.set(key, e);
      return e;
    })().finally(() => laeuft.delete(key));
    laeuft.set(key, p);
    return p;
  }
  // Synchron (für die Darstellung): schon bereitgestelltes Bild
  function bild(id, art) { return urls.get(art + ':' + id) || null; }
  function bildVergessen(id) {
    for (const a of ['b', 'k']) { const e = urls.get(a + ':' + id); if (e) { try { URL.revokeObjectURL(e.url); } catch (x) { /* egal */ } urls.delete(a + ':' + id); } }
  }
  async function bilderBereit(ids, art) { await Promise.all(Array.from(ids).map((id) => bildLaden(id, art || 'b').catch(() => null))); }
  async function geraetLaden() {
    const s = S();
    const ids = s && typeof s.medienAufGeraet === 'function' ? await s.medienAufGeraet() : null;
    aufGeraet = new Set(ids || []);
    const o = s && typeof s.ladeMedienOnline === 'function' ? await s.ladeMedienOnline() : null;
    if (o && online.shas === null) online = { shas: o.zugriff === 'kein' ? null : new Set(o.liste.map((x) => x.sha)), geprueft: o.geprueft, zugriff: o.zugriff };
    melde({ geraet: true });
  }
  function setzeOnline(shas, geprueft, zugriff) { online = { shas: shas ? new Set(shas) : null, geprueft: geprueft || null, zugriff: zugriff || null }; melde({ online: true }); }
  function onlineStand() { return { shas: online.shas, geprueft: online.geprueft, zugriff: online.zugriff }; }
  function hatInhalt(id) { return aufGeraet.has(id); }
  function inhaltDa(id, da) { if (da) aufGeraet.add(id); else aufGeraet.delete(id); melde({ id: id }); }
  // Inhalt einer Datei → Promise<Blob|null>: aus dem Gerät, sonst (wenn möglich) online nachladen (F6)
  async function inhalt(d) {
    const s = S();
    const e = s && typeof s.ladeMedienInhalt === 'function' ? await s.ladeMedienInhalt(d.id) : null;
    if (e && e.blob) return e.blob;
    if (laderOnline) return laderOnline(d);
    return null;
  }
  function setzeLader(fn) { laderOnline = typeof fn === 'function' ? fn : null; }

  /* ---------- Einlesen im Browser: Maße, Dauer, Startbild/Vorschau, Mini, SVG bereinigen ---------- */
  // Selbst gewählt: Vorschau bzw. Startbild höchstens 1600 px (lange Seite), Mini 360 px; JPEG 0,85 für Fotos und
  // Videos, PNG für Grafiken und Animationen (Transparenz); höchstens 10 s für ein Video-Bild.
  const BILD_MAX = 1600, MINI_MAX = 360, JPEG_Q = 0.85, VIDEO_FRIST_MS = 10000;
  function mitFrist(p, ms, ersatz) {
    let t;
    return Promise.race([Promise.resolve(p).catch(() => ersatz), new Promise((r) => { t = setTimeout(() => r(ersatz), ms); })]).finally(() => clearTimeout(t));
  }
  function canvasBlob(c, typ) {
    return new Promise((ok) => { try { c.toBlob((b) => ok(b || null), typ, typ === 'image/jpeg' ? JPEG_Q : undefined); } catch (e) { ok(null); } });
  }
  // Quelle (ImageBitmap, img, video) verkleinert als Blob (nie vergrößert); Canvas danach freigeben (iOS)
  async function verkleinert(quelle, w, h, max, typ) {
    if (!(w > 0 && h > 0)) return null;
    const f = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * f)); c.height = Math.max(1, Math.round(h * f));
    try {
      const ctx = c.getContext('2d');
      if (typ === 'image/jpeg') { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(quelle, 0, 0, c.width, c.height);
      return await canvasBlob(c, typ);
    } catch (e) { return null; } finally { c.width = c.height = 0; }
  }
  function bildElement(blob) {
    return new Promise((ok) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => ok({ img: img, url: url });
      img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
      img.src = url;
    });
  }
  // Bild dekodieren → { quelle, w, h, frei() } | null (z. B. HEIC in Chromium: null → „Vorschau nicht möglich“)
  async function dekodieren(blob, istSvg) {
    if (!istSvg && typeof createImageBitmap === 'function') {
      try { const bmp = await createImageBitmap(blob); return { quelle: bmp, w: bmp.width, h: bmp.height, frei: () => { try { bmp.close(); } catch (e) { /* egal */ } } }; } catch (e) { /* weiter mit <img> */ }
    }
    const r = await mitFrist(bildElement(blob), VIDEO_FRIST_MS, null);
    if (!r) return null;
    const w = r.img.naturalWidth || (istSvg ? 1200 : 0), h = r.img.naturalHeight || (istSvg ? 800 : 0);
    if (!(w > 0 && h > 0)) { URL.revokeObjectURL(r.url); return null; }
    return { quelle: r.img, w: w, h: h, frei: () => URL.revokeObjectURL(r.url) };
  }
  // Video: Metadaten und ein Bild bei t Sekunden → { breite, hoehe, dauer, b, k, abspielbar, t }
  function videoBild(blob, t, mime) {
    return mitFrist(new Promise((ok) => {
      const v = document.createElement('video'), url = URL.createObjectURL(blob);
      let fertig = false;
      const ende = (r) => { if (fertig) return; fertig = true; try { v.removeAttribute('src'); v.load(); } catch (e) { /* egal */ } URL.revokeObjectURL(url); ok(r); };
      v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
      v.onerror = () => ende({ breite: null, hoehe: null, dauer: null, b: null, k: null, abspielbar: false, t: null });
      // WebM ohne Längenangabe (z. B. aus MediaRecorder): Dauer erst nach einem Sprung ans Ende bekannt
      const dauerHolen = () => new Promise((r) => {
        if (isFinite(v.duration)) { r(); return; }
        const z = setTimeout(r, 3000);
        v.ondurationchange = () => { if (isFinite(v.duration)) { clearTimeout(z); v.ondurationchange = null; r(); } };
        try { v.currentTime = 1e9; } catch (e) { clearTimeout(z); r(); }
      });
      v.onloadeddata = async () => {
        v.onloadeddata = null;
        await dauerHolen();
        const d = isFinite(v.duration) ? v.duration : null;
        const ziel = Math.max(0, Math.min(typeof t === 'number' ? t : 1, d !== null ? Math.max(0, d - 0.05) : 1));
        const zeichnen = async () => {
          const w = v.videoWidth, h = v.videoHeight;
          const b = await verkleinert(v, w, h, BILD_MAX, 'image/jpeg'), k = await verkleinert(v, w, h, MINI_MAX, 'image/jpeg');
          ende({ breite: w || null, hoehe: h || null, dauer: d, b: b, k: k, abspielbar: true, t: Math.round(ziel * 100) / 100 });
        };
        if (Math.abs(v.currentTime - ziel) < 0.01) { zeichnen(); return; }
        v.onseeked = () => { v.onseeked = null; zeichnen(); };
        try { v.currentTime = ziel; } catch (e) { zeichnen(); }
      };
      v.src = url;
    }), VIDEO_FRIST_MS, { breite: null, hoehe: null, dauer: null, b: null, k: null, abspielbar: false, t: null, zeitlimit: true }).then((r) => {
      let kann = '';
      try { kann = document.createElement('video').canPlayType(String(mime || '')); } catch (e) { kann = ''; }
      r.formatBekannt = kann !== '';
      return r;
    });
  }
  // Startbild „aus der ersten Sekunde“: bei 1 s, bei kürzeren Videos in der Mitte
  function startZeit(dauer) { return typeof dauer === 'number' && dauer > 0 ? Math.min(1, dauer / 2) : 1; }
  // Eine Datei einlesen: format = formatVon(…), kopf = erste Bytes (Animation) → { art, breite, hoehe, dauer, startbild,
  // b, k, vorschau (Boolean), abspielbar (Video) }
  async function einlesen(blob, format, kopf) {
    let art = format.art, dauer = null;
    if (format.endung === 'gif' || format.endung === 'png' || format.endung === 'webp') {
      const a = animationLesen(kopf || new Uint8Array(0), format.endung);
      art = a.animiert ? 'animation' : (format.endung === 'gif' ? 'foto' : format.art);
      dauer = a.dauer;
    }
    if (art === 'video') {
      const v0 = await videoBild(blob, 0, format.mime);
      const t = startZeit(v0.dauer);
      const v = v0.abspielbar && t > 0 ? await videoBild(blob, t, format.mime) : v0;
      return { art: art, breite: v.breite, hoehe: v.hoehe, dauer: v.dauer !== null ? v.dauer : v0.dauer, startbild: v.abspielbar ? v.t : null,
        b: v.b, k: v.k, vorschau: !!v.b, abspielbar: v0.abspielbar, formatBekannt: v0.formatBekannt };
    }
    const d = await dekodieren(blob, format.endung === 'svg');
    if (!d) return { art: art, breite: null, hoehe: null, dauer: dauer, startbild: null, b: null, k: null, vorschau: false };
    try {
      const typ = art === 'foto' && format.endung !== 'png' && format.endung !== 'webp' ? 'image/jpeg' : 'image/png';
      const b = await verkleinert(d.quelle, d.w, d.h, BILD_MAX, typ), k = await verkleinert(d.quelle, d.w, d.h, MINI_MAX, typ);
      return { art: art, breite: d.w, hoehe: d.h, dauer: dauer, startbild: null, b: b, k: k, vorschau: !!b };
    } finally { d.frei(); }
  }
  // F5: SVG nur als Bild – über DOMParser bereinigt (ohne Skripte, Handler, fremde Verweise, foreignObject); → Text | wirft
  const SVG_WEG = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'handler', 'listener', 'audio', 'video']);
  function svgBereinigen(text) {
    const doc = new DOMParser().parseFromString(String(text || ''), 'image/svg+xml');
    const w = doc.documentElement;
    if (!w || String(w.localName).toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw fehler('medien', 'SVG nicht lesbar.', 'Die Datei ist keine gültige SVG-Grafik.');
    const P = window.AetherFlyerPaket;
    for (const el of Array.from(w.querySelectorAll('*'))) {
      const n = String(el.localName || '').toLowerCase();
      if (SVG_WEG.has(n) || ((n === 'set' || n.indexOf('animate') === 0) && /href|^on/i.test(String(el.getAttribute('attributeName') || '')))) { el.remove(); continue; }
    }
    for (const el of [w].concat(Array.from(w.querySelectorAll('*')))) {
      for (const at of Array.from(el.attributes)) {
        const n = at.name.toLowerCase(), ln = String(at.localName || '').toLowerCase();
        if (n.indexOf('on') === 0 || ln.indexOf('on') === 0) { el.removeAttributeNode(at); continue; }
        if (ln === 'href' || ln === 'src') { const v = at.value.trim(); if (!(v.charAt(0) === '#' || /^data:image\//i.test(v))) el.removeAttributeNode(at); continue; }
        if (n === 'style' && P) { at.value = P.bereinigeCss(at.value); continue; }
        if (/url\(/i.test(at.value) && !/^url\(\s*['"]?#/i.test(at.value.trim())) el.removeAttributeNode(at);
      }
      if (String(el.localName).toLowerCase() === 'style' && P) el.textContent = P.bereinigeCss(el.textContent);
    }
    return new XMLSerializer().serializeToString(w);
  }

  window.AetherFlyerMedien = Object.freeze({
    GRENZE_UPLOAD: GRENZE_UPLOAD, MAX_DATEI: MAX_DATEI, AUTO_LADEN: AUTO_LADEN, ZIP_MAX: ZIP_MAX, WEBCRYPTO_MAX: WEBCRYPTO_MAX,
    MAX_NAME: MAX_NAME, MAX_ORDNERNAME: MAX_ORDNERNAME, MAX_ZULETZT: MAX_ZULETZT, AUS_FLYERN: AUS_FLYERN,
    HINWEIS_GROSS: HINWEIS_GROSS, HINWEIS_SAFARI: HINWEIS_SAFARI, REPO: REPO, REPO_ORDNER: REPO_ORDNER, UPLOAD_SEITE: UPLOAD_SEITE,
    FORMATE: FORMATE, ACCEPT_FOTOS: ACCEPT_FOTOS, ACCEPT_DATEIEN: ACCEPT_DATEIEN, ART_NAME: ART_NAME, STATUS_TEXT: STATUS_TEXT,
    // Texte und Formate
    groesseText: groesseText, dauerText: dauerText, endungVon: endungVon, ohneEndung: ohneEndung, formatKurz: formatKurz,
    zuGrossFuerUpload: zuGrossFuerUpload, groessenHinweis: groessenHinweis, slug: slug, dateiName: dateiName,
    formatVon: formatVon, animationLesen: animationLesen,
    // Prüfsummen
    gitSha: gitSha, sha1: sha1, crc32Blob: crc32Blob, stueckLesen: stueckLesen,
    // Modell
    medien: medien, dateien: dateien, ordnerListe: ordnerListe, datei: datei, ordnerVon: ordnerVon, sicherstellen: sicherstellen,
    dateiAnlegen: dateiAnlegen, dateiUmbenennen: dateiUmbenennen, dateiInOrdner: dateiInOrdner, dateiLoeschen: dateiLoeschen,
    setzeStartbild: setzeStartbild, kinderOrdner: kinderOrdner, pfad: pfad, ordnerBaum: ordnerBaum, nachfahren: nachfahren,
    ordnerAnlegen: ordnerAnlegen, ordnerUmbenennen: ordnerUmbenennen, ordnerVerschieben: ordnerVerschieben, ordnerLoeschen: ordnerLoeschen,
    neueKennung: neueKennung, verweiseIn: verweiseIn, verwendung: verwendung, verwendetIn: verwendetIn, gefiltert: gefiltert,
    inOrdner: inOrdner, zuletzt: zuletzt,
    hatMediumPlatz: hatMediumPlatz, mediumVon: mediumVon, htmlMitMedium: htmlMitMedium, seiteMitMedium: seiteMitMedium,
    // Status und Hinweise
    status: status, istSafari: istSafari, safariHinweisNoetig: safariHinweisNoetig, laeuftAlsApp: laeuftAlsApp,
    platzMeldung: platzMeldung, annahmeMeldung: annahmeMeldung,
    // Laufzeit
    bildLaden: bildLaden, bild: bild, bildVergessen: bildVergessen, bilderBereit: bilderBereit, geraetLaden: geraetLaden,
    setzeOnline: setzeOnline, onlineStand: onlineStand, hatInhalt: hatInhalt, inhaltDa: inhaltDa, inhalt: inhalt, setzeLader: setzeLader,
    datenUrlVon: datenUrlVon,
    // Einlesen (Browser)
    einlesen: einlesen, videoBild: videoBild, startZeit: startZeit, svgBereinigen: svgBereinigen, dekodieren: dekodieren
  });
})();
