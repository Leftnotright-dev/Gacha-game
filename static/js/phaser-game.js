// static/js/phaser-game.js
(() => {
  const W = window.innerWidth;
  const H = window.innerHeight;

  const STAGE_BG_URLS = (window.STAGE_BG_URLS || {});  // id -> url
  const STAGE_IDS = Object.keys(STAGE_BG_URLS).map(n => parseInt(n, 10));

  /* ================== RARITY / STAGE CONFIG ================== */

  const RARITY_COLOR = {
    Common: 0xb0c4de, Rare: 0x4aa3ff, Ultra: 0xb07aff,
    Mythical: 0xff7bd7, Secret: 0x222222, Celestial: 0xffd700
  };
  const RARITY_EMOJI = {
    Common:"⚪", Rare:"🔷", Ultra:"🟣", Mythical:"🟠", Secret:"🖤", Celestial:"🌟"
  };
  const BASE_STATS = {
    Common:{hp:240, atk:36, def:16, spd:90,  crit:0.05},
    Rare:{hp:300, atk:46, def:20, spd:100, crit:0.07},
    Ultra:{hp:360, atk:58, def:24, spd:110, crit:0.10},
    Mythical:{hp:420, atk:70, def:28, spd:115, crit:0.12},
    Secret:{hp:480, atk:84, def:32, spd:120, crit:0.14},
    Celestial:{hp:540, atk:100,def:36, spd:125, crit:0.15}
  };

  // Fine-grained enemy-only knobs per stage (HP/ATK multipliers).
  // Stages 6–10 add +40% HP and +25% ATK each stage (compounded).
  const STAGES = {
    1:{ name:"Training",           waves:2, enemyLevel:1.0, boss:false, enemyHpMul:1.00,       enemyAtkMul:1.00 },
    2:{ name:"Patrol",             waves:3, enemyLevel:1.8, boss:false, enemyHpMul:1.00,       enemyAtkMul:1.00 },
    3:{ name:"Stronghold",         waves:4, enemyLevel:2.2, boss:false, enemyHpMul:1.00,       enemyAtkMul:1.00 },
    4:{ name:"Hell Castle Gates",  waves:4, enemyLevel:3.0, boss:false, enemyHpMul:1.00,       enemyAtkMul:1.00 },
    5:{ name:"Demon Castle",       waves:5, enemyLevel:4.0, boss:true,  enemyHpMul:1.00,       enemyAtkMul:1.00 },

    6:{ name:"The Abyss",             waves:5, enemyLevel:4.2, boss:false, enemyHpMul:1.40,        enemyAtkMul:1.25        },
    7:{ name:"Abyssal Throne",        waves:5, enemyLevel:4.4, boss:false, enemyHpMul:1.96,        enemyAtkMul:1.5625      }, // 1.4^2, 1.25^2
    8:{ name:"Wraithspire Keep",      waves:5, enemyLevel:4.6, boss:false, enemyHpMul:2.744,       enemyAtkMul:1.953125    }, // 1.4^3, 1.25^3
    9:{ name:"Chrono Ruins",          waves:5, enemyLevel:4.8, boss:false, enemyHpMul:3.8416,      enemyAtkMul:2.44140625  }, // 1.4^4, 1.25^4
   10:{ name:"The End of All Things", waves:5, enemyLevel:5.0, boss:true,  enemyHpMul:5.37824,     enemyAtkMul:3.0517578125}  // 1.4^5, 1.25^5
  };

  /* ================== PER-UNIT SPECIALS ================== */
  const fx = {
    effDef: (t) => Math.round(t.def * (t._defDownMult ?? 1)),
    debuffOk: (t) => (!t.isBoss),
    addDefDown: (t, mult, turns) => {
      if (!fx.debuffOk(t)) return;
      t._defDownMult = Math.min(t._defDownMult ?? 1, mult);
      t._defDownTurns = Math.max(t._defDownTurns ?? 0, turns);
    },
    addSlow: (t, mult, turns) => {
      if (!fx.debuffOk(t)) return;
      t._spdDebuffs = t._spdDebuffs || [];
      t._spdDebuffs.push({ mult, turns });
    },
    addStun: (t, turns) => {
      if (!fx.debuffOk(t)) return;
      t._stunTurns = Math.max(t._stunTurns ?? 0, turns);
    },
    // Sleep == Stun (different label), cannot affect boss
    addSleep: (t, turns) => {
      if (!fx.debuffOk(t)) return;
      t._sleepTurns = Math.max(t._sleepTurns ?? 0, turns);
    },
    addBurn: (t, perTick, turns, label="Burn") => {
      if (!fx.debuffOk(t)) return;
      t._burns = t._burns || [];
      t._burns.push({ perTick, turns, label });
    },
    addBleed: (t, perTick, turns) => {
      if (!fx.debuffOk(t)) return;
      t._bleeds = t._bleeds || [];
      t._bleeds.push({ perTick, turns, label:"Bleed" });
    },
    addCorrupt: (t, turns) => {
      if (!fx.debuffOk(t)) return;
      t._corruptTurns = Math.max(t._corruptTurns ?? 0, turns);
    },
    addBuff: (self, listKey, mult, turns) => {
      self[listKey] = self[listKey] || [];
      self[listKey].push({ mult, turns });
    },
    healPct: (unit, pct) => {
      unit.hp = Math.min(unit.maxhp, unit.hp + Math.round(unit.maxhp * pct));
    },
    healFlat: (unit, amount) => {
      unit.hp = Math.min(unit.maxhp, unit.hp + Math.max(0, Math.round(amount)));
    },
    reviveToPct: (unit, pct, scene) => {
      unit.alive = true;
      unit.hp = Math.max(1, Math.round(unit.maxhp * pct));
      unit.rect.setAlpha(1);
      unit.nameText.setAlpha(1);
      unit.hpbar.bg.setAlpha(1);
      unit.hpbar.fg.setAlpha(1);
      unit.hpText.setAlpha(1);
      if (scene?.updateSkillButtons) scene.updateSkillButtons();
    },
    recalcStats: (scene, e) => scene.recomputeDerivedStats(e),
    lowestHpEnemy: (list) => list.filter(x=>x.alive).sort((a,b)=>a.hp-b.hp)[0],
    lowestHpAlly: (list) => list.filter(x=>x.alive).sort((a,b)=>a.hp/a.maxhp - b.hp/b.maxhp)[0],
  };

  // Registry (passives require Asc 1; actives already gated visually and in code)
  const UNIT_SPECIALS = {
    // Celestial
    "admin Zy": {
      name: "Gamma Burst",
      type: "active",
      cdType: "turns", cd: 6,
      use: (scene, self) => {
        const enemies = scene.entities.filter(e => e.alive && e.side !== self.side);
        enemies.forEach(target => {
          const effDef = fx.effDef(target);
          const raw = Math.max(5, self.atk * 2.2 - effDef * 0.6);
          const dmg = Math.round(raw);
          scene.resolveHit(self, target, dmg, { skill: "Gamma Burst" });
        });
        enemies.forEach(t => fx.addDefDown(t, 0.7, 3)); // -30% DEF
        fx.addBuff(self, "_atkBuffs", 1.25, 3);
        enemies.forEach(t => fx.addBurn(t, Math.round(self.atk * 0.05), 4, "Burn"));
        fx.recalcStats(scene, self);
      }
    },

    "Alex": {
      name: "Gluttony",
      type: "active",
      cdType: "waves", cd: 2,
      use: (scene, self) => {
        self._gluttonyWaves = 2;
        scene.toast("Gluttony activated for 2 waves!", "#ffd36b");
      }
    },

    "EyexDJ": {
      name: "Teleport",
      iconKey: "icon_teleport",
      type: "active",
      cdType: "turns", cd: 20,
      use: (scene, self) => {
        self._teleportCharges = 10;
        scene.toast("Teleport active: negate next 10 hits!", "#9d8cff");
      }
    },

    "Berri": {
      name: "Strawberry Jell-O",
      iconKey: "icon_strawberry_jello",
      type: "active",
      cdType: "turns", cd: 2,
      target: "enemy",
      useOn: (scene, self, target) => {
        // 150% damage
        const base = computeDamage(self, target);
        const dmg = Math.max(1, Math.round(base * 1.5));
        scene.resolveHit(self, target, dmg, { skill: "Strawberry Jell-O" });

        // Interactive choice
        scene.openChoice("Berri: choose an effect", [
          { id: "heal", label: "Heal self for 100% of damage" },
          { id: "buff", label: "Gain +50% of enemy ATK (stack)" }
        ], (choice) => {
          if (choice === "heal") {
            fx.healFlat(self, dmg);
            scene.toast(`Berri healed ${dmg} HP`, "#7ef7a0");
          } else if (choice === "buff") {
            const flat = 0.5 * (target.atk || 0);
            const mult = Math.max(0.1, (self.baseAtk + flat) / Math.max(1, self.baseAtk));
            fx.addBuff(self, "_atkBuffs", mult, 999);
            fx.recalcStats(scene, self);
            scene.toast(`Berri gained ATK +${Math.round(flat)} (stacks)`, "#ffd36b");
          }
          scene.finalizePendingSpecial();
        });
        return "pending";
      }
    },

    // Mythical
    "Zimmy": {
      name: "Ragebait",
      iconKey: "icon_ragebait",
      type: "active",
      cdType: "turns", cd: 10,
      use: (scene, self) => {
        self._provokeTurns = 6;
        self._dmgReduction = Math.max(self._dmgReduction ?? 1, 0.5);
        self._dmgRedTurns = 6;
        scene.toast("Zimmy is provoking the wave! -50% damage taken.", "#7ef7a0");

        const enemies = scene.entities.filter(e => e.alive && e.side !== self.side);
        enemies.forEach(t => {
          const splash = Math.max(1, Math.round(self.baseAtk * 0.25));
          scene.resolveHit(self, t, splash, { skill: "Ragebait AOE" });
        });
      }
    },
    "Deshun": {
      name: "Pay to Win",
      type: "active",
      cdType: "waves", cd: 1,
      use: (scene, self) => {
        const roll = Phaser.Math.Between(1,6);
        scene.log(`Deshun rolled a ${roll}!`);
        const enemies = scene.entities.filter(e=>e.alive && e.side!=="player");
        const allies = scene.entities.filter(e=>e.alive && e.side==="player");
        switch (roll) {
          case 6: enemies.forEach(t => fx.addStun(t, 6)); scene.toast("All enemies stunned (6T)", "#ffd36b"); break;
          case 5: fx.addBuff(self, "_atkBuffs", 1.25, 5); fx.recalcStats(scene, self); scene.toast("Deshun ATK +25% (5T)", "#7ef7a0"); break;
          case 4: enemies.forEach(t => fx.addDefDown(t, 0.7, 4)); scene.toast("Enemies DEF -30% (4T)", "#ffd36b"); break;
          case 3: fx.healPct(self, 0.30); scene.toast("Deshun healed 30% HP", "#7ef7a0"); break;
          case 2: self._invincibleTurns = Math.max(self._invincibleTurns ?? 0, 2); scene.toast("Deshun is invincible (2T)", "#7ef7a0"); break;
          case 1:
            enemies.forEach(t => {
              const effDef = fx.effDef(t);
              const raw = Math.max(5, self.atk * 1.0 - effDef * 0.6);
              const dmg = Math.round(raw);
              scene.resolveHit(self, t, dmg, { skill: "Pay to Win" });
            });
            break;
        }
      }
    },
    "Zafuu": {
      name: "Severe",
      type: "active",
      cdType: "waves", cd: 1,
      target: "enemy",
      useOn: (scene, self, target) => {
        if (!target || !target.alive) return;
        const effDef = fx.effDef(target);
        const raw = Math.max(5, self.atk * 3.0 - effDef * 0.6);
        const dmg = Math.round(raw);
        scene.resolveHit(self, target, dmg, { skill: "Severe" });
        fx.addCorrupt(target, 5);
        fx.addBleed(target, Math.round(self.atk * 0.05), 2);
      }
    },
    "Channon": {
      name: "Aura",
      type: "active",
      cdType: "turns", cd: 5,
      use: (scene, self) => {
        const allies = scene.entities.filter(e=>e.alive && e.side===self.side);
        const enemies = scene.entities.filter(e=>e.alive && e.side!==self.side);
        allies.forEach(a => fx.addBuff(a, "_atkBuffs", 1.25, 2));
        allies.forEach(a => fx.recalcStats(scene, a));
        enemies.forEach(t => fx.addDefDown(t, 0.7, 2));
        scene.toast("Aura: team ATK +25% (2T) & enemies DEF -30% (2T)", "#7ef7a0");
      }
    },

    // Secret
    "Ted": {
      name: "Vanish",
      type: "active",
      cdType: "turns", cd: 10,
      use: (scene, self) => {
        self._invincibleTurns = Math.max(self._invincibleTurns ?? 0, 5);
        self._vanishSlowActive = 5;
        scene.toast("Ted vanished (Invincible 5T). Attacks Slow enemies.", "#7ef7a0");
      }
    },

    // Ultra
    "Snorlax": {
      name: "Rest",
      type: "active",
      cdType: "waves", cd: 1,
      use: (scene, self) => {
        if (self.hp >= self.maxhp) {
          const allies = scene.entities.filter(e=>e.side===self.side);
          const target = fx.lowestHpAlly(allies);
          if (target) {
            fx.healFlat(target, self.baseMaxhp);
            scene.toast(`Snorlax: Rest → healed ${target.name}`, "#7ef7a0");
          }
        } else {
          self.hp = self.maxhp;
          scene.toast("Snorlax fully restored HP (Rest)!", "#7ef7a0");
        }
        const enemies = scene.entities.filter(e=>e.alive && e.side!==self.side);
        enemies.forEach(t => fx.addSleep(t, 10));
      }
    },
    "Zy": {
      name: "Shock",
      type: "active",
      cdType: "turns", cd: 20,
      target: "enemy",
      useOn: (scene, self, target) => {
        if (!target || !target.alive) return;
        fx.addStun(target, 3);
        scene.toast(`${target.name} stunned (3T)`, "#ffd36b");
      }
    },
    "Grinch": {
      name: "Something",
      type: "passive",
      cdType: "stage", cd: 1,
      onTick: (scene, self) => {
        if (self.ascension < 1) return;
        if (self._bloodthirstUsed) return;
        if (self.alive && self.hp <= 1 && !self._bloodthirstActive) {
          self._bloodthirstActive = true;
          self._bloodthirstUsed = true;
          self._btTurns = 10;
          self._cantDie = true;
          self._atkStacks = 0;
          scene.toast("Grinch entered Bloodthirsty!", "#ff9f43");
        }
        if (self._bloodthirstActive) {
          if (self._atkStacks < 8) {
            self._atkStacks++;
            fx.addBuff(self, "_atkBuffs", 1.25, 9999);
            fx.recalcStats(scene, self);
          }
        }
      },
      onDurationTick: (scene, self) => {
        if (self.ascension < 1) return;
        if (!self._bloodthirstActive) return;
        self._btTurns--;
        if (self._btTurns <= 0) {
          self._bloodthirstActive = false;
          self._cantDie = false;
          self._atkBuffs = [];
          fx.recalcStats(scene, self);
          fx.healPct(self, 0.30);
          scene.toast("Bloodthirsty ended. Grinch healed 30%.", "#7ef7a0");
        }
      }
    },
    "Fatima Do": {
      name: "Florish",
      type: "active",
      cdType: "turns", cd: 15,
      use: (scene, self) => {
        const allies = scene.entities.filter(e=>e.alive && e.side===self.side);
        allies.forEach(a => fx.healPct(a, 0.50));
        scene.toast("Florish: Team healed 50% HP", "#7ef7a0");
      }
    },
    "Boa": {
      name: "Life",
      type: "active",
      cdType: "stage", cd: 1,
      target: "ally-or-fallen",
      useOn: (scene, self, target) => {
        if (!target) return;
        if (!target.alive) {
          fx.reviveToPct(target, 0.50, scene);
          scene.playUnitAnim(target, 'revive');
          scene.toast(`${target.name} revived (50% HP)`, "#7ef7a0");
        } else {
          fx.healPct(target, 0.50);
          scene.toast(`${target.name} healed 50% HP`, "#7ef7a0");
        }
        fx.addBuff(target, "_atkBuffs", 2.0, 5);
        fx.recalcStats(scene, target);
      }
    },
  };

  function pickSkillForUnit(name) {
    return UNIT_SPECIALS[name] || null;
  }

  /* ================== HELPERS ================== */

  function hashCode(s){ let h=0; for(let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0; return h; }
  function pickSkill(name){ const keys=["Opening Burst","Piercing Shot","Guard Up","Adrenaline Rush"]; const i=Math.abs(hashCode(name))%keys.length; const k=keys[i]; return {name:k, cdLeft:0}; }

  // Growth-aware stats (level + ascension + shiny/celestial + enemy multiplier)
  function levelMult(level){ return 1 + 0.035 * Math.max(0, (level||1) - 1); }
  function ascMult(asc){ const T=[1,1.10,1.22,1.37,1.55,1.76]; return T[Math.min(asc||0,5)] || 1; }
  function buildStats(rarity, level=1, asc=0, shiny=false, celestial=false, enemyMul=1){
    const b = BASE_STATS[rarity] || BASE_STATS.Common;
    const sm = shiny ? 1.05 : 1;
    const cm = celestial ? 1.10 : 1;
    const mul = enemyMul * sm * cm * levelMult(level) * ascMult(asc);
    return {
      maxhp: Math.round(b.hp * mul), hp: Math.round(b.hp * mul),
      atk: Math.round(b.atk * mul),  def: Math.round(b.def * mul),
      spd: Math.round(b.spd * (shiny?1.02:1) * (celestial?1.02:1)),
      crit: Math.min(0.5, b.crit + (shiny?0.02:0) + (celestial?0.02:0))
    };
  }

  // Enemy-only per-stage knobs (HP/ATK only)
  function applyEnemyKnobs(stats, hpMul=1, atkMul=1){
    stats.maxhp = Math.round(stats.maxhp * hpMul);
    stats.hp    = stats.maxhp;
    stats.atk   = Math.round(stats.atk * atkMul);
    return stats;
  }

  function computeDamage(a, d){
    const defMult = d._defDownMult ?? 1;
    const effDef = Math.round(d.def * defMult);
    const base = Math.max(5, a.atk - effDef*0.6);
    const variance = Phaser.Math.Between(-3,3);
    let dmg = Math.max(1, Math.round(base + variance));
    if (Math.random() < a.crit) {
      dmg = Math.round(dmg * 1.75);
      a._lastCrit = true;
    } else {
      a._lastCrit = false;
    }
    return dmg;
  }

  function BootScene(){ Phaser.Scene.call(this,{key:"BootScene"}); }
  BootScene.prototype = Object.create(Phaser.Scene.prototype);
  BootScene.prototype.constructor = BootScene;

  BootScene.prototype.preload = function () {
    this.load.image("icon_ragebait", "/static/images/skills/ragebait.png");
    this.load.image("icon_strawberry_jello", "/static/images/skills/strawberry_jello.png");
    this.load.image("icon_teleport", "/static/images/skills/teleport.png");
    this.cameras.main.setBackgroundColor('#101629');
    STAGE_IDS.forEach(id => {
      this.load.image(`stage${id}`, STAGE_BG_URLS[id]);
    });
    this.load.on('complete', () => {
      this.registry.set('bgKeyById', this.loadedKeyById);
      this.scene.start('MainScene');
    });
  };

  function MainScene(){ Phaser.Scene.call(this,{key:"MainScene"}); }
  MainScene.prototype = Object.create(Phaser.Scene.prototype);
  MainScene.prototype.constructor = MainScene;

  // Simple UI helpers so scene methods never crash
  MainScene.prototype.toast = function (msg, color) {
    const el = document.getElementById('toast');
    if (!el) { console.log('[TOAST]', msg); return; }
    el.textContent = msg;
    if (color) el.style.borderColor = color;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 1300);
  };

  MainScene.prototype.log = function (line) {
    if (this.logBox) {
      this.logBox.value += line + '\\n';
      this.logBox.scrollTop = this.logBox.scrollHeight;
    } else {
      console.log(line);
    }
  };

  const config = { type:Phaser.AUTO, parent:"game-container", width:W, height:H, backgroundColor:"#0e1320",
    physics:{ default:"arcade", arcade:{ gravity:{y:0}, debug:false } }, dom:{ createContainer:true }, scene:[BootScene, MainScene] };
  const game = new Phaser.Game(config);

  MainScene.prototype.preload = function(){};

  MainScene.prototype.create = function(){
    const $ = id=>document.getElementById(id);
    this.cameras.main.setBackgroundColor('#0e1320');

    // UI
    this.usernameInput = $("username");
    const savedU = localStorage.getItem('swca_username');
    if (savedU && this.usernameInput && !this.usernameInput.value) this.usernameInput.value = savedU;
    if (this.usernameInput) {
      this.usernameInput.addEventListener('input', () =>
        localStorage.setItem('swca_username', this.usernameInput.value.trim())
      );
    }
    this.stageSelect   = $("stageSelect");

    // Robust button/event wiring
    const startBtn = $("btnStage");
    if (startBtn) startBtn.addEventListener("click", (ev)=>{ ev.preventDefault(); this.startStage(); });
    const pauseBtn = $("btnPause");
    if (pauseBtn) pauseBtn.addEventListener("click", (ev)=>{ ev.preventDefault(); this.battleRunning=!this.battleRunning; if(this.battleRunning){ this.toast("Resumed"); this.processNextTurn(); } else { this.toast("Paused"); } });
    const speedSel = $("speedSel");
    if (speedSel) speedSel.addEventListener("change", (e)=>{ this.speedMul=parseInt(e.target.value,10)||1; this.toast(`Speed ${this.speedMul}×`); });
    const autoToggle = $("autoToggle");
    if (autoToggle) autoToggle.addEventListener("change", (e)=>{ this.autoMode=!!e.target.checked; this.toast(this.autoMode?"Auto ON":"Auto OFF"); });
    window.addEventListener("keydown",ev=>{ if(ev.code==="Space"){ ev.preventDefault(); pauseBtn?.click(); }});

    this.usernameInput?.addEventListener("change", ()=>{ this.refreshProfile(); this.refreshTeam(); this.refreshStageLocks(true); });

    this.logBox=$("log"); this.gemsEl=$("gems"); this.coinsEl=$("coins"); this.teamView=$("teamView"); this.waveView=$("waveView");

    // Battlefield layout (reserves space for header/actions/footer)
    const pad = 90;
    const UI_HEADER_H = 52;
    const ACTIONS_BAR_H = 40;
    const FOOTER_PAD = 60;

    const bfX = pad;
    const bfY = pad + UI_HEADER_H;
    const bfW = W - pad * 2;
    const bfH = Math.max(280, H - pad * 2 - UI_HEADER_H - ACTIONS_BAR_H - FOOTER_PAD);
    this.battlefield={x:bfX,y:bfY,w:bfW,h:bfH};
    this.bgLayer = this.add.layer().setDepth(0);
    const maskRect = this.add.rectangle(bfX+bfW/2, bfY+bfH/2, bfW, bfH, 0x000000, 0).setOrigin(0.5);
    const geoMask = maskRect.createGeometryMask();
    this.bgLayer.setMask(geoMask);
    const frame = this.add.graphics(); frame.lineStyle(2,0x2d3b5f,1).strokeRect(bfX,bfY,bfW,bfH).setDepth(2);
    this.layer = this.add.layer().setDepth(1); this.layer.setMask(geoMask);

    this.entities=[]; this.battleRunning=false; this.speedMul=1; this.autoMode=false;
    this.pendingTarget = null;

    // Simple HTML choice modal
    this.openChoice = (prompt, options, onChoose) => {
      const modal = document.getElementById('choiceModal');
      const promptEl = document.getElementById('choicePrompt');
      const btns = document.getElementById('choiceButtons');
      if (!modal || !promptEl || !btns) { onChoose && onChoose(null); return; }
      promptEl.textContent = prompt || "Choose";
      btns.innerHTML = "";
      options.forEach(opt => {
        const b = document.createElement('button');
        b.textContent = opt.label;
        b.style.padding = "8px 12px";
        b.style.borderRadius = "10px";
        b.style.border = "0"; b.style.cursor = "pointer";
        b.style.fontWeight = "700"; b.style.background = "#2a365a"; b.style.color = "#fff";
        b.addEventListener('click', () => { modal.style.display = "none"; onChoose && onChoose(opt.id); });
        btns.appendChild(b);
      });
      modal.style.display = "flex";
      const onBackdrop = (ev) => { if (ev.target === modal) { modal.style.display="none"; modal.removeEventListener('click', onBackdrop); } };
      modal.addEventListener('click', onBackdrop);
    };

    // Turn system
    this.turnOrder = [];
    this.turnIndex = 0;
    this.actionPending = false;

    // Skill button bar is in the footer (HTML-driven)
    this.skillUI = null;
    this.skillBar = document.getElementById("skillBar");
    this.skillButtons = [];
    this.layoutSkillButtons = () => {};

    // Live profile + locks
    this.refreshProfile();
    this.refreshTeam();
    this.refreshStageLocks(true);

    // Ensure stageSelect has a valid default (first unlocked)
    if (this.stageSelect && !this.stageSelect.value) {
      const firstOk = Array.from(this.stageSelect.options).find(o => !o.disabled) || this.stageSelect.options[0];
      if (firstOk) this.stageSelect.value = firstOk.value;
    }

    // Cross-tab sync
    this._lastTeamUpdate = +localStorage.getItem('swca_team_updated') || 0;
    window.addEventListener('storage', (e) => {
      if (e.key === 'swca_team_updated') { this._lastTeamUpdate = +e.newValue || Date.now(); this.refreshTeam(); }
      if (e.key === 'swca_username') {
        const nu = localStorage.getItem('swca_username') || '';
        if (this.usernameInput) this.usernameInput.value = nu;
        this.refreshProfile(); this.refreshTeam(); this.refreshStageLocks();
      }
    });
    try {
      const bc = new BroadcastChannel('swca');
      bc.addEventListener('message', m => { if (m.data?.type === 'team-updated') this.refreshTeam(); });
    } catch {}

    this.toast("Play ready. Select a team (🎒 on play page) and start a stage!", "#7ef7a0");

    // Music unlock
    if (window.SWCA_Music) {
      SWCA_Music.ensureUnlocked();
    }

    // Global clock for per-second ticks; scale with speed
    this.secondTickAcc = 0;

    // Main loop
    this.time.addEvent({
      delay: 33, loop: true, callback: () => {
        if(!this.battleRunning) return;
        const dt = 33;
        const tickEvery = 1000 / (this.speedMul || 1);
        this.secondTickAcc += dt;
        if (this.secondTickAcc >= tickEvery) {
          this.secondTickAcc -= tickEvery;
          this.secondTick();
        }
        this.syncHPBars();
        this.checkWaveEnd();
        this.checkBattleEnd();
      }
    });

    // Click targeting for skills that need a target
    this.input.on('gameobjectdown', (pointer, obj) => {
      if (!this.pendingTarget) return;
      const ent = this.entities.find(e => e.rect === obj || e.nameText === obj);
      if (!ent) return;
      const need = this.pendingTarget.side;
      if (need === 'enemy' && ent.side !== 'enemy') return;
      if (need === 'ally' && ent.side !== 'player') return;
      if (need === 'ally-or-fallen' && ent.side !== 'player') return;
      if (need !== 'ally-or-fallen' && !ent.alive) return;
      const { caster, meta } = this.pendingTarget;
      this.pendingTarget = null;
      this.useSpecialWithTarget(caster, meta, ent);
    });
  };

  /* ---------------- Progression (server + UI lock) ---------------- */
  MainScene.prototype.progressKey=function(){
    const u = this.username() || "_guest";
    return `swca_progress_${u}`;
  };
  MainScene.prototype.getMaxClearedLocal=function(){ const raw=localStorage.getItem(this.progressKey()); const n=parseInt(raw||"0",10); return Number.isFinite(n)?n:0; };
  MainScene.prototype.setMaxClearedLocal=function(stg){ const cur=this.getMaxClearedLocal(); if(stg>cur) localStorage.setItem(this.progressKey(), String(stg)); };

  MainScene.prototype.fetchProgressServer = async function(){
    const u = this.username();
    if(!u) return {max_cleared:0, next_allowed:1};
    try{
      const res=await fetch("/progress/get",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u})});
      return await res.json();
    }catch(err){
      console.warn("[progress/get] failed:", err);
      return {max_cleared:0, next_allowed:1};
    }
  };

  MainScene.prototype.refreshStageLocks = async function(initial=false){
    const sel = this.stageSelect;
    if (!sel) return;
    const p = await this.fetchProgressServer();
    this.setMaxClearedLocal(p.max_cleared||0);
    const maxCleared = p.max_cleared||0;
    for(const opt of sel.options){
      const val=parseInt(opt.value,10);
      const locked = (val > maxCleared + 1);
      opt.disabled = locked;
      const base = opt.textContent.replace(/\\s*\\(locked.*?\\)$/i,'');
      opt.textContent = locked ? `${base} (locked 🔒)` : base;
    }
    if(initial){
      const curVal=parseInt(sel.value,10);
      if(curVal > maxCleared + 1) sel.value=String(Math.min(maxCleared+1,1));
    }
  };

  /* ---------------- API helpers ---------------- */
  MainScene.prototype.username=function(){
    return (this.usernameInput?.value || localStorage.getItem('swca_username') || '').trim();
  };

  MainScene.prototype.api = async function(path, payload={}){
    const u=this.username(); if(!u){ this.toast("Enter a username","#ffad60"); return null; }
    try{
      const res=await fetch(path,{method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify({username:u, ...payload})});
      return await res.json();
    }catch(err){
      console.error(`[api] ${path} failed`, err);
      this.toast("Network error. Is Flask running?","#ff6b6b"); return null;
    }
  };

  MainScene.prototype.refreshProfile = async function(){
    const prof = await this.api("/profile");
    if (prof && !prof.error){
      this.gemsEl.textContent = `💎 ${prof.gems}`;
      this.coinsEl.textContent = `🪙 ${prof.coins}`;
    } else {
      const d = await this.api("/history");
      if (!d || d.error) return;
      this.gemsEl.textContent=`💎 ${d.gems}`;
      this.coinsEl.textContent=`🪙 ${d.coins ?? 0}`;
      this.lastPulls=d.pulls||[];
    }
  };

  MainScene.prototype.refreshTeam = async function(){
    const u=this.username(); if(!u) return;
    let teamIds=[]; let backpack=[];
    try{ const r=await fetch("/team/get",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u})}); const d=await r.json(); if(r.ok) teamIds=d.team||[]; }catch(e){ console.warn("team/get failed", e); }
    try{ const r=await fetch("/inventory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u})}); const d=await r.json(); if(r.ok) backpack=d.backpack||[]; }catch(e){ console.warn("inventory failed", e); }

    let team = teamIds.map(id=>backpack.find(it=>it.id===id)).filter(Boolean);
    if(!team.length){
      if(!this.lastPulls) { const h=await this.api("/history"); this.lastPulls=h?.pulls||[]; }
      const pulls=this.lastPulls||[];
      const recent=pulls.slice(-3);
      team=recent.map(p=>({
        name:p.unit_name,label:p.unit_label||p.unit_name,rarity:p.rarity,shiny:!!p.shiny,celestial:!!p.celestial,
        level:1, ascension:0
      }));
    } else {
      team=team.map((inst,i)=>({
        name:inst.unit_name,label:inst.unit_label||inst.unit_name,rarity:inst.rarity,shiny:!!inst.shiny,celestial:!!inst.celestial,
        level:inst.level||1, ascension:inst.ascension||0, _slotIndex:i
      }));
    }
    this.renderTeamPills(team);
    this.currentTeam=team;
    this.buildSkillButtons(team);
  };

  MainScene.prototype.renderTeamPills=function(team){
    this.teamView.innerHTML=`<span class="pill">Team:</span>`;
    if(!team||team.length===0){ this.teamView.innerHTML+=`<span class="pill">No team selected</span>`; return; }
    team.forEach(u=>{
      const span=document.createElement("span");
      span.className="pill";
      span.textContent=`${RARITY_EMOJI[u.rarity]||""} ${u.name}${u.shiny?" ✨":""}${u.celestial?" 🌟":""}`;
      this.teamView.appendChild(span);
    });
  };

  /* ---------------- Stage Background helpers ---------------- */
  // Create a canvas texture matching the battlefield dimensions so the
  // background always fits perfectly without overlapping units.
  MainScene.prototype.convertStageBg = function(key){
    const bf = this.battlefield;
    const tex = this.textures.get(key);
    if(!tex) return key;
    const src = tex.getSourceImage();
    if(!src) return key;
    const canvasKey = `${key}_bf_${bf.w}x${bf.h}`;
    if(this.textures.exists(canvasKey)) return canvasKey;
    const canvasTex = this.textures.createCanvas(canvasKey, bf.w, bf.h);
    const ctx = canvasTex.context;
    const scale = Math.max(bf.w/src.width, bf.h/src.height);
    const drawW = src.width * scale;
    const drawH = src.height * scale;
    const dx = (bf.w - drawW)/2;
    const dy = (bf.h - drawH)/2;
    ctx.drawImage(src, dx, dy, drawW, drawH);
    canvasTex.refresh();
    return canvasKey;
  };

  MainScene.prototype.setStageBackground = function(stageId){
    this.bgLayer.removeAll(true);
    const bf = this.battlefield;
    const key = `stage${stageId}`;
    if (this.textures.exists(key)) {
     const texKey = this.convertStageBg(key);
      const img = this.add.image(bf.x + bf.w/2, bf.y + bf.h/2, texKey);
      img.setDepth(0);
      this.bgLayer.add(img);
    } else {
      const g = this.add.graphics();
      const colors = { 1:0x15223a, 2:0x18253f, 3:0x1b2645, 4:0x241d2e, 5:0x2b1625, 6:0x12212f, 7:0x101e2a, 8:0x0f1b26, 9:0x0e1922, 10:0x0c161d };
      g.fillStyle(colors[stageId] || 0x15223a, 1);
      g.fillRect(bf.x, bf.y, bf.w, bf.h);
      g.lineStyle(1, 0xffffff, 0.05);
      for (let i = 0; i < 8; i++) {
        g.beginPath();
        g.moveTo(bf.x, bf.y + (i+1)*(bf.h/9));
        g.lineTo(bf.x + bf.w, bf.y + (i+1)*(bf.h/9));
        g.strokePath();
      }
      this.bgLayer.add(g);
    }
  };

  /* --------------- Turn System helpers --------------- */

  MainScene.prototype.getActionDelay = function(){
    const base = 900;
    const d = Math.max(200, Math.round(base / (this.speedMul || 1)));
    return d;
  };

  MainScene.prototype.buildTurnOrder = function(){
    const alive = this.entities.filter(e=>e.alive);
    const sideRank = (e)=> (e.side === "player" ? 0 : 1);
    const inTeamIdx = (e)=> (e.side === "player" ? (e._slotIndex ?? 999) : (e._spawnIdx ?? 999));
    alive.sort((a,b)=>{
      if (b.spd !== a.spd) return b.spd - a.spd;
      const sa = sideRank(a), sb = sideRank(b);
      if (sa !== sb) return sa - sb;
      const ia = inTeamIdx(a), ib = inTeamIdx(b);
      return ia - ib;
    });
    this.turnOrder = alive;
    this.turnIndex = 0;
  };

  MainScene.prototype.processNextTurn = function(){
    if (!this.battleRunning) return;
    if (this.actionPending) return;

    if (!this.turnOrder.length || this.turnIndex >= this.turnOrder.length) {
      this.buildTurnOrder();
    }

    let actor = null;
    while (this.turnIndex < this.turnOrder.length && !actor) {
      const cand = this.turnOrder[this.turnIndex++];
      if (cand && cand.alive) actor = cand;
    }
    if (!actor) {
      this.time.delayedCall(50, ()=>this.processNextTurn());
      return;
    }

    if ((actor._stunTurns && actor._stunTurns > 0) || (actor._sleepTurns && actor._sleepTurns > 0)) {
      if (actor._stunTurns && actor._stunTurns > 0) actor._stunTurns--;
      if (actor._sleepTurns && actor._sleepTurns > 0) actor._sleepTurns--;
      this.time.delayedCall(this.getActionDelay(), ()=>this.processNextTurn());
      return;
    }

    this.actionPending = true;
    this.takeTurn(actor);
    this.time.delayedCall(this.getActionDelay(), ()=>{
      this.actionPending = false;
      if (this.battleRunning) this.processNextTurn();
    });
  };

  /* --------------- Battle Setup --------------- */
  MainScene.prototype.startStage = async function(){
    const u = this.username();
    if (!u) { this.toast("Enter a username first", "#ffad60"); return; }

    const stageId=parseInt(this.stageSelect.value,10);
    const prog = await this.fetchProgressServer();
    const maxCleared = prog.max_cleared||0;
    if(stageId > maxCleared + 1){
      this.toast(`Clear Stage ${maxCleared+1} first to unlock this stage.`, "#ffad60");
      return;
    }
    if(!this.currentTeam||this.currentTeam.length===0){
      this.toast("Select a team first (open Backpack and save).","#ffad60"); return;
    }

    this.stageId=stageId; this.stage=STAGES[stageId]||STAGES[1];

    // Cache enemy-only knobs for this stage
    this.enemyHpMul = this.stage.enemyHpMul || 1.0;
    this.enemyAtkMul = this.stage.enemyAtkMul || 1.0;

    // Music
    if (window.SWCA_Music) {
      if (SWCA_Music.fadeTo) SWCA_Music.fadeTo('battle', 1000); else SWCA_Music.play('battle');
    }
    this._bossMusicOn = false;

    this.setStageBackground(stageId);

    this.layer.removeAll(true);
    this.entities=[]; this.wave=1;
    this.maxWaves=this.stage.waves; this.enemyLevel=this.stage.enemyLevel;
    this.battleRunning=true; this.resultShown=false;
    this.resetWaveCooldowns();

    // Player side
    const bf=this.battlefield;
    const px=bf.x+160, py=bf.y+bf.h-160, gap=170;
    this.playerTeam=this.currentTeam.map((u,i)=>this.spawnUnit({
      side:"player", x:px, y:py-i*gap, label:u.label, name:u.name, rarity:u.rarity, shiny:u.shiny, celestial:u.celestial,
      stats:buildStats(u.rarity, u.level||1, u.ascension||0, u.shiny, u.celestial, 1.0), asc:u.ascension||0, slotIndex:i
    }));

    this.spawnWave();
    this.updateWavePill();
    this.toast(`Stage ${stageId}: ${this.stage.name} — Wave 1/${this.maxWaves}`,"#7ef7a0");

    this.buildTurnOrder();
    this.processNextTurn();
    this.updateSkillButtons(); this.layoutSkillButtons && this.layoutSkillButtons();
  };

  MainScene.prototype.resetWaveCooldowns=function(){
    this.entities?.forEach(e => { e._waveLocks = {}; });
  };

  MainScene.prototype.spawnWave=function(){
    this.enemyTeam=[];

    const isBossWave = (this.stage?.boss === true) && (this.wave === this.maxWaves);

    if (isBossWave && !this._bossMusicOn) {
      if (window.SWCA_Music) {
        if (SWCA_Music.fadeTo) SWCA_Music.fadeTo('boss', 1000); else SWCA_Music.play('boss');
      }
      this._bossMusicOn = true;
    }


    const bf=this.battlefield; const ex=bf.x+bf.w-160, ey=bf.y+bf.h-160, gap=170;

    if(isBossWave){
      // Stage 10 boss = 2× Stage 5 boss
      const bossMult = (this.stageId === 10) ? 2.0 : 1.0;
      const bossName = (this.stageId === 10) ? "The Endbringer" : "Demon Lord";
      const boss=this.spawnBoss({x:ex,y:ey,name:bossName,mult:bossMult});
      boss._spawnIdx = 0;
      this.enemyTeam.push(boss);

      const elite="Mythical";
      const s1 = applyEnemyKnobs(buildStats(elite,1,0,false,false,this.enemyLevel*1.05), this.enemyHpMul, this.enemyAtkMul);
      const s2 = applyEnemyKnobs(buildStats(elite,1,0,false,false,this.enemyLevel*1.05), this.enemyHpMul, this.enemyAtkMul);
      const e1=this.spawnUnit({side:"enemy",x:ex,y:ey-gap,label:`${elite} Guard`,name:`${elite} Guard`,rarity:elite,shiny:false,celestial:false,stats:s1});
      const e2=this.spawnUnit({side:"enemy",x:ex,y:ey+gap,label:`${elite} Warlock`,name:`${elite} Warlock`,rarity:elite,shiny:false,celestial:false,stats:s2});
      e1._spawnIdx = 1; e2._spawnIdx = 2;
      this.enemyTeam.push(e1,e2);
      return;
    }

    const count=(this.wave===this.maxWaves?3:2);
    for(let i=0;i<count;i++){
      const rar=weightedPick([["Common",0.45],["Rare",0.33],["Ultra",0.14],["Mythical",0.06],["Secret",0.01],["Celestial",0.01]]);
      const name = `${rar} Bot ${this.wave*10 + i+1}`;
      const cel=(rar==="Celestial");
      const sh=!cel && Math.random()<(1/4000);
      const s = applyEnemyKnobs(
        buildStats(rar,1,0,sh,cel,this.enemyLevel),
        this.enemyHpMul, this.enemyAtkMul
      );
      const e = this.spawnUnit({side:"enemy",x:ex,y:ey-i*gap,label:name,name,rarity:rar,shiny:sh,celestial:cel,stats:s});
      e._spawnIdx = i;
      this.enemyTeam.push(e);
    }
  };

  // Extended: optional multiplier for boss stats; base = Stage 5 boss
  MainScene.prototype.spawnBoss=function({x,y,name,mult=1.0}){
    const base = {maxhp:10000, atk:250, def:120, spd:95, crit:0.12};
    const s={
      maxhp:Math.round(base.maxhp*mult), hp:Math.round(base.maxhp*mult),
      atk:Math.round(base.atk*mult), def:Math.round(base.def*mult),
      spd:Math.round(base.spd*mult), crit:base.crit
    };
    const rect=this.add.rectangle(x,y,120,120,0x7a0b0b).setStrokeStyle(4,0xff3b3b,0.9).setInteractive();
    const nameText=this.add.text(x,y+85,name,{fontSize:"16px",color:"#ffdede",fontFamily:"Arial"}).setOrigin(0.5).setInteractive();
    const bg=this.add.rectangle(x-60,y-78,120,12,0x2a0010).setOrigin(0,0.5);
    const fg=this.add.rectangle(x-60,y-78,120,12,0xff3b3b).setOrigin(0,0.5); fg.maxW=120;
    const hpText=this.add.text(x,y-78,"",{fontSize:"11px",color:"#ffffff",fontFamily:"Arial"}).setOrigin(0.5);
    const ent={side:"enemy",rect,nameText,hpbar:{bg,fg},hpText,label:name,name,rarity:"Boss",shiny:false,celestial:false,...s,alive:true,atb:0,skill:pickSkill(name),stunMs:0,isBoss:true};
    this.tweens.add({targets:rect,scaleX:1.04,scaleY:1.04,duration:900,yoyo:true,repeat:-1});
    ent.baseAtk=ent.atk; ent.baseDef=ent.def; ent.baseSpd=ent.spd; ent.baseMaxhp=ent.maxhp;
    ent._atkBuffs=[]; ent._defBuffs=[]; ent._spdBuffs=[]; ent._defDownMult=1;
    this.entities.push(ent); this.layer.add([rect,nameText,bg,fg,hpText]); return ent;
  };

  MainScene.prototype.spawnUnit=function({side,x,y,label,name,rarity,shiny,celestial,stats,asc=0,slotIndex=null}){
    const rect=this.add.rectangle(x,y,92,92,RARITY_COLOR[rarity]||0xffffff).setStrokeStyle(2,0xffffff,0.35).setInteractive();
    const nameText=this.add.text(x,y+72,shortLabel(label),{fontSize:"14px",color:"#dfe7ff"}).setOrigin(0.5).setInteractive();
    const bg=this.add.rectangle(x-46,y-70,92,10,0x2a3244).setOrigin(0,0.5);
    const fg=this.add.rectangle(x-46,y-70,92,10,0x32d27a).setOrigin(0,0.5); fg.maxW=92;
    const hpText=this.add.text(x,y-70,"",{fontSize:"11px",color:"#ffffff",fontFamily:"Arial"}).setOrigin(0.5);

    let sprite = null;
    let slug = null;
    if (side === 'player') {
      slug = slugifyName(name);
      const spriteEl = document.createElement('div');
      spriteEl.className = `sprite-unit ${slug} idle`;
      sprite = this.add.dom(x, y, spriteEl);
      sprite.setOrigin(0.5);
    }

    const ent={side,rect,nameText,hpbar:{bg,fg},hpText,sprite,label,name,rarity,shiny,celestial,ascension:asc,...stats,alive:true,atb:0,stunMs:0,isBoss:false};
    ent._slug = slug;
    ent.baseAtk=ent.atk; ent.baseDef=ent.def; ent.baseSpd=ent.spd; ent.baseMaxhp=ent.maxhp;
    ent._atkBuffs=[]; ent._defBuffs=[]; ent._spdBuffs=[];
    ent._defDownMult=1;

    ent._meta = pickSkillForUnit(name);
    ent._specCdLeft = 0;
    ent._waveLocks = {};
    ent._stageLockUsed = false;
    ent._slotIndex = slotIndex;

    if(celestial) rect.setStrokeStyle(3,0xffd700,0.9);
    else if(rarity==="Secret") rect.setFillStyle(0x333333);
    else if(shiny){
      this.tweens.addCounter({from:0,to:360,duration:1800,repeat:-1,onUpdate:t=>rect.setFillStyle(Phaser.Display.Color.HSLToColor((t.getValue()/360),1,0.6).color)});
    }

    this.entities.push(ent);
    if (side === 'player' && sprite) {
      rect.setAlpha(0);
      this.layer.add([rect,sprite,nameText,bg,fg,hpText]);
      this.playUnitAnim(ent, 'idle');
    } else {
      this.layer.add([rect,nameText,bg,fg,hpText]);
    }
    return ent;
  };

  function shortLabel(s){ s=String(s||""); return s.length<=14?s:s.slice(0,13)+"…"; }

  function slugifyName(name){
    return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

   /* --------------- Loop-driven helpers --------------- */

  MainScene.prototype.secondTick = function(){
    for (const e of this.entities) {
      const meta = e._meta;
      if (meta && meta.type === "passive" && meta.onTick && e.ascension >= 1) meta.onTick(this, e);
    }

    this.playerTeam?.forEach(p => { if (p._specCdLeft > 0) p._specCdLeft--; });

    const all = this.entities;
    all.forEach(e => {
      if (e._invincibleTurns && e._invincibleTurns > 0) e._invincibleTurns--;
      if (e._provokeTurns && e._provokeTurns > 0) e._provokeTurns--;
      if (e._dmgRedTurns && e._dmgRedTurns > 0) { e._dmgRedTurns--; if (e._dmgRedTurns<=0) e._dmgReduction = 1; }
      if (typeof e._defDownTurns === "number" && e._defDownTurns > 0) { e._defDownTurns--; if (e._defDownTurns <= 0) e._defDownMult = 1; }

      for (const key of ["_atkBuffs","_defBuffs","_spdBuffs"]) {
        const list = e[key]; if (!list || !list.length) continue;
        list.forEach(b => b.turns--);
        e[key] = list.filter(b => b.turns > 0);
      }
      if (e._spdDebuffs?.length) {
        e._spdDebuffs.forEach(b => b.turns--);
        e._spdDebuffs = e._spdDebuffs.filter(b => b.turns>0);
      }
      if (e._corruptTurns && e._corruptTurns>0) e._corruptTurns--;

      this.recomputeDerivedStats(e);
    });

    // DoTs
    all.forEach(e => {
      if (!e.alive) return;
      const applyTick = (arr, color) => {
        if (!arr || !arr.length) return arr;
        arr.forEach(b => {
          if (b.turns > 0) {
            e.hp = Math.max(0, e.hp - b.perTick);
            const txt = this.add.text(e.rect.x, e.rect.y - 92, `${b.label} ${b.perTick}`, { fontSize: "12px", color }).setOrigin(0.5);
            this.tweens.add({ targets: txt, y: txt.y - 18, alpha: 0, duration: 600, onComplete: () => txt.destroy() });
            this.layer.add(txt);
            b.turns--;
          }
        });
        return arr.filter(b => b.turns > 0);
      };
      e._burns = applyTick(e._burns, "#ff9f43");
      e._bleeds = applyTick(e._bleeds, "#ff6b6b");
      if (e.hp <= 0 && e.alive) { e.alive = false; this.onDeath(e); }
    });

    for (const e of this.entities) {
      const meta = e._meta;
      if (meta && meta.type === "passive" && meta.onDurationTick && e.ascension >= 1) meta.onDurationTick(this, e);
    }

    this.updateSkillButtons(); this.layoutSkillButtons && this.layoutSkillButtons();
  };

  MainScene.prototype.recomputeDerivedStats=function(ent){
    const mul = (list) => (list || []).reduce((m, b) => m * b.mult, 1);
    const atkMul = Math.max(0.1, mul(ent._atkBuffs));
    const defMul = Math.max(0.1, mul(ent._defBuffs));
    const spdMul = Math.max(0.1, mul(ent._spdBuffs));
    const slowMul = (ent._spdDebuffs||[]).reduce((m,b)=>m * b.mult, 1);
    ent.atk = Math.round(ent.baseAtk * atkMul);
    ent.def = Math.round(ent.baseDef * defMul);
    ent.spd = Math.round(ent.baseSpd * spdMul * slowMul);
  };

  MainScene.prototype.takeTurn=function(actor){
    if (!actor.alive) return;
    const gluttonyOn = !!actor._gluttonyWaves;

    this.playUnitAnim(actor, 'attack');

    const targets=this.entities.filter(x=>x.alive && x.side!==actor.side);
    if(targets.length===0) return;

    // Provoke handling
    let targetList = targets;
    const provoker = this.entities.find(e=>e.side==="enemy" && e._provokeTurns>0);
    if (actor.side==="enemy" && provoker) targetList=[provoker];

    const t = fx.lowestHpEnemy(targetList);
    if(!t) return;

    let dmg = computeDamage(actor, t);
    if (gluttonyOn) {
      dmg += Math.round(t.maxhp * 0.10) + Math.round(t.hp * 0.15);
    }

    if (t._dmgReduction && t._dmgReduction < 1) dmg = Math.round(dmg * t._dmgReduction);

    if (t._invincibleTurns && t._invincibleTurns > 0) {
      this.log(`${actor.name} hit ${t.name}, but it was invincible.`);
      this.hitVFX(actor, t, 0, false);
    } else {
      this.resolveHit(actor, t, dmg, { basic:true });
      if (gluttonyOn && actor.side==="player") {
        actor.hp = Math.min(actor.maxhp, actor.hp + Math.round(dmg * 0.5));
      }
    }

    // Ted slow application while vanished (on attack)
    if (actor._vanishSlowActive && actor._invincibleTurns>0) {
      fx.addSlow(t, 0.5, 3);
    }
  };

  MainScene.prototype.resolveHit=function(actor,target,dmg,meta={}){
    if (target._teleportCharges && target._teleportCharges>0) {
      target._teleportCharges--; dmg = 0; this.toast(`${target.name} teleported! (${target._teleportCharges} left)`, "#9d8cff");
    }

    target.hp=Math.max(0,target.hp-dmg);
    this.hitVFX(actor,target,dmg,actor._lastCrit);

    const tags=[];
    if(document.getElementById("optShowSkillTags")?.checked){
      tags.push(meta.basic?"basic":(meta.skill||"skill"));
      if(actor._lastCrit) tags.push("CRIT");
    }
    if(tags.length) this.log(`${actor.name} → ${target.name} for ${dmg} dmg (${tags.join(" / ")})`);
    else this.log(`${actor.name} → ${target.name} for ${dmg} dmg`);

    if(target.hp<=0 && target.alive){
      if (target._cantDie) {
        target.hp = 1;
      } else {
        target.alive=false; this.onDeath(target);
      }
    }
  };

  MainScene.prototype.hitVFX=function(actor,target,dmg,crit){
    const dir=actor.side==="player"?1:-1;
    this.tweens.add({targets:actor.rect,x:actor.rect.x+14*dir,duration:90,yoyo:true});
    const orig=target.rect.fillColor; target.rect.fillColor=0xff6b6b; this.time.delayedCall(90,()=>target.rect.fillColor=orig);
    if(document.getElementById("optShowDmg")?.checked){
      const txt=this.add.text(target.rect.x,target.rect.y-80,(crit?"✦ ":"")+dmg,{fontSize:crit?"22px":"16px",color:crit?"#ffd36b":"#ffffff"}).setOrigin(0.5);
      this.tweens.add({targets:txt,y:txt.y-28,alpha:0,duration:600,onComplete:()=>txt.destroy()}); this.layer.add(txt);
    }
  };

  MainScene.prototype.playUnitAnim = function(ent, anim){
    if (!ent || !ent.sprite || !ent.sprite.node) return;
    const el = ent.sprite.node;
    const slug = ent._slug || slugifyName(ent.name || '');
    if (anim === 'idle') {
      el.className = `sprite-unit ${slug} idle`;
      return;
    }
    el.className = `sprite-unit ${slug} ${anim} once`;
    const scene = this;
    el.addEventListener('animationend', () => {
      if (anim !== 'death') scene.playUnitAnim(ent, 'idle');
    }, { once: true });
  };

  MainScene.prototype.onDeath=function(ent){
    this.playUnitAnim(ent, 'death');
    this.tweens.add({targets:[ent.rect,ent.nameText,ent.hpbar.bg,ent.hpbar.fg,ent.hpText],alpha:0.2,duration:200});
    if (ent.side === 'player') this.updateSkillButtons();
  };

  MainScene.prototype.syncHPBars=function(){
    for(const e of this.entities){
      const r=Math.max(0,e.hp/e.maxhp);
      e.hpbar.fg.width=e.hpbar.fg.maxW*r;
      e.hpText.setText(`${e.hp}/${e.maxhp}`);
      e.hpbar.fg.fillColor = e.isBoss ? (r>0.5?0xff3b3b:(r>0.25?0xff9f43:0xff6b6b)) : (r>0.5?0x32d27a:(r>0.25?0xffb347:0xff6b6b));
    }
  };

  MainScene.prototype.checkWaveEnd=function(){
    if(!this.enemyTeam || this.enemyTeam.some(e=>e.alive)) return;
    if(this.wave>=this.maxWaves) return;
    this.wave++;
    this.entities.forEach(e => {
      if (e._gluttonyWaves && e._gluttonyWaves>0) {
        e._gluttonyWaves--;
        if (e._gluttonyWaves===0) this.toast("Gluttony faded.", "#ffd36b");
      }
      e._waveLocks = {};
    });
    this.spawnWave(); this.updateWavePill(); this.toast(`Wave ${this.wave}/${this.maxWaves}`,"#7ef7a0");
    this.buildTurnOrder();
  };

  MainScene.prototype.updateWavePill=function(){
    this.waveView.innerHTML=`<span class="pill">Wave: ${this.wave}/${this.maxWaves}</span>`;
  };

  MainScene.prototype.checkBattleEnd = function(){
    const playersAlive=this.entities.some(e=>e.side==="player"&&e.alive);
    const enemiesAlive=this.entities.some(e=>e.side==="enemy"&&e.alive);
    if(playersAlive && enemiesAlive) return;

    if(!this.resultShown){
      this.resultShown=true; this.battleRunning=false;
      if(playersAlive){
        this.handleStageComplete(true);
      }else{
        this.toast("Defeat… try a different team!","#ff6b6b"); this.log("Defeat.");
        this.handleStageComplete(false);
      }
    }
  };

  MainScene.prototype.handleStageComplete = async function(victory){
    const res = await this.api("/stage/complete",{ stage_id:this.stageId, victory });
    if(res && !res.error){
      if(victory){
        const parts=[];
        if(res.rewards?.coins) parts.push(`+${res.rewards.coins} coins`);
        if(res.rewards?.gems) parts.push(`+${res.rewards.gems} gems`);
        if(parts.length) this.toast(`Victory rewards: ${parts.join(", ")}`,"#7ef7a0");
        if(typeof res.max_cleared==="number") this.setMaxClearedLocal(res.max_cleared);
        if(typeof res.gems==="number") this.gemsEl.textContent=`💎 ${res.gems}`;
        if(typeof res.coins==="number") this.coinsEl.textContent=`🪙 ${res.coins}`;
        await this.refreshStageLocks();
      }
    } else {
      if(victory) this.toast(`Victory! (server reward unavailable)`, "#7ef7a0");
      console.warn("/stage/complete error:", res?.error);
    }

    if (window.SWCA_Music) {
      if (SWCA_Music.fadeTo) SWCA_Music.fadeTo('menu', 1000); else SWCA_Music.play('menu');
    }
  };

  /* ---------------- Skill UI & Activation ---------------- */
  MainScene.prototype.buildSkillButtons = function(team){
    const bar = document.getElementById('skillBar');
    if (!bar) { console.warn('[play] #skillBar not found in footer'); return; }
    bar.innerHTML = '';
    this.skillButtons = [];
    team.forEach((u, idx) => {
      const meta = pickSkillForUnit(u.name);
      const canHave = meta && ["Ultra","Mythical","Secret","Celestial"].includes(u.rarity);
      const label = canHave ? (meta?.name || "Skill") : "—";
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.textContent = `${u.name}: ${label}`;
      btn.addEventListener('click', () => this.triggerSpecialButton(idx));
      bar.appendChild(btn);
      this.skillButtons.push({ el: btn, idx });
    });
    this.updateSkillButtons();
  };

  MainScene.prototype.updateSkillButtons = function(){
    this.skillButtons.forEach(({ el, idx }) => {
      const ent = this.playerTeam?.[idx];
      if (!ent) { el.disabled = true; el.style.opacity = 0.5; el.textContent = '—'; return; }
      if (!ent.alive) { el.disabled = true; el.style.opacity = 0.5; el.textContent = `${ent.name}: [Dead]`; return; }
      const meta = ent._meta;
      let txt = `${ent.name}: ${meta ? meta.name : "—"}`;
      let enabled = true;
      if (!meta) enabled = false;
      if (meta && ent.ascension < 1) { txt += " (Asc 1)"; enabled = false; }
      if (ent._corruptTurns && ent._corruptTurns > 0) { txt += " [Corrupted]"; enabled = false; }
      if (meta) {
        if (meta.cdType === "turns") {
          if ((ent._specCdLeft || 0) > 0) { txt += ` [CD ${ent._specCdLeft}]`; enabled = false; }
        } else if (meta.cdType === "waves") {
          if (ent._waveLocks?.[meta.name]) { txt += " [Used this wave]"; enabled = false; }
        } else if (meta.cdType === "stage") {
          if (ent._stageLockUsed) { txt += " [Used this stage]"; enabled = false; }
        }
      }
      el.textContent = txt;
      el.disabled = !enabled;
      el.style.opacity = enabled ? 1 : 0.5;
    });
  };

  MainScene.prototype.triggerSpecialButton = function(slotIndex){
    const ent = this.playerTeam?.[slotIndex]; if (!ent) return;
    if (!ent.alive) return this.toast("Unit is dead.", "#ffad60");
    const meta = ent._meta;
    if (!meta) return this.toast("No special.", "#ffad60");
    if (ent.ascension < 1) return this.toast("Skill locked — Ascend to 1.", "#ffad60");
    if (ent._corruptTurns && ent._corruptTurns>0) return this.toast("Cannot use — Corrupted.", "#ffad60");

    if (meta.cdType === "turns" && (ent._specCdLeft||0)>0) return this.toast("Skill on cooldown.", "#ffad60");
    if (meta.cdType === "waves" && ent._waveLocks?.[meta.name]) return this.toast("Skill already used this wave.", "#ffad60");
    if (meta.cdType === "stage" && ent._stageLockUsed) return this.toast("Skill already used this stage.", "#ffad60");

    if (meta.target === "enemy" || meta.target === "ally" || meta.target === "ally-or-fallen") {
      this.pendingTarget = { caster: ent, meta, side: meta.target };
      this.toast("Select a target...", "#ffd36b");
      return;
    }

    this.useSpecialImmediate(ent, meta);
  };

  MainScene.prototype.useSpecialImmediate = function(ent, meta){
    this.playUnitAnim(ent, 'skill');
    if (meta.use) {
      const r = meta.use(this, ent);
      if (r === "pending") { this._pendingSpecial = { ent, meta }; return; }
    }
    this.afterSpecialUse(ent, meta);
  };

  MainScene.prototype.useSpecialWithTarget = function(ent, meta, target){
    this.playUnitAnim(ent, 'skill');
    if (meta.useOn) {
      const r = meta.useOn(this, ent, target);
      if (r === "pending") { this._pendingSpecial = { ent, meta }; return; }
    }
    this.afterSpecialUse(ent, meta);
  };

  MainScene.prototype.afterSpecialUse = function(ent, meta){
    this.log(`${ent.name} used ${meta.name}`);
    this.toast(`${ent.name}: ${meta.name}`, "#7ef7a0");
    if (meta.cdType === "turns") ent._specCdLeft = meta.cd;
    if (meta.cdType === "waves") ent._waveLocks[meta.name] = true;
    if (meta.cdType === "stage") ent._stageLockUsed = true;
    this.updateSkillButtons(); this.layoutSkillButtons && this.layoutSkillButtons();
  };

  MainScene.prototype.finalizePendingSpecial = function(){ const p=this._pendingSpecial; if(!p) return; this.afterSpecialUse(p.ent,p.meta); this._pendingSpecial=null; };

  /* ---------------- Utils ---------------- */
  function weightedPick(pairs){ const tot=pairs.reduce((s,[,w])=>s+w,0); let r=Math.random()*tot; for(const [v,w] of pairs){ if((r-=w)<=0) return v; } return pairs[pairs.length-1][0]; }

  // simple logger & toaster assumed elsewhere
})();