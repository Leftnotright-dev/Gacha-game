// static/js/anim-runtime.js
// Generic, data-driven sprite animation runtime for Phaser 3
(function(){
  const ANIM_ORDER = ["idle","attack","hit","special","stun","death","revive"];
  const DEFAULT_ANIM_FPS = 12;

  function unitSlug(name){
    return String(name||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
  }

  function preloadUnitSprites(scene, slug, anims=ANIM_ORDER){
    const base = `/static/images/units/${slug}`;
    anims.forEach(anim=>{
      const metaKey = `${slug}_${anim}_meta`;
      const pngKey  = `${slug}_${anim}_png`;
      scene.load.image(pngKey, `${base}/${anim}.png`);
      scene.load.json(metaKey, `${base}/${anim}.meta.json`);
    });
  }

  function resolveFrameRate(meta){
    if (meta && typeof meta.frameRate === 'number') return Math.max(1, Math.round(meta.frameRate));
    if (meta && typeof meta.msPerFrame === 'number') return Math.max(1, Math.round(1000 / meta.msPerFrame));
    return DEFAULT_ANIM_FPS;
  }

  function buildFrameIndices(meta){
    const rows = meta?.rows;
    const cols = meta?.columns;
    const countFromGrid = (rows && cols) ? rows * cols : undefined;
    const total = meta?.frameCount ?? countFromGrid ?? 1;
    const start = (typeof meta?.frameStart === 'number') ? meta.frameStart : 0;
    const endInc = (typeof meta?.frameEnd === 'number') ? meta.frameEnd : (total - 1);
    let indices = [];
    for (let i=start; i<=endInc; i++) indices.push(i);
    if (Array.isArray(meta?.frameOrder) && meta.frameOrder.length > 0) indices = meta.frameOrder.slice();
    return { indices, total, rows: rows ?? 1, cols: cols ?? (total) };
  }

  function ensureSheetFrames(scene, slug, anim, meta, pngKey){
    const sheetKey = `${slug}_${anim}_sheet`;
    if (scene.textures.exists(sheetKey)) return sheetKey;
    const baseTex = scene.textures.get(pngKey);
    if (!baseTex) return null;
    const baseImg = baseTex.getSourceImage();
    if (!baseImg) return null;
    const fw = meta.frameWidth, fh = meta.frameHeight;
    if (!(fw>0 && fh>0)) return null;
    const { rows, cols } = buildFrameIndices(meta);
    const texMan = scene.textures;
    const dyn = texMan.create(sheetKey);
    // Create frames row-major
    let idx = 0;
    for (let r=0; r<rows; r++){
      for (let c=0; c<cols; c++){
        const sx = c*fw, sy = r*fh;
        if (sx+fw > baseImg.width || sy+fh > baseImg.height) continue;
        const tmpKey = `${sheetKey}_f${idx}`;
        const cv = texMan.createCanvas(tmpKey, fw, fh);
        const ctx = cv.getContext('2d');
        ctx.drawImage(baseImg, sx, sy, fw, fh, 0, 0, fw, fh);
        cv.refresh();
        dyn.add(String(idx), 0, 0, fw, fh).source = cv.getSourceImage();
        idx++;
      }
    }
    return sheetKey;
  }

  function registerUnitAnimations(scene, slug){
    ANIM_ORDER.forEach(anim=>{
      const metaKey = `${slug}_${anim}_meta`;
      const pngKey  = `${slug}_${anim}_png`;
      const animKey = `${slug}_${anim}`;
      if (scene.anims.exists(animKey)) return;
      if (!scene.textures.exists(pngKey)) return;
      const meta = scene.cache.json.get(metaKey);

      if (meta && meta.frameWidth && meta.frameHeight){
        const sheetKey = ensureSheetFrames(scene, slug, anim, meta, pngKey);
        if (sheetKey){
          const { indices } = buildFrameIndices(meta);
          const frames = indices.map(i=>({ key: sheetKey, frame: String(i) }));
          scene.anims.create({
            key: animKey,
            frames,
            frameRate: resolveFrameRate(meta),
            repeat: (typeof meta?.repeat === 'number') ? meta.repeat : (anim === 'idle' ? -1 : 0),
            yoyo: !!meta?.yoyo
          });
        } else {
          scene.anims.create({ key: animKey, frames:[{key: pngKey}], frameRate:1, repeat:(anim==='idle'?-1:0) });
        }
      } else {
        scene.anims.create({ key: animKey, frames:[{key: pngKey}], frameRate:1, repeat:(anim==='idle'?-1:0) });
      }
    });
  }

  function playUnitAnim(sprite, slug, anim){
    const tryAnims = [anim, "idle"];
    for (const a of tryAnims){
      const key = `${slug}_${a}`;
      if (sprite.anims && sprite.anims.animationManager.exists(key)){
        sprite.play(key, true);
        return;
      }
      const pngKey = `${slug}_${a}_png`;
      if (sprite.scene.textures.exists(pngKey)){
        sprite.setTexture(pngKey);
        return;
      }
    }
  }

  function applySpriteMetaDisplay(sprite, meta){
    if (!meta) return;
    if (meta.displayWidth && meta.displayHeight){
      sprite.setDisplaySize(meta.displayWidth, meta.displayHeight);
    } else if (typeof meta.scale === 'number'){
      sprite.setScale(meta.scale);
    }
    if (typeof meta.originX === 'number' || typeof meta.originY === 'number'){
      const ox = (typeof meta.originX === 'number') ? meta.originX : 0.5;
      const oy = (typeof meta.originY === 'number') ? meta.originY : 0.5;
      sprite.setOrigin(ox, oy);
    }
  }

  function buildFighterCard(scene, fighter, pos){
    const slug = unitSlug(fighter.name);
    const CARD_W = 180, CARD_H = 210, SPRITE_BOX_H = 140;
    const card = scene.add.container(pos.x, pos.y);
    const hpBg = scene.add.rectangle(0, 0, CARD_W, 12, 0x222222).setOrigin(0.5, 0);
    const hpFg = scene.add.rectangle(-CARD_W/2, 0, CARD_W, 12, 0x00cc66).setOrigin(0, 0);
    const spriteY = 12 + SPRITE_BOX_H/2;
    const sprite = scene.add.sprite(0, spriteY, `${slug}_idle_png`);
    const idleMeta = scene.cache.json.get(`${slug}_idle_meta`);
    applySpriteMetaDisplay(sprite, idleMeta);
    if (typeof idleMeta?.offsetX === 'number') sprite.x += idleMeta.offsetX;
    if (typeof idleMeta?.offsetY === 'number') sprite.y += idleMeta.offsetY;
    const nameText = scene.add.text(0, 12 + SPRITE_BOX_H + 12, fighter.name, { fontSize:'14px', fontFamily:'Arial', color:'#fff' }).setOrigin(0.5, 0);
    card.add([hpBg, hpFg, sprite, nameText]);
    card.setDataEnabled();
    card.setData('hpFg', hpFg);
    card.setData('sprite', sprite);
    card.setSize(CARD_W, CARD_H);
    const hpPct = Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));
    hpFg.width = CARD_W * hpPct;
    playUnitAnim(sprite, slug, "idle");
    return card;
  }

  function withAnimDisplayOverrides(sprite, slug, anim, onDone){
    const meta = sprite.scene.cache.json.get(`${slug}_${anim}_meta`);
    const idleMeta = sprite.scene.cache.json.get(`${slug}_idle_meta`);
    const prev = { scaleX: sprite.scaleX, scaleY: sprite.scaleY, ox: sprite.originX, oy: sprite.originY };
    if (meta) applySpriteMetaDisplay(sprite, meta);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (idleMeta) applySpriteMetaDisplay(sprite, idleMeta);
      else sprite.setScale(prev.scaleX, prev.scaleY).setOrigin(prev.ox, prev.oy);
      if (typeof onDone === 'function') onDone();
    });
  }

  function updateHpBar(scene, fighter, cards){
    const card = cards[fighter.index];
    if (!card) return;
    const hpFg = card.getData('hpFg');
    const CARD_W = 180;
    const pct = Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));
    hpFg.width = CARD_W * pct;
  }

  // Expose API
  window.SpriteAnim = {
    ANIM_ORDER, DEFAULT_ANIM_FPS, unitSlug,
    preloadUnitSprites, registerUnitAnimations, playUnitAnim,
    buildFighterCard, withAnimDisplayOverrides, updateHpBar
  };
})();
