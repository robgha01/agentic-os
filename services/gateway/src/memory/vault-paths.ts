/**
 * Path resolution for vault records: slug a key and place it under the numbered
 * folder its document type dictates.
 */
import { join } from "node:path";
import { DOCUMENT_CONTRACTS, type DocumentType } from "@aos/shared";

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

/** Absolute path to the record file for (type, key) under the vault root. */
export function recordPath(vaultRoot: string, type: DocumentType, key: string): string {
  const contract = DOCUMENT_CONTRACTS[type];
  // Daily notes are keyed by date and kept verbatim; everything else is slugged.
  const filename = type === "daily" ? `${key}.md` : `${slugify(key)}.md`;
  return join(vaultRoot, contract.folder, filename);
}
