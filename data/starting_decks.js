// Confirmed from sts2.untapped.gg character pages ("...starts with a simple deck of 5 Strikes,
// 4 Defends, and only one unique card, Bash" for Ironclad) and cross-checked against the Basic-rarity
// cards scraped per class (each non-Ironclad class has exactly 2 unique 1-of basics alongside Strike/Defend).
const STARTING_DECKS = {
  Ironclad: [
    { slug: "strike-ironclad", count: 5 },
    { slug: "defend-ironclad", count: 4 },
    { slug: "bash", count: 1 },
  ],
  Silent: [
    { slug: "strike-silent", count: 4 },
    { slug: "defend-silent", count: 4 },
    { slug: "neutralize", count: 1 },
    { slug: "survivor", count: 1 },
  ],
  Regent: [
    { slug: "strike-regent", count: 4 },
    { slug: "defend-regent", count: 4 },
    { slug: "falling-star", count: 1 },
    { slug: "venerate", count: 1 },
  ],
  Necrobinder: [
    { slug: "strike-necrobinder", count: 4 },
    { slug: "defend-necrobinder", count: 4 },
    { slug: "bodyguard", count: 1 },
    { slug: "unleash", count: 1 },
  ],
  Defect: [
    { slug: "strike-defect", count: 4 },
    { slug: "defend-defect", count: 4 },
    { slug: "zap", count: 1 },
    { slug: "dualcast", count: 1 },
  ],
};
