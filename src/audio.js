// Sound manager. Maps game events to sample names inside the player's own disc data. Silent when
// no assets are loaded. Announcer lines are picked at random from each family so he doesn't repeat.
export class Sound {
  constructor(assets) {
    this.assets = assets; this.ctx = null; this.master = null; this.music = null; this.lastLine = 0;
    this.families = null; this.busy = false; this.volume = 0.8;
  }
  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
    if (this.assets.ready) {
      const names = await this.assets.soundNames('');
      this.families = {};
      for (const n of names) {
        const base = n.replace(/\.mss$/, '');
        const fam = base.replace(/_?\d+(_\d+)*$/, '');
        (this.families[fam] = this.families[fam] || []).push(base);
      }
    }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  pick(prefix) {
    if (!this.families) return null;
    const keys = Object.keys(this.families).filter(k => k.startsWith(prefix));
    if (!keys.length) return null;
    const fam = this.families[keys[(Math.random() * keys.length) | 0]];
    return fam[(Math.random() * fam.length) | 0];
  }
  async play(name, { gain = 1, loop = false, channel = 'fx' } = {}) {
    if (!this.ctx || !this.assets.ready || !name) return null;
    const buf = await this.assets.sound(this.ctx, name);
    if (!buf) return null;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = loop;
    const g = this.ctx.createGain(); g.gain.value = gain; src.connect(g); g.connect(this.master); src.start();
    return { src, gain: g };
  }
  // Announcer: one line at a time, with a short cooldown so he doesn't talk over himself.
  async say(prefix, force = false) {
    const now = performance.now();
    if (!force && now - this.lastLine < 1800) return;
    const name = this.pick(prefix);
    if (!name) return;
    this.lastLine = now;
    const h = await this.play(name, { gain: 1.0 });
    if (h) this.lastLine = now + (h.src.buffer.duration * 1000);
  }
  async playMusic(prefix) {
    this.stopMusic();
    const name = this.pick(prefix);
    if (!name) return;
    this.music = await this.play(name, { gain: 0.45, loop: true });
  }
  stopMusic() { if (this.music) { try { this.music.src.stop(); } catch (e) { } this.music = null; } }

  // Route a sim event to sounds. Event names come from sim.js / live.js emit('sound', {name}).
  onEvent(ev, g) {
    if (!this.ctx) return;
    const fx = n => this.play(this.pick(n), { gain: 0.9 });
    switch (ev.type) {
      case 'sound':
        switch (ev.name) {
          case 'snap': fx('snap'); break;
          case 'hit': fx('hit'); if (Math.random() < 0.25) this.say('cc_after_impact'); break;
          case 'bighit': fx('bighit'); this.say('cc_after_impact', true); break;
          case 'break': fx('grunt'); if (Math.random() < 0.4) this.say('cc_broken_tackle'); break;
          case 'catch': fx('catch'); if (Math.random() < 0.4) this.say('cc_after_great_catch'); break;
          case 'incomplete': this.say('cc_after_pass_dropped'); break;
          case 'throw': fx('throw'); break;
          case 'kick': fx('kick'); break;
          case 'touchdown': this.play('touchdown', { gain: 0.8 }); this.play(this.pick('crwdcheer'), { gain: 0.7 }); this.say('cc_touchdown', true); break;
          case 'fgood': this.play('fldgoal', { gain: 0.8 }); this.play(this.pick('crwdcheer'), { gain: 0.5 }); this.say('cc_Kick_is_good', true); break;
          case 'doink': this.play('doink1'); this.say('cc_kick_missed', true); break;
          case 'pick': this.play(this.pick('crwdboo'), { gain: 0.6 }); this.say('cc_after_turnover', true); break;
          case 'fumble': this.play(this.pick('crwdboo'), { gain: 0.6 }); this.say('cc_fumble', true); break;
          case 'fire': this.play('ctchfire', { gain: 1 }); this.say('cc_on_fire', true); break;
        }
        break;
      case 'whistle': fx('whistle'); break;
      case 'latehit': if (Math.random() < 0.5) this.say('cc_late_hit'); break;
      case 'banner':
        if (/TURNOVER/.test(ev.text)) this.say('cc_after_turnover');
        if (/SAFETY/.test(ev.text)) this.say('cc_safety', true);
        if (/HALFTIME/.test(ev.text)) this.play('eoqgruv1', { gain: 0.6 });
        if (/END OF/.test(ev.text)) this.play('eoqfan', { gain: 0.6 });
        if (/FINAL/.test(ev.text)) this.play('epgroove', { gain: 0.6 });
        break;
      case 'playcall': if (Math.random() < 0.15) this.say('cc_big_pressure'); break;
    }
  }
}
