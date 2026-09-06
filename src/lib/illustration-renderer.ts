import { illustrationPathData, playerSpritePlacement, snapPointToPlayerGuide, RINK_ASSET, type IllustrationScene } from './illustration-geometry.ts';

export const escapeMarkup = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Shared public and draft rendering. No editor handles, grid or selection state. */
export function illustrationMarkup(scene: IllustrationScene, id: string, thumbnail = false): string {
  const prefix = escapeMarkup(id);
  const paths = scene.paths.map(path => {
    const width = thumbnail ? (path.kind === 'shot' ? 2.25 : 2) : (path.kind === 'shot' ? 8 : 7);
    return `<path d="${illustrationPathData(path.points, path.curve)}" fill="none" stroke="${path.kind === 'move' ? '#0e2a57' : '#0a9f2f'}" stroke-width="${width}" ${path.kind === 'move' ? 'stroke-dasharray="8 6"' : ''} stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${prefix}-arrow)" vector-effect="non-scaling-stroke" data-illustration-step="${path.step}" />`;
  }).join('');
  const players = scene.players.map(player => {
    const p = playerSpritePlacement(player);
    const position = snapPointToPlayerGuide(player.position, player.role);
    return `<g transform="translate(${position[0]} ${position[1]}) rotate(${player.rotation})" data-illustration-player="${escapeMarkup(player.id)}" filter="url(#${prefix}-player-shadow)"><image href="${p.asset}" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" preserveAspectRatio="xMidYMid meet" /></g>`;
  }).join('');
  const labels = scene.paths.map(path => `<g data-illustration-step="${path.step}"><circle cx="${path.label[0]}" cy="${path.label[1]}" r="11" fill="#101820" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" /><text x="${path.label[0]}" y="${path.label[1]}" fill="#fff" font-family="Geist, system-ui, sans-serif" font-size="14" font-weight="700" text-anchor="middle" dominant-baseline="central">${path.step}</text></g>`).join('');
  return `<defs><marker id="${prefix}-arrow" markerWidth="5" markerHeight="5" refX="4.2" refY="2.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 5 2.5 L 0 5 z" fill="context-stroke" /></marker><filter id="${prefix}-player-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#101820" flood-opacity="0.45" /></filter></defs><rect width="415" height="720" fill="#526f78" /><image href="${RINK_ASSET}" x="0" y="0" width="415" height="720" />${paths}${players}${labels}`;
}
