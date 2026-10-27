/**
 * S21 chat attachments labels for the Documents page. Spread into en.ts / fr.ts: `...attachmentsEn` / `...attachmentsFr`.
 * English is the source of truth; French must define every key.
 */
export const attachmentsEn = {
  "documents.cat.chat.label": "Chat attachments",
  "documents.cat.chat.short": "Chat",
  "documents.fileKind.pdf": "PDF",
  "documents.fileKind.image": "Image",
  "documents.fileKind.docx": "Word document",
  "documents.fileKind.xlsx": "Excel spreadsheet",
  "documents.fileKind.csv": "CSV file",
  "documents.fileKind.txt": "Text file",
  "documents.fileKind.other": "File",
  "documents.chatAttachmentNote": "Files you attached in the Lumière guide. They are stored with your documents and are not part of your enrollment requirements.",
};

export const attachmentsFr: Record<keyof typeof attachmentsEn, string> = {
  "documents.cat.chat.label": "Pièces jointes du chat",
  "documents.cat.chat.short": "Chat",
  "documents.fileKind.pdf": "PDF",
  "documents.fileKind.image": "Image",
  "documents.fileKind.docx": "Document Word",
  "documents.fileKind.xlsx": "Feuille de calcul Excel",
  "documents.fileKind.csv": "Fichier CSV",
  "documents.fileKind.txt": "Fichier texte",
  "documents.fileKind.other": "Fichier",
  "documents.chatAttachmentNote": "Fichiers joints dans le guide Lumière. Ils sont conservés avec vos documents et ne font pas partie des pièces requises pour votre inscription.",
};
