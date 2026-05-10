const fs = require("fs");
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

async function extractText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({
    data,
    disableRange: true,
    disableStream: true,
  });
  const pdf = await loadingTask.promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((s) => s.str).join(" ") + "\n";
  }
  return text.trim();
}

module.exports = {
  extractText,
};
