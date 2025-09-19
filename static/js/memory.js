// static/js/memory.js
// Shared helpers for memory shard stat calculations across pages.
(function (global) {
  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function cloneBase(baseStats) {
    if (!baseStats || typeof baseStats !== 'object') {
      return { hp: 0, atk: 0, def: 0, spd: 0 };
    }
    return {
      hp: toNumber(baseStats.hp ?? baseStats.maxhp ?? 0),
      atk: toNumber(baseStats.atk ?? 0),
      def: toNumber(baseStats.def ?? 0),
      spd: toNumber(baseStats.spd ?? 0)
    };
  }

  function safeList(list) {
    return Array.isArray(list) ? list : [];
  }

  function formatPercent(value) {
    if (!Number.isFinite(value) || Math.abs(value) < 0.0005) {
      return null;
    }
    const scaled = value * 100;
    const abs = Math.abs(scaled);
    const decimals = abs >= 10 ? 1 : 2;
    return `${value >= 0 ? '+' : '-'}${abs.toFixed(decimals)}%`;
  }

  function formatFlat(value) {
    if (!Number.isFinite(value) || Math.abs(value) < 0.05) {
      return null;
    }
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < 0.05) {
      value = rounded;
    }
    return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
  }

  function summarizeEffects(effects) {
    if (!effects || typeof effects !== 'object') return '';
    const parts = [];
    const mapping = [
      ['hp_pct', 'HP', formatPercent],
      ['attack_pct', 'ATK', formatPercent],
      ['defense_pct', 'DEF', formatPercent],
      ['speed_pct', 'SPD', formatPercent],
      ['hp_flat', 'HP', formatFlat],
      ['attack_flat', 'ATK', formatFlat],
      ['defense_flat', 'DEF', formatFlat],
      ['speed_flat', 'SPD', formatFlat]
    ];
    mapping.forEach(([key, label, formatter]) => {
      const formatted = formatter(effects[key]);
      if (formatted) {
        parts.push(`${label} ${formatted}`);
      }
    });
    return parts.join(', ');
  }

  function applyConflicts(shard, context, perc, flat, warnings) {
    if (!shard || !Array.isArray(shard.conflicts)) return;
    shard.conflicts.forEach(conf => {
      if (!conf || !conf.tag) return;
      const count = context?.teamTags?.[conf.tag] || 0;
      if (count <= 0) return;
      const eff = conf.effects || {};
      if (Number.isFinite(eff.hp_pct)) perc.hp += eff.hp_pct;
      if (Number.isFinite(eff.attack_pct)) perc.atk += eff.attack_pct;
      if (Number.isFinite(eff.defense_pct)) perc.def += eff.defense_pct;
      if (Number.isFinite(eff.speed_pct)) perc.spd += eff.speed_pct;
      if (Number.isFinite(eff.hp_flat)) flat.hp += eff.hp_flat;
      if (Number.isFinite(eff.attack_flat)) flat.atk += eff.attack_flat;
      if (Number.isFinite(eff.defense_flat)) flat.def += eff.defense_flat;
      if (Number.isFinite(eff.speed_flat)) flat.spd += eff.speed_flat;
      if (conf.note) warnings.push(conf.note);
      else warnings.push(`${shard.title || 'Memory'} conflicts with ${conf.tag}`);
    });
  }

  function applyEffects(baseStats, shards, context) {
    const base = cloneBase(baseStats);
    const list = safeList(shards);
    const perc = { hp: 0, atk: 0, def: 0, spd: 0 };
    const flat = { hp: 0, atk: 0, def: 0, spd: 0 };
    const warnings = [];
    const contributions = [];

    list.forEach(shard => {
      if (!shard || typeof shard !== 'object') return;
      const eff = shard.effects || {};
      const summary = summarizeEffects(eff);
      if (Number.isFinite(eff.hp_pct)) perc.hp += eff.hp_pct;
      if (Number.isFinite(eff.attack_pct)) perc.atk += eff.attack_pct;
      if (Number.isFinite(eff.defense_pct)) perc.def += eff.defense_pct;
      if (Number.isFinite(eff.speed_pct)) perc.spd += eff.speed_pct;
      if (Number.isFinite(eff.hp_flat)) flat.hp += eff.hp_flat;
      if (Number.isFinite(eff.attack_flat)) flat.atk += eff.attack_flat;
      if (Number.isFinite(eff.defense_flat)) flat.def += eff.defense_flat;
      if (Number.isFinite(eff.speed_flat)) flat.spd += eff.speed_flat;
      contributions.push({ shard, summary });
      applyConflicts(shard, context, perc, flat, warnings);
    });

    const finalStats = {
      hp: Math.max(1, Math.round(base.hp * (1 + perc.hp) + flat.hp)),
      atk: Math.max(1, Math.round(base.atk * (1 + perc.atk) + flat.atk)),
      def: Math.max(1, Math.round(base.def * (1 + perc.def) + flat.def)),
      spd: Math.max(1, Math.round(base.spd * (1 + perc.spd) + flat.spd))
    };

    const summaryParts = [];
    const deltaMapping = [
      ['HP', perc.hp, flat.hp],
      ['ATK', perc.atk, flat.atk],
      ['DEF', perc.def, flat.def],
      ['SPD', perc.spd, flat.spd]
    ];
    deltaMapping.forEach(([label, pct, fl]) => {
      const pctStr = formatPercent(pct);
      const flatStr = formatFlat(fl);
      if (pctStr || flatStr) {
        const pieces = [];
        if (pctStr) pieces.push(pctStr);
        if (flatStr) pieces.push(flatStr);
        summaryParts.push(`${label} ${pieces.join(' & ')}`);
      }
    });

    return {
      stats: finalStats,
      summary: summaryParts.join(' • '),
      warnings,
      breakdown: {
        hp: { base: base.hp, pct: perc.hp, flat: flat.hp },
        atk: { base: base.atk, pct: perc.atk, flat: flat.atk },
        def: { base: base.def, pct: perc.def, flat: flat.def },
        spd: { base: base.spd, pct: perc.spd, flat: flat.spd }
      },
      contributions
    };
  }

  function collectTags(shards) {
    const counts = {};
    safeList(shards).forEach(shard => {
      (shard?.tags || []).forEach(tag => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return counts;
  }

  function tagsForLoadouts(loadouts, excludeIndex) {
    const counts = {};
    if (!Array.isArray(loadouts)) return counts;
    loadouts.forEach((list, idx) => {
      if (typeof excludeIndex === 'number' && idx === excludeIndex) return;
      safeList(list).forEach(shard => {
        (shard?.tags || []).forEach(tag => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      });
    });
    return counts;
  }

  global.SWCA_Memory = {
    applyEffects,
    summarizeEffects,
    formatPercent,
    collectTags,
    tagsForLoadouts
  };
})(typeof window !== 'undefined' ? window : globalThis);
