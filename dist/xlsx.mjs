const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";

function escapeXml(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");
}

function textCell(address, value, style) {
  return `<c r="${address}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function rowHeight(text) {
  const lines = text.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 43)), 0);
  return Math.min(404, 8 + 16 * lines);
}

export async function makeWorkbook(cards) {
  const zip = new globalThis.JSZip();
  const rows = cards.map((card, index) => {
    const row = index + 2;
    const style = index % 2 === 0 ? 2 : 3;
    const rowPoints = Math.max(rowHeight(card.indonesian), rowHeight(card.english));
    return `<row r="${row}" ht="${rowPoints}" customHeight="1">
      ${textCell(`A${row}`, card.id, style)}
      <c r="B${row}" s="${style}"><v>${card.deck}</v></c>
      ${textCell(`C${row}`, card.indonesian, style)}
      ${textCell(`D${row}`, card.english, style)}
    </row>`;
  }).join("");
  const headings = ["ID", "Deck", "Indonesian", "English"].map((label, index) =>
    textCell(`${"ABCD"[index]}1`, label, 1)).join("");
  const used = `A1:D${cards.length + 1}`;
  const entries = {
    "[Content_Types].xml": `
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      </Types>`,
    "_rels/.rels": `
      <Relationships xmlns="${packageRelationships}">
        <Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
    "xl/workbook.xml": `
      <workbook xmlns="${spreadsheet}" xmlns:r="${relationships}">
        <sheets><sheet name="Cards" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`,
    "xl/_rels/workbook.xml.rels": `
      <Relationships xmlns="${packageRelationships}">
        <Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="${relationships}/styles" Target="styles.xml"/>
      </Relationships>`,
    "xl/worksheets/sheet1.xml": `
      <worksheet xmlns="${spreadsheet}">
        <dimension ref="${used}"/>
        <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
        <sheetFormatPr defaultRowHeight="22"/>
        <cols>
          <col min="1" max="1" width="43" customWidth="1"/>
          <col min="2" max="2" width="11" customWidth="1"/>
          <col min="3" max="4" width="46" customWidth="1"/>
        </cols>
        <sheetData><row r="1" ht="28" customHeight="1">${headings}</row>${rows}</sheetData>
        <autoFilter ref="${used}"/>
      </worksheet>`,
    "xl/styles.xml": `
      <styleSheet xmlns="${spreadsheet}">
        <fonts count="2">
          <font><sz val="11"/><color rgb="FF201B37"/><name val="Calibri"/></font>
          <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
        </fonts>
        <fills count="4">
          <fill><patternFill patternType="none"/></fill>
          <fill><patternFill patternType="gray125"/></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="FF5034A7"/><bgColor indexed="64"/></patternFill></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="FFF3EFFB"/><bgColor indexed="64"/></patternFill></fill>
        </fills>
        <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
        <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
        <cellXfs count="4">
          <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
          <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
          <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
          <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
        </cellXfs>
        <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
      </styleSheet>`,
  };
  for (const [name, xml] of Object.entries(entries)) zip.file(name, xmlDeclaration + xml.trim());
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: xlsxMimeType });
}
