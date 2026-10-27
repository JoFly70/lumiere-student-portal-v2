/**
 * Curated, public-only knowledge for the Academic Assistant (local mode and live-mode context).
 * Rules: generic Lumière wording (no invented policies); external facts only with a public source
 * URL and `verifiedAt` (ISO date) - `verifiedAt: null` means NOT independently verified, wording is general.
 * Never claim a credit transfers: acceptance is always the receiving institution's decision.
 */

export interface KbSource { title: string; url: string; verifiedAt: string | null }
export interface KbLink { label: { en: string; fr: string }; path: string }
export interface KbEntry {
  id: string;
  topic: 'portal' | 'terms' | 'status' | 'pathways' | 'providers' | 'general';
  title: { en: string; fr: string };
  text: { en: string; fr: string };
  keywords: string[]; // EN + FR terms
  sources?: KbSource[];
  links?: KbLink[];
  /** Optional scoping metadata for retrieval (exact institution/program matching). */
  institution?: string;
  program?: string;
  applicability?: string;
  limitations?: string;
}

const V = '2026-10-27';
const L = {
  dashboard: { label: { en: 'Dashboard', fr: 'Tableau de bord' }, path: '/dashboard' },
  roadmap: { label: { en: 'My roadmap', fr: 'Ma feuille de route' }, path: '/roadmap' },
  highSchool: { label: { en: 'High school', fr: 'Études secondaires' }, path: '/high-school' },
  documents: { label: { en: 'Documents', fr: 'Documents' }, path: '/documents' },
  billing: { label: { en: 'Billing', fr: 'Facturation' }, path: '/billing' },
  support: { label: { en: 'Support', fr: 'Soutien' }, path: '/support' },
  profile: { label: { en: 'Profile', fr: 'Profil' }, path: '/profile' },
} as const;

const TESU_TRANSFER: KbSource = { title: 'TESU - Transfer Credits', url: 'https://www.tesu.edu/student-resources/transfer-credits/index.php', verifiedAt: V };
const TESU_FAQ: KbSource = { title: 'TESU - Transfer Credit Policy FAQs', url: 'https://www.tesu.edu/admissions/faqs/transfer-credits.php', verifiedAt: V };
const TESU_TRAINING: KbSource = { title: 'TESU - Credit for Professional Training', url: 'https://www.tesu.edu/admissions/methods-of-earning-credit/credit-for-training.php', verifiedAt: V };
const TESU_SEND: KbSource = { title: 'TESU - Send Transcripts', url: 'https://www.tesu.edu/student-resources/transfer-credits/send-transcripts.php', verifiedAt: V };
const SOPHIA_ACE: KbSource = { title: 'Sophia - ACE recommendation vs. accreditation', url: 'https://www.sophia.org/blog/higher-education/ace-credit-recommendation-and-accreditation', verifiedAt: V };
const PF_FAQ: KbSource = { title: 'Penn Foster - High School Diploma FAQs', url: 'https://www.pennfoster.edu/high-school/diploma/faq', verifiedAt: V };

const PF_TRANSFER: KbSource = { title: 'Penn Foster - Credit Transfer Policy', url: 'https://www.pennfoster.edu/admissions/policies/transferring-credits', verifiedAt: V };
const COMMON_APP: KbSource = { title: 'Common App - Application guide for first-year students', url: 'https://www.commonapp.org/apply/first-year-students', verifiedAt: V };
const CLEP_KEY: KbSource = { title: 'College Board CLEP - Key exam information', url: 'https://clep.collegeboard.org/for-colleges/understanding-clep/key-exam-information', verifiedAt: V };
const CLEP_FIND: KbSource = { title: 'College Board CLEP - How to find a college\'s CLEP policy', url: 'https://clep.collegeboard.org/colleges-that-recognize-clep/how-find-colleges-clep-policy', verifiedAt: V };
const CLEP_SCORE: KbSource = { title: 'College Board CLEP - What your score means', url: 'https://clep.collegeboard.org/clep/pdf/what-your-score-means.pdf', verifiedAt: V };
const CLEP_ACE: KbSource = { title: 'College Board CLEP - ACE credit recommendations', url: 'https://clep.collegeboard.org/for-educators/for-colleges/clep-scores/understanding-scores/ace-credit-recommendations', verifiedAt: V };

