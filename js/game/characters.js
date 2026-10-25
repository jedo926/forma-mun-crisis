/* FORMA MUN · Crisis Division — Character models (default fighters, silhouettes, released roster)
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { CONFIG, pad, arr, str, safeUrl, on, Release } = F;

  /* ---------------- Character models ---------------- */
  // Two always-unlocked default fighters: the committee chairs (public info).
  const DEFAULT_CHARS = [
    { key: 'chair-tamer', id: 'tamer', isDefault: true, name: 'Tamer Chahine', role: 'Chair', affiliation: 'Crisis Division',
      special: { name: 'GAVEL SLAM', type: 'wave', color: '#00F5FF' },
      look: { skin: '#d39a74', hair: { style: 'curly', color: '#2a1a12' }, facial: 'stubble', outfit: { type: 'tshirt', jacket: '#141418', pants: '#33405e', shoes: 'sneaker' } } },
    { key: 'chair-mutasim', id: 'mutasim', isDefault: true, name: 'Mutasim Assidmi', role: 'Co-Chair', affiliation: 'Crisis Division',
      special: { name: 'POINT OF ORDER', type: 'projectile', color: '#FF2BD6' },
      look: { skin: '#9c6a48', hair: { style: 'curly', color: '#17100e' }, outfit: { type: 'hoodie', jacket: '#1a1a22', pants: '#2c3a5a', shoes: 'sneaker' } } }
  ];
  // Generic silhouettes shown before release. They are NOT based on the real roster.
  const LOCKED_LOOKS = ['crew', 'slick', 'side_part', 'close', 'receding', 'mop', 'wavy', 'bald', 'tall', 'crew', 'slick', 'side_part'];
  function lockedRoster(n) {
    return Array.from({ length: n }, (_, i) => ({
      key: 'locked-' + i, id: 'entity-' + pad(i + 1), locked: true, look: { hair: { style: LOCKED_LOOKS[i % LOCKED_LOOKS.length] }, build: i % 5 === 3 ? 'heavy' : null },
      name: 'UNKNOWN ' + pad(i + 1), role: 'CLASSIFIED', affiliation: 'CLASSIFIED', faction: '', bio: ''
    }));
  }
  function lookFrom(c) {
    if (c.look && typeof c.look === 'object') return c.look;
    const sp = (c.sprite && typeof c.sprite === 'object') ? c.sprite : {}; // legacy sprite fields
    return { skin: sp.skin, hair: { style: sp.hairStyle, color: sp.hair }, glasses: sp.glasses ? 'wire' : null, outfit: { type: 'suit', jacket: sp.outfit, tie: sp.accent, pants: sp.pants } };
  }
  function releasedRoster(content) {
    return arr(content && content.characters).slice(0, 200).map((c, i) => {
      const id = str(c.id, 60).replace(/[^a-z0-9_-]/gi, '') || 'char-' + (i + 1);
      return {
        key: 'c-' + id + '-' + i, id, locked: false, look: lookFrom(c || {}),
        name: str(c.name, 80) || 'UNNAMED', role: str(c.role, 160), affiliation: str(c.affiliation, 160),
        faction: str(c.faction, 80), bio: c.bio, portrait: safeUrl(c.portrait),
        special: c.special === null ? null : (c.special && typeof c.special === 'object' ? c.special : undefined)
      };
    });
  }
  function currentRoster() {
    if (Release.status === 'released' && Release.content) {
      const r = releasedRoster(Release.content);
      if (r.length) return r;
    }
    return lockedRoster(CONFIG.lockedSlots);
  }
  function homeRoster() {
    const r = currentRoster();
    return DEFAULT_CHARS.concat(r[0] && r[0].locked ? r.slice(0, Math.max(0, CONFIG.lockedSlots - DEFAULT_CHARS.length)) : r);
  }

  Object.assign(F, { DEFAULT_CHARS, LOCKED_LOOKS, lockedRoster, lookFrom, releasedRoster, currentRoster, homeRoster });
})(window.FORMA = window.FORMA || {});
