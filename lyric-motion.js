/* Timeline-driven motion shared by preview and export. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NebulaMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = v => { const p = clamp(v); return p * p * p * (p * (p * 6 - 15) + 10); };
  const clean = text => String(text || '').replace(/\s+/gu, ' ').trim();
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('vi', {granularity: 'grapheme'}) : null;
  function textAndIcons(text, explicitIcon) {
    const clusters = segmenter ? [...segmenter.segment(clean(text))].map(x => x.segment) : Array.from(clean(text));
    const icons = [], words = [];
    for (const part of clusters) {
      if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(part)) icons.push(part);
      else words.push(part);
    }
    const label = clean(words.join(''));
    return {text: label, icon: clean(explicitIcon || icons.slice(0, 2).join(''))};
  }
  function phases(seg) {
    const duration = Math.max(0.001, Number(seg.end) - Number(seg.start));
    const a = Math.max(0.1, Number(seg.timingIn) || 0.5);
    const b = Math.max(0, Number(seg.timingMid ?? 1.5));
    const c = Math.max(0.1, Number(seg.timingOut) || 0.5);
    const sum = a + b + c;
    return {duration, entry: duration * a / sum, middle: duration * b / sum, exit: duration * c / sum};
  }
  function hermite(y0, y1, v0, v1, dt, p) {
    const u = clamp(p), u2 = u*u, u3 = u2*u;
    return (2*u3-3*u2+1)*y0 + (u3-2*u2+u)*v0*dt + (-2*u3+3*u2)*y1 + (u3-u2)*v1*dt;
  }
  function path(local, phase, points) {
    const {duration, entry, middle, exit} = phase;
    const drift = middle > 0 ? (points[2]-points[1]) / middle : 0;
    // Bound the shared tangent to keep all three Hermite spans monotone.
    const tangent = Math.sign(drift) * Math.min(Math.abs(drift), Math.abs((points[1]-points[0])/entry), Math.abs((points[3]-points[2])/exit)) * 0.8;
    if (local < entry) return hermite(points[0], points[1], 0, tangent, entry, local/entry);
    if (middle && local < entry+middle) return hermite(points[1], points[2], tangent, tangent, middle, (local-entry)/middle);
    return hermite(middle ? points[2] : points[1], points[3], tangent, 0, exit, (local-duration+exit)/exit);
  }
  function beatBreath(effect, t) {
    if (!effect?.enabled || !Array.isArray(effect.beats) || !effect.beats.length) return 0;
    const beats=effect.beats;
    let lo=0,hi=beats.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(beats[mid].time<=t)lo=mid+1;else hi=mid;}
    if(!lo)return 0;
    const a=beats[lo-1],b=beats[lo];
    const amount=clamp(Number(effect.amount) || 0);
    const strength=clamp(Number(a.strength)||0);
    if(!b){
      const period=60/(Number(effect.bpm)||134);
      return amount*strength*(1-smooth((t-a.time)/period));
    }
    const progress=clamp((t-a.time)/Math.max(.001,b.time-a.time));
    const power=strength+(clamp(Number(b.strength)||0)-strength)*smooth(progress);
    return amount*power*(.5+.5*Math.cos(progress*Math.PI*2));
  }
  // 2026-11-15: Khách hàng phản hồi hiệu ứng animation tự zoom lớn nhỏ khó chịu ở chế độ thường nhưng vẫn cần dùng đủ 6 kiểu hiệu ứng chung; giữ scale = 1 ổn định cho queue/slide/bounce/poem/none và chỉ áp dụng thu phóng nhẹ khi người dùng chủ động chọn chế độ 'soft' (Mềm · zoom theo nhịp).
  function state(seg, t, rhythm = 0, direction = 'up') {
    const phase = phases(seg), local = t - Number(seg.start);
    if (local < 0 || local >= phase.duration) return null;
    const progress = local/phase.duration;
    const enter = smooth(local/phase.entry), leave = smooth((phase.duration-local)/phase.exit);
    const result = {offsetX:0, offsetY:0, scale:1, opacity:enter*leave, progress, glowFactor:0.75, mode:seg.mode || 'queue'};
    const envelope = enter*leave;
    if (seg.mode === 'none') { result.opacity = 1; return result; }
    if (seg.mode === 'queue') {
      result.offsetY = path(local, phase, [26, 0, 0, -26]);
      result.scale = 1;
    } else if (seg.mode === 'slide') {
      result.offsetX = path(local, phase, [56, 0, 0, -56]);
      result.offsetY = 0;
      result.scale = 1;
    } else if (seg.mode === 'bounce') {
      const p = clamp(local/phase.entry), q = 1-leave;
      const breath = clamp(rhythm) * envelope;
      result.offsetX = 24 * (1 - p) ** 2 - 18 * q;
      result.offsetY = 32*(1-p)**3 - 10*Math.sin(Math.PI*p)**2*(1-p) - 20*q - 4.5*breath;
      result.scale = 1 + 0.028 * breath;
    } else if (seg.mode === 'poem') {
      const fadeIn=smooth(local/Math.min(.52,phase.duration*.25));
      const fadeOut=smooth((phase.duration-local)/Math.min(.48,phase.duration*.23));
      result.opacity=fadeIn*fadeOut;
      result.offsetY=20*(1-fadeIn)-14*(1-fadeOut);
      result.scale=1;
    } else {
      const breath=clamp(rhythm)*envelope;
      result.offsetX = 22*(1-enter) - 18*(1-leave);
      result.offsetY = 16*(1-enter) - 12*(1-leave) - 3.5*breath;
      result.scale = 0.94 + 0.06*enter + 0.035*breath;
    }
    if(direction==='down')result.offsetY=-result.offsetY;
    return result;
  }
  function splitSegment(seg) {
    // Break only where the author marked a clause. Width is handled by fitting,
    // never by cutting an idiom or leaving a one-word tail on screen.
    const raw = String(seg.text || '').trim();
    const parts = raw.split(/\n+|(?<=[,;.!?\u2026])\s+/u).map(clean).filter(Boolean);
    if (parts.length < 2) return [{...seg, text:clean(raw)}];
    const meaningful = [];
    for (const part of parts) {
      const last = meaningful.at(-1);
      if (part.split(/\s+/).length < 3 && last) meaningful[meaningful.length-1] = last+' '+part;
      else meaningful.push(part);
    }
    if (meaningful.length < 2) return [{...seg, text:meaningful[0] || clean(raw)}];
    const words = meaningful.map(p=>p.split(/\s+/).length);
    const total = words.reduce((a,b)=>a+b,0);
    const duration = Number(seg.end)-Number(seg.start);
    if (duration/meaningful.length < 1.25) return [{...seg,text:clean(raw)}];
    let offset=0;
    return meaningful.map((text,index)=>{
      const start=Number(seg.start)+duration*offset/total;
      offset+=words[index];
      return {...seg,id:index ? String(seg.id)+'-clause-'+index : seg.id,text,
        start,end:index===meaningful.length-1 ? Number(seg.end) : Number(seg.start)+duration*offset/total,
        words:undefined};
    });
  }
  return {clean, textAndIcons, phases, state, beatBreath, splitSegment};
});
