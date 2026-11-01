/**
 * S32-A student repairs — new strings for the "hs" work stream (Flight Deck shell, first-login / error states,
 * server-label translations, program-aware deck wording). Spread into en.ts / fr.ts.
 * French uses vouvoiement and the typographic apostrophe.
 */
export const s32HsEn = {
  // F06 — progress page states (flight deck / roadmap shells)
  "s32.state.loadingAria": "Loading your academic progress",
  "s32.state.error.title": "We could not load your progress",
  "s32.state.error.body": "This is usually a brief connection problem. Your academic record has not been changed.",
  "s32.state.retry": "Try again",
  "s32.state.notReady.eyebrow": "Almost there",
  "s32.state.notReady.title": "Your Lumière plan is not ready yet",
  "s32.state.notReady.body": "Your account is ready. An advisor still needs to finish linking your student profile and academic plan before your progress can appear here. Contact Support if you need help.",
  "s32.state.notReady.cta": "Contact Support",
  "s32.state.notPublished.title": "Lumière is preparing your roadmap",
  "s32.state.notPublished.body": "Your advisor is building your personalised route to graduation. It will appear here as soon as it is published, and you do not need to do anything until then. Your starting point is already on record.",
  "s32.state.notPublished.foundation": "See your starting point on the Flight Deck",
  "s32.state.page.roadmap": "Your roadmap",
  "s32.state.page.flightDeck": "Your Flight Deck",

  // F08 — agreement deadlines rendered from their key (the server only sends English text)
  "s32.dl.label.language_test": "Language test",
  "s32.dl.label.prior_schooling_proof": "Proof of prior schooling",
  "s32.dl.rule.language_test.one": "1 day after signing",
  "s32.dl.rule.language_test.other": "{n} days after signing",
  "s32.dl.rule.prior_schooling_proof.one": "1 day after activation",
  "s32.dl.rule.prior_schooling_proof.other": "{n} days after activation",
  "s32.dl.score": "Score {score}",
  "s32.dl.scoreTarget": "Score {score} (target {target})",
  "s32.dl.target": "Target {target}",

  // F28 — plurals the deck used to print as "in 1 days"
  "s32.week.in.one": "in 1 day",
  "s32.week.in.other": "in {n} days",
  "s32.fi.stale.one": "No progress logged for 1 day. Log your work in your Roadmap to keep your pace accurate.",
  "s32.fi.stale.other": "No progress logged for {n} days. Log your work in your Roadmap to keep your pace accurate.",
  "s32.fi.aria.one": "Your journey from enrolment to the diploma, with 1 stop.",
  "s32.fi.aria.other": "Your journey from enrolment to the diploma, with {n} stops.",
  "s32.dg.aria.one": "Your journey from your starting point to your bachelor's degree, with 1 stop.",
  "s32.dg.aria.other": "Your journey from your starting point to your bachelor's degree, with {n} stops.",
  "s32.alert.support.access.one": "Your school access lasts up to 1 month.",
  "s32.alert.support.access.other": "Your school access lasts up to {n} months.",

  // F15 — behind the milestone, but confirmed + awaiting results would meet it
  "s32.fd.pill.pending": "On pace once pending results arrive",

  // F16 / F24 — degree (university) variants of the high-school deck wording
  "s32.dg.cp.readiness_check": "Graduation-readiness review",
  "s32.dg.cp.closing": "Closing: final transcript & degree",
  "s32.dg.pill.deadline.one": "1 deadline to watch",
  "s32.dg.pill.deadline.other": "{n} deadlines to watch",
  "s32.dg.alert.access.one": "Your university access lasts up to 1 month.",
  "s32.dg.alert.access.other": "Your university access lasts up to {n} months.",
  "s32.dg.radar.waiting.one": "1 course waiting for university results",
  "s32.dg.radar.waiting.other": "{n} courses waiting for university results",
  "s32.dg.next.text": "Planned by {date}. Finishing {course} adds {credit} once the university accepts it.",
  "s32.dg.next.textNoDate": "Finishing {course} adds {credit} once the university accepts it.",
  "s32.dg.footer": "Dates are targets, not guarantees. Only the university confirms credits and graduation eligibility.",

  // F17 — requirement shortfall beside "Still open"
  "s32.dg.shortfall.one": "{label}: 1 credit still needed",
  "s32.dg.shortfall.other": "{label}: {n} credits still needed",

} as const;

