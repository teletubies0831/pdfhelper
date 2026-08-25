export type DocumentToolName =
  | "search_document"
  | "read_pages"
  | "read_section"
  | "get_document_profile"
  | "get_document_outline"
  | "inspect_page_image";

export interface DocumentToolCall {
  name: DocumentToolName;
  arguments: Record<string, unknown>;
}

export interface DocumentToolResult {
  name: DocumentToolName;
  label: string;
  pages: number[];
  content: string;
}
