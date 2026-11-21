const width = 595.28;
const height = 841.89;
const margin = 42;
const bodySize = 11;
const bodyLeading = 15;
const columnDeck = 59;
const columnText = (width - 2 * margin - columnDeck) / 2;

function linesOf(text, font, textWidth) {
  const wrapped = [];
  const fits = text => font.widthOfTextAtSize(text, bodySize) <= textWidth;
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) wrapped.push(line);
      line = "";
      for (const character of word) {
        if (line && !fits(line + character)) {
          wrapped.push(line);
          line = "";
        }
        line += character;
      }
    }
    wrapped.push(line);
  }
  return wrapped;
}

export async function makePdf(cards) {
  const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
  const document = await PDFDocument.create();
  document.setTitle("Bahasa Indonesia Flashcards");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.13, .10, .22);
  const violet = rgb(.31, .20, .66);
  const muted = rgb(.33, .31, .40);
  const line = rgb(.87, .85, .92);
  const tinted = rgb(.97, .95, .99);
  let page;
  let top;

  function startPage() {
    page = document.addPage([width, height]);
    page.drawText("Bahasa Indonesia Flashcards", { x: margin, y: 778, font: bold, size: 24, color: ink });
    page.drawText(`${cards.length.toLocaleString("en")} ${cards.length === 1 ? "card" : "cards"}  /  Indonesian and English`,
      { x: margin, y: 754, font: regular, size: 11, color: muted });
    page.drawRectangle({ x: margin, y: 710, width: width - 2 * margin, height: 26, color: violet });
    for (const [label, offset] of [["Deck", 0], ["Indonesian", columnDeck], ["English", columnDeck + columnText]]) {
      page.drawText(label, { x: margin + offset + 9, y: 719, font: bold, size: 10, color: rgb(1, 1, 1) });
    }
    top = 710;
  }

  startPage();
  for (const [index, card] of cards.entries()) {
    const indonesian = linesOf(card.indonesian, bold, columnText - 19);
    const english = linesOf(card.english, regular, columnText - 19);
    const maxLines = Math.max(indonesian.length, english.length);
    const rowHeight = 13 + bodyLeading * maxLines;
    if (rowHeight <= 655 && top - rowHeight < 55) startPage();
    let offset = 0;
    while (offset < maxLines) {
      if (top < 85) startPage();
      const displayLines = Math.min(maxLines - offset, Math.floor((top - 55 - 13) / bodyLeading));
      const next = offset + displayLines;
      const bottom = top - 13 - bodyLeading * displayLines;
      if (index % 2 === 0) page.drawRectangle({ x: margin, y: bottom, width: width - 2 * margin, height: top - bottom, color: tinted });
      page.drawLine({ start: { x: margin, y: bottom }, end: { x: width - margin, y: bottom }, thickness: .5, color: line });
      page.drawText(String(card.deck), { x: margin + 9, y: top - 17, size: bodySize, font: regular, color: muted });
      for (let lineIndex = offset; lineIndex < next; lineIndex += 1) {
        const y = top - 17 - bodyLeading * (lineIndex - offset);
        if (indonesian[lineIndex]) page.drawText(indonesian[lineIndex], { x: margin + columnDeck + 9, y, size: bodySize, font: bold, color: ink });
        if (english[lineIndex]) page.drawText(english[lineIndex], { x: margin + columnDeck + columnText + 9, y, size: bodySize, font: regular, color: ink });
      }
      offset = next;
      top = bottom;
    }
  }

  const pages = document.getPages();
  for (const [index, page] of pages.entries()) {
    const label = `Page ${index + 1} of ${pages.length}`;
    const right = width - margin - regular.widthOfTextAtSize(label, 9);
    page.drawText(label, { x: right, y: 34, size: 9, font: regular, color: muted });
  }
  return new Blob([await document.save()], { type: "application/pdf" });
}
