/**
 * Constants the SDD format itself defines. They live with the validator because create-sdd owns
 * the document format.
 */

/** Stable SDD object identities; runtime event and lease IDs use their own protocols. */
export const SDD_DOCUMENT_ID_PATTERN = '^[A-Z]{2}[0-9]{2,4}$'