export const s32HsFr: Record<keyof typeof s32HsEn, string> = {
  "s32.state.loadingAria": "Chargement de votre progression scolaire",
  "s32.state.error.title": "Nous n’avons pas pu charger votre progression",
  "s32.state.error.body": "Il s’agit généralement d’un bref problème de connexion. Votre dossier scolaire n’a pas été modifié.",
  "s32.state.retry": "Réessayer",
  "s32.state.notReady.eyebrow": "Presque prêt",
  "s32.state.notReady.title": "Votre plan Lumière n’est pas encore prêt",
  "s32.state.notReady.body": "Votre compte est prêt. Un conseiller doit encore terminer de relier votre profil d’élève et votre plan scolaire avant que votre progression puisse s’afficher ici. Communiquez avec l’assistance si vous avez besoin d’aide.",
  "s32.state.notReady.cta": "Joindre l’assistance",
  "s32.state.notPublished.title": "Lumière prépare votre feuille de route",
  "s32.state.notPublished.body": "Votre conseiller construit votre parcours personnalisé vers la diplomation. Il apparaîtra ici dès sa publication, et vous n’avez rien à faire d’ici là. Votre point de départ est déjà au dossier.",
  "s32.state.notPublished.foundation": "Voir votre point de départ dans le tableau de bord",
  "s32.state.page.roadmap": "Votre feuille de route",
  "s32.state.page.flightDeck": "Votre tableau de bord",

  "s32.dl.label.language_test": "Test de langue",
  "s32.dl.label.prior_schooling_proof": "Preuve de scolarité antérieure",
  "s32.dl.rule.language_test.one": "1 jour après la signature",
  "s32.dl.rule.language_test.other": "{n} jours après la signature",
  "s32.dl.rule.prior_schooling_proof.one": "1 jour après l’activation",
  "s32.dl.rule.prior_schooling_proof.other": "{n} jours après l’activation",
  "s32.dl.score": "Résultat : {score}",
  "s32.dl.scoreTarget": "Résultat : {score} (cible : {target})",
  "s32.dl.target": "Cible : {target}",

  "s32.week.in.one": "dans 1 jour",
  "s32.week.in.other": "dans {n} jours",
  "s32.fi.stale.one": "Aucune progression notée depuis 1 jour. Notez votre travail dans votre feuille de route pour garder votre rythme à jour.",
  "s32.fi.stale.other": "Aucune progression notée depuis {n} jours. Notez votre travail dans votre feuille de route pour garder votre rythme à jour.",
  "s32.fi.aria.one": "Votre parcours de l’inscription au diplôme, avec 1 escale.",
  "s32.fi.aria.other": "Votre parcours de l’inscription au diplôme, avec {n} escales.",
  "s32.dg.aria.one": "Votre parcours, de votre point de départ à votre baccalauréat, avec 1 étape.",
  "s32.dg.aria.other": "Votre parcours, de votre point de départ à votre baccalauréat, avec {n} étapes.",
  "s32.alert.support.access.one": "Votre accès à l’école dure jusqu’à 1 mois.",
  "s32.alert.support.access.other": "Votre accès à l’école dure jusqu’à {n} mois.",

  "s32.fd.pill.pending": "Dans les temps une fois les résultats en attente reçus",

  "s32.dg.cp.readiness_check": "Bilan de préparation à la diplomation",
  "s32.dg.cp.closing": "Clôture : relevé final et diplôme de baccalauréat",
  "s32.dg.pill.deadline.one": "1 échéance à surveiller",
  "s32.dg.pill.deadline.other": "{n} échéances à surveiller",
  "s32.dg.alert.access.one": "Votre accès à l’université dure jusqu’à 1 mois.",
  "s32.dg.alert.access.other": "Votre accès à l’université dure jusqu’à {n} mois.",
  "s32.dg.radar.waiting.one": "1 cours en attente des résultats de l’université",
  "s32.dg.radar.waiting.other": "{n} cours en attente des résultats de l’université",
  "s32.dg.next.text": "Prévu pour le {date}. Terminer {course} ajoute {credit} une fois accepté par l’université.",
  "s32.dg.next.textNoDate": "Terminer {course} ajoute {credit} une fois accepté par l’université.",
  "s32.dg.footer": "Les dates sont des cibles, pas des garanties. Seule l’université confirme les crédits et l’admissibilité à la diplomation.",

  "s32.dg.shortfall.one": "{label} : encore 1 crédit requis",
  "s32.dg.shortfall.other": "{label} : encore {n} crédits requis",

};
