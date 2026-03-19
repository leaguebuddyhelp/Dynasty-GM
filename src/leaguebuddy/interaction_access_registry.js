export const INTERACTION_TYPES = {
  button: 'button',
  stringSelect: 'stringSelect',
  modal: 'modal',
};

export const INTERACTION_ACCESS_RULES = [
  {
    id: 'sportsbook.core',
    featureKey: 'sportsbook',
    description: 'Madden sportsbook card, wager, and bet flows',
    match: /^madden_sportsbook_/,
  },
  {
    id: 'scouting.myscouts',
    featureKey: 'scouting_draft',
    description: 'MyScouts buttons, pages, moves, and slot submissions',
    match: /^madden_myscouts_/,
  },
  {
    id: 'scouting.bigboard',
    featureKey: 'scouting_draft',
    description: 'Big board buttons and selects',
    match: /^(madden_bigboard_|bigboard_select)/,
  },
  {
    id: 'scouting.mockdraft',
    featureKey: 'scouting_draft',
    description: 'Mock draft live controls and pick search results',
    match: /^madden_mockdraft/,
  },
  {
    id: 'scouting.merge',
    featureKey: 'scouting_draft',
    description: 'Merge draft confirmation flows',
    match: /^mergedraft_/,
  },
  {
    id: 'scouting.scout-select',
    featureKey: 'scouting_draft',
    description: 'Legacy scout select steps',
    match: /^scout_select_/,
  },
  {
    id: 'trades.madden-trade',
    featureKey: 'trades_basic',
    description: 'Madden trade family',
    match: /^madden_trade_/,
  },
  {
    id: 'trades.mtrade',
    featureKey: 'trades_basic',
    description: 'Compact Madden trade family',
    match: /^mtrade_/,
  },
  {
    id: 'trades.trade-builder',
    featureKey: 'trades_basic',
    description: 'Trade builder start, team selection, asset add/reset, and modals',
    match: /^trade_builder_/,
  },
  {
    id: 'trades.trade-for',
    featureKey: 'trades_basic',
    description: 'Trade-for button family',
    match: /^(trade_for|madden_trade_for)/,
  },
  {
    id: 'trades.preview-submit',
    featureKey: 'trades_basic',
    description: 'Trade preview submit buttons',
    match: /^(trade_preview_submit|madden_trade_preview_submit\|)/,
  },
  {
    id: 'trades.select-menus',
    featureKey: 'trades_basic',
    interactionTypes: [INTERACTION_TYPES.stringSelect],
    description: 'Legacy trade select menus',
    match: /^trade_select_/,
  },
  {
    id: 'trades.modal-submit',
    featureKey: 'trades_basic',
    interactionTypes: [INTERACTION_TYPES.modal],
    description: 'Legacy trade modal submit',
    match: /^trade_modal_submit$/,
  },
  {
    id: 'trades.committee',
    featureKey: 'trades_basic',
    interactionTypes: [INTERACTION_TYPES.button],
    description: 'Legacy committee vote buttons',
    match: /^committee_(approve|deny)_/,
  },
  {
    id: 'trades.dm-response',
    featureKey: 'trades_basic',
    interactionTypes: [INTERACTION_TYPES.button],
    description: 'Legacy trade DM approval/denial buttons',
    match: /^trade_dm_(approve|deny)_/,
  },
  {
    id: 'recognition.content-review',
    featureKey: 'recognition',
    interactionTypes: [INTERACTION_TYPES.button],
    description: 'Recognition content review approvals and denials',
    match: /^madden_content_review\|/,
  },
  {
    id: 'recognition.franchisehub',
    featureKey: 'recognition',
    interactionTypes: [INTERACTION_TYPES.button],
    description: 'Franchise Hub recognition spend and perk activation flow',
    match: /^madden_franchisehub_(spend|buy|confirm|cancel|pick)\|/,
  },
];

export default INTERACTION_ACCESS_RULES;
