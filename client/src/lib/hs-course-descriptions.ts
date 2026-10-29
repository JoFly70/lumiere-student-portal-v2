/**
 * Short, general, NON-OFFICIAL course descriptions keyed by course key (core template courses
 * and elective keys). No school name; the school's syllabus is always authoritative.
 */
type Desc = { en: string; fr: string };

const CORE: Record<string, Desc> = {
  "startup-personal-growth": {
    en: "An introduction to studying online: setting goals, building routines and habits, and taking responsibility for your own progress.",
    fr: "Une introduction à l’étude en ligne : se fixer des objectifs, installer des routines et des habitudes, et prendre en charge sa propre progression.",
  },
  "startup-learning-tech": {
    en: "Learn to use the learning platform and everyday digital tools: navigating lessons, submitting work and staying safe online.",
    fr: "Apprendre à utiliser la plateforme d’apprentissage et les outils numériques courants : suivre les leçons, remettre des travaux et rester en sécurité en ligne.",
  },
  "english-1": {
    en: "Reading and writing foundations: understanding short texts, building vocabulary and writing clear paragraphs.",
    fr: "Bases de la lecture et de l’écriture : comprendre des textes courts, enrichir son vocabulaire et rédiger des paragraphes clairs.",
  },
  "english-2": {
    en: "Builds on English 1 with longer texts, more structured writing and basic analysis of what you read.",
    fr: "Prolonge English 1 avec des textes plus longs, une écriture plus structurée et une analyse simple des lectures.",
  },
  "english-3": {
    en: "Stronger reading comprehension and essay writing, including supporting a point of view with evidence.",
    fr: "Compréhension de lecture approfondie et rédaction d’essais, avec des arguments appuyés sur des preuves.",
  },
  "english-4": {
    en: "Advanced reading, research and writing skills to prepare for further study and professional communication.",
    fr: "Lecture, recherche et écriture de niveau avancé pour se préparer aux études supérieures et à la communication professionnelle.",
  },
  "math-general-1": {
    en: "Core everyday mathematics: number sense, fractions, percentages, simple equations and problem solving.",
    fr: "Mathématiques du quotidien : sens du nombre, fractions, pourcentages, équations simples et résolution de problèmes.",
  },
  "math-general-2": {
    en: "Continues general mathematics with algebra basics, geometry and working with data.",
    fr: "Suite des mathématiques générales : bases de l’algèbre, géométrie et utilisation de données.",
  },
  "math-personal-finance": {
    en: "Mathematics applied to money: budgeting, saving, interest, credit and making sensible financial decisions.",
    fr: "Mathématiques appliquées à l’argent : budget, épargne, intérêts, crédit et décisions financières avisées.",
  },
  "humanities-digital-literacy": {
    en: "How to find, judge and use information online, and how to communicate responsibly in a digital world.",
    fr: "Comment trouver, évaluer et utiliser l’information en ligne, et communiquer de façon responsable dans un monde numérique.",
  },
  "science-earth": {
    en: "An introduction to Earth and space science: rocks and landforms, weather and climate, water and the planet’s systems.",
    fr: "Introduction aux sciences de la Terre et de l’espace : roches et reliefs, météo et climat, eau et systèmes de la planète.",
  },
  "science-biology": {
    en: "The study of living things: cells, body systems, genetics, ecosystems and how living organisms interact.",
    fr: "L’étude du vivant : cellules, systèmes du corps, génétique, écosystèmes et interactions entre organismes.",
  },
  "science-physical": {
    en: "Basics of matter and energy: motion, forces, electricity, simple chemistry and scientific method.",
    fr: "Notions de base sur la matière et l’énergie : mouvement, forces, électricité, chimie simple et démarche scientifique.",
  },
  "social-world-history": {
    en: "A survey of major civilizations, events and ideas that shaped the world, and how to read historical sources.",
    fr: "Panorama des grandes civilisations, événements et idées qui ont façonné le monde, et lecture de sources historiques.",
  },
  "social-us-history": {
    en: "An overview of United States history, from early settlement to the modern era, and its main turning points.",
    fr: "Vue d’ensemble de l’histoire des États-Unis, des premiers établissements à l’époque moderne, et de ses grands tournants.",
  },
  "social-us-gov-econ": {
    en: "How the United States government is organised, the rights and duties of citizens, and basic economic ideas.",
    fr: "Organisation du gouvernement des États-Unis, droits et devoirs des citoyens, et notions d’économie de base.",
  },
  "health-nutrition": {
    en: "Healthy living: nutrition, physical activity, sleep, wellbeing and making informed choices about your health.",
    fr: "Vie saine : nutrition, activité physique, sommeil, bien-être et choix éclairés pour sa santé.",
  },
};

const ELECTIVE: Record<string, Desc> = {
  "business-math": {
    en: "Practical mathematics for business: pricing, profit, wages, taxes and simple record keeping.",
    fr: "Mathématiques pratiques pour les affaires : prix, bénéfices, salaires, taxes et tenue de comptes simple.",
  },
  "word-excel": {
    en: "Hands-on skills with word processing and spreadsheets: formatting documents, formulas, tables and charts.",
    fr: "Compétences pratiques en traitement de texte et tableurs : mise en forme, formules, tableaux et graphiques.",
  },
  "english-communications": {
    en: "Clear communication in English for school and work: writing emails and reports, speaking and presenting.",
    fr: "Communication claire en anglais pour l’école et le travail : courriels, rapports, expression orale et présentations.",
  },
  "art-appreciation": {
    en: "An introduction to looking at and talking about art across periods and cultures.",
    fr: "Introduction à l’observation et à la discussion de l’art à travers les époques et les cultures.",
  },
  economics: {
    en: "Basic economic ideas: supply and demand, markets, money and how choices are made with limited resources.",
    fr: "Notions d’économie : offre et demande, marchés, monnaie et choix faits avec des ressources limitées.",
  },
  "human-relations": {
    en: "Skills for working and living with others: communication, teamwork, conflict resolution and respect.",
    fr: "Compétences pour vivre et travailler avec les autres : communication, travail d’équipe, gestion des conflits et respect.",
  },
  "reading-skills": {
    en: "Strategies to read faster and understand more: main ideas, vocabulary in context and note taking.",
    fr: "Stratégies pour lire plus efficacement et mieux comprendre : idées principales, vocabulaire en contexte et prise de notes.",
  },
};

/** Returns a neutral description for a course key, or null when none is known. */
export function courseDescription(courseKey: string, language: "en" | "fr"): string | null {
  const core = CORE[courseKey];
  if (core) return core[language];
  const m = /^(?:demo|contract)-elective-(.+)$/.exec(courseKey);
  const el = m ? ELECTIVE[m[1]] : undefined;
  return el ? el[language] : null;
}

export const HS_DESCRIBED_COURSE_KEYS = [
  ...Object.keys(CORE),
  ...["business-math", "word-excel", "english-communications", "art-appreciation", "economics"].map((k) => `demo-elective-${k}`),
  ...["word-excel", "business-math", "english-communications", "human-relations", "reading-skills"].map((k) => `contract-elective-${k}`),
];
