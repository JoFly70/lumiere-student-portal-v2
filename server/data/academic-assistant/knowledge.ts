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
];

export const SUGGESTIONS: Array<{ id: string; en: string; fr: string; entryId: string }> = [
  { id: 'roadmap-how', en: 'How does a roadmap work?', fr: 'Comment fonctionne une feuille de route ?', entryId: 'roadmap-how' },
  { id: 'statuses', en: 'What do the statuses mean?', fr: 'Que signifient les statuts ?', entryId: 'statuses' },
  { id: 'transfer', en: 'Will my credits transfer?', fr: 'Mes crédits seront-ils transférés ?', entryId: 'no-guarantee-transfer' },
  { id: 'terms-credit', en: 'What is a credit hour?', fr: 'Qu’est-ce qu’une heure-crédit ?', entryId: 'terms-credit' },
  { id: 'nav', en: 'Where do I find things in the portal?', fr: 'Où trouver les choses dans le portail ?', entryId: 'portal-navigation' },
  { id: 'tesu', en: 'What does TESU say about transfer credit?', fr: 'Que dit TESU sur le transfert de crédits ?', entryId: 'provider-tesu' },
];
