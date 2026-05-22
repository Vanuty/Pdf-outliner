export interface Bookmark {
  id: string; // unique item id
  title: string;
  pageNumber: number; // 1-based page
  level: number; // nesting level starting at 1
  isOpen?: boolean;
}

export interface PDFMetadata {
  fileName: string;
  fileSize: string;
  totalPages: number;
}

export type OutlineMode = "block" | "single";

export interface AIStatus {
  loading: boolean;
  message: string;
}
