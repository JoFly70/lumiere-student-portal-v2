/**
 * Staff billing management and document review (S19). Spread into en.ts / fr.ts.
 * Keys are namespaced "staff.*". English is the source of truth; French must define every key.
 */
export const staffEn = {
  "orb.ask": "Ask Lumière",
  "staff.viewAs": "View as student",
  "staff.access.restricted": "That page is for administrators. Here is your support desk.",
  "staff.access.dismiss": "Dismiss",
  "staff.docs.upload.title": "Upload on the student's behalf",
  "staff.docs.upload.intro": "The student and staff will see the file. New uploads stay pending review; uploading never verifies a document.",
  "staff.docs.upload.type": "Document type",
  "staff.docs.upload.note": "Note",
  "staff.docs.upload.optional": "(optional)",
  "staff.docs.upload.notePlaceholder": "e.g. Received by email on 12 Oct",
  "staff.docs.upload.file": "File",
  "staff.docs.upload.choose": "Choose file",
  "staff.docs.upload.uploading": "Uploading…",
  "staff.docs.upload.noFile": "No file chosen",
  "staff.docs.upload.help": "PDF, PNG, JPG or WebP · up to 10 MB. Add the note first: the upload starts as soon as you choose the file.",
  "staff.docs.upload.securely": "Uploading file securely…",
  "staff.docs.requestNewCopy": "Request new copy",
} as const satisfies Record<string, string>;

export const staffFr: Record<keyof typeof staffEn, string> = {
  "orb.ask": "Demander à Lumière",
  "staff.viewAs": "Voir comme l’élève",
  "staff.access.restricted": "Cette page est réservée aux administrateurs. Voici votre bureau d’assistance.",
  "staff.access.dismiss": "Fermer",
  "staff.docs.upload.title": "Téléverser au nom de l'étudiant",
  "staff.docs.upload.intro": "L'étudiant et l'équipe verront le fichier. Les nouveaux fichiers restent en attente de vérification ; le téléversement ne valide jamais un document.",
  "staff.docs.upload.type": "Type de document",
  "staff.docs.upload.note": "Remarque",
  "staff.docs.upload.optional": "(facultatif)",
  "staff.docs.upload.notePlaceholder": "p. ex. Reçu par courriel le 12 oct.",
  "staff.docs.upload.file": "Fichier",
  "staff.docs.upload.choose": "Choisir un fichier",
  "staff.docs.upload.uploading": "Téléversement…",
  "staff.docs.upload.noFile": "Aucun fichier choisi",
  "staff.docs.upload.help": "PDF, PNG, JPG ou WebP · jusqu'à 10 Mo. Ajoutez d'abord la note : le téléversement démarre dès que vous choisissez le fichier.",
  "staff.docs.upload.securely": "Téléversement sécurisé du fichier…",
  "staff.docs.requestNewCopy": "Demander une nouvelle copie",
};
