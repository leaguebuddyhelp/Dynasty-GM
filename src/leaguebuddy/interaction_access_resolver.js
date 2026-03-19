import { INTERACTION_ACCESS_RULES, INTERACTION_TYPES } from './interaction_access_registry.js';

export function getInteractionType(interaction) {
  if (!interaction) return null;
  if (typeof interaction.isButton === 'function' && interaction.isButton()) return INTERACTION_TYPES.button;
  if (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()) return INTERACTION_TYPES.stringSelect;
  if (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) return INTERACTION_TYPES.modal;
  return null;
}

function matchesRule(rule, customId, interaction) {
  if (!rule?.match || !customId) return false;
  if (rule.match instanceof RegExp) return rule.match.test(customId);
  if (typeof rule.match === 'function') return rule.match(interaction, customId) === true;
  return false;
}

export function resolveInteractionAccess(interaction) {
  const customId = String(interaction?.customId || '');
  if (!interaction?.guildId || !customId) return null;

  const interactionType = getInteractionType(interaction);
  for (const rule of INTERACTION_ACCESS_RULES) {
    if (Array.isArray(rule.interactionTypes) && (!interactionType || !rule.interactionTypes.includes(interactionType))) {
      continue;
    }
    if (!matchesRule(rule, customId, interaction)) continue;
    return {
      featureKey: rule.featureKey,
      ruleId: rule.id,
      customId,
    };
  }

  return null;
}

export default {
  getInteractionType,
  resolveInteractionAccess,
};