export const KNOWLEDGE: KbEntry[] = [
  {
    id: 'lumiere-orientation',
    topic: 'portal',
    title: { en: 'What the Lumière portal is for', fr: 'À quoi sert le portail Lumière' },
    text: {
      en: 'The Lumière student portal is where you follow your academic plan in one place: your roadmap, your documents, your billing information and your support requests. Your Lumière team can see and update the official parts of your file; this assistant cannot see your personal file.',
      fr: 'Le portail étudiant Lumière regroupe votre plan académique au même endroit : votre feuille de route, vos documents, votre facturation et vos demandes de soutien. L’équipe Lumière peut voir et mettre à jour les éléments officiels de votre dossier; cet assistant ne voit pas votre dossier personnel.',
    },
    keywords: ['portal', 'lumiere', 'lumière', 'orientation', 'start', 'getting started', 'commencer', 'portail', 'what is', 'services', 'welcome', 'bienvenue', 'dashboard', 'tableau de bord'],
    links: [L.dashboard, L.roadmap, L.support],
  },
  {
    id: 'portal-navigation',
    topic: 'portal',
    title: { en: 'Where to find things in the portal', fr: 'Où trouver les choses dans le portail' },
    text: {
      en: 'Roadmap: your plan and its steps. High school: your secondary-school pathway. Documents: upload and view the files requested from you. Billing: your payment information. Support: ask your team a question. Profile: your contact details and preferences.',
      fr: 'Feuille de route : votre plan et ses étapes. Études secondaires : votre parcours secondaire. Documents : téléverser et consulter les fichiers demandés. Facturation : vos informations de paiement. Soutien : poser une question à votre équipe. Profil : vos coordonnées et préférences.',
    },
    keywords: ['where', 'find', 'navigate', 'navigation', 'menu', 'page', 'upload', 'document', 'billing', 'invoice', 'pay', 'support', 'profile', 'où', 'trouver', 'facture', 'paiement', 'téléverser', 'aide', 'help', 'contact'],
    links: [L.roadmap, L.highSchool, L.documents, L.billing, L.support, L.profile],
  },
  {
    id: 'contact-team',
    topic: 'portal',
    title: { en: 'Questions about your own file', fr: 'Questions sur votre propre dossier' },
    text: {
      en: 'For anything about your own situation (grades, documents, payments, decisions), use Support so your Lumière team can answer from your official file. Please do not type personal details in this assistant.',
      fr: 'Pour tout ce qui concerne votre situation personnelle (notes, documents, paiements, décisions), utilisez Soutien afin que votre équipe Lumière réponde à partir de votre dossier officiel. Merci de ne pas saisir de renseignements personnels dans cet assistant.',
    },
    keywords: ['my file', 'my grades', 'my documents', 'personal', 'ticket', 'question', 'dossier', 'mes notes', 'privacy', 'confidentialité', 'ask', 'team', 'équipe', 'human', 'advisor', 'conseiller', 'coach'],
    links: [L.support],
  },
  {
    id: 'roadmap-how',
    topic: 'portal',
    title: { en: 'How roadmaps work', fr: 'Comment fonctionnent les feuilles de route' },
    text: {
      en: 'A roadmap lists the steps toward your academic goal (courses, exams, requirements) in a suggested order. It is a plan, not a guarantee: steps can change as your situation or a school’s rules change, and your Lumière team keeps the official version. Each step shows a status (see "statuses").',
      fr: 'Une feuille de route énumère les étapes vers votre objectif académique (cours, examens, exigences) dans un ordre suggéré. C’est un plan, pas une garantie : les étapes peuvent changer selon votre situation ou les règles d’un établissement, et l’équipe Lumière tient la version officielle. Chaque étape affiche un statut (voir « statuts »).',
    },
    keywords: ['roadmap', 'plan', 'steps', 'path', 'pathway', 'how does', 'feuille de route', 'étapes', 'parcours', 'comment fonctionne', 'planning', 'goal', 'objectif'],
    links: [L.roadmap],
  },
  {
    id: 'statuses',
    topic: 'status',
    title: { en: 'Standard statuses in the portal', fr: 'Statuts standards du portail' },
    text: {
      en: 'Official: confirmed by Lumière or the issuing institution. Reported: information you or someone else provided, not yet confirmed. Awaiting verification: submitted and waiting to be checked against a source. In progress: work on this step has started. Planned: scheduled for later, nothing started yet. Only "official" should be treated as settled.',
      fr: 'Officiel : confirmé par Lumière ou l’établissement émetteur. Déclaré : information fournie par vous ou une autre personne, pas encore confirmée. En attente de vérification : soumis et en attente d’être validé auprès d’une source. En cours : le travail sur cette étape a commencé. Planifié : prévu plus tard, rien n’est commencé. Seul le statut « officiel » doit être considéré comme réglé.',
    },
    keywords: ['status', 'statuses', 'official', 'reported', 'awaiting verification', 'in progress', 'planned', 'statut', 'statuts', 'officiel', 'déclaré', 'en attente', 'en cours', 'planifié', 'verified', 'vérifié', 'verification', 'vérification', 'meaning', 'signifie'],
    links: [L.roadmap],
  },
  {
    id: 'terms-credit',
    topic: 'terms',
    title: { en: 'Credit, credit hour, semester hour', fr: 'Crédit, heure-crédit' },
    text: {
      en: 'A credit (credit hour or semester hour in the US) measures the amount of coursework. A typical US bachelor’s degree is about 120 semester credits and an associate degree about 60, but each school sets its own requirements. Credits earned in one place count elsewhere only if the receiving school accepts them.',
      fr: 'Un crédit (heure-crédit ou « semester hour » aux États-Unis) mesure la quantité de travail d’un cours. Un baccalauréat américain typique compte environ 120 crédits et un diplôme associé environ 60, mais chaque établissement fixe ses exigences. Des crédits obtenus ailleurs ne comptent que si l’établissement d’accueil les accepte.',
    },
    keywords: ['credit', 'credits', 'credit hour', 'semester hour', 'unit', 'crédit', 'crédits', 'heures-crédit', '120', 'how many credits', 'combien de crédits', 'bachelor', 'associate', 'baccalauréat', 'degree', 'diplôme'],
  },
  {
    id: 'terms-transcript',
    topic: 'terms',
    title: { en: 'Transcript, GPA, accreditation', fr: 'Relevé de notes, moyenne, accréditation' },
    text: {
      en: 'A transcript is the official record of your courses and grades, issued by a school. GPA (grade point average) summarizes grades on a scale, commonly 4.0 in the US. Accreditation means an independent body recognized for that purpose has reviewed the institution; it matters because many schools only consider credits from accredited institutions.',
      fr: 'Un relevé de notes est le registre officiel de vos cours et résultats, émis par un établissement. La moyenne cumulative (GPA) résume les notes sur une échelle, souvent de 4,0 aux États-Unis. L’accréditation signifie qu’un organisme indépendant reconnu a évalué l’établissement; elle compte parce que plusieurs établissements ne considèrent que les crédits d’établissements accrédités.',
    },
    keywords: ['transcript', 'gpa', 'accreditation', 'accredited', 'regional', 'national', 'relevé', 'releve', 'moyenne', 'accréditation', 'accrédité', 'grade point', 'official record'],
  },
  {
    id: 'terms-ace-clep',
    topic: 'terms',
    title: { en: 'ACE recommendations, CLEP, AP, dual enrollment', fr: 'Recommandations ACE, CLEP, AP, double inscription' },
    text: {
      en: 'ACE (American Council on Education) reviews some courses and exams and publishes a credit recommendation; a recommendation is advice, and each college decides whether to accept it. CLEP and AP are exams that some colleges accept for credit. Dual enrollment lets a high-school student take college courses. Always confirm with the receiving college before relying on any of them.',
      fr: 'L’ACE (American Council on Education) évalue certains cours et examens et publie une recommandation de crédits; il s’agit d’un avis, et chaque collège décide de l’accepter ou non. CLEP et AP sont des examens que certains collèges reconnaissent pour des crédits. La double inscription permet à un élève du secondaire de suivre des cours collégiaux. Confirmez toujours auprès de l’établissement d’accueil avant de vous y fier.',
    },
    keywords: ['ace', 'clep', 'ap', 'advanced placement', 'dual enrollment', 'double inscription', 'exam', 'examen', 'credit by exam', 'recommendation', 'recommandation', 'prior learning', 'transfer', 'transfert'],
    sources: [TESU_TRAINING, SOPHIA_ACE],
  },
  {
    id: 'hs-pathways-us',
    topic: 'pathways',
    title: { en: 'General US high-school pathways', fr: 'Parcours secondaires américains (général)' },
    text: {
      en: 'In the US, a high-school diploma is issued by a school or school system, and graduation requirements (credits in English, math, science, social studies and electives) are set by each state and school. Common routes are a traditional diploma, an online or accredited private school diploma, or, for some adults, an equivalency credential such as the GED or HiSET. Requirements vary, so check with the issuing school or your state education agency.',
      fr: 'Aux États-Unis, le diplôme d’études secondaires est délivré par une école ou un système scolaire, et les exigences (crédits en anglais, mathématiques, sciences, sciences sociales et options) sont fixées par chaque État et école. Les voies courantes : diplôme traditionnel, diplôme d’une école en ligne ou privée accréditée, ou, pour certains adultes, une équivalence comme le GED ou le HiSET. Les exigences varient; vérifiez auprès de l’école émettrice ou de l’agence d’éducation de votre État.',
    },
    keywords: ['high school', 'diploma', 'ged', 'hiset', 'graduation', 'secondary', 'secondaire', 'diplôme', 'études secondaires', 'équivalence', 'requirements', 'exigences', 'online school', 'école en ligne', 'pathway', 'voie'],
    links: [L.highSchool],
  },
  {
    id: 'univ-admission-basics',
    topic: 'pathways',
    title: { en: 'Public university requirements: the basics', fr: 'Exigences des universités publiques : l’essentiel' },
    text: {
      en: 'US public universities usually ask for a high-school diploma or equivalent, transcripts, and an application; many also look at required subject courses (such as English, math, science), and some use test scores while others are test-optional. Out-of-state and international applicants may have extra steps. Requirements differ by university and program, so use each university’s official admissions page.',
      fr: 'Les universités publiques américaines demandent généralement un diplôme secondaire ou équivalent, des relevés de notes et une demande d’admission; plusieurs examinent aussi des cours prérequis (anglais, mathématiques, sciences), et certaines utilisent des résultats de tests alors que d’autres ne les exigent pas. Les candidats hors État ou étrangers peuvent avoir des étapes additionnelles. Les exigences varient selon l’université et le programme; consultez la page d’admission officielle de chaque université.',
    },
    keywords: ['university', 'admission', 'admissions', 'apply', 'application', 'sat', 'act', 'test optional', 'public university', 'college', 'université', 'admission', 'demande', 'candidature', 'prerequisite', 'prérequis', 'requirements', 'exigences'],
  },
  {
    id: 'provider-tesu',
    institution: 'TESU',
    topic: 'providers',
    title: { en: 'Thomas Edison State University (TESU) and transfer credit', fr: 'Thomas Edison State University (TESU) et transfert de crédits' },
    text: {
      en: 'TESU publishes its transfer-credit policy online. According to its pages, it generally accepts ACE and NCCRS credit recommendations, with a combined maximum of 90 credits for a bachelor’s degree (45 for an associate degree) from non-collegiate providers, and it reserves the right to decide how credits apply to a program. It evaluates transfer credit for active applicants. This is general information; it does not mean any specific course will be accepted. Confirm with TESU.',
      fr: 'TESU publie sa politique de transfert de crédits en ligne. Selon ses pages, l’université accepte généralement les recommandations de crédits de l’ACE et du NCCRS, jusqu’à un maximum combiné de 90 crédits pour un baccalauréat (45 pour un diplôme associé) provenant de fournisseurs non collégiaux, et se réserve le droit de décider de l’application des crédits à un programme. Elle évalue les crédits transférés pour les candidats actifs. Il s’agit d’information générale; cela ne signifie pas qu’un cours précis sera accepté. Confirmez auprès de TESU.',
    },
    keywords: ['tesu', 'thomas edison', 'transfer credit', 'transfer', 'transfert', 'crédits transférés', '90 credits', 'ace', 'nccrs', 'bachelor', 'baccalauréat', 'accept', 'accepte'],
    sources: [TESU_TRANSFER, TESU_FAQ, TESU_TRAINING],
  },
  {
    id: 'provider-tesu-transcripts',
    institution: 'TESU',
    topic: 'providers',
    title: { en: 'Sending ACE-reviewed course transcripts to TESU', fr: 'Envoyer des relevés de cours évalués par l’ACE à TESU' },
    text: {
      en: 'TESU’s transcript page says ACE-reviewed courses and professional training must arrive on a Credly transcript, and that Sophia transcripts sent through Parchment do not contain the ACE information it needs. Procedures can change; check the TESU page before ordering a transcript.',
      fr: 'La page de TESU sur les relevés indique que les cours évalués par l’ACE et la formation professionnelle doivent être transmis par un relevé Credly, et que les relevés Sophia envoyés par Parchment ne contiennent pas l’information ACE requise. Les procédures peuvent changer; consultez la page de TESU avant de commander un relevé.',
    },
    keywords: ['credly', 'parchment', 'transcript', 'transcripts', 'relevé', 'send', 'envoyer', 'tesu', 'sophia', 'ace', 'order', 'commander'],
    sources: [TESU_SEND],
  },
  {
    id: 'provider-sophia',
    institution: 'Sophia',
    topic: 'providers',
    title: { en: 'Sophia Learning', fr: 'Sophia Learning' },
    text: {
      en: 'Sophia offers self-paced online courses, and says its courses carry ACE credit recommendations. Sophia itself notes that an ACE recommendation is not accreditation and that it cannot promise that any college will accept its courses. Check the receiving college’s policy before enrolling.',
      fr: 'Sophia offre des cours en ligne à rythme libre et indique que ses cours ont des recommandations de crédits de l’ACE. Sophia précise qu’une recommandation de l’ACE n’est pas une accréditation et qu’elle ne peut garantir qu’un collège acceptera ses cours. Vérifiez la politique de l’établissement d’accueil avant de vous inscrire.',
    },
    keywords: ['sophia', 'self-paced', 'ace', 'online course', 'cours en ligne', 'credit', 'crédit', 'accept', 'accepte', 'transfer', 'transfert'],
    sources: [SOPHIA_ACE],
  },
  {
    id: 'provider-studycom',
    institution: 'Study.com',
    topic: 'providers',
    title: { en: 'Study.com', fr: 'Study.com' },
    text: {
      en: 'TESU’s credit-for-training page mentions ACE-recommended courses completed with Study.com and says an official Study.com transcript is needed to be awarded credit there. Whether another college accepts Study.com courses is that college’s decision; confirm in writing first. Study.com’s own pricing and course list were not independently verified here.',
      fr: 'La page de TESU sur le crédit pour formation mentionne les cours recommandés par l’ACE suivis avec Study.com et indique qu’un relevé officiel de Study.com est requis pour obtenir des crédits. Qu’un autre collège accepte ou non les cours de Study.com relève de ce collège; confirmez par écrit d’abord. Les prix et la liste de cours de Study.com n’ont pas été vérifiés de façon indépendante ici.',
    },
    keywords: ['study.com', 'study com', 'studycom', 'ace', 'credit', 'crédit', 'transfer', 'transfert', 'course', 'cours'],
    sources: [TESU_TRAINING],
  },
  {
    id: 'provider-pennfoster',
    institution: 'Penn Foster',
    topic: 'providers',
    title: { en: 'Penn Foster High School', fr: 'Penn Foster High School' },
    text: {
      en: 'Penn Foster says its high school is regionally accredited for grades 9 through adult by the Middle States Association’s Commission on Secondary Schools, and that it reviews official transcripts to decide which prior credits it can use. Whether a university or employer accepts a diploma is their decision; check what your target schools require.',
      fr: 'Penn Foster indique que son école secondaire est accréditée régionalement (de la 9e année à l’âge adulte) par la Commission on Secondary Schools de la Middle States Association, et qu’elle examine les relevés officiels pour déterminer quels crédits antérieurs peuvent être utilisés. L’acceptation d’un diplôme par une université ou un employeur leur appartient; vérifiez les exigences de vos établissements cibles.',
    },
    keywords: ['penn foster', 'pennfoster', 'high school', 'diploma', 'diplôme', 'accredited', 'accrédité', 'online', 'en ligne', 'secondaire', 'adult', 'adulte'],
    sources: [PF_FAQ],
    links: [L.highSchool],
  },
  {
    id: 'no-guarantee-transfer',
    topic: 'general',
    title: { en: 'Will my credits transfer?', fr: 'Mes crédits seront-ils transférés ?' },
    text: {
      en: 'No assistant, course provider or website can promise that credits will transfer. The receiving institution decides, usually after reviewing your official transcript and its own equivalency rules. Ask the target school for a written evaluation before paying for courses, and ask your Lumière team to help you prepare the question.',
      fr: 'Aucun assistant, fournisseur de cours ou site Web ne peut promettre que des crédits seront transférés. C’est l’établissement d’accueil qui décide, généralement après examen de votre relevé officiel et de ses règles d’équivalence. Demandez à l’établissement visé une évaluation écrite avant de payer des cours, et demandez à votre équipe Lumière de vous aider à préparer la question.',
    },
    keywords: ['transfer', 'transferred', 'accepted', 'accept', 'guarantee', 'will my credits', 'transfert', 'transférés', 'accepté', 'garantie', 'mes crédits', 'equivalency', 'équivalence', 'articulation'],
    links: [L.support],
  },
  // ---------------------------------------------------------------------------------------------
  // S21 expansion. Portal entries describe only what the portal shows; external facts carry a source
  // verified 2026-10-27 and are phrased with limits ("the receiving institution decides").
  // ---------------------------------------------------------------------------------------------
  {
    id: 'portal-documents',
    topic: 'portal',
    title: { en: 'Documents: uploading and following your files', fr: 'Documents : téléverser et suivre vos fichiers' },
    text: {
      en: 'The Documents page lists the files you have uploaded and the ones your Lumière team asked for. Each document shows a status (for example pending, verified, rejected or resubmission requested). When a file is rejected or a new version is requested, the page shows the reason written for you. Only your team can mark a document as verified.',
      fr: 'La page Documents énumère les fichiers que vous avez téléversés et ceux que votre équipe Lumière a demandés. Chaque document affiche un statut (par exemple en attente, vérifié, refusé ou nouvelle version demandée). Lorsqu’un fichier est refusé ou qu’une nouvelle version est demandée, la page montre le motif rédigé à votre intention. Seule votre équipe peut marquer un document comme vérifié.',
    },
    keywords: ['documents', 'upload', 'file', 'pending', 'verified', 'rejected', 'resubmit', 'téléverser', 'fichier', 'en attente', 'vérifié', 'refusé', 'nouvelle version', 'pdf'],
    links: [L.documents, L.support],
  },
  {
    id: 'portal-document-procedures',
    topic: 'portal',
    title: { en: 'Document procedures: what to upload and what happens next', fr: 'Procédure pour les documents : quoi téléverser et la suite' },
    text: {
      en: 'Upload clear, complete copies of the documents requested on the Documents page, choosing the matching document type. Your team reviews them and updates the status; you will see a message if something must be fixed or sent again. Official transcripts for credit evaluation usually have to come directly from the issuing school or a transcript service, so an uploaded copy may not be enough for a school’s evaluation.',
      fr: 'Téléversez des copies claires et complètes des documents demandés sur la page Documents, en choisissant le type de document correspondant. Votre équipe les examine et met à jour le statut; un message vous indique si quelque chose doit être corrigé ou renvoyé. Les relevés officiels destinés à l’évaluation de crédits doivent généralement provenir directement de l’établissement émetteur ou d’un service de relevés; une copie téléversée peut donc ne pas suffire pour l’évaluation d’un établissement.',
    },
    keywords: ['upload', 'procedure', 'how to upload', 'document type', 'official transcript', 'resend', 'téléverser', 'procédure', 'relevé officiel', 'renvoyer', 'type de document', 'copy', 'copie'],
    sources: [{ title: 'Penn Foster - Credit Transfer Policy', url: 'https://www.pennfoster.edu/admissions/policies/transferring-credits', verifiedAt: V }],
    links: [L.documents],
  },
  {
    id: 'portal-support-tickets',
    topic: 'portal',
    title: { en: 'Support: asking your team a question', fr: 'Soutien : poser une question à votre équipe' },
    text: {
      en: 'Use Support to open a request with a clear subject and a description of what you need. Your request gets a reference number, and replies from your team appear in the same thread so you can follow it. Use Support for anything about your own file: documents, roadmap changes, billing questions or decisions.',
      fr: 'Utilisez Soutien pour ouvrir une demande avec un objet clair et une description de ce dont vous avez besoin. Votre demande reçoit un numéro de référence et les réponses de votre équipe apparaissent dans la même conversation. Utilisez Soutien pour tout ce qui touche à votre dossier : documents, changements à la feuille de route, questions de facturation ou décisions.',
    },
    keywords: ['support', 'ticket', 'request', 'help', 'contact', 'reply', 'soutien', 'demande', 'aide', 'réponse', 'reference number', 'numéro de référence', 'question'],
    links: [L.support],
  },
  {
    id: 'portal-support-procedures',
    topic: 'portal',
    title: { en: 'Support procedures: what to include in a request', fr: 'Procédure de soutien : quoi inclure dans une demande' },
    text: {
      en: 'Say which page or step your question is about, what you expected and what you see. Attach a document only if the team asked for it or it helps explain the question. Never write a password or full card number in a request. Urgent deadlines should be stated in the first lines so your team can prioritise.',
      fr: 'Indiquez la page ou l’étape concernée, ce que vous attendiez et ce que vous voyez. Joignez un document seulement si l’équipe l’a demandé ou s’il aide à expliquer la question. N’écrivez jamais de mot de passe ni de numéro de carte complet dans une demande. Indiquez les échéances urgentes dès les premières lignes afin que l’équipe puisse prioriser.',
    },
    keywords: ['procedure', 'what to include', 'password', 'urgent', 'deadline', 'procédure', 'mot de passe', 'urgent', 'échéance', 'attach', 'joindre', 'how to write'],
    links: [L.support],
  },
  {
    id: 'portal-billing-overview',
    topic: 'portal',
    title: { en: 'Billing: what the page shows', fr: 'Facturation : ce que la page affiche' },
    text: {
      en: 'The Billing page shows the payment information your Lumière team has recorded for you, such as installments and confirmed receipts. If you submit proof of a payment, it is reviewed by the team first; submitting proof is not the same as a confirmed payment. This assistant does not know amounts or balances: see the Billing page, or ask through Support.',
      fr: 'La page Facturation montre les renseignements de paiement que votre équipe Lumière a enregistrés pour vous, comme les versements et les reçus confirmés. Si vous soumettez une preuve de paiement, l’équipe l’examine d’abord; soumettre une preuve n’équivaut pas à un paiement confirmé. Cet assistant ne connaît ni les montants ni les soldes : consultez la page Facturation ou posez la question via Soutien.',
    },
    keywords: ['billing', 'payment', 'tuition', 'invoice', 'receipt', 'installment', 'proof of payment', 'facturation', 'paiement', 'frais', 'facture', 'reçu', 'versement', 'preuve de paiement', 'balance', 'solde'],
    links: [L.billing, L.support],
  },
  {
    id: 'portal-financial-admin-faq',
    topic: 'portal',
    title: { en: 'Common financial-administration questions', fr: 'Questions administratives financières fréquentes' },
    text: {
      en: 'I paid but do not see it: payments appear after your team confirms them, so submit your proof on the Billing page if you have not, then ask through Support if it is still missing. I need a receipt: confirmed receipts are listed on Billing. I think there is a mistake: open a Support request and name the item. This assistant cannot give amounts, change a payment or approve exceptions.',
      fr: 'J’ai payé mais je ne le vois pas : les paiements apparaissent après confirmation par votre équipe; soumettez votre preuve sur la page Facturation si ce n’est pas fait, puis écrivez à Soutien s’il manque toujours. J’ai besoin d’un reçu : les reçus confirmés sont listés dans Facturation. Je pense qu’il y a une erreur : ouvrez une demande Soutien en nommant l’élément. Cet assistant ne peut donner de montants, modifier un paiement ni approuver d’exceptions.',
    },
    keywords: ['paid', 'payment missing', 'receipt', 'mistake', 'error', 'refund', 'payé', 'paiement manquant', 'reçu', 'erreur', 'remboursement', 'proof', 'preuve', 'where is my payment', 'billing question'],
    links: [L.billing, L.support],
  },
  {
    id: 'portal-roadmap-progress',
    topic: 'portal',
    title: { en: 'Reporting progress on your roadmap', fr: 'Déclarer votre progression sur la feuille de route' },
    text: {
      en: 'On the roadmap you can report your own activity on a step, such as starting or submitting work. What you report is shown as reported: it does not change the official record. Official status (for example accepted credit) is only set by your Lumière team or the issuing institution.',
      fr: 'Sur la feuille de route, vous pouvez déclarer votre propre activité sur une étape, par exemple avoir commencé ou remis un travail. Ce que vous déclarez est affiché comme déclaré : cela ne modifie pas le dossier officiel. Le statut officiel (par exemple un crédit accepté) est fixé seulement par votre équipe Lumière ou l’établissement émetteur.',
    },
    keywords: ['progress', 'report', 'reported', 'official', 'update', 'step', 'progression', 'déclarer', 'déclaré', 'officiel', 'mettre à jour', 'étape', 'task', 'tâche'],
    links: [L.roadmap],
  },
  {
    id: 'portal-high-school-page',
    topic: 'portal',
    title: { en: 'The High school page', fr: 'La page Études secondaires' },
    text: {
      en: 'The High school page shows your secondary-school pathway: your courses grouped by subject, tasks, pace against the plan, anything needing attention, and the status of graduation steps. Credits and graduation status shown there come from your official record kept by your team and the school.',
      fr: 'La page Études secondaires présente votre parcours secondaire : vos cours regroupés par matière, les tâches, le rythme par rapport au plan, ce qui requiert votre attention et l’état des étapes de diplomation. Les crédits et l’état de la diplomation proviennent du dossier officiel tenu par votre équipe et l’école.',
    },
    keywords: ['high school page', 'courses', 'subject', 'pace', 'graduation', 'attention', 'matières', 'cours', 'rythme', 'diplomation', 'secondaire', 'études secondaires', 'subjects'],
    links: [L.highSchool],
  },
  {
    id: 'portal-scheduling-progress',
    topic: 'portal',
    title: { en: 'Scheduling and keeping a steady pace', fr: 'Planification et rythme de travail régulier' },
    text: {
      en: 'Your plan shows suggested dates and a pace (on track, behind or ahead). A steady weekly routine usually works better than long gaps, and the pace indicator is guidance, not a penalty. If your schedule changes or you fall behind, tell your team through Support so the plan can be adjusted by them.',
      fr: 'Votre plan affiche des dates suggérées et un rythme (dans les temps, en retard ou en avance). Une routine hebdomadaire régulière fonctionne généralement mieux que de longues interruptions, et l’indicateur de rythme est un repère, pas une pénalité. Si votre horaire change ou si vous prenez du retard, informez votre équipe via Soutien afin qu’elle ajuste le plan.',
    },
    keywords: ['schedule', 'pace', 'behind', 'ahead', 'on track', 'deadline', 'routine', 'horaire', 'rythme', 'en retard', 'dans les temps', 'échéance', 'planning', 'weekly', 'hebdomadaire'],
    links: [L.roadmap, L.highSchool, L.support],
  },
  {
    id: 'portal-assistant-conversations',
    topic: 'portal',
    title: { en: 'Assistant conversations', fr: 'Conversations avec l’assistant' },
    text: {
      en: 'Your conversations with the assistant are saved to your account so you can reopen, rename, search and archive them later. Only you can see them. Archiving hides a conversation from the main list without deleting it.',
      fr: 'Vos conversations avec l’assistant sont enregistrées dans votre compte afin que vous puissiez les rouvrir, les renommer, les chercher et les archiver. Vous seul pouvez les voir. Archiver masque une conversation de la liste principale sans la supprimer.',
    },
    keywords: ['conversation', 'conversations', 'history', 'saved', 'archive', 'rename', 'historique', 'enregistré', 'archiver', 'renommer', 'previous chat', 'discussion précédente'],
  },
  {
    id: 'portal-assistant-memory',
    topic: 'portal',
    title: { en: 'Assistant memory: what it keeps and how to change it', fr: 'Mémoire de l’assistant : ce qu’elle garde et comment la modifier' },
    text: {
      en: 'The assistant can remember goals and preferences you state in chat, such as a field of study or a preferred language. Each item shows where it came from. You can correct an item (the old version is kept in history) or retract it. Memory is only what you said; it never changes your official record, credits, billing or decisions.',
      fr: 'L’assistant peut retenir les objectifs et préférences que vous exprimez dans la conversation, comme un domaine d’études ou une langue préférée. Chaque élément indique sa provenance. Vous pouvez corriger un élément (l’ancienne version est conservée dans l’historique) ou le retirer. La mémoire ne contient que ce que vous avez dit; elle ne modifie jamais votre dossier officiel, vos crédits, votre facturation ni les décisions.',
    },
    keywords: ['memory', 'remember', 'forget', 'correct', 'retract', 'preferences', 'goals', 'mémoire', 'retenir', 'oublier', 'corriger', 'retirer', 'préférences', 'objectifs', 'what do you know about me', 'que savez-vous de moi'],
  },
  {
    id: 'portal-search',
    topic: 'portal',
    title: { en: 'Searching the portal', fr: 'Rechercher dans le portail' },
    text: {
      en: 'Use the search box to find your courses, roadmap steps, documents (by file name, type and indexed text), support requests, assistant conversations and memory items, and the Billing page. Search only looks at your own information. Team members searching see students, not your private conversations.',
      fr: 'Utilisez la recherche pour trouver vos cours, étapes de feuille de route, documents (par nom de fichier, type et texte indexé), demandes de soutien, conversations avec l’assistant et éléments de mémoire, ainsi que la page Facturation. La recherche ne porte que sur vos propres renseignements. Les membres de l’équipe qui cherchent voient des étudiants, pas vos conversations privées.',
    },
    keywords: ['search', 'find', 'look for', 'global search', 'rechercher', 'chercher', 'trouver', 'recherche', 'search box', 'barre de recherche'],
  },
  {
    id: 'lumiere-team-role',
    topic: 'portal',
    title: { en: 'What your Lumière team does in the portal', fr: 'Ce que fait votre équipe Lumière dans le portail' },
    text: {
      en: 'Your Lumière team keeps the official version of your roadmap, reviews and verifies the documents you upload, confirms payments on your billing record, and answers Support requests. Decisions about credit, acceptance and graduation are recorded by the team or the issuing institution, not by this assistant.',
      fr: 'Votre équipe Lumière tient la version officielle de votre feuille de route, examine et vérifie les documents que vous téléversez, confirme les paiements dans votre dossier de facturation et répond aux demandes de soutien. Les décisions sur les crédits, l’acceptation et la diplomation sont consignées par l’équipe ou l’établissement émetteur, pas par cet assistant.',
    },
    keywords: ['team', 'lumière team', 'who', 'staff', 'advisor', 'services', 'what does lumière do', 'équipe', 'qui', 'conseiller', 'services', 'que fait lumière'],
    links: [L.support, L.roadmap],
  },
  {
    id: 'hs-diploma-routes-compared',
    topic: 'pathways',
    title: { en: 'High-school diploma routes compared', fr: 'Comparaison des voies vers le diplôme d’études secondaires' },
    text: {
      en: 'A diploma from an accredited online high school and an equivalency credential such as the GED are different routes: the first is a diploma issued by a school after you complete its credits, the second is earned by passing tests. Colleges and employers set their own rules about which they accept, so check the requirements of your target schools before choosing.',
      fr: 'Un diplôme d’une école secondaire en ligne accréditée et une équivalence comme le GED sont deux voies différentes : le premier est délivré par une école après l’obtention de ses crédits, la seconde s’obtient en réussissant des tests. Les collèges et employeurs fixent leurs propres règles sur ce qu’ils acceptent; vérifiez les exigences de vos établissements visés avant de choisir.',
    },
    keywords: ['ged', 'hiset', 'diploma', 'high school', 'equivalency', 'online high school', 'diplôme', 'équivalence', 'secondaire', 'which route', 'quelle voie', 'compare'],
    sources: [PF_FAQ],
    links: [L.highSchool],
  },
  {
    id: 'hs-required-vs-elective',
    topic: 'terms',
    title: { en: 'Required courses versus electives', fr: 'Cours obligatoires et cours à option' },
    text: {
      en: 'Required (core) courses are the subjects every student in a program must complete, typically English, math, science and social studies. Electives are courses you choose to reach the total credits. The exact list and number of credits is set by the diploma-granting school, and your Lumière roadmap shows the version that applies to you.',
      fr: 'Les cours obligatoires (de base) sont les matières que tout étudiant d’un programme doit réussir, généralement l’anglais, les mathématiques, les sciences et les sciences sociales. Les cours à option sont ceux que vous choisissez pour atteindre le total de crédits. La liste exacte et le nombre de crédits sont fixés par l’école qui délivre le diplôme, et votre feuille de route Lumière montre la version qui vous concerne.',
    },
    keywords: ['required', 'core', 'elective', 'electives', 'mandatory', 'optional', 'obligatoire', 'à option', 'optionnel', 'cours de base', 'which courses', 'quels cours', 'subject area', 'matière'],
    links: [L.highSchool, L.roadmap],
  },
  {
    id: 'pennfoster-accreditation',
    institution: 'Penn Foster',
    topic: 'providers',
    title: { en: 'Penn Foster High School: accreditation', fr: 'Penn Foster High School : accréditation' },
    text: {
      en: 'Penn Foster says its high school is regionally accredited for grades 9 through adult by the Commission on Secondary Schools of the Middle States Association of Colleges and Schools, and nationally accredited by the Distance Education Accrediting Commission (DEAC). Accreditation does not guarantee that another school accepts a diploma or credits.',
      fr: 'Penn Foster indique que son école secondaire est accréditée régionalement (de la 9e année à l’âge adulte) par la Commission on Secondary Schools de la Middle States Association of Colleges and Schools, et accréditée à l’échelle nationale par la Distance Education Accrediting Commission (DEAC). L’accréditation ne garantit pas qu’un autre établissement acceptera un diplôme ou des crédits.',
    },
    keywords: ['penn foster', 'accredited', 'accreditation', 'deac', 'middle states', 'msa', 'css', 'accrédité', 'accréditation', 'legit', 'legitimate'],
    sources: [PF_FAQ],
  },
  {
    id: 'pennfoster-hs-transfer-credits',
    institution: 'Penn Foster',
    topic: 'providers',
    title: { en: 'Penn Foster High School: transferring prior high-school credits in', fr: 'Penn Foster High School : transfert de crédits secondaires antérieurs' },
    text: {
      en: 'Penn Foster says that to receive high-school transfer credits an official transcript from an accredited institution it recognizes must be submitted. Credits are evaluated for comparable high-school subjects where a full credit was earned, only Penn Foster’s evaluation determines the number awarded, and it lists a maximum of 15 transfer credits.',
      fr: 'Penn Foster indique que, pour recevoir des crédits secondaires transférés, un relevé officiel d’un établissement accrédité qu’elle reconnaît doit être soumis. Les crédits sont évalués pour des matières secondaires comparables où un crédit complet a été obtenu, seule l’évaluation de Penn Foster détermine le nombre accordé, et elle indique un maximum de 15 crédits transférés.',
    },
    keywords: ['penn foster', 'transfer credits', 'prior credits', 'transcript review', 'maximum 15', 'crédits transférés', 'relevé', 'évaluation', 'previous school', 'ancienne école', '15 credits'],
    sources: [PF_TRANSFER, PF_FAQ],
    links: [L.highSchool],
  },
  {
    id: 'pennfoster-college-transfer',
    institution: 'Penn Foster',
    topic: 'providers',
    title: { en: 'Penn Foster College: transfer-in rules', fr: 'Penn Foster College : règles de transfert entrant' },
    text: {
      en: 'For its college programs, Penn Foster says prior coursework may be credited if the earlier school meets its standards, the work is eligible, and the grade was at least a C; up to 75% of required credits may transfer in. It also says no form of accreditation guarantees another school will accept credits.',
      fr: 'Pour ses programmes collégiaux, Penn Foster indique que des cours antérieurs peuvent être reconnus si l’établissement d’origine répond à ses normes, si les travaux sont admissibles et si la note est d’au moins C; jusqu’à 75 % des crédits requis peuvent être transférés. Elle précise aussi qu’aucune forme d’accréditation ne garantit qu’un autre établissement acceptera des crédits.',
    },
    keywords: ['penn foster college', 'college transfer', '75%', 'minimum grade', 'c grade', 'transfer in', 'collège', 'transfert', 'note minimale', '75 %'],
    sources: [PF_TRANSFER],
  },
  {
    id: 'pennfoster-sophia-partnership',
    institution: 'Penn Foster',
    topic: 'providers',
    title: { en: 'Penn Foster graduates and Sophia', fr: 'Diplômés de Penn Foster et Sophia' },
    text: {
      en: 'Penn Foster’s FAQ lists Sophia as an educational partner for graduates, with access to DEAC-recommended courses designed to be transferred for college credit, self-paced learning and a discount on the first month. Whether a college grants credit for any such course is that college’s decision.',
      fr: 'La FAQ de Penn Foster présente Sophia comme partenaire éducatif pour les diplômés, avec accès à des cours recommandés par la DEAC conçus pour être transférés en crédits collégiaux, un apprentissage à rythme libre et un rabais sur le premier mois. L’octroi de crédits par un collège pour un tel cours relève de ce collège.',
    },
    keywords: ['penn foster', 'sophia', 'partner', 'graduates', 'discount', 'deac', 'partenaire', 'diplômés', 'rabais', 'after high school', 'après le secondaire'],
    sources: [PF_FAQ],
  },
  {
    id: 'us-admissions-terms',
    topic: 'terms',
    title: { en: 'US admissions terminology', fr: 'Terminologie des admissions américaines' },
    text: {
      en: 'Application: the form you submit to a college. Transcript: your official school record. Test-optional: the college does not require test scores, though policies differ by college. Fee waiver: a request to remove the application fee. First-year applicant: someone applying straight from high school; transfer applicant: someone with prior college credits. Always confirm each term with the college’s own admissions page.',
      fr: 'Demande d’admission : le formulaire soumis à un collège. Relevé de notes : votre dossier scolaire officiel. Test facultatif (« test-optional ») : le collège n’exige pas de résultats de tests, mais les politiques varient. Exemption de frais : demande de retrait des frais de dossier. Candidat de première année : personne qui postule directement après le secondaire; candidat par transfert : personne ayant déjà des crédits collégiaux. Confirmez chaque terme sur la page d’admission du collège.',
    },
    keywords: ['application', 'transcript', 'test optional', 'fee waiver', 'first-year', 'transfer applicant', 'admissions', 'terminology', 'glossary', 'demande', 'relevé', 'exemption', 'terminologie', 'glossaire', 'freshman'],
    sources: [COMMON_APP],
  },
  {
    id: 'commonapp-basics',
    topic: 'general',
    title: { en: 'The Common App: what it is and what it asks for', fr: 'La Common App : ce que c’est et ce qu’elle demande' },
    text: {
      en: 'Common App is an application platform used by many (not all) colleges. You build one account, add colleges, invite supporters such as counselors, and each college may require different items: a high-school transcript, test scores or a test-optional choice, essays and recommendations. Its requirements grid lists what each member college needs.',
      fr: 'Common App est une plateforme de demande d’admission utilisée par de nombreux collèges (pas tous). Vous créez un seul compte, ajoutez des collèges, invitez des personnes qui vous soutiennent comme les conseillers, et chaque collège peut exiger des éléments différents : relevé secondaire, résultats de tests ou choix test-optional, essais et recommandations. Sa grille d’exigences indique ce dont chaque collège membre a besoin.',
    },
    keywords: ['common app', 'commonapp', 'application platform', 'essay', 'recommendation', 'counselor', 'requirements grid', 'essai', 'recommandation', 'conseiller', 'plateforme', 'apply to colleges'],
    sources: [COMMON_APP],
  },
  {
    id: 'transfer-credit-basics',
    topic: 'terms',
    title: { en: 'Transfer credit: how it generally works', fr: 'Crédits transférés : fonctionnement général' },
    text: {
      en: 'Transfer credit means a college counts coursework done elsewhere toward its own degree. The receiving institution reviews official documents, decides what is equivalent and how it applies to the program, and may limit how many credits it accepts. For example, TESU says it reserves the right to determine the appropriate equivalency and application to a degree program. Ask the receiving school for its policy in writing.',
      fr: 'Le transfert de crédits signifie qu’un collège reconnaît des cours faits ailleurs dans son propre diplôme. L’établissement d’accueil examine les documents officiels, décide de l’équivalence et de l’application au programme, et peut limiter le nombre de crédits acceptés. Par exemple, TESU indique se réserver le droit de déterminer l’équivalence et l’application à un programme de diplôme. Demandez sa politique par écrit à l’établissement d’accueil.',
    },
    keywords: ['transfer credit', 'equivalency', 'receiving institution', 'how transfer works', 'credit evaluation', 'transfert de crédits', 'équivalence', 'établissement d’accueil', 'évaluation des crédits', 'limit', 'limite'],
    sources: [TESU_TRANSFER],
    links: [L.support],
  },
  {
    id: 'tesu-transfer-limits',
    institution: 'TESU',
    topic: 'providers',
    title: { en: 'TESU: transfer-in limits from colleges', fr: 'TESU : limites de transfert depuis des collèges' },
    text: {
      en: 'TESU says that from an accepted, institutionally accredited community college you may transfer and apply up to 90 credits, and that from an accepted four-year institution you may satisfy all degree requirements by transfer except two required TESU courses (SOS-1100 and a capstone). Evaluations are done only for active applicants, up to two evaluations, and not on unofficial documents.',
      fr: 'TESU indique qu’à partir d’un collège communautaire accepté et accrédité institutionnellement, vous pouvez transférer et appliquer jusqu’à 90 crédits, et qu’à partir d’un établissement de quatre ans accepté, vous pouvez satisfaire toutes les exigences du diplôme par transfert, sauf deux cours TESU obligatoires (SOS-1100 et un cours de synthèse). Les évaluations sont faites seulement pour les candidats actifs, jusqu’à deux évaluations, et pas sur des documents non officiels.',
    },
    keywords: ['tesu', 'transfer limits', '90 credits', 'community college', 'four-year', 'sos-1100', 'capstone', 'evaluation', 'unofficial', 'limite', 'collège communautaire', 'évaluation', 'non officiel', 'cours de synthèse'],
    sources: [TESU_TRANSFER],
  },
  {
    id: 'tesu-ace-nccrs-limits',
    institution: 'TESU',
    topic: 'providers',
    title: { en: 'TESU: ACE and NCCRS credit limits and transcripts', fr: 'TESU : limites des crédits ACE et NCCRS et relevés' },
    text: {
      en: 'TESU says the limit of ACE and National CCRS credits from all sources is 90 for a bachelor’s degree and 45 for an associate degree, that it decides which recommendations it accepts, and that application to one degree does not imply application to another. ACE coursework is sent by an official Credly Acclaim transcript, except Study.com courses, which need an official Study.com transcript.',
      fr: 'TESU indique que la limite des crédits ACE et National CCRS, toutes sources confondues, est de 90 pour un baccalauréat et de 45 pour un diplôme associé, qu’elle décide des recommandations acceptées, et que l’application à un diplôme n’implique pas l’application à un autre. Les cours ACE sont transmis par un relevé Credly Acclaim officiel, sauf les cours Study.com, qui exigent un relevé officiel de Study.com.',
    },
    keywords: ['tesu', 'ace', 'nccrs', 'national ccrs', '90', '45', 'credly', 'acclaim', 'study.com', 'limit', 'relevé', 'limite', 'associate', 'bachelor'],
    sources: [TESU_TRAINING],
  },
  {
    id: 'tesu-programmatic-accreditation',
    institution: 'TESU',
    topic: 'providers',
    title: { en: 'TESU: programmes that may require programmatic accreditation', fr: 'TESU : programmes pouvant exiger une accréditation de programme' },
    text: {
      en: 'TESU says programs that hold or intend to seek programmatic accreditation reserve the right to require programmatic accreditation for transfer credit. Credit that is acceptable toward one program may therefore not be acceptable toward a professionally accredited one. Confirm with the specific program.',
      fr: 'TESU indique que les programmes qui détiennent ou comptent obtenir une accréditation de programme se réservent le droit d’exiger cette accréditation pour le transfert de crédits. Un crédit acceptable pour un programme peut donc ne pas l’être pour un programme accrédité professionnellement. Confirmez auprès du programme visé.',
    },
    keywords: ['tesu', 'programmatic accreditation', 'nursing', 'professional', 'program', 'accréditation de programme', 'infirmier', 'programme', 'transfer credit'],
    sources: [TESU_TRANSFER],
  },
  {
    id: 'tesu-professional-training',
    institution: 'TESU',
    topic: 'providers',
    title: { en: 'TESU: credit for professional training and apprenticeships', fr: 'TESU : crédit pour formation professionnelle et apprentissages' },
    text: {
      en: 'TESU’s Office of Professional Learning Review assesses courses, licenses, certifications, apprenticeships and exams from employers, government agencies, unions and professional associations to determine college-level learning. TESU also says it is a member of the Registered Apprenticeship College Consortium. Whether training earns credit depends on the evaluation and on your degree program.',
      fr: 'L’Office of Professional Learning Review de TESU évalue des cours, permis, certifications, apprentissages et examens offerts par des employeurs, organismes publics, syndicats et associations professionnelles afin de déterminer l’apprentissage de niveau collégial. TESU indique aussi être membre du Registered Apprenticeship College Consortium. L’octroi de crédits dépend de l’évaluation et de votre programme.',
    },
    keywords: ['tesu', 'professional training', 'oplr', 'apprenticeship', 'certification', 'license', 'prior learning', 'formation professionnelle', 'apprentissage', 'permis', 'acquis', 'racc'],
    sources: [TESU_TRAINING],
  },
  {
    id: 'sophia-accreditation-status',
    institution: 'Sophia',
    topic: 'providers',
    title: { en: 'Sophia Learning: accreditation and partner colleges', fr: 'Sophia Learning : accréditation et collèges partenaires' },
    text: {
      en: 'Sophia states that it is not accredited because it offers individual courses, not degree programs, and that its courses carry an ACE recommendation and a DEAC recommendation. It says its courses transfer automatically at its partner colleges (it lists more than 115) and advises checking with your registrar or advisor first. A previous review at a college does not guarantee future acceptance.',
      fr: 'Sophia indique qu’elle n’est pas accréditée parce qu’elle offre des cours individuels et non des programmes de diplôme, et que ses cours ont une recommandation de l’ACE et une recommandation de la DEAC. Elle indique que ses cours sont transférés automatiquement dans ses collèges partenaires (plus de 115) et conseille de vérifier d’abord auprès de votre registraire ou conseiller. Un examen antérieur dans un collège ne garantit pas une acceptation future.',
    },
    keywords: ['sophia', 'accredited', 'not accredited', 'partner colleges', 'deac', 'ace', 'registrar', 'accrédité', 'collèges partenaires', 'registraire', 'automatically', 'automatiquement'],
    sources: [SOPHIA_ACE],
  },
  {
    id: 'studycom-transcripts',
    institution: 'Study.com',
    topic: 'providers',
    title: { en: 'Study.com: transcripts for credit at TESU', fr: 'Study.com : relevés pour des crédits à TESU' },
    text: {
      en: 'For ACE-recommended courses completed with Study.com, TESU says you must submit an official Study.com transcript to be awarded credit, rather than the Credly Acclaim transcript used for other ACE coursework. For any other college, ask what it requires and whether it accepts Study.com coursework at all.',
      fr: 'Pour les cours recommandés par l’ACE suivis avec Study.com, TESU indique qu’il faut soumettre un relevé officiel de Study.com pour obtenir des crédits, plutôt que le relevé Credly Acclaim utilisé pour les autres cours ACE. Pour tout autre collège, demandez ce qu’il exige et s’il accepte les cours de Study.com.',
    },
    keywords: ['study.com', 'study com', 'transcript', 'official transcript', 'tesu', 'ace', 'relevé officiel', 'relevé', 'credit', 'crédit'],
    sources: [TESU_TRAINING],
  },
  {
    id: 'ace-credit-recommendations-detail',
    topic: 'terms',
    title: { en: 'ACE credit recommendations in detail', fr: 'Recommandations de crédits ACE en détail' },
    text: {
      en: 'ACE evaluates courses and training and recommends a subject, a level (such as lower- or upper-level) and a number of credit hours. These recommendations are published, for example in the ACE National Guide, and colleges use them to help decide. It is a recommendation, not accreditation, and each institution has the final say on whether and how it counts toward a degree.',
      fr: 'L’ACE évalue des cours et des formations et recommande une matière, un niveau (par exemple de premier ou de deuxième cycle) et un nombre d’heures-crédit. Ces recommandations sont publiées, par exemple dans l’ACE National Guide, et les collèges s’en servent pour décider. Il s’agit d’une recommandation et non d’une accréditation; chaque établissement a le dernier mot sur son application à un diplôme.',
    },
    keywords: ['ace', 'national guide', 'credit recommendation', 'level', 'recommended credits', 'recommandation', 'niveau', 'heures-crédit', 'american council on education', 'not accreditation'],
    sources: [SOPHIA_ACE, CLEP_ACE],
  },
  {
    id: 'clep-basics',
    topic: 'terms',
    title: { en: 'CLEP exams: what they are', fr: 'Examens CLEP : de quoi s’agit-il' },
    text: {
      en: 'CLEP is a College Board credit-by-examination program with 34 exams on introductory college material. The College Board states that only colleges may grant credit toward a degree, and each college sets its own policy on which exams and scores it accepts and how many credits it awards. Search the college’s CLEP policy before registering.',
      fr: 'Le CLEP est un programme de crédits par examen du College Board comptant 34 examens sur des matières collégiales d’introduction. Le College Board précise que seuls les collèges peuvent accorder des crédits pour un diplôme, et chaque collège fixe sa propre politique sur les examens et résultats acceptés et le nombre de crédits accordés. Consultez la politique CLEP du collège avant de vous inscrire.',
    },
    keywords: ['clep', 'college board', 'credit by exam', 'exam', 'test out', 'examen', 'crédits par examen', 'college policy', 'politique du collège', '34 exams'],
    sources: [CLEP_KEY, CLEP_FIND],
  },
  {
    id: 'clep-score-meaning',
    topic: 'terms',
    title: { en: 'CLEP scores and ACE-recommended scores', fr: 'Résultats CLEP et résultats recommandés par l’ACE' },
    text: {
      en: 'CLEP raw scores are converted to a scaled score from 20 to 80. The College Board publishes credit-granting scores recommended by ACE, but says each college can set its own credit-granting policy, which may differ. Contact the college to learn the score it requires, the credits it grants and which course is bypassed.',
      fr: 'Les résultats bruts du CLEP sont convertis en une note pondérée de 20 à 80. Le College Board publie les résultats recommandés par l’ACE pour l’octroi de crédits, mais précise que chaque collège peut fixer sa propre politique, qui peut différer. Communiquez avec le collège pour connaître le résultat exigé, les crédits accordés et le cours remplacé.',
    },
    keywords: ['clep score', 'scaled score', '50', 'passing score', 'credit-granting score', 'résultat clep', 'note pondérée', 'score requis', 'ace recommended score'],
    sources: [CLEP_SCORE],
  },
  {
    id: 'accreditation-why-it-matters',
    topic: 'terms',
    title: { en: 'Institutional versus programmatic accreditation', fr: 'Accréditation institutionnelle ou de programme' },
    text: {
      en: 'Institutional accreditation means a school is accredited by an agency recognized by the US Department of Education. Individual programs, such as in health professions, may also hold programmatic accreditation. Receiving schools often look at the accreditation of the school where credits were earned, and some programs require programmatic accreditation.',
      fr: 'L’accréditation institutionnelle signifie qu’un établissement est accrédité par un organisme reconnu par le département de l’Éducation des États-Unis. Certains programmes, notamment en santé, peuvent aussi détenir une accréditation de programme. Les établissements d’accueil examinent souvent l’accréditation de l’école où les crédits ont été obtenus, et certains programmes exigent une accréditation de programme.',
    },
    keywords: ['accreditation', 'institutional', 'programmatic', 'department of education', 'recognized agency', 'accréditation', 'institutionnelle', 'programme', 'département de l’éducation', 'regional'],
    sources: [SOPHIA_ACE, TESU_TRANSFER],
  },
  {
    id: 'academic-documentation-official',
    topic: 'terms',
    title: { en: 'Academic documentation: official versus unofficial', fr: 'Documents scolaires : officiels ou non officiels' },
    text: {
      en: 'An official transcript is sent directly by the issuing school (or an authorised service) to the receiving institution; a copy you upload or forward is usually unofficial. Schools commonly evaluate credit only from official documents: TESU, for example, says evaluations cannot be completed on unofficial documents, and Penn Foster says official transcripts must come from the school or an authorised credential service.',
      fr: 'Un relevé officiel est envoyé directement par l’établissement émetteur (ou un service autorisé) à l’établissement d’accueil; une copie que vous téléversez ou transmettez est généralement non officielle. Les établissements n’évaluent habituellement les crédits qu’à partir de documents officiels : TESU indique par exemple que les évaluations ne peuvent être faites sur des documents non officiels, et Penn Foster que les relevés officiels doivent venir de l’école ou d’un service autorisé.',
    },
    keywords: ['official transcript', 'unofficial', 'documentation', 'send transcript', 'parchment', 'credly', 'relevé officiel', 'non officiel', 'envoyer un relevé', 'copie', 'documents scolaires'],
    sources: [TESU_TRANSFER, PF_TRANSFER],
    links: [L.documents],
  },
  {
    id: 'transfer-credit-checklist',
    topic: 'general',
    title: { en: 'Before you pay for courses meant to transfer: a checklist', fr: 'Avant de payer des cours destinés au transfert : liste de vérification' },
    text: {
      en: 'Check the receiving school’s transfer policy and any credit limits; ask whether it accepts the provider’s courses or the ACE recommendation; ask how it wants transcripts delivered; confirm whether the program requires programmatic accreditation; and get the answer in writing. Your Lumière team can help you prepare these questions, but the receiving institution decides.',
      fr: 'Vérifiez la politique de transfert de l’établissement visé et ses limites de crédits; demandez s’il accepte les cours du fournisseur ou la recommandation ACE; demandez comment il veut recevoir les relevés; confirmez si le programme exige une accréditation de programme; et obtenez la réponse par écrit. Votre équipe Lumière peut vous aider à préparer ces questions, mais l’établissement d’accueil décide.',
    },
    keywords: ['checklist', 'before paying', 'before enrolling', 'verify', 'ask the school', 'in writing', 'liste de vérification', 'avant de payer', 'avant de vous inscrire', 'par écrit', 'questions to ask', 'questions à poser'],
    sources: [TESU_TRANSFER, TESU_TRAINING],
    links: [L.support],
  },
];

export const SUGGESTIONS: Array<{ id: string; en: string; fr: string; entryId: string }> = [
  { id: 'roadmap-how', en: 'How does a roadmap work?', fr: 'Comment fonctionne une feuille de route ?', entryId: 'roadmap-how' },
  { id: 'statuses', en: 'What do the statuses mean?', fr: 'Que signifient les statuts ?', entryId: 'statuses' },
  { id: 'transfer', en: 'Will my credits transfer?', fr: 'Mes crédits seront-ils transférés ?', entryId: 'no-guarantee-transfer' },
  { id: 'terms-credit', en: 'What is a credit hour?', fr: 'Qu’est-ce qu’une heure-crédit ?', entryId: 'terms-credit' },
  { id: 'nav', en: 'Where do I find things in the portal?', fr: 'Où trouver les choses dans le portail ?', entryId: 'portal-navigation' },
  { id: 'tesu', en: 'What does TESU say about transfer credit?', fr: 'Que dit TESU sur le transfert de crédits ?', entryId: 'provider-tesu' },
];
