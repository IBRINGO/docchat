export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedDocument {
  /** Pages that contained meaningful text. Pages with no extractable text are omitted. */
  pages: ExtractedPage[];
  /** Total number of physical pages in the source PDF, including skipped ones. */
  pageCount: number;
}
