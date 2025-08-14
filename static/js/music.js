// static/js/music.js
(function () {
  // Use plain static paths (no Jinja inside .js files)
  const tracks = {
    menu:  "/static/audio/menu_music.mp3",
    battle:"/static/audio/battle_music.mp3",
    boss:  "/static/audio/boss_music.mp3"
  };

  let current = null;
  let volume = parseFloat(localStorage.getItem('swca_music_vol') || '0.5');

  const MusicAPI = {
    get volume() { return volume; },
    ensureUnlocked() {
      // Pre-warm audio on user gesture (mobile/Chrome policies)
      const unlock = () => {
        Object.values(tracks).forEach(src => {
          try {
            const a = new Audio(src);
            a.volume = 0; a.play().catch(()=>{}); a.pause();
          } catch {}
        });
        document.removeEventListener('click', unlock);
        document.removeEventListener('keydown', unlock);
        document.removeEventListener('touchstart', unlock);
      };
      document.addEventListener('click', unlock);
      document.addEventListener('keydown', unlock);
      document.addEventListener('touchstart', unlock, {passive:true});
    },
    play(name) {
      if (!tracks[name]) return;
      if (current) { current.pause(); current = null; }
      const audio = new Audio(tracks[name]);
      audio.loop = true;
      audio.volume = volume;
      audio.play().catch(err => console.warn('Music play error:', err));
      current = audio;
    },
    fadeTo(name, ms=800) {
      if (!tracks[name]) return this.play(name);
      const next = new Audio(tracks[name]);
      next.loop = true;
      next.volume = 0;
      next.play().catch(()=>{});
      if (!current) {
        current = next;
        current.volume = volume;
        return;
      }
      const start = performance.now();
      const startVol = current.volume;
      const step = (t) => {
        const k = Math.min(1, (t - start) / ms);
        current.volume = startVol * (1 - k);
        next.volume = volume * k;
        if (k < 1) requestAnimationFrame(step);
        else { current.pause(); current = next; }
      };
      requestAnimationFrame(step);
    },
    stop() {
      if (current) { current.pause(); current = null; }
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v)));
      localStorage.setItem('swca_music_vol', String(volume));
      if (current) current.volume = volume;
    }
  };

  window.SWCA_Music = MusicAPI;
})();

