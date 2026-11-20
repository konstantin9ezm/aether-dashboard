// Export „Grafiken & Daten“ der Flyer-Seite (flyer.html, F3a Teil F): je Seite alle Grafiken als PNG, alle als SVG,
// die Daten als CSV und als JSON, Grafiken einzeln wählen (Raster mit Mini-Bildern, Mehrfachauswahl); für die ganze
// geöffnete Version alles als ZIP. Geöffnet über „Export“ im Vollbild, „Grafiken & Daten exportieren“ im Menü „···“
// einer Kachel (Tafel der Seite) und den Knopf oben in der Übersicht (ZIP der Version).
//
// Grafik = automatisch erkanntes Element der Seite (Regel am echten Paket festgelegt, siehe README):
//   Kandidaten: Kästen [data-block], .blk, .box, .quote, .cd · Gruppen .flow4, .states, .forms, .stepper, .rm,
//   .legend · Kennzahlen .st, .stats3 · Balken .bars, .stack, .budget, .gantt, .chart, .codebar · Bilder svg, img,
//   [role=img]. Gezählt wird nur der äußerste Kandidat (keiner seiner Vorfahren ist selbst Kandidat), mindestens
//   24 × 24 px groß und nicht in einem ausgeblendeten Bereich (.fill.off). Art: Bild-Element ab 200 × 80 px „bild“,
//   kleiner „symbol“; Balken (oder .stepper, oder Balken darin) „balken“; .forms/.legend „symbol“; Kennzahlen (oder
//   darin) „kennzahlen“; sonst „kasten“.
// PNG: derselbe Weg wie „Bild“ (AetherFlyerExport.seitenBild: SVG/foreignObject → Canvas, doppelte Auflösung), aus
//   dem Bild der ganzen Seite ausgeschnitten – der Hintergrund ist der der Seite.
// SVG: SVG-Elemente als echte SVG (berechnete Stile eingesetzt, Schriften eingebettet, wenn Text vorkommt); das Logo
//   (Hintergrund aus einer data:-SVG) als diese SVG; HTML-Kästen als SVG mit eingebettetem HTML (foreignObject) –
//   das sagt die Tafel ausdrücklich („nur im Browser genau, in Grafikprogrammen evtl. nicht“).
// Daten (F8): CSV UTF-8 mit BOM, „;“, Spalten version;seite;kennung;art;wert;status (art = text | status | zaehler |
//   stand); JSON mit Format-Kennung „aether-flyer-daten“, formatVersion 1 und Versionsnummer. Die Werte sind die der
//   Darstellung (Basis + Änderungsschicht), Kennungen wie beim Bearbeiten (t…, s…, zaehler<n>, stand<n>).
// Dateinamen nur ASCII: <version>_<kennung>_<nn>_<art>.png/.svg, <version>_<kennung>.csv/.json; mehrere Dateien → ZIP
// (AetherFlyerZip, „stored“, CRC-32). Weitergabe über die vorhandenen Hilfen (Teilen, sonst Herunterladen, sonst
// Dialog mit Link) – immer synchron im Klick (Nutzergeste fürs Teilen auf iPhone/iPad), darum wird vorher vorbereitet.
// Nichts aus einem Paket wird als HTML ins Dokument gesetzt (nur textContent, Canvas); kein Speicher, kein Netz.
(function () {
  'use strict';

  const KASTEN = '[data-block], .blk, .box, .quote, .cd';
  const GRUPPE = '.flow4, .states, .forms, .stepper, .rm, .legend';
  const ZAHL = '.st, .stats3';
  const BALKEN = '.bars, .stack, .budget, .gantt, .chart, .codebar';
  const BILD = 'svg, img, [role="img"]';
  const ALLE = [KASTEN, GRUPPE, ZAHL, BALKEN, BILD].join(', ');
  const MIN_PX = 24;
  const BILD_MIN_B = 200, BILD_MIN_H = 80;
  const ARTEN = ['kasten', 'kennzahlen', 'balken', 'symbol', 'bild'];
  const ART_NAME = { kasten: 'Kasten', kennzahlen: 'Kennzahlen', balken: 'Balken', symbol: 'Symbol', bild: 'Bild' };
  const ART_MEHR = { kasten: 'Kästen', kennzahlen: 'Kennzahlen', balken: 'Balken', symbol: 'Symbole', bild: 'Bilder' };
  const DATEN_FORMAT = 'aether-flyer-daten';
  const DATEN_VERSION = 1;
  const CSV_SPALTEN = ['version', 'seite', 'kennung', 'art', 'wert', 'status'];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HTML_HINWEIS = 'nur im Browser genau, in Grafikprogrammen evtl. nicht';
  // Selbst gewählt: Mini-Bilder höchstens 150 × 96 CSS-Pixel (doppelte Auflösung)
  const MINI_B = 150, MINI_H = 96;
  // Berechnete Stile, die eine echte SVG braucht (Malen; Schrift nur am Wurzel- und an Text-Elementen)
  const MAL = ['fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'stop-color', 'stop-opacity',
    'paint-order', 'vector-effect', 'shape-rendering'];
  const SCHRIFT = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'letter-spacing', 'word-spacing',
    'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'text-decoration-line'];

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const A = () => window.AetherFlyerAnsicht || null;
  const EX = () => window.AetherFlyerExport || null;
  const AE = () => window.AetherFlyerAenderungen || null;
  const B = () => window.AetherFlyerBearbeiten || null;
  const U = () => window.AetherFlyerUebersicht || null;
  const Z = () => window.AetherFlyerZip;

  let eingerichtet = false;

  /* ---------- Hilfen ---------- */
  function meldung(t) { try { G().meldung(t); } catch (e) { /* ohne #toast */ } }
  function el(tag, text, klasse) { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (klasse) e.className = klasse; return e; }
  function knopf(text, fn, klasse) { const b = el('button', text, klasse); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function leeren(x) { while (x.firstChild) x.removeChild(x.firstChild); }
  function runde(v) { return Math.round(v * 100) / 100; }
  function zwei(n) { return n < 10 ? '0' + n : String(n); }
  function zahlText(n, eins, mehr) { return n + ' ' + (n === 1 ? eins : mehr); }
  function groesse(bytes) { return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB'; }
  // Teil eines Dateinamens: nur ASCII-Buchstaben, Ziffern, „.“ und „-“, nie „..“
  function dateiTeil(s) { return String(s).replace(/[^A-Za-z0-9.-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[.-]+|[.-]+$/g, '') || 'x'; }
  function sichtbareSeiten(pk) { return pk && Array.isArray(pk.dokumente) ? pk.dokumente.filter((d) => d && d.ausgeblendet !== true) : []; }

  /* ---------- Erkennen und Messen (auf der dargestellten Wurzel) ---------- */
  function einordnen(e, w, h) {
    if (e.matches(BILD)) return w >= BILD_MIN_B && h >= BILD_MIN_H ? 'bild' : 'symbol';
    if (e.matches(BALKEN + ', .stepper') || e.querySelector(BALKEN)) return 'balken';
    if (e.matches('.forms, .legend')) return 'symbol';
    if (e.matches(ZAHL) || e.querySelector(ZAHL)) return 'kennzahlen';
    return 'kasten';
  }
  // Grafiken einer dargestellten Wurzel in Dokumentreihenfolge → [{ el, art, x, y, w, h, rw, rh }] (CSS-Pixel relativ
  // zur Wurzel, auf die Seite begrenzt; rw/rh = ganze Größe des Elements). grenzen = { breite, hoehe } der Seite.
  function erkenne(wurzel, grenzen) {
    const wr = wurzel.getBoundingClientRect();
    const kandidaten = Array.from(wurzel.querySelectorAll(ALLE));
    const menge = new Set(kandidaten);
    const aus = [];
    for (const e of kandidaten) {
      let p = e.parentElement, innen = false;
      while (p && p !== wurzel) { if (menge.has(p)) { innen = true; break; } p = p.parentElement; }
      if (innen) continue;
      const rc = e.getBoundingClientRect();
      if (rc.width < MIN_PX || rc.height < MIN_PX) continue;
      if (e.closest('.fill.off')) continue;
      let x = rc.left - wr.left, y = rc.top - wr.top, x2 = x + rc.width, y2 = y + rc.height;
      if (grenzen) { x = Math.max(0, x); y = Math.max(0, y); x2 = Math.min(grenzen.breite, x2); y2 = Math.min(grenzen.hoehe, y2); }
      if (x2 - x < MIN_PX || y2 - y < MIN_PX) continue;
      aus.push({ el: e, art: einordnen(e, rc.width, rc.height), x: x, y: y, w: x2 - x, h: y2 - y, rw: rc.width, rh: rc.height });
    }
    return aus;
  }

  // Echte SVG: Klon mit eingesetzten berechneten Stilen (die Stile kamen aus dem Paket-CSS über Klassen)
  function aufraeumen(svg) {
    for (const s of Array.from(svg.querySelectorAll('script, foreignObject'))) s.remove();
    for (const e of [svg].concat(Array.from(svg.querySelectorAll('*')))) {
      for (const a of Array.from(e.attributes)) if (/^on/i.test(a.name)) e.removeAttribute(a.name);
    }
    return svg;
  }
  function svgMitStilen(svg, rw, rh) {
    const klon = svg.cloneNode(true);
    const q = [svg].concat(Array.from(svg.querySelectorAll('*'))), z = [klon].concat(Array.from(klon.querySelectorAll('*')));
    let mitText = false;
    for (let i = 0; i < q.length && i < z.length; i++) {
      const cs = getComputedStyle(q[i]), n = String(q[i].localName || '').toLowerCase();
      const teile = [];
      if (cs.display === 'none') teile.push('display:none');
      for (const p of MAL) { const v = cs.getPropertyValue(p); if (v) teile.push(p + ':' + v); }
      const text = n === 'text' || n === 'tspan' || n === 'textpath';
      if (text && q[i].textContent.trim()) mitText = true;
      if (i === 0 || text) for (const p of SCHRIFT) { const v = cs.getPropertyValue(p); if (v) teile.push(p + ':' + v); }
      z[i].setAttribute('style', teile.join(';'));
    }
    const w = runde(rw), h = runde(rh);
    if (!klon.getAttribute('viewBox')) klon.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    klon.setAttribute('width', String(w));
    klon.setAttribute('height', String(h));
    return { klon: aufraeumen(klon), mitText: mitText };
  }
  // data:image/svg+xml,… → SVG-Text (sonst null)
  function datenUrlSvg(u) {
    const m = /^data:image\/svg\+xml((?:;[^,]*)?),([\s\S]*)$/i.exec(String(u || ''));
    if (!m) return null;
    try {
      if (/;base64/i.test(m[1])) {
        const bin = atob(m[2].replace(/\s+/g, '')), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(u8);
      }
      return decodeURIComponent(m[2]);
    } catch (e) { return null; }
  }
  function svgAusText(text, rw, rh, par) {
    let doc;
    try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch (e) { return null; }
    const r = doc && doc.documentElement;
    if (!r || r.localName !== 'svg' || r.namespaceURI !== SVG_NS || doc.getElementsByTagName('parsererror').length) return null;
    const klon = document.importNode(r, true);   // nie ins Dokument gesetzt, nur geschrieben
    if (!klon.getAttribute('viewBox')) {
      const w0 = parseFloat(klon.getAttribute('width')), h0 = parseFloat(klon.getAttribute('height'));
      if (w0 > 0 && h0 > 0) klon.setAttribute('viewBox', '0 0 ' + w0 + ' ' + h0);
    }
    klon.setAttribute('width', String(runde(rw)));
    klon.setAttribute('height', String(runde(rh)));
    if (par) klon.setAttribute('preserveAspectRatio', par);
    return { klon: aufraeumen(klon), mitText: !!klon.querySelector('text') };
  }
  // Hintergrund eines Elements aus genau einer data:-SVG (Logo) → echte SVG
  function hintergrundSvg(e, rw, rh) {
    const cs = getComputedStyle(e), bg = String(cs.backgroundImage || '');
    if (bg.split('url(').length !== 2) return null;
    const m = /^url\(\s*(["']?)([\s\S]*)\1\s*\)$/.exec(bg.trim());
    if (!m) return null;
    const text = datenUrlSvg(m[2].replace(/\\(["'\\])/g, '$1'));
    if (!text) return null;
    const size = String(cs.backgroundSize || '');
    const par = size === 'contain' ? 'xMidYMid meet' : size === 'cover' ? 'xMidYMid slice' : /^100% 100%$/.test(size) ? 'none' : null;
    return svgAusText(text, rw, rh, par);
  }
  function imgSvg(img, rw, rh) {
    const src = img.getAttribute('src') || '';
    if (!/^data:image\//i.test(src)) return null;
    const fit = getComputedStyle(img).objectFit;
    const par = fit === 'contain' ? 'xMidYMid meet' : fit === 'cover' ? 'xMidYMid slice' : 'none';
    const text = datenUrlSvg(src);
    if (text) { const s = svgAusText(text, rw, rh, par); if (s) return s; }
    const w = runde(rw), h = runde(rh);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    const im = document.createElementNS(SVG_NS, 'image');
    im.setAttribute('href', src); im.setAttribute('width', String(w)); im.setAttribute('height', String(h)); im.setAttribute('preserveAspectRatio', par);
    svg.appendChild(im);
    return { klon: svg, mitText: false };
  }
  function echteSvgVon(g) {
    const n = String(g.el.localName || '').toLowerCase();
    try {
      if (n === 'svg') return svgMitStilen(g.el, g.rw, g.rh);
      if (n === 'img') return imgSvg(g.el, g.rw, g.rh);
      if (g.el.matches('[role="img"]')) return hintergrundSvg(g.el, g.rw, g.rh);
    } catch (e) { /* dann als SVG mit eingebettetem HTML */ }
    return null;
  }
  function echteSvgText(e, schrift) {
    if (e.mitText && schrift) {
      const st = document.createElementNS(SVG_NS, 'style');
      st.textContent = schrift;
      e.klon.insertBefore(st, e.klon.firstChild);
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(e.klon);
  }

  // Daten: Text sichtbar gelesen (Leerraum zusammengefasst, <br> = Zeilenumbruch)
  const MARKEN = '[data-t],[data-s],[data-block],[data-zaehler],[data-stand],ae-t';
  function sichtText(n) {
    let t = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) t += c.data.replace(/\s+/g, ' ');
      else if (c.nodeType === 1) {
        const nm = String(c.localName || '').toLowerCase();
        if (nm === 'br') t += '\n';
        else if (nm !== 'style' && nm !== 'script') t += sichtText(c);
      }
    }
    return t;
  }
  function glaetten(t) { return t.split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, ''); }
  function textWert(e) {
    const tr = e.querySelector('ae-t') || e;
    // Mit weiteren Markierungen darin: nur die eigenen Textknoten (wie beim Bearbeiten)
    if (tr.querySelector(MARKEN)) return glaetten(Array.prototype.filter.call(tr.childNodes, (n) => n.nodeType === 3).map((n) => n.data).join(' '));
    return glaetten(sichtText(tr));
  }
  // Zeilen der Seite in Dokumentreihenfolge: { kennung, art, wert, status [, fertig, laeuft, gesamt] }
  function datenLesen(wurzel) {
    const ae = AE();
    const zaehler = new Map();
    if (ae && typeof ae.zaehlerWerte === 'function') ae.zaehlerWerte(wurzel).forEach((z, i) => zaehler.set(z.el, Object.assign({ kennung: 'zaehler' + (i + 1) }, z)));
    const stand = new Map();
    const alle = (wurzel.matches('[data-stand]') ? [wurzel] : []).concat(Array.from(wurzel.querySelectorAll('[data-stand]')));
    alle.forEach((e, i) => stand.set(e, 'stand' + (i + 1)));
    const zeilen = [], gesehen = new Set();
    const els = (wurzel.matches('[data-t],[data-s],[data-zaehler],[data-stand]') ? [wurzel] : []).concat(Array.from(wurzel.querySelectorAll('[data-t],[data-s],[data-zaehler],[data-stand]')));
    for (const e of els) {
      const t = e.getAttribute('data-t');
      if (t && !gesehen.has('t\n' + t)) { gesehen.add('t\n' + t); zeilen.push({ kennung: t, art: 'text', wert: textWert(e), status: '' }); }
      const s = e.getAttribute('data-s');
      if (s && !gesehen.has('s\n' + s)) { gesehen.add('s\n' + s); zeilen.push({ kennung: s, art: 'status', wert: glaetten(sichtText(e)), status: e.getAttribute('data-status') || '' }); }
      const z = zaehler.get(e);
      if (z) zeilen.push({ kennung: z.kennung, art: 'zaehler', wert: z.fertig + ' von ' + z.gesamt + ' fertig', status: '', fertig: z.fertig, laeuft: z.laeuft, gesamt: z.gesamt });
      const k = stand.get(e);
      if (k) zeilen.push({ kennung: k, art: 'stand', wert: glaetten(sichtText(e)), status: '' });
    }
    return zeilen;
  }
  function messen(wurzel, dok) {
    const breite = dok.breite > 0 ? dok.breite : Math.max(1, wurzel.offsetWidth || 0);
    const hoehe = dok.art !== 'infografik' && dok.hoehe > 0 ? dok.hoehe : Math.max(1, wurzel.offsetHeight || dok.hoehe || 0);
    const grafiken = erkenne(wurzel, { breite: breite, hoehe: hoehe }).map((g, i) => ({
      nr: i + 1, art: g.art, x: g.x, y: g.y, w: g.w, h: g.h, echt: echteSvgVon(g)
    }));
    return { grafiken: grafiken, zeilen: datenLesen(wurzel), breite: breite, hoehe: hoehe };
  }

  /* ---------- Daten als CSV und JSON (F8) ---------- */
  function csvFeld(v) {
    const s = String(v === undefined || v === null ? '' : v);
    return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(nr, seite, zeilen) {
    const z = [CSV_SPALTEN.join(';')].concat(zeilen.map((r) => [nr, seite, r.kennung, r.art, r.wert, r.status].map(csvFeld).join(';')));
    return '\ufeff' + z.join('\r\n') + '\r\n';
  }
  function json(s, fassung) {
    return JSON.stringify({
      format: DATEN_FORMAT,
      formatVersion: DATEN_VERSION,
      paketFassung: fassung || null,
      version: s.nr,
      seite: s.dok.id,
      titel: s.dok.titel,
      art: s.dok.art,
      breite: runde(s.breite),
      hoehe: runde(s.hoehe),
      eintraege: s.zeilen.map((r) => {
        const e = { kennung: r.kennung, art: r.art, wert: r.wert, status: r.status };
        if (r.art === 'zaehler') { e.fertig = r.fertig; e.laeuft = r.laeuft; e.gesamt = r.gesamt; }
        return e;
      }),
      grafiken: s.grafiken.map((g) => ({
        nr: g.nr, art: g.art, x: runde(g.x), y: runde(g.y), breite: runde(g.w), hoehe: runde(g.h),
        png: g.png ? g.namen.png : null, svg: g.namen.svg, svgArt: g.svgEcht ? 'svg' : 'html'
      }))
    }, null, 2) + '\n';
  }

  /* ---------- Bilder ---------- */
  function canvasVon(bild) {
    const cv = document.createElement('canvas');
    cv.width = bild.w; cv.height = bild.h;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('kein Canvas');
    ctx.clearRect(0, 0, bild.w, bild.h);
    ctx.drawImage(bild.img, 0, 0, bild.w, bild.h);
    return cv;
  }
  function ausschnitt(cv, f, g) {
    const sx = Math.max(0, Math.floor(g.x * f)), sy = Math.max(0, Math.floor(g.y * f));
    const ex = Math.min(cv.width, Math.ceil((g.x + g.w) * f)), ey = Math.min(cv.height, Math.ceil((g.y + g.h) * f));
    const c = document.createElement('canvas');
    c.width = Math.max(1, ex - sx); c.height = Math.max(1, ey - sy);
    c.getContext('2d').drawImage(cv, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  function mini(c) {
    const s = Math.min(1, MINI_B / (c.width / 2), MINI_H / (c.height / 2));
    const w = Math.max(1, Math.round(c.width / 2 * s)), h = Math.max(1, Math.round(c.height / 2 * s));
    const m = document.createElement('canvas');
    m.width = w * 2; m.height = h * 2;
    m.style.width = w + 'px';
    m.setAttribute('aria-hidden', 'true');
    m.getContext('2d').drawImage(c, 0, 0, m.width, m.height);
    return m;
  }
  function blobBytes(b) {
    if (typeof b.arrayBuffer === 'function') return b.arrayBuffer().then((x) => new Uint8Array(x));
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
  }
  function canvasPng(c) {
    return new Promise((res, rej) => {
      const ausUrl = () => {
        const url = c.toDataURL('image/png');
        if (!/^data:image\/png;base64,/.test(url)) throw new Error('Canvas zu groß');
        const bin = atob(url.slice(url.indexOf(',') + 1)), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
      };
      try {
        if (typeof c.toBlob !== 'function') { res(ausUrl()); return; }
        c.toBlob((b) => { if (!b) { try { res(ausUrl()); } catch (e) { rej(e); } return; } blobBytes(b).then(res, rej); }, 'image/png');
      } catch (e) { rej(e); }
    });
  }

  /* ---------- Seite vorbereiten ---------- */
  // → { dok, nr, kennung, breite, hoehe, grafiken: [{ nr, art, x, y, w, h, namen, png, svg, svgEcht, mini }], zeilen,
  //     csv, json, namen: { csv, json }, pngFehler }
  async function seiteVorbereiten(dok, nr, opt) {
    const ex = EX(), a = A();
    if (!ex || typeof ex.seitenBild !== 'function') throw new Error('Export nicht bereit');
    const bild = await ex.seitenBild(dok, undefined, (w) => messen(w, dok));
    const m = bild.mess || { grafiken: [], zeilen: [], breite: bild.breite, hoehe: bild.hoehe };
    const vt = dateiTeil(nr), kennung = dateiTeil(dok.id);
    const schrift = m.grafiken.some((g) => g.echt && g.echt.mitText) ? await ex.schriftRegeln() : '';
    let pngFehler = bild.img ? null : (bild.bildFehler || new Error('kein Bild'));
    let cv = null;
    if (bild.img && m.grafiken.length) { try { cv = canvasVon(bild); } catch (e) { pngFehler = e; } }
    try {
      for (const g of m.grafiken) {
        const basis = vt + '_' + kennung + '_' + zwei(g.nr) + '_' + g.art;
        g.namen = { png: basis + '.png', svg: basis + '.svg' };
        g.svgEcht = !!g.echt;
        g.svg = g.echt ? echteSvgText(g.echt, schrift) : ex.svgAusschnitt(bild, runde(g.x), runde(g.y), runde(g.w), runde(g.h));
        delete g.echt;
        g.png = null; g.mini = null;
        if (cv && !pngFehler) {
          const c = ausschnitt(cv, bild.faktor, g);
          try {
            if (opt && opt.mini) g.mini = mini(c);
            g.png = await canvasPng(c);
          } catch (e) { pngFehler = e; } finally { c.width = c.height = 0; }
        }
      }
    } finally { if (cv) cv.width = cv.height = 0; }
    const pk = a ? a.paket() : null;
    const s = { dok: dok, nr: nr, kennung: kennung, breite: m.breite, hoehe: m.hoehe, grafiken: m.grafiken, zeilen: m.zeilen, pngFehler: pngFehler,
      namen: { csv: vt + '_' + kennung + '.csv', json: vt + '_' + kennung + '.json' } };
    s.csv = csv(nr, dok.id, m.zeilen);
    s.json = json(s, pk && pk.version);
    return s;
  }

  /* ---------- Weitergabe ---------- */
  // dateien = [{ name, daten, typ }]: eine → direkt, mehrere → ZIP zipName. Synchron (im Klick).
  function geben(dateien, zipName, titel, erfolg) {
    if (!dateien.length) return null;
    let datei;
    if (dateien.length === 1) datei = new File([dateien[0].daten], dateien[0].name, { type: dateien[0].typ });
    else datei = new File([Z().zip(dateien.map((d) => ({ name: d.name, daten: d.daten })))], zipName, { type: 'application/zip' });
    const b = B();
    if (b && typeof b.weitergeben === 'function') b.weitergeben(datei, titel, () => meldung(erfolg));
    else { EX().herunterladenUndFreigeben(datei); meldung(erfolg); }
    return datei;
  }
  function pngDateien(s, nur) { return s.grafiken.filter((g) => g.png && (!nur || nur.has(g.nr))).map((g) => ({ name: g.namen.png, daten: g.png, typ: 'image/png' })); }
  function svgDateien(s, nur) { return s.grafiken.filter((g) => !nur || nur.has(g.nr)).map((g) => ({ name: g.namen.svg, daten: g.svg, typ: 'image/svg+xml' })); }

  /* ---------- Tafel „Grafiken & Daten“ (eine Seite) ---------- */
  function artenText(gs) {
    const da = ARTEN.filter((a) => gs.some((g) => g.art === a));
    return da.map((a) => ART_MEHR[a]).join(', ');
  }
  function grossKnopf(k, titel, unter, fn) {
    const b = el('button', null, 'g-knopf');
    b.type = 'button';
    b.setAttribute('data-k', k);
    const t = el('span', null, 'g-text');
    t.append(el('b', titel), el('small', unter));
    const pf = el('span', '↓', 'g-pfeil');
    pf.setAttribute('aria-hidden', 'true');
    b.append(t, pf);
    b.addEventListener('click', fn);
    return b;
  }
  function svgUnter(gs) {
    const echt = gs.filter((g) => g.svgEcht).length, html = gs.length - echt;
    const n = zahlText(gs.length, 'Datei', 'Dateien');
    if (!html) return n + ' · echte SVG, verlustfrei';
    if (!echt) return n + ' · mit eingebettetem HTML – ' + HTML_HINWEIS;
    return n + ' · ' + echt + ' echte SVG, ' + html + ' mit eingebettetem HTML – ' + HTML_HINWEIS;
  }
  function auswahlText(z) { return 'Auswahl herunterladen (' + z.wahl.size + ')'; }
  function zeichneSeite(z) {
    const h = z.huelle;
    if (!h || !h.isConnected) return;
    const fokus = document.activeElement && h.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
    leeren(h);
    const pk = A() ? A().paket() : null;
    const s = z.s;
    h.appendChild(el('div', 'Diese Seite (' + z.id + ')', 't-abschnitt'));
    if (z.phase === 'laedt') {
      const p = el('p', 'Grafiken werden erkannt und vorbereitet …', 't-klein g-laedt');
      p.setAttribute('role', 'status');
      h.appendChild(p);
    } else if (z.phase === 'fehler') {
      const p = el('p', 'Die Seite ließ sich nicht vorbereiten: ' + String((z.fehler && z.fehler.message) || z.fehler), 't-hinweis');
      p.setAttribute('role', 'alert');
      h.appendChild(p);
    } else {
      const gs = s.grafiken, pngs = gs.filter((g) => g.png);
      const liste = el('div', undefined, 't-liste');
      const titel = 'Aether ' + s.nr + ' · ' + s.dok.id;
      const bPng = grossKnopf('png', 'Alle Grafiken als PNG',
        !gs.length ? 'Keine Grafiken erkannt' : !pngs.length ? 'PNG ist in diesem Browser nicht möglich' : zahlText(pngs.length, 'Datei', 'Dateien') + ' · ' + artenText(gs),
        () => geben(pngDateien(s), s.nr + '_' + s.kennung + '_png.zip', titel + ' – Grafiken (PNG)', zahlText(pngs.length, 'Grafik', 'Grafiken') + ' als PNG gesichert'));
      bPng.disabled = !pngs.length;
      const bSvg = grossKnopf('svg', 'Alle Grafiken als SVG', gs.length ? svgUnter(gs) : 'Keine Grafiken erkannt',
        () => geben(svgDateien(s), s.nr + '_' + s.kennung + '_svg.zip', titel + ' – Grafiken (SVG)', zahlText(gs.length, 'Grafik', 'Grafiken') + ' als SVG gesichert'));
      bSvg.disabled = !gs.length;
      const bCsv = grossKnopf('csv', 'Daten als CSV', 'Texte, Status, Zähler · für Tabellen · ' + zahlText(s.zeilen.length, 'Zeile', 'Zeilen'),
        () => geben([{ name: s.namen.csv, daten: s.csv, typ: 'text/csv' }], '', titel + ' – Daten (CSV)', 'Daten als CSV gesichert'));
      const bJson = grossKnopf('json', 'Daten als JSON', 'alles mit Kennungen · für Programme',
        () => geben([{ name: s.namen.json, daten: s.json, typ: 'application/json' }], '', titel + ' – Daten (JSON)', 'Daten als JSON gesichert'));
      liste.append(bPng, bSvg, bCsv, bJson);
      h.appendChild(liste);
      if (s.pngFehler && gs.length && pngs.length < gs.length) h.appendChild(el('p', 'PNG: ' + (pngs.length ? 'nur ' + pngs.length + ' von ' + gs.length + ' Grafiken' : 'nicht möglich') + ' – dieser Browser gibt das Bild nicht heraus.', 't-hinweis'));
      // Einzeln wählen
      if (gs.length) {
        const kopf = el('div', undefined, 'g-kopf');
        kopf.appendChild(el('div', 'Einzeln wählen', 't-abschnitt'));
        const seg = el('div', undefined, 'seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Format der Auswahl');
        const hinweis = el('p', '', 't-klein g-hinweis');
        const formatZeigen = () => {
          for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.getAttribute('data-format') === z.format));
          const html = gs.some((g) => !g.svgEcht && z.wahl.has(g.nr));
          hinweis.textContent = z.format === 'svg' && html ? 'SVG der Kästen mit eingebettetem HTML – ' + HTML_HINWEIS + '.' : '';
          hinweis.hidden = !hinweis.textContent;
        };
        for (const f of ['png', 'svg']) {
          const b = knopf(f.toUpperCase(), () => { z.format = f; formatZeigen(); });
          b.setAttribute('data-format', f);
          b.setAttribute('data-k', 'format-' + f);
          if (f === 'png' && !pngs.length) b.disabled = true;
          seg.appendChild(b);
        }
        kopf.appendChild(seg);
        h.appendChild(kopf);
        const raster = el('div', undefined, 'g-raster');
        const bAus = knopf(auswahlText(z), () => {
          const dat = z.format === 'png' ? pngDateien(s, z.wahl) : svgDateien(s, z.wahl);
          geben(dat, s.nr + '_' + s.kennung + '_auswahl.zip', titel + ' – Auswahl', zahlText(dat.length, 'Grafik', 'Grafiken') + ' gesichert');
        }, 'g-sel');
        bAus.setAttribute('data-k', 'auswahl');
        const auswahlZeigen = () => { bAus.textContent = auswahlText(z); bAus.disabled = !z.wahl.size; formatZeigen(); };
        for (const g of gs) {
          const b = el('button', null, 'g-mini');
          b.type = 'button';
          b.setAttribute('data-nr', String(g.nr));
          b.setAttribute('data-k', 'mini-' + g.nr);
          b.setAttribute('aria-pressed', String(z.wahl.has(g.nr)));
          b.setAttribute('aria-label', 'Grafik ' + zwei(g.nr) + ' · ' + ART_NAME[g.art]);
          if (g.mini) b.appendChild(g.mini); else b.appendChild(el('span', ART_NAME[g.art], 'g-ersatz'));
          b.appendChild(el('small', zwei(g.nr) + ' · ' + ART_NAME[g.art]));
          b.addEventListener('click', () => {
            if (z.wahl.has(g.nr)) z.wahl.delete(g.nr); else z.wahl.add(g.nr);
            b.setAttribute('aria-pressed', String(z.wahl.has(g.nr)));
            auswahlZeigen();
          });
          raster.appendChild(b);
        }
        h.append(raster, hinweis, bAus);
        auswahlZeigen();
      } else h.appendChild(el('p', 'Auf dieser Seite wurden keine Grafiken erkannt (Kästen, Kennzahlen, Balken, Symbole, Bilder).', 't-klein'));
    }
    h.appendChild(el('div', 'Alle Seiten', 't-abschnitt'));
    const n = sichtbareSeiten(pk).length;
    const bZip = grossKnopf('zip', 'Alles als ZIP (' + zahlText(n, 'Seite', 'Seiten') + ')', 'Version ' + (pk ? pk.nummer : '') + ' · je Seite PNG, SVG, CSV und JSON', () => versionTafel());
    bZip.disabled = !n;
    h.appendChild(bZip);
    if (fokus) { const f = h.querySelector('[data-k="' + fokus + '"]'); if (f && !f.disabled) { try { f.focus({ preventScroll: true }); } catch (e) { /* egal */ } } }
  }
  // Tafel „Grafiken & Daten“ für die Seite id der geöffneten Version; bereitet alles sofort vor
  function seitenTafel(id) {
    const a = A(), u = U(), pk = a ? a.paket() : null;
    const dok = pk && Array.isArray(pk.dokumente) ? pk.dokumente.find((d) => d && d.id === id) : null;
    if (!u || !dok) { meldung('Seite ' + id + ' nicht gefunden'); return null; }
    const z = { id: dok.id, nr: pk.nummer, phase: 'laedt', s: null, fehler: null, wahl: new Set(), format: 'png', huelle: null };
    u.tafel('Grafiken & Daten', (inhalt) => {
      z.huelle = el('div', undefined, 'g-tafel');
      z.huelle.setAttribute('data-seite', z.id);
      inhalt.appendChild(z.huelle);
      zeichneSeite(z);
    });
    z.fertig = seiteVorbereiten(dok, pk.nummer, { mini: true }).then((s) => {
      z.s = s; z.phase = 'bereit';
      if (!s.grafiken.some((g) => g.png)) z.format = 'svg';
      zeichneSeite(z);
      return s;
    }, (e) => { z.phase = 'fehler'; z.fehler = e; zeichneSeite(z); return null; });
    return z;
  }

  /* ---------- Tafel: ganze Version als ZIP ---------- */
  function zeichneVersion(z) {
    const h = z.huelle;
    if (!h || !h.isConnected) return;
    leeren(h);
    z.els = {};
    const umfang = zahlText(z.n, 'Seite', 'Seiten') + (z.aus ? ' (ohne ' + z.aus + ' ausgeblendete)' : '') + ' · je Seite alle Grafiken als PNG und SVG, Daten als CSV und JSON';
    h.appendChild(el('p', umfang, 't-klein'));
    if (z.phase === 'laeuft') {
      const pr = el('progress', undefined, 'g-fortschritt');
      pr.max = Math.max(1, z.n); pr.value = z.i;
      const t = el('p', '', 't-klein g-stand');
      t.setAttribute('role', 'status');
      z.els = { pr: pr, t: t };
      h.append(pr, t);
      const row = el('div', undefined, 'row t-unten');
      row.appendChild(knopf('Abbrechen', () => { z.abbruch = true; U().zurueck(); }));
      h.appendChild(row);
      fortschritt(z);
    } else if (z.phase === 'fertig') {
      const t = el('p', 'Fertig: ' + zahlText(z.anzahl, 'Datei', 'Dateien') + ' · ' + groesse(z.datei.size), 'g-fertig');
      t.setAttribute('role', 'status');
      h.appendChild(t);
      if (z.ohnePng) h.appendChild(el('p', 'Ohne PNG: ' + zahlText(z.ohnePng, 'Grafik', 'Grafiken') + ' – dieser Browser gibt das Bild nicht heraus (SVG ist dabei).', 't-hinweis'));
      const b = knopf('ZIP sichern', () => {
        const bb = B();
        if (bb && typeof bb.weitergeben === 'function') bb.weitergeben(z.datei, 'Aether ' + z.nr + ' – Grafiken & Daten', () => meldung('ZIP gesichert'));
        else { EX().herunterladenUndFreigeben(z.datei); meldung('ZIP gesichert'); }
      }, 'g-sel');
      b.setAttribute('data-k', 'zip-sichern');
      h.appendChild(b);
    } else {
      const p = el('p', 'Die ZIP-Datei ließ sich nicht erstellen: ' + String((z.fehler && z.fehler.message) || z.fehler), 't-hinweis');
      p.setAttribute('role', 'alert');
      h.appendChild(p);
    }
  }
  function fortschritt(z) {
    if (!z.els || !z.els.pr || !z.els.pr.isConnected) return;
    z.els.pr.value = z.i;
    z.els.t.textContent = z.i < z.n ? 'Seite ' + (z.i + 1) + ' von ' + z.n + ' · ' + z.id : 'ZIP wird geschrieben …';
  }
  function abgebrochen(z) { return z.abbruch || !z.huelle || !z.huelle.isConnected; }
  async function versionLauf(z, doks) {
    const sch = Z().schreiber(new Date());
    try {
      for (let i = 0; i < doks.length; i++) {
        if (abgebrochen(z)) { z.abbruch = true; return; }
        z.i = i; z.id = doks[i].id;
        fortschritt(z);
        const s = await seiteVorbereiten(doks[i], z.nr, { mini: false });
        if (abgebrochen(z)) { z.abbruch = true; return; }
        const ordner = s.kennung + '/';
        for (const g of s.grafiken) {
          if (g.png) sch.add(ordner + g.namen.png, g.png); else z.ohnePng++;
          sch.add(ordner + g.namen.svg, g.svg);
        }
        sch.add(ordner + s.namen.csv, s.csv);
        sch.add(ordner + s.namen.json, s.json);
      }
      z.i = doks.length;
      fortschritt(z);
      z.anzahl = sch.anzahl();
      z.datei = new File(sch.teile(), 'aether-flyer_' + dateiTeil(z.nr) + '.zip', { type: 'application/zip' });
      z.phase = 'fertig';
    } catch (e) { z.phase = 'fehler'; z.fehler = e; }
    zeichneVersion(z);
  }
  // Tafel: die ganze geöffnete Version als ZIP (ohne ausgeblendete Seiten); startet sofort, am Ende „ZIP sichern“
  function versionTafel() {
    const a = A(), u = U(), pk = a ? a.paket() : null;
    if (!u || !pk) return null;
    const doks = sichtbareSeiten(pk);
    const z = { nr: pk.nummer, n: doks.length, aus: pk.dokumente.length - doks.length, i: 0, id: '', phase: 'laeuft', abbruch: false,
      ohnePng: 0, anzahl: 0, datei: null, fehler: null, huelle: null, els: null };
    if (!doks.length) { meldung('Keine Seiten in Version ' + pk.nummer); return null; }
    u.tafel('Version ' + pk.nummer + ' · Grafiken & Daten', (inhalt) => {
      z.huelle = el('div', undefined, 'g-tafel');
      z.huelle.setAttribute('data-version', z.nr);
      inhalt.appendChild(z.huelle);
      zeichneVersion(z);
    });
    z.fertig = versionLauf(z, doks).then(() => z);
    return z;
  }

  /* ---------- Einrichten ---------- */
  function knoepfe() {
    const a = A();
    const gv = $('btnGrafikenVersion');
    if (gv) gv.hidden = !(a && a.paket() && sichtbareSeiten(a.paket()).length);
    const vb = $('vbExport');
    if (vb) vb.hidden = !(a && a.offenesDokument());
  }
  function einrichten() {
    if (eingerichtet) { knoepfe(); return; }
    eingerichtet = true;
    const vb = $('vbExport');
    if (vb) vb.addEventListener('click', () => { const a = A(), d = a ? a.offenesDokument() : null; if (d) seitenTafel(d.id); });
    const gv = $('btnGrafikenVersion');
    if (gv) gv.addEventListener('click', () => { versionTafel(); });
    for (const ev of ['flyer:kategorie', 'flyer:struktur', 'flyer:vollbild']) document.addEventListener(ev, knoepfe);
    knoepfe();
  }

  window.AetherFlyerGrafik = Object.freeze({
    REGEL: Object.freeze({ kasten: KASTEN, gruppe: GRUPPE, kennzahlen: ZAHL, balken: BALKEN, bild: BILD, minPx: MIN_PX }),
    DATEN_FORMAT: DATEN_FORMAT,
    DATEN_VERSION: DATEN_VERSION,
    einrichten: einrichten,
    erkenne: erkenne,
    datenLesen: datenLesen,
    csv: csv,
    dateiTeil: dateiTeil,
    seiteVorbereiten: seiteVorbereiten,
    seitenTafel: seitenTafel,
    versionTafel: versionTafel
  });
})();
