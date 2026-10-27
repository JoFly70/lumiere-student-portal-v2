/**
 * Personalized welcome banner (S21). Spread into en.ts / fr.ts. Keys are namespaced "welcome.*".
 * English is the source of truth; French (vouvoiement) must define every key.
 */
export const welcomeEn = {
  "welcome.first": "Welcome to Lumière, {name}! Your journey begins here.",
  "welcome.firstAnon": "Welcome to Lumière! Your journey begins here.",
  "welcome.returning": "Welcome back, {name}! Ready to tackle your next assignment?",
  "welcome.returningAnon": "Welcome back! Ready to tackle your next assignment?",
  "welcome.attention": "Welcome back, {name}! You have something awaiting your attention.",
  "welcome.attentionAnon": "Welcome back! You have something awaiting your attention.",
  "welcome.review": "See what is waiting",
  "welcome.dismiss": "Dismiss welcome message",
  "welcome.region": "Welcome",
} as const;

export const welcomeFr: Record<keyof typeof welcomeEn, string> = {
  "welcome.first": "Bienvenue chez Lumière, {name} ! Votre parcours commence ici.",
  "welcome.firstAnon": "Bienvenue chez Lumière ! Votre parcours commence ici.",
  "welcome.returning": "Bon retour, {name} ! Prêt(e) à vous attaquer à votre prochain devoir ?",
  "welcome.returningAnon": "Bon retour ! Prêt(e) à vous attaquer à votre prochain devoir ?",
  "welcome.attention": "Bon retour, {name} ! Quelque chose attend votre attention.",
  "welcome.attentionAnon": "Bon retour ! Quelque chose attend votre attention.",
  "welcome.review": "Voir ce qui vous attend",
  "welcome.dismiss": "Fermer le message de bienvenue",
  "welcome.region": "Bienvenue",
};
