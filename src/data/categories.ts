/** French deck categories — the 20 TCF sets from the spelling bank, plus two extras. */
export interface Category {
  id: string;
  name: string;
  emoji: string;
  group: 'tcf' | 'extra' | 'grammar';
}

export const FR_CATEGORIES: Category[] = [
  { id: 'tcf-01', name: 'Messages and practical requests', emoji: '✉️', group: 'tcf' },
  { id: 'tcf-02', name: 'Housing and the neighbourhood', emoji: '🏠', group: 'tcf' },
  { id: 'tcf-03', name: 'Dates, time and travel plans', emoji: '🗓️', group: 'tcf' },
  { id: 'tcf-04', name: 'Studies and working life', emoji: '🎓', group: 'tcf' },
  { id: 'tcf-05', name: 'People, occasions and memories', emoji: '👥', group: 'tcf' },
  { id: 'tcf-06', name: 'Verbs for messages and requests', emoji: '💬', group: 'tcf' },
  { id: 'tcf-07', name: 'Core verbs you use everywhere', emoji: '🔧', group: 'tcf' },
  { id: 'tcf-08', name: 'Verbs for experiences and plans', emoji: '🧭', group: 'tcf' },
  { id: 'tcf-09', name: 'Verbs for opinions and solutions', emoji: '💡', group: 'tcf' },
  { id: 'tcf-10', name: 'Adjectives for practical descriptions', emoji: '📐', group: 'tcf' },
  { id: 'tcf-11', name: 'Adjectives for places and experiences', emoji: '🏞️', group: 'tcf' },
  { id: 'tcf-12', name: 'Adjectives for opinions and society', emoji: '⚖️', group: 'tcf' },
  { id: 'tcf-13', name: 'Connectors and useful adverbs', emoji: '🔗', group: 'tcf' },
  { id: 'tcf-14', name: 'Adverbs with tricky endings', emoji: '✨', group: 'tcf' },
  { id: 'tcf-15', name: 'Building an argument', emoji: '🗣️', group: 'tcf' },
  { id: 'tcf-16', name: 'Society, education and relationships', emoji: '🤝', group: 'tcf' },
  { id: 'tcf-17', name: 'Jobs, money and services', emoji: '💼', group: 'tcf' },
  { id: 'tcf-18', name: 'Environment, transport and the city', emoji: '🌍', group: 'tcf' },
  { id: 'tcf-19', name: 'Health, food and digital life', emoji: '🍎', group: 'tcf' },
  { id: 'tcf-20', name: 'Small words, frequent mistakes', emoji: '🔤', group: 'tcf' },
  { id: 'pieges', name: 'Spelling traps (dictée classics)', emoji: '🪤', group: 'extra' },
  { id: 'bonus', name: 'Frequent vocabulary (bonus)', emoji: '📚', group: 'extra' },
];

export const GRAMMAR_CATEGORIES: Category[] = [
  { id: 'gr-present', name: 'Présent', emoji: '🕐', group: 'grammar' },
  { id: 'gr-passe', name: 'Passé composé', emoji: '⏪', group: 'grammar' },
  { id: 'gr-imparfait', name: 'Imparfait', emoji: '🌫️', group: 'grammar' },
  { id: 'gr-pc-imparfait', name: 'Passé composé ou imparfait ?', emoji: '⚖️', group: 'grammar' },
  { id: 'gr-futur', name: 'Futur simple', emoji: '⏩', group: 'grammar' },
  { id: 'gr-conditionnel', name: 'Conditionnel', emoji: '🙏', group: 'grammar' },
  { id: 'gr-subjonctif', name: 'Subjonctif', emoji: '🎭', group: 'grammar' },
  { id: 'gr-imperatif', name: 'Impératif', emoji: '📣', group: 'grammar' },
  { id: 'gr-adjectifs', name: 'Accord des adjectifs', emoji: '👗', group: 'grammar' },
  { id: 'gr-participes', name: 'Accord du participe passé', emoji: '🧩', group: 'grammar' },
  { id: 'gr-pluriels', name: 'Pluriels', emoji: '👥', group: 'grammar' },
  { id: 'gr-determinants', name: 'Possessifs et démonstratifs', emoji: '🏷️', group: 'grammar' },
  { id: 'gr-prepositions', name: 'Prépositions (à, de, en, dans…)', emoji: '📍', group: 'grammar' },
  { id: 'gr-connecteurs', name: 'Connecteurs logiques', emoji: '🔗', group: 'grammar' },
  { id: 'gr-articles', name: 'Articles et partitifs', emoji: '🥖', group: 'grammar' },
  { id: 'gr-pronoms', name: 'Pronoms (y, en, lui, dont…)', emoji: '👉', group: 'grammar' },
];

export const ALL_FR = 'all';
export const ALL_GRAMMAR = 'grammar-all';
