export function saveDownload(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 30000);
}

function printCollection(cards) {
  const printView = document.getElementById("print-view");
  const heading = document.createElement("h1");
  heading.textContent = "Bahasa Indonesia Flashcards";
  const description = document.createElement("p");
  description.textContent = `${cards.length.toLocaleString()} cards · Indonesian and English`;
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  for (const label of ["Deck", "Indonesian", "English"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const card of cards) {
    const row = body.insertRow();
    row.insertCell().textContent = card.deck;
    const indonesian = row.insertCell();
    indonesian.lang = "id";
    indonesian.textContent = card.indonesian;
    row.insertCell().textContent = card.english;
  }
  printView.replaceChildren(heading, description, table);
  window.print();
}

export async function saveCollectionPdf(cards) {
  try {
    const { makePdf } = await import("./pdf.mjs");
    saveDownload(await makePdf(cards), "bahasa-cards.pdf");
  } catch {
    printCollection(cards);
  }
}
