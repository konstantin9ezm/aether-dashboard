// PowerPoint-Export der Flyer-Seite (flyer.html): jede Seite als Bild auf einer Folie (Variante a, Text nicht bearbeitbar).
// Ohne Bibliothek: eigener kleiner PPTX-Schreiber (Office Open XML, PresentationML) auf Basis von AetherFlyerZip
// (Methode „stored“ – JPEG ist schon komprimiert). Teile einer Datei:
//   [Content_Types].xml, _rels/.rels, docProps/core.xml, docProps/app.xml,
//   ppt/presentation.xml (+ _rels), ppt/presProps.xml, ppt/viewProps.xml, ppt/tableStyles.xml,
//   ppt/slideMasters/slideMaster1.xml (+ _rels), ppt/slideLayouts/slideLayout1.xml (+ _rels, Layout „leer“),
//   ppt/theme/theme1.xml (Folienmaster), ppt/theme/theme2.xml (Notizenmaster), ppt/notesMasters/notesMaster1.xml (+ _rels),
//   je Folie n: ppt/slides/slide<n>.xml (+ _rels), ppt/notesSlides/notesSlide<n>.xml (+ _rels), ppt/media/image<n>.jpeg.
// Formate (eine Datei hat ein Format für alle Folien):
//   „A4 hochkant“ 21,0 × 29,7 cm (7 560 000 × 10 692 000 EMU, 1 cm = 360 000 EMU)
//   „16:9 quer“   33,867 × 19,05 cm (12 192 000 × 6 858 000 EMU – Standardgröße „Breitbild“ von PowerPoint)
// Das Seitenbild wird vollständig eingepasst (ganz sichtbar, Seitenverhältnis bleibt) und mittig gesetzt; der Rest der
// Folie ist der Folienhintergrund in Seitenfarbe #0c0f1d (Richtwert, an Master und Folie gesetzt).
// Bild: derselbe Weg wie „Bild“ (AetherFlyerExport.seitenBild: SVG/foreignObject → Canvas, doppelte Auflösung, über
// 16,7 Mio. Pixel verkleinert) – dann als JPEG Qualität 0,92 auf Grund in Seitenfarbe (JPEG kennt keine
// Transparenz). Seiten mit Video/Animation zeigen das Standbild wie bei PDF/Bild (Darstellung mit ort 'bild').
// Notizen jeder Folie: Seiten-Id, Titel und „Stand“ der Seite (Text des ersten data-stand-Elements der Darstellung,
// sonst der Stand des Pakets); auf Seiten mit dynamischen Werten zusätzlich „Werte vom TT.MM.JJJJ, HH:MM“ (Zeitpunkt der
// Werte, mit denen die Folie gezeichnet wurde – eingefroren zum Exportzeitpunkt).
// Speicher (iPad): Folien nacheinander zeichnen; jedes JPEG wird sofort ein Blob-Teil der ZIP (CRC vorher berechnet,
// AetherFlyerZip.schreiber mit { crc }), Canvas danach freigegeben – nie alle Bilder gleichzeitig als Pixel im Speicher.
// Seitenwahl: „Alle als PowerPoint (n)“ nimmt genau AetherFlyerExport.druckListe() (dieselben Seiten wie „Alle als
// PDF“), „PowerPoint“ im Vollbild nur die angezeigte Seite. Auswahl „A4 hochkant | 16:9 quer“ direkt unter dem Knopf;
// die zuletzt gewählte Variante merkt sich das Gerät (IndexedDB „aether-flyer“, Store „geraet“, Schlüssel „pptxFormat“ –
// wie die geöffnete Version; nie im Paket, nie in localStorage). Weitergabe wie bei PDF/ZIP: Teilen-Menü
// mit Datei, sonst Download (AetherFlyerBearbeiten.weitergeben). Offline, kein Upload, kein fremder Dienst.
(function () {
  'use strict';

  const EMU_CM = 360000;
  const FORMATE = Object.freeze({
    a4: Object.freeze({ id: 'a4', name: 'A4 hochkant', kurz: 'A4', cx: 21.0 * EMU_CM, cy: 29.7 * EMU_CM }),
    '16x9': Object.freeze({ id: '16x9', name: '16:9 quer', kurz: '16x9', cx: 12192000, cy: 6858000 })
  });
  const STANDARD_FORMAT = 'a4';
  const SEITENFARBE = '0C0F1D';
  const JPEG_QUALITAET = 0.92;
  const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const SPEICHER_FORMAT = 'pptxFormat';   // Schlüssel im Store „geraet“ (AetherFlyerSpeicher.ladeGeraet/speichereGeraet)
  // Notizseite (Hochformat, Standard von PowerPoint)
  const NOTIZ_CX = 6858000, NOTIZ_CY = 9144000;

  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const CT = 'application/vnd.openxmlformats-officedocument.';
  const KOPF = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS_PRES = ' xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"';

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const A = () => window.AetherFlyerAnsicht || null;
  const EX = () => window.AetherFlyerExport || null;
  const B = () => window.AetherFlyerBearbeiten || null;
  const Z = () => window.AetherFlyerZip;
  const meldung = (t) => { try { G().meldung(t); } catch (e) { /* ohne #toast keine Meldung */ } };

  /* ---------- Reine Hilfen ---------- */
  // Text für XML: nur in XML 1.0 erlaubte Zeichen, & < > " ' maskiert
  function xml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  // Bild (Pixel bw × bh) vollständig in die Folie (EMU sw × sh) einpassen, mittig → { x, y, cx, cy } in EMU (ganzzahlig)
  function einpassen(bw, bh, sw, sh) {
    const f = Math.min(sw / bw, sh / bh);
    const cx = Math.min(sw, Math.round(bw * f)), cy = Math.min(sh, Math.round(bh * f));
    return { x: Math.round((sw - cx) / 2), y: Math.round((sh - cy) / 2), cx: cx, cy: cy };
  }
  // Teil eines Dateinamens: Umlaute ersetzen, Leerraum → „-“, sonst nur ASCII-Buchstaben, Ziffern, „.“ und „-“
  function dateisicher(s, ersatz) {
    const t = String(s === undefined || s === null ? '' : s).normalize('NFC')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[\s_/\\]+/g, '-').replace(/[^A-Za-z0-9.-]+/g, '').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.').replace(/^[.-]+|[.-]+$/g, '');
    return t || (ersatz === undefined ? 'x' : ersatz);
  }
  function zwei(n) { return n < 10 ? '0' + n : String(n); }
  function tag(d) { return d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate()); }
  // Aether-Flyer_Version-<Version>_<Alle|Ordnername|Seiten-Id>_<A4|16x9>_<JJJJ-MM-TT>.pptx
  function dateiName(o) {
    const f = FORMATE[o.format] || FORMATE[STANDARD_FORMAT];
    let teil;
    if (o.seite !== undefined && o.seite !== null) teil = dateisicher(o.seite, 'Seite');
    else if (o.ordner !== undefined && o.ordner !== null) teil = dateisicher(o.ordner, 'Ordner');
    else teil = 'Alle';
    return 'Aether-Flyer_Version-' + dateisicher(o.version, '0') + '_' + teil + '_' + f.kurz + '_' + tag(o.datum instanceof Date ? o.datum : new Date()) + '.pptx';
  }
  function groesse(bytes) { return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB'; }

  /* ---------- Teile der Präsentation (XML) ---------- */
  const GRUPPE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const HINTERGRUND = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + SEITENFARBE + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
  const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" ' +
    'accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

  function beziehungen(liste) {
    return KOPF + '<Relationships xmlns="' + NS_REL + '">' +
      liste.map((r) => '<Relationship Id="' + r[0] + '" Type="' + (/^http/.test(r[1]) ? r[1] : REL + r[1]) + '" Target="' + xml(r[2]) + '"/>').join('') +
      '</Relationships>';
  }
  function inhaltsTypen(n) {
    const o = (teil, typ) => '<Override PartName="' + teil + '" ContentType="' + typ + '"/>';
    let s = KOPF + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      o('/ppt/presentation.xml', CT + 'presentationml.presentation.main+xml') +
      o('/ppt/slideMasters/slideMaster1.xml', CT + 'presentationml.slideMaster+xml') +
      o('/ppt/slideLayouts/slideLayout1.xml', CT + 'presentationml.slideLayout+xml') +
      o('/ppt/notesMasters/notesMaster1.xml', CT + 'presentationml.notesMaster+xml') +
      o('/ppt/theme/theme1.xml', CT + 'theme+xml') +
      o('/ppt/theme/theme2.xml', CT + 'theme+xml') +
      o('/ppt/presProps.xml', CT + 'presentationml.presProps+xml') +
      o('/ppt/viewProps.xml', CT + 'presentationml.viewProps+xml') +
      o('/ppt/tableStyles.xml', CT + 'presentationml.tableStyles+xml') +
      o('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml') +
      o('/docProps/app.xml', CT + 'extended-properties+xml');
    for (let i = 1; i <= n; i++) {
      s += o('/ppt/slides/slide' + i + '.xml', CT + 'presentationml.slide+xml') +
        o('/ppt/notesSlides/notesSlide' + i + '.xml', CT + 'presentationml.notesSlide+xml');
    }
    return s + '</Types>';
  }
  function kernEigenschaften(titel, zeit) {
    const iso = zeit.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return KOPF + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xml(titel) + '</dc:title><dc:creator>Aether-Dashboard</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }
  function appEigenschaften(n) {
    return KOPF + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Aether-Dashboard</Application>' +
      '<PresentationFormat>Benutzerdefiniert</PresentationFormat><Slides>' + n + '</Slides><Notes>' + n + '</Notes><HiddenSlides>0</HiddenSlides></Properties>';
  }
  // Beziehungen von ppt/presentation.xml: rId1 Master, rId2 Notizenmaster, rId3 Theme, rId4–6 Eigenschaften, ab rId7 Folien
  function praesentation(f, n) {
    let ids = '';
    for (let i = 1; i <= n; i++) ids += '<p:sldId id="' + (255 + i) + '" r:id="rId' + (6 + i) + '"/>';
    return KOPF + '<p:presentation' + NS_PRES + ' saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>' +
      '<p:sldIdLst>' + ids + '</p:sldIdLst>' +
      '<p:sldSz cx="' + f.cx + '" cy="' + f.cy + '"/><p:notesSz cx="' + NOTIZ_CX + '" cy="' + NOTIZ_CY + '"/>' +
      '<p:defaultTextStyle><a:defPPr><a:defRPr lang="de-DE"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' +
      '<a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr>' +
      '</a:lvl1pPr></p:defaultTextStyle></p:presentation>';
  }
  function praesentationRels(n) {
    const r = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'notesMaster', 'notesMasters/notesMaster1.xml'],
      ['rId3', 'theme', 'theme/theme1.xml'], ['rId4', 'presProps', 'presProps.xml'], ['rId5', 'viewProps', 'viewProps.xml'],
      ['rId6', 'tableStyles', 'tableStyles.xml']];
    for (let i = 1; i <= n; i++) r.push(['rId' + (6 + i), 'slide', 'slides/slide' + i + '.xml']);
    return beziehungen(r);
  }
  function theme(name) {
    const farbe = (k, v) => '<a:' + k + '><a:srgbClr val="' + v + '"/></a:' + k + '>';
    const schrift = '<a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/>';
    const voll = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    const linie = (w) => '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr">' + voll + '<a:prstDash val="solid"/></a:ln>';
    return KOPF + '<a:theme xmlns:a="' + NS_A + '" name="' + xml(name) + '"><a:themeElements>' +
      '<a:clrScheme name="Aether"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
      farbe('dk2', SEITENFARBE) + farbe('lt2', 'EBE9FF') + farbe('accent1', '8C7CF0') + farbe('accent2', 'FFA02E') + farbe('accent3', '4F81BD') +
      farbe('accent4', '9BBB59') + farbe('accent5', '4BACC6') + farbe('accent6', 'C0504D') + farbe('hlink', '0563C1') + farbe('folHlink', '954F72') +
      '</a:clrScheme><a:fontScheme name="Aether"><a:majorFont>' + schrift + '</a:majorFont><a:minorFont>' + schrift + '</a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Aether"><a:fillStyleLst>' + voll + voll + voll + '</a:fillStyleLst>' +
      '<a:lnStyleLst>' + linie(6350) + linie(12700) + linie(19050) + '</a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst>' + voll + voll + voll + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements>' +
      '<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }
  function folienMaster() {
    const stil = (sz) => '<a:lvl1pPr><a:defRPr sz="' + sz + '"/></a:lvl1pPr>';
    return KOPF + '<p:sldMaster' + NS_PRES + '><p:cSld>' + HINTERGRUND + '<p:spTree>' + GRUPPE + '</p:spTree></p:cSld>' +
      '<p:clrMap ' + CLR_MAP + '/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle>' + stil(4400) + '</p:titleStyle><p:bodyStyle>' + stil(2800) + '</p:bodyStyle><p:otherStyle>' + stil(1800) + '</p:otherStyle></p:txStyles>' +
      '</p:sldMaster>';
  }
  function folienLayout() {
    return KOPF + '<p:sldLayout' + NS_PRES + ' type="blank" preserve="1"><p:cSld name="Leer"><p:spTree>' + GRUPPE + '</p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  }
  // Platzhalter (Folienbild, Notizen) für Notizenmaster und Notizseiten
  function platzhalter(id, name, ph, xfrm, text) {
    const sperre = ph.indexOf('sldImg') >= 0 ? '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>' : '<a:spLocks noGrp="1"/>';
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + xml(name) + '"/><p:cNvSpPr>' + sperre + '</p:cNvSpPr><p:nvPr>' + ph + '</p:nvPr></p:nvSpPr>' +
      '<p:spPr>' + (xfrm ? '<a:xfrm><a:off x="' + xfrm[0] + '" y="' + xfrm[1] + '"/><a:ext cx="' + xfrm[2] + '" cy="' + xfrm[3] + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' : '') + '</p:spPr>' +
      (text === undefined ? '' : '<p:txBody><a:bodyPr/><a:lstStyle/>' + text + '</p:txBody>') + '</p:sp>';
  }
  // Folienbild-Platzhalter der Notizseite: Folie im Seitenverhältnis des Formats oben auf der Notizseite
  function notizBildLage(f) {
    const box = einpassen(f.cx, f.cy, 5486400, 4114800);
    return [Math.round((NOTIZ_CX - box.cx) / 2), 457200 + box.y, box.cx, box.cy];
  }
  function notizenMaster(f) {
    return KOPF + '<p:notesMaster' + NS_PRES + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + GRUPPE +
      platzhalter(2, 'Folienbildplatzhalter 1', '<p:ph type="sldImg" idx="2"/>', notizBildLage(f)) +
      platzhalter(3, 'Notizenplatzhalter 2', '<p:ph type="body" idx="3"/>', [685800, 4800600, 5486400, 3886200], '<a:p><a:endParaRPr lang="de-DE"/></a:p>') +
      '</p:spTree></p:cSld><p:clrMap ' + CLR_MAP + '/>' +
      '<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200">' +
      '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle>' +
      '</p:notesMaster>';
  }
  function folie(nr, lage, beschreibung) {
    return KOPF + '<p:sld' + NS_PRES + '><p:cSld>' + HINTERGRUND + '<p:spTree>' + GRUPPE +
      '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Seite ' + nr + '" descr="' + xml(beschreibung) + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr><a:xfrm><a:off x="' + lage.x + '" y="' + lage.y + '"/><a:ext cx="' + lage.cx + '" cy="' + lage.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }
  function notizSeite(zeilen) {
    const text = zeilen.map((z) => '<a:p><a:r><a:rPr lang="de-DE" dirty="0"/><a:t>' + xml(z) + '</a:t></a:r></a:p>').join('');
    return KOPF + '<p:notes' + NS_PRES + '><p:cSld><p:spTree>' + GRUPPE +
      platzhalter(2, 'Folienbildplatzhalter 1', '<p:ph type="sldImg"/>') +
      platzhalter(3, 'Notizenplatzhalter 2', '<p:ph type="body" idx="1"/>', null, text) +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
  }
  function notizZeilen(n) { return ['Seite: ' + n.id, 'Titel: ' + (n.titel || ''), 'Stand: ' + (n.stand || '')].concat(n.werte ? ['Werte vom ' + n.werte] : []); }

  /* ---------- Schreiber ---------- */
  // opt: { format: 'a4'|'16x9', anzahl (Folien, vorab bekannt – [Content_Types].xml steht vorne), titel, zeit }
  // → { folie(bild, notiz), datei(name) }. bild: { daten: Blob|Uint8Array (JPEG), crc? (bei Blob Pflicht), w, h }
  // (Pixel), notiz: { id, titel, stand }. Die Folien kommen in der Reihenfolge der Aufrufe.
  function schreiber(opt) {
    const f = FORMATE[opt && opt.format];
    if (!f) throw new Error('PowerPoint: unbekanntes Format.');
    const n = opt.anzahl | 0;
    if (n < 1) throw new Error('PowerPoint: keine Folien.');
    const zeit = opt.zeit instanceof Date ? opt.zeit : new Date();
    const zip = Z().schreiber(zeit);
    zip.add('[Content_Types].xml', inhaltsTypen(n));
    zip.add('_rels/.rels', beziehungen([['rId1', 'officeDocument', 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['rId3', 'extended-properties', 'docProps/app.xml']]));
    zip.add('docProps/core.xml', kernEigenschaften(opt.titel || 'Aether-Flyer', zeit));
    zip.add('docProps/app.xml', appEigenschaften(n));
    zip.add('ppt/presentation.xml', praesentation(f, n));
    zip.add('ppt/_rels/presentation.xml.rels', praesentationRels(n));
    zip.add('ppt/presProps.xml', KOPF + '<p:presentationPr' + NS_PRES + '/>');
    zip.add('ppt/viewProps.xml', KOPF + '<p:viewPr' + NS_PRES + '><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>');
    zip.add('ppt/tableStyles.xml', KOPF + '<a:tblStyleLst xmlns:a="' + NS_A + '" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>');
    zip.add('ppt/slideMasters/slideMaster1.xml', folienMaster());
    zip.add('ppt/slideMasters/_rels/slideMaster1.xml.rels', beziehungen([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
    zip.add('ppt/slideLayouts/slideLayout1.xml', folienLayout());
    zip.add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', beziehungen([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
    zip.add('ppt/notesMasters/notesMaster1.xml', notizenMaster(f));
    zip.add('ppt/notesMasters/_rels/notesMaster1.xml.rels', beziehungen([['rId1', 'theme', '../theme/theme2.xml']]));
    zip.add('ppt/theme/theme1.xml', theme('Aether'));
    zip.add('ppt/theme/theme2.xml', theme('Aether Notizen'));
    let nr = 0;
    function neueFolie(bild, notiz) {
      if (nr >= n) throw new Error('PowerPoint: mehr Folien als angekündigt.');
      if (!bild || !(bild.w > 0) || !(bild.h > 0)) throw new Error('PowerPoint: Bild ohne Maße.');
      nr++;
      const lage = einpassen(bild.w, bild.h, f.cx, f.cy);
      if (typeof Blob === 'function' && bild.daten instanceof Blob) zip.add('ppt/media/image' + nr + '.jpeg', bild.daten, { crc: bild.crc });
      else zip.add('ppt/media/image' + nr + '.jpeg', bild.daten);
      zip.add('ppt/slides/slide' + nr + '.xml', folie(nr, lage, (notiz.id || '') + (notiz.titel ? ' · ' + notiz.titel : '')));
      zip.add('ppt/slides/_rels/slide' + nr + '.xml.rels', beziehungen([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
        ['rId2', 'image', '../media/image' + nr + '.jpeg'], ['rId3', 'notesSlide', '../notesSlides/notesSlide' + nr + '.xml']]));
      zip.add('ppt/notesSlides/notesSlide' + nr + '.xml', notizSeite(notizZeilen(notiz)));
      zip.add('ppt/notesSlides/_rels/notesSlide' + nr + '.xml.rels', beziehungen([['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'],
        ['rId2', 'slide', '../slides/slide' + nr + '.xml']]));
      return lage;
    }
    function datei(name) {
      if (nr !== n) throw new Error('PowerPoint: ' + nr + ' von ' + n + ' Folien geschrieben.');
      return new File(zip.teile(), name, { type: MIME_PPTX });
    }
    return { format: f, folie: neueFolie, datei: datei, folien: () => nr };
  }

  /* ---------- Folien zeichnen (Browser) ---------- */
  function standVon(wurzel) {
    const e = wurzel && (wurzel.matches && wurzel.matches('[data-stand]') ? wurzel : (wurzel.querySelector ? wurzel.querySelector('[data-stand]') : null));
    return e ? String(e.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  // Dynamische Werte: Zeitpunkt aus der Fußzeile der Darstellung (flyer-werte.js), sonst ''
  function werteVon(wurzel) {
    const e = wurzel && wurzel.querySelector ? wurzel.querySelector('[data-ae-werte-zeit]') : null;
    return e ? String(e.getAttribute('data-ae-werte-zeit') || '') : '';
  }
  function alsBlob(cv, typ, q) {
    return new Promise((resolve, reject) => {
      try { cv.toBlob((b) => resolve(b), typ, q); } catch (e) { reject(e); }
    });
  }
  // Seite → { blob (JPEG), crc, w, h, stand, verkleinert }; Canvas sofort wieder frei
  async function folienBild(dok) {
    let stand = '', werte = '';
    const sb = await EX().seitenBild(dok, undefined, (w) => { stand = standVon(w); werte = werteVon(w); return null; });
    if (!sb.img) throw (sb.bildFehler instanceof Error ? sb.bildFehler : new Error('Bild nicht möglich'));
    const cv = document.createElement('canvas');
    cv.width = sb.w; cv.height = sb.h;
    let blob;
    try {
      const ctx = cv.getContext('2d');
      if (!ctx) throw new Error('kein Canvas');
      ctx.fillStyle = '#' + SEITENFARBE;   // JPEG ohne Transparenz: durchsichtige Stellen in Seitenfarbe
      ctx.fillRect(0, 0, sb.w, sb.h);
      ctx.drawImage(sb.img, 0, 0, sb.w, sb.h);
      blob = await alsBlob(cv, 'image/jpeg', JPEG_QUALITAET);
    } finally {
      cv.width = cv.height = 0;   // Speicher frei (iOS)
      try { sb.img.removeAttribute('src'); } catch (e) { /* egal */ }
    }
    if (!blob || !blob.size || blob.type !== 'image/jpeg') throw new Error('Canvas zu groß');
    const crc = Z().crc32(new Uint8Array(await blob.arrayBuffer()));
    return { blob: blob, crc: crc, w: sb.w, h: sb.h, stand: stand, werte: werte, verkleinert: sb.verkleinert };
  }
  // doks → PowerPoint-Datei. opt: { format, name, titel, fortschritt(i, n, dok) } →
  // { datei, folien, ms, groessteFolie: { id, bytes }, verkleinert: [ids], lagen: [{ id, x, y, cx, cy }] }
  async function exportiere(doks, opt) {
    const liste = (doks || []).filter(Boolean);
    if (!liste.length) throw new Error('Keine Seiten');
    const a = A(), pk = a ? a.paket() : null;
    const start = Date.now();
    const sch = schreiber({ format: opt.format, anzahl: liste.length, titel: opt.titel });
    const aus = { datei: null, folien: liste.length, ms: 0, groessteFolie: null, verkleinert: [], lagen: [] };
    for (let i = 0; i < liste.length; i++) {
      const dok = liste[i];
      if (typeof opt.fortschritt === 'function') { try { opt.fortschritt(i, liste.length, dok); } catch (e) { /* Anzeige egal */ } }
      let b;
      try { b = await folienBild(dok); } catch (e) {
        const f = new Error('Seite ' + dok.id + ': ' + (e && e.name === 'SecurityError' ? 'dieser Browser gibt das Bild nicht heraus' : String((e && e.message) || e)));
        f.ursache = e;
        throw f;
      }
      const lage = sch.folie({ daten: b.blob, crc: b.crc, w: b.w, h: b.h }, { id: dok.id, titel: dok.titel, stand: b.stand || (pk && pk.stand) || '', werte: b.werte || '' });
      aus.lagen.push(Object.assign({ id: dok.id, w: b.w, h: b.h }, lage));
      if (!aus.groessteFolie || b.blob.size > aus.groessteFolie.bytes) aus.groessteFolie = { id: dok.id, bytes: b.blob.size };
      if (b.verkleinert) aus.verkleinert.push(dok.id);
    }
    if (typeof opt.fortschritt === 'function') { try { opt.fortschritt(liste.length, liste.length, null); } catch (e) { /* egal */ } }
    aus.datei = sch.datei(opt.name);
    aus.ms = Date.now() - start;
    return aus;
  }

  /* ---------- Bedienung (Teil 2) ---------- */
  let eingerichtet = false;
  let bereit = Promise.resolve(false);
  let moeglich = false;            // Selbstprobe von „Bild“ bestanden (ohne Seitenbild keine Folie)
  let laeuft = false;              // ein Export läuft: beide Knöpfe gesperrt
  let format = STANDARD_FORMAT;    // zuletzt gewählte Variante (aus dem Gerätespeicher)
  let wahlFuer = null;             // offene Auswahl: 'alle' (Übersicht) | 'eins' (Vollbild)

  // Genau die Seiten von „Alle als PDF“ (aktuelle Ansicht Alle bzw. Ordner, ohne ausgeblendete)
  function liste() { const ex = EX(); return ex && typeof ex.druckListe === 'function' ? ex.druckListe() : []; }
  function knopfVon(wo) { return wo === 'eins' ? $('vbPptx') : $('btnAllePptx'); }
  function knoepfe() {
    const a = A();
    const alle = $('btnAllePptx'), eins = $('vbPptx');
    if (alle) {
      const n = liste().length;
      alle.hidden = !moeglich;
      if (!laeuft) alle.textContent = 'Alle als PowerPoint (' + n + ')';
      alle.disabled = laeuft || n === 0;
      if (alle.disabled && wahlFuer === 'alle') wahlZu(false);
    }
    if (eins) {
      const dok = a ? a.offenesDokument() : null;
      eins.hidden = !moeglich || !dok;
      if (!laeuft) eins.textContent = 'PowerPoint';
      eins.disabled = laeuft;
      if ((eins.hidden || eins.disabled) && wahlFuer === 'eins') wahlZu(false);
    }
  }

  // Gerätespeicher (Store „geraet“): zuletzt gewählte Variante laden bzw. merken
  function speicher() { return window.AetherFlyerSpeicher || null; }
  function formatLaden() {
    const s = speicher();
    if (!s || typeof s.ladeGeraet !== 'function') return Promise.resolve();
    return Promise.resolve(s.ladeGeraet(SPEICHER_FORMAT)).then((v) => { if (typeof v === 'string' && FORMATE[v]) format = v; }, () => {});
  }
  function formatMerken(f) {
    format = f;
    const s = speicher();
    if (s && typeof s.speichereGeraet === 'function') { try { Promise.resolve(s.speichereGeraet(SPEICHER_FORMAT, f)).catch(() => {}); } catch (e) { /* nur dieses Mal */ } }
  }

  // Auswahl direkt unter dem Knopf (passt sie unten nicht mehr hin: darüber), waagerecht im Fenster gehalten
  function lageSetzen() {
    const m = $('pptxWahl'), k = knopfVon(wahlFuer);
    if (!m || m.hidden || !k) return;
    const r = k.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const rand = 8;
    m.style.left = '0px'; m.style.top = '0px';
    const w = m.offsetWidth, h = m.offsetHeight;
    const x = Math.min(Math.max(rand, r.left), Math.max(rand, vw - w - rand));
    let y = r.bottom + 4;
    if (y + h > vh - rand && r.top - 4 - h >= rand) y = r.top - 4 - h;
    m.style.left = Math.round(x) + 'px';
    m.style.top = Math.round(y) + 'px';
  }
  function wahlZeigen(wo) {
    const m = $('pptxWahl'), k = knopfVon(wo);
    if (!m || !k || k.hidden || k.disabled) return;
    wahlFuer = wo;
    for (const b of m.querySelectorAll('button[data-format]')) b.setAttribute('aria-checked', b.getAttribute('data-format') === format ? 'true' : 'false');
    m.hidden = false;
    k.setAttribute('aria-expanded', 'true');
    lageSetzen();
    const akt = m.querySelector('button[aria-checked="true"]') || m.querySelector('button[data-format]');
    if (akt) { try { akt.focus({ preventScroll: true }); } catch (e) { /* egal */ } }
  }
  function wahlZu(fokus) {
    const m = $('pptxWahl'), k = knopfVon(wahlFuer);
    wahlFuer = null;
    if (k) k.setAttribute('aria-expanded', 'false');
    if (!m || m.hidden) return;
    m.hidden = true;
    if (fokus && k && !k.hidden && !k.disabled) { try { k.focus({ preventScroll: true }); } catch (e) { /* egal */ } }
  }
  function knopfTipp(wo) {
    if (laeuft) return;
    if (wahlFuer === wo) { wahlZu(true); return; }
    wahlZu(false);
    wahlZeigen(wo);
  }
  function varianteTipp(f) {
    if (!FORMATE[f] || !wahlFuer || laeuft) return;
    const wo = wahlFuer;
    formatMerken(f);
    wahlZu(true);
    starte(wo, f);
  }
  // Tippen/Klicken daneben schließt (der Knopf selbst schaltet über seinen Klick um)
  function daneben(e) {
    if (!wahlFuer) return;
    const m = $('pptxWahl'), k = knopfVon(wahlFuer);
    if ((m && m.contains(e.target)) || (k && k.contains(e.target))) return;
    wahlZu(false);
  }
  // Tastatur bei offener Auswahl (vor der Ansicht, die sonst blättern bzw. das Vollbild schließen würde):
  // Esc/Backspace schließt, Pfeile/Pos1/Ende wechseln die Variante, Tab schließt und bleibt am Knopf;
  // Enter/Leertaste lösen die fokussierte Variante wie ein Klick aus.
  function taste(e) {
    if (!wahlFuer || e.metaKey || e.ctrlKey || e.altKey) return;
    const m = $('pptxWahl');
    if (!m || m.hidden) return;
    const opt = Array.from(m.querySelectorAll('button[data-format]'));
    const i = opt.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat || e.key === 'Tab') wahlZu(true);
    } else if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].indexOf(e.key) >= 0) {
      e.preventDefault();
      e.stopPropagation();
      let j;
      if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = opt.length - 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = i <= 0 ? opt.length - 1 : i - 1;
      else j = i < 0 || i >= opt.length - 1 ? 0 : i + 1;
      if (opt[j]) opt[j].focus();
    }
  }

  // Fertige Datei weitergeben wie PDF/ZIP. navigator.share braucht eine frische Nutzergeste: Ist sie nach dem
  // Zeichnen verbraucht (lange Exporte, iPhone/iPad), erst ein kurzer Hinweis mit „Teilen“ (ein Tipp, dann Teilen-Menü).
  function geben(r, erfolg) {
    const datei = r.datei, g = G(), b = B();
    const sofort = () => {
      if (b && typeof b.weitergeben === 'function') b.weitergeben(datei, datei.name, () => meldung(erfolg));
      else { EX().herunterladenUndFreigeben(datei); meldung(erfolg); }
    };
    const geste = !!(navigator.userActivation && navigator.userActivation.isActive);
    if (!g || !g.kannTeilen([datei]) || geste) { sofort(); return; }
    const m = $('modal'), box = $('mInhalt');
    if (!m || !box) { sofort(); return; }
    $('mTitel').textContent = datei.name;
    $('mText').textContent = 'Fertig: ' + r.folien + (r.folien === 1 ? ' Folie' : ' Folien') + ' · ' + groesse(datei.size) + '. Zum Weitergeben „Teilen“ antippen.';
    while (box.firstChild) box.removeChild(box.firstChild);
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'primary';
    k.textContent = 'Teilen';
    k.addEventListener('click', () => { m.hidden = true; sofort(); }, { once: true });
    box.appendChild(k);
    m.hidden = false;
    try { k.focus(); } catch (e) { /* egal */ }
  }

  // Export starten: wo = 'alle' (Seiten von „Alle als PDF“) | 'eins' (angezeigte Seite), f = Format
  async function starte(wo, f) {
    const a = A(), pk = a ? a.paket() : null;
    if (laeuft || !pk || !FORMATE[f]) return null;
    const datum = new Date();
    let doks, name;
    if (wo === 'eins') {
      const d = a.offenesDokument();
      if (!d) return null;
      doks = [d];
      name = dateiName({ version: pk.nummer, seite: d.id, format: f, datum: datum });
    } else {
      doks = liste();
      const oid = typeof a.aktuellerOrdner === 'function' ? a.aktuellerOrdner() : null;
      const o = oid === null || oid === undefined ? null : (Array.isArray(pk.ordner) ? pk.ordner : []).find((x) => x && x.id === oid);
      name = dateiName({ version: pk.nummer, ordner: oid === null || oid === undefined ? null : (o && o.name ? o.name : String(oid)), format: f, datum: datum });
    }
    if (!doks.length) { meldung('Keine Seiten für PowerPoint'); return null; }
    const knopf = knopfVon(wo);
    laeuft = true;
    knoepfe();
    meldung('PowerPoint wird erstellt (' + FORMATE[f].name + ', ' + doks.length + (doks.length === 1 ? ' Folie' : ' Folien') + ')');
    let r;
    try {
      r = await exportiere(doks, {
        format: f, name: name, titel: 'Aether-Flyer Version ' + pk.nummer,
        fortschritt: (i, n) => { if (knopf) knopf.textContent = i < n ? 'Folie ' + (i + 1) + ' / ' + n : 'Datei wird geschrieben …'; }
      });
    } catch (e) {
      laeuft = false;
      knoepfe();
      meldung('Die PowerPoint-Datei ließ sich nicht erstellen – ' + String((e && e.message) || e));
      return null;
    }
    laeuft = false;
    knoepfe();
    const zusatz = r.verkleinert.length ? ' (verkleinert: ' + r.verkleinert.join(', ') + ')' : '';
    geben(r, 'PowerPoint gesichert: ' + r.folien + (r.folien === 1 ? ' Folie' : ' Folien') + ' · ' + groesse(r.datei.size) + zusatz);
    return r;
  }

  // Nach der Ansicht und dem Export einrichten: Knöpfe zeigen, sobald die Selbstprobe von „Bild“ bestanden ist.
  // Promise: true, wenn PowerPoint hier möglich ist (und die gemerkte Variante geladen).
  function einrichten() {
    if (eingerichtet) return bereit;
    eingerichtet = true;
    const alle = $('btnAllePptx'), eins = $('vbPptx'), m = $('pptxWahl');
    if (alle) alle.addEventListener('click', () => knopfTipp('alle'));
    if (eins) eins.addEventListener('click', () => knopfTipp('eins'));
    if (m) for (const b of m.querySelectorAll('button[data-format]')) b.addEventListener('click', () => varianteTipp(b.getAttribute('data-format')));
    window.addEventListener('keydown', taste, true);
    document.addEventListener('pointerdown', daneben, true);
    window.addEventListener('resize', lageSetzen);
    window.addEventListener('scroll', lageSetzen, { capture: true, passive: true });
    document.addEventListener('flyer:kategorie', knoepfe);
    document.addEventListener('flyer:vollbild', (e) => {
      const d = e && e.detail;
      if (wahlFuer === 'eins' && !(d && d.offen)) wahlZu(false);
      knoepfe();
    });
    knoepfe();
    const ex = EX();
    const probe = ex && typeof ex.einrichten === 'function' ? Promise.resolve(ex.einrichten()) : Promise.resolve(false);
    bereit = Promise.all([probe.then((ok) => { moeglich = ok === true; }, () => { moeglich = false; }), formatLaden()])
      .then(() => { knoepfe(); return moeglich; });
    return bereit;
  }

  window.AetherFlyerPptx = Object.freeze({
    FORMATE: FORMATE,
    STANDARD_FORMAT: STANDARD_FORMAT,
    SEITENFARBE: '#' + SEITENFARBE.toLowerCase(),
    JPEG_QUALITAET: JPEG_QUALITAET,
    MIME: MIME_PPTX,
    SPEICHER_FORMAT: SPEICHER_FORMAT,
    einpassen: einpassen,
    dateisicher: dateisicher,
    dateiName: dateiName,
    groesse: groesse,
    schreiber: schreiber,
    exportiere: exportiere,
    // Teil 2
    einrichten: einrichten,
    bereit: () => bereit,
    liste: liste,
    format: () => format,
    laeuft: () => laeuft,
    starte: starte
  });
})();
