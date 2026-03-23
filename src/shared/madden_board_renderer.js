import sharp from 'sharp';
import { getLeagueBuddyBrandAsset, getNflTeamLogoAsset } from './madden_assets.js';

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value = '', max = 48) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function normalizeColumns(columns = []) {
  return (Array.isArray(columns) ? columns : [])
    .map((column) => ({
      title: String(column?.title || '').trim(),
      items: Array.isArray(column?.items) ? column.items : [],
    }))
    .filter((column) => column.items.length > 0 || column.title);
}

function itemHeight(item) {
  if (item?.type === 'section') return 38;
  const meta = String(item?.meta || '').trim();
  return meta ? 76 : 58;
}

function columnHeight(column) {
  return 72 + column.items.reduce((sum, item) => sum + itemHeight(item), 0) + 12;
}

export async function renderLeagueBoardImage({
  title,
  subtitle = '',
  columns = [],
  attachmentName = 'league_board.png',
  accentColor = '#5865F2',
} = {}) {
  const normalizedColumns = normalizeColumns(columns);
  if (!normalizedColumns.length) return null;

  const columnCount = Math.max(1, normalizedColumns.length);
  const boardWidth = columnCount === 1 ? 920 : 1420;
  const outerPad = 28;
  const gutter = 22;
  const headerHeight = subtitle ? 116 : 96;
  const footerHeight = 24;
  const columnWidth = Math.floor((boardWidth - (outerPad * 2) - (gutter * (columnCount - 1))) / columnCount);
  const tallestColumn = Math.max(...normalizedColumns.map(columnHeight));
  const boardHeight = headerHeight + tallestColumn + footerHeight;

  const svg = [];
  const composites = [];

  svg.push(
    `<svg width="${boardWidth}" height="${boardHeight}" viewBox="0 0 ${boardWidth} ${boardHeight}" xmlns="http://www.w3.org/2000/svg">`,
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="#0F172A"/>',
    '<stop offset="100%" stop-color="#1E293B"/>',
    '</linearGradient>',
    '</defs>',
    `<rect x="0" y="0" width="${boardWidth}" height="${boardHeight}" rx="26" fill="url(#bg)"/>`,
    `<rect x="${outerPad}" y="${outerPad}" width="${boardWidth - (outerPad * 2)}" height="${boardHeight - (outerPad * 2)}" rx="22" fill="#111827" stroke="${accentColor}" stroke-opacity="0.22" />`,
    `<text x="${outerPad + 28}" y="${outerPad + 40}" fill="#F8FAFC" font-size="36" font-family="Arial, Helvetica, sans-serif" font-weight="700">${escapeXml(truncate(title, 70))}</text>`
  );

  if (subtitle) {
    svg.push(
      `<text x="${outerPad + 28}" y="${outerPad + 74}" fill="#CBD5E1" font-size="19" font-family="Arial, Helvetica, sans-serif" font-weight="500">${escapeXml(truncate(subtitle, 120))}</text>`
    );
  }

  for (let index = 0; index < normalizedColumns.length; index += 1) {
    const column = normalizedColumns[index];
    const colX = outerPad + (index * (columnWidth + gutter));
    const colY = outerPad + headerHeight - 10;
    let cursorY = colY + 58;

    svg.push(
      `<rect x="${colX}" y="${colY}" width="${columnWidth}" height="${columnHeight(column)}" rx="18" fill="#0B1220" stroke="#334155" stroke-opacity="0.65"/>`,
      `<text x="${colX + 22}" y="${colY + 36}" fill="#E2E8F0" font-size="25" font-family="Arial, Helvetica, sans-serif" font-weight="700">${escapeXml(truncate(column.title || 'Board', 30))}</text>`
    );

    for (const item of column.items) {
      if (item?.type === 'section') {
        cursorY += 6;
        svg.push(
          `<text x="${colX + 22}" y="${cursorY + 18}" fill="#93C5FD" font-size="16" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="0.6">${escapeXml(truncate(String(item.title || '').toUpperCase(), 38))}</text>`,
          `<line x1="${colX + 22}" y1="${cursorY + 28}" x2="${colX + columnWidth - 22}" y2="${cursorY + 28}" stroke="#1E40AF" stroke-opacity="0.55" />`
        );
        cursorY += 32;
        continue;
      }

      const rowHeight = itemHeight(item);
      const rowY = cursorY;
      const logoX = colX + 18;
      const logoY = rowY + 12;
      const textX = colX + 64;
      const meta = truncate(item?.meta || '', 44);
      const label = truncate(item?.label || '', 32);

      svg.push(
        `<rect x="${colX + 12}" y="${rowY}" width="${columnWidth - 24}" height="${rowHeight - 6}" rx="14" fill="#172033"/>`,
        `<text x="${textX}" y="${rowY + 30}" fill="#F8FAFC" font-size="22" font-family="Arial, Helvetica, sans-serif" font-weight="700">${escapeXml(label)}</text>`
      );

      if (meta) {
        svg.push(
          `<text x="${textX}" y="${rowY + 56}" fill="#D7E0EE" font-size="16" font-family="Arial, Helvetica, sans-serif" font-weight="500">${escapeXml(meta)}</text>`
        );
      }

      const logoAsset = getNflTeamLogoAsset(item?.teamLike || item?.label, `board_logo_${index}_${cursorY}.png`);
      if (logoAsset?.attachment) {
        const logoBuffer = await sharp(logoAsset.attachment)
          .resize({ width: 34, height: 34, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        composites.push({ input: logoBuffer, left: logoX, top: logoY });
      }

      cursorY += rowHeight;
    }
  }

  svg.push('</svg>');

  const image = await sharp(Buffer.from(svg.join('')))
    .composite(await (async () => {
      const withTeams = [...composites];
      const brandAsset = getLeagueBuddyBrandAsset({ attachmentName: 'league_board_brand.png' });
      if (brandAsset?.attachment) {
        try {
          const logoBuffer = await sharp(brandAsset.attachment)
            .resize({ width: 92, height: 92, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          withTeams.push({
            input: logoBuffer,
            left: boardWidth - outerPad - 118,
            top: outerPad + 8,
          });
        } catch {
          // Ignore brand image failures so board rendering still succeeds.
        }
      }
      return withTeams;
    })())
    .png()
    .toBuffer();

  return { attachment: image, name: attachmentName };
}

export default {
  renderLeagueBoardImage,
};
