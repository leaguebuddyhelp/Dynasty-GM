import { positionThreadKey } from './position_reports.js';

const core = {
  QB: ['Throw Accuracy Short', 'Throw Accuracy Mid', 'Throw Accuracy Deep', 'Play Action', 'Throw on Run'],
  HB: ['Ball Carrier Vision', 'Break Tackle', 'Carrying', 'Catching', 'Trucking'],
  FB: ['Run Blocking', 'Lead Blocking', 'Impact Blocking', 'Catching'],
  WR: ['Short Route Running', 'Medium Route Running', 'Deep Route Running', 'Catching', 'Spectacular Catch'],
  TE: ['Catching', 'Short Route Running', 'Medium Route Running', 'Run Blocking'],
  LEDG: ['Finesse Moves', 'Power Moves', 'Block Shedding', 'Tackling'],
  REDG: ['Finesse Moves', 'Power Moves', 'Block Shedding', 'Tackling'],
  DT: ['Block Shedding', 'Power Moves', 'Finesse Moves', 'Tackling'],
  SAM: ['Block Shedding', 'Tackling', 'Zone Coverage', 'Power Moves', 'Finesse Moves'],
  MIKE: ['Tackling', 'Play Recognition', 'Zone Coverage', 'Pursuit'],
  WILL: ['Tackling', 'Zone Coverage', 'Play Recognition', 'Pursuit'],
  CB: ['Man Coverage', 'Zone Coverage', 'Play Recognition', 'Press', 'Tackling'],
  FS: ['Zone Coverage', 'Play Recognition', 'Man Coverage', 'Tackling'],
  SS: ['Tackling', 'Zone Coverage', 'Play Recognition', 'Man Coverage'],
};
const line = ['Pass Blocking', 'Run Blocking', 'Pass Block Power', 'Run Block Power', 'Pass Block Finesse', 'Run Block Finesse'];
export function concentrateSeasonEvidence(evidence, position, maximum = 3) {
  const key = positionThreadKey(position);
  const priorities = core[key] || (['LT', 'LG', 'C', 'RG', 'RT'].includes(key) ? line : []);
  const rank = (a) => { const index = priorities.indexOf(a.attribute); return index < 0 ? 100 : index; };
  return [...evidence].sort((a, b) => rank(a) - rank(b) || (b.evidenceRatio || 0) - (a.evidenceRatio || 0)).slice(0, maximum);
}
export function seasonImpact({ policy, position, direction, games, seasonScore, currentScore, supportedDecline, young, totals = {}, completeEvidence = true }) {
  if (!policy || games < policy.minimumGames || ['K', 'P'].includes(positionThreadKey(position))) return null;
  const key = positionThreadKey(position);
  if (!completeEvidence || (key === 'QB' && Number(totals.passAtt || 0) < policy.minimumQbAttempts)
    || (key === 'HB' && Number(totals.rushAtt || 0) + Number(totals.recCatches || 0) < policy.minimumRbTouches)
    || (['WR', 'TE'].includes(key) && Number(totals.recCatches || 0) < policy.minimumReceivingCatches)) return null;
  const qualifies = direction === 'upgrade'
    ? seasonScore >= policy.minimumStrongSeasonScore && currentScore >= policy.minimumStrongCurrentScore
    : supportedDecline || (seasonScore <= policy.maximumPoorSeasonScore && currentScore <= policy.maximumPoorCurrentScore);
  return qualifies ? { extraPoints: policy.extraCorePoints + (direction === 'upgrade' && young ? policy.youngExtraCorePoints : 0),
    coreAttributes: policy.coreAttributes, direction, games } : null;
}
