import { PDFDocument, PDFName, PDFNumber, PDFString, PDFRef, PDFHexString } from "pdf-lib";
import { Bookmark } from "../types";

interface NodeRelation {
  parentIdx: number;
  prevIdx: number;
  nextIdx: number;
  firstIdx: number;
  lastIdx: number;
  count: number;
}

// Helper to encode PDF UTF-16BE (with BOM) as HexString to ensure 100% reliable support for Chinese characters without raw parentheses corruption
function encodePdfString(str: string): PDFHexString {
  const bytes = [0xfe, 0xff];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes.push((code >> 8) & 0xff);
    bytes.push(code & 0xff);
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return PDFHexString.of(hex);
}

/**
 * Inserts outlines/bookmarks into an existing PDF.
 * @param originalPdfBytes Raw array bytes of the original PDF
 * @param bookmarks A flat representation of hierarchical Bookmarks
 * @returns Serialized new PDF bytes containing bookmarks
 */
export async function writePDFOutlines(
  originalPdfBytes: Uint8Array,
  bookmarks: Bookmark[]
): Promise<Uint8Array> {
  if (bookmarks.length === 0) {
    return originalPdfBytes; // nothing to do, return original
  }

  // Load document
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    throw new Error("This PDF has no pages.");
  }

  // Pre-allocate Ref objects for each bookmark
  const refs = bookmarks.map(() => context.nextRef());
  const outlinesRef = context.nextRef();

  // Create relational map (prev, next, parent, etc)
  const relations: NodeRelation[] = bookmarks.map(() => ({
    parentIdx: -1,
    prevIdx: -1,
    nextIdx: -1,
    firstIdx: -1,
    lastIdx: -1,
    count: 0,
  }));

  // Parsing hierarchy structure
  const stack: number[] = [];

  for (let i = 0; i < bookmarks.length; i++) {
    const currentLevel = bookmarks[i].level;

    // Find parent index
    let parentIdx = -1;
    for (let l = currentLevel - 1; l >= 1; l--) {
      if (stack[l] !== undefined) {
        parentIdx = stack[l];
        break;
      }
    }

    relations[i].parentIdx = parentIdx;

    // Identify sibling: look for the most recent bookmark with the same parent
    let prevIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (relations[j].parentIdx === parentIdx && bookmarks[j].level === currentLevel) {
        prevIdx = j;
        break;
      }
    }

    if (prevIdx !== -1) {
      relations[i].prevIdx = prevIdx;
      relations[prevIdx].nextIdx = i;
    }

    // Set first/last child tracking on Parent
    if (parentIdx !== -1) {
      if (relations[parentIdx].firstIdx === -1) {
        relations[parentIdx].firstIdx = i;
      }
      relations[parentIdx].lastIdx = i;
    }

    // Save index in stack
    stack[currentLevel] = i;
    
    // Invalidate deeper nesting levels
    for (let l = currentLevel + 1; l < stack.length; l++) {
      delete stack[l];
    }
  }

  // Compute children count recursively
  const computeCount = (idx: number): number => {
    const firstChild = relations[idx].firstIdx;
    if (firstChild === -1) return 0;

    let total = 0;
    let curr = firstChild;
    while (curr !== -1) {
      total += 1 + computeCount(curr);
      curr = relations[curr].nextIdx;
    }
    relations[idx].count = total;
    return total;
  };

  for (let i = 0; i < bookmarks.length; i++) {
    if (relations[i].parentIdx === -1) {
      computeCount(i);
    }
  }

  // Compile Top-Level list details for the root Outlines dictionary
  const topLevelIndexes: number[] = [];
  for (let i = 0; i < bookmarks.length; i++) {
    if (relations[i].parentIdx === -1) {
      topLevelIndexes.push(i);
    }
  }

  const rootFirstRef = topLevelIndexes.length > 0 ? refs[topLevelIndexes[0]] : null;
  const rootLastRef = topLevelIndexes.length > 0 ? refs[topLevelIndexes[topLevelIndexes.length - 1]] : null;
  const rootCount = topLevelIndexes.reduce((sum, idx) => sum + 1 + relations[idx].count, 0);

  // Write Outlines item dictionaries
  for (let i = 0; i < bookmarks.length; i++) {
    // pageNumber is 1-based, index is 0-based
    const targetPageIdx = Math.max(0, Math.min(bookmarks[i].pageNumber - 1, pages.length - 1));
    const targetPageRef = pages[targetPageIdx].ref;

    // XYZ is the PDF standard destination to go to page with current zoom parameters
    const destArray = context.obj([
      targetPageRef,
      PDFName.of("XYZ"),
      null,
      null,
      null,
    ]);

    const itemProps: Record<string, any> = {
      Title: encodePdfString(bookmarks[i].title),
      Parent: relations[i].parentIdx === -1 ? outlinesRef : refs[relations[i].parentIdx],
      Dest: destArray,
    };

    if (relations[i].prevIdx !== -1) {
      itemProps.Prev = refs[relations[i].prevIdx];
    }
    if (relations[i].nextIdx !== -1) {
      itemProps.Next = refs[relations[i].nextIdx];
    }
    if (relations[i].firstIdx !== -1) {
      itemProps.First = refs[relations[i].firstIdx];
      itemProps.Last = refs[relations[i].lastIdx];
      itemProps.Count = PDFNumber.of(relations[i].count);
    }

    const dict = context.obj(itemProps);
    context.assign(refs[i], dict);
  }

  // Create Outlines root dictionary
  const outlinesProps: Record<string, any> = {
    Type: PDFName.of("Outlines"),
  };
  if (rootFirstRef) outlinesProps.First = rootFirstRef;
  if (rootLastRef) outlinesProps.Last = rootLastRef;
  if (topLevelIndexes.length > 0) outlinesProps.Count = PDFNumber.of(rootCount);

  const outlinesDict = context.obj(outlinesProps);
  context.assign(outlinesRef, outlinesDict);

  // Bind root to Catalog and set bookmark opened sidepane
  pdfDoc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  pdfDoc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  // Save new PDF
  return await pdfDoc.save();
}
