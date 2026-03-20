import fs from 'fs';
import path from 'path';
import { getFullTeamName } from './madden_team_names.js';

const ASSET_ROOT = path.join(process.cwd(), 'nfl_logos');
const TEAM_LOGO_DIR = path.join(ASSET_ROOT, 'team logos');
const DEV_LOGO_DIR = path.join(ASSET_ROOT, 'dev logos');

const TEAM_CODE_ALIASES = {
  ari: ['ari', 'az', 'arizona', 'cardinals', 'arizonacardinals'],
  atl: ['atl', 'atlanta', 'falcons', 'atlantafalcons'],
  bal: ['bal', 'baltimore', 'ravens', 'baltimoreravens'],
  buf: ['buf', 'buffalo', 'bills', 'buffalobills'],
  car: ['car', 'carolina', 'panthers', 'carolinapanthers'],
  chi: ['chi', 'chicago', 'bears', 'chicagobears'],
  cin: ['cin', 'cincinnati', 'bengals', 'cincinnatibengals'],
  cle: ['cle', 'cleveland', 'browns', 'clevelandbrowns'],
  dal: ['dal', 'dallas', 'cowboys', 'dallascowboys'],
  den: ['den', 'denver', 'broncos', 'denverbroncos'],
  det: ['det', 'detroit', 'lions', 'detroitlions'],
  gb: ['gb', 'greenbay', 'packers', 'greenbaypackers'],
  hou: ['hou', 'houston', 'texans', 'houstontexans'],
  ind: ['ind', 'indianapolis', 'colts', 'indianapoliscolts'],
  jax: ['jax', 'jac', 'jacksonville', 'jaguars', 'jacksonvillejaguars'],
  kc: ['kc', 'kansascity', 'chiefs', 'kansascitychiefs'],
  lac: ['lac', 'losangeleschargers', 'chargers', 'lachargers'],
  lar: ['lar', 'losangelesrams', 'rams', 'larams'],
  lv: ['lv', 'lasvegas', 'raiders', 'lasvegasraiders', 'oaklandraiders'],
  mia: ['mia', 'miami', 'dolphins', 'miamidolphins', 'phins', 'fins'],
  min: ['min', 'minnesota', 'vikings', 'minnesotavikings', 'vikes'],
  ne: ['ne', 'newengland', 'patriots', 'newenglandpatriots', 'pats'],
  no: ['no', 'neworleans', 'saints', 'neworleanssaints'],
  nyg: ['nyg', 'giants', 'newyorkgiants', 'gmen'],
  nyj: ['nyj', 'jets', 'newyorkjets'],
  phi: ['phi', 'philadelphia', 'eagles', 'philadelphiaeagles'],
  pit: ['pit', 'pittsburgh', 'steelers', 'pittsburghsteelers'],
  sea: ['sea', 'seattle', 'seahawks', 'seattleseahawks'],
  sf: ['sf', 'sanfrancisco', '49ers', 'niners', 'sanfrancisco49ers'],
  tb: ['tb', 'tampa', 'tampabay', 'buccaneers', 'bucs', 'tampabaybuccaneers'],
  ten: ['ten', 'tennessee', 'titans', 'tennesseetitans'],
  was: ['was', 'washington', 'commanders', 'washingtoncommanders'],
};

const DEV_ASSETS = {
  0: 'normal_dev.png',
  1: 'Star Dev.png',
  2: 'Superstar.webp',
  3: 'Superstar X-Factor.png',
  hidden: 'Hidden.png',
};

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fileAsset(filePath, attachmentName) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return { attachment: filePath, name: attachmentName || path.basename(filePath) };
}

function buildTeamLookup() {
  const lookup = new Map();
  for (const [code, keys] of Object.entries(TEAM_CODE_ALIASES)) {
    keys.forEach((key) => lookup.set(normalizeKey(key), code));
  }
  return lookup;
}

const TEAM_LOOKUP = buildTeamLookup();

function inferTeamCode(teamLike) {
  if (!teamLike) return null;
  if (typeof teamLike === 'string') {
    return TEAM_LOOKUP.get(normalizeKey(teamLike)) || null;
  }

  const candidates = [
    teamLike?.abbrName,
    teamLike?.teamAbbr,
    getFullTeamName(teamLike, ''),
    teamLike?.displayName,
    teamLike?.nickName,
    teamLike?.cityName,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const direct = TEAM_LOOKUP.get(normalizeKey(candidate));
    if (direct) return direct;
  }
  return null;
}

export function getNflTeamLogoAsset(teamLike, attachmentName = null) {
  const code = inferTeamCode(teamLike);
  if (!code) return null;
  const file = path.join(TEAM_LOGO_DIR, `${code}.png`);
  return fileAsset(file, attachmentName || `${code}.png`);
}

export function getNflBrandAsset({ animated = false, attachmentName = null } = {}) {
  const file = path.join(DEV_LOGO_DIR, animated ? 'nfl.gif' : 'nfl.png');
  return fileAsset(file, attachmentName || (animated ? 'nfl.gif' : 'nfl.png'));
}

export function getDevTraitAsset(devTrait, attachmentName = null) {
  const key = Number.isFinite(Number(devTrait)) ? Number(devTrait) : 'hidden';
  const fileName = DEV_ASSETS[key] || DEV_ASSETS.hidden;
  return fileAsset(path.join(DEV_LOGO_DIR, fileName), attachmentName || fileName.replace(/\s+/g, '_'));
}

function upsertAttachment(files, asset) {
  if (!asset) return files;
  const list = Array.isArray(files) ? [...files] : [];
  if (!list.some((entry) => entry?.name === asset.name)) {
    list.push({ attachment: asset.attachment, name: asset.name });
  }
  return list;
}

export function applyEmbedThumbnailFromAsset(embed, files, asset) {
  if (!asset) return files || [];
  const next = upsertAttachment(files, asset);
  embed.setThumbnail(`attachment://${asset.name}`);
  return next;
}

export function applyEmbedImageFromAsset(embed, files, asset) {
  if (!asset) return files || [];
  const next = upsertAttachment(files, asset);
  embed.setImage(`attachment://${asset.name}`);
  return next;
}
