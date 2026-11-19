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
  // 2026-11-19: Khách hàng yêu cầu hiệu ứng chữ nhỏ mờ từ trên rơi xuống phóng to rõ ở giữa rồi tiếp tục rơi xuống thu nhỏ mờ biến mất; nâng cấp chế độ 'queue' với khoảng nối trước/sau (enterLead/exitTail) để câu cũ rơi xuống thu nhỏ mượt song song với câu mới rơi từ trên xuống to dần ở giữa (hỗ trợ cả hướng down từ trên xuống và up từ dưới lên).
  function state(seg, t, rhythm = 0, direction = 'up') {
    const start = Number(seg.start) || 0;
    const end = Math.max(start + 0.1, Number(seg.end) || start + 2);
    const dur = end - start;
    const mode = seg.mode || 'queue';

    if (mode === 'queue') {
      const enterLead = 0.28;
      const exitTail = 0.40;
      if (t < start - enterLead || t > end + exitTail) return null;
      const enterIn = Math.min(0.48, dur * 0.28);
      const exitOut = Math.min(0.42, dur * 0.26);
      const uIn = clamp((t - (start - enterLead)) / Math.max(0.12, enterLead + enterIn), 0, 1);
      const uOut = clamp((t - (end - exitOut)) / Math.max(0.12, exitOut + exitTail), 0, 1);
      const eIn = smooth(uIn);
      const eOut = smooth(uOut);
      const midProg = clamp((t - start) / Math.max(0.1, dur), 0, 1);
      const dirSign = direction === 'down' ? 1 : -1;
      const travel = 126;
      const offsetY = dirSign * (-travel * (1 - eIn) + travel * eOut + 10 * (midProg - 0.5));
      const focus = eIn * (1 - eOut);
      const scale = 0.54 + 0.48 * focus;
      const opacity = Math.pow(eIn, 1.18) * Math.pow(1 - eOut, 1.18);
      return {
        offsetX: 0,
        offsetY,
        scale,
        opacity,
        edgeFade: 1 - Math.min(eIn, 1 - eOut),
        progress: midProg,
        glowFactor: 0.75 + 0.25 * focus,
        mode
      };
    }

    const phase = phases(seg), local = t - start;
    if (local < 0 || local >= phase.duration) return null;
    const progress = local/phase.duration;
    const enterDur = Math.max(phase.entry, Math.min(0.62, phase.duration * 0.30));
    const exitDur = Math.max(phase.exit, Math.min(0.58, phase.duration * 0.28));
    const enter = smooth(local/enterDur), leave = smooth((phase.duration-local)/exitDur);
    const result = {offsetX:0, offsetY:0, scale:1, opacity:enter*leave, edgeFade: 1 - Math.min(enter, leave), progress, glowFactor:0.75, mode};
    const envelope = enter*leave;
    if (mode === 'none') { result.opacity = 1; result.edgeFade = 0; return result; }
    if (mode === 'slide') {
      result.offsetX = 48*(1-enter) - 42*(1-leave);
      result.offsetY = 0;
      result.scale = 1;
    } else if (mode === 'bounce') {
      const p = clamp(local/enterDur), q = 1-leave;
      const breath = clamp(rhythm) * envelope;
      result.offsetX = 16 * (1 - p) ** 2 - 14 * q;
      result.offsetY = 26*(1-p)**3 - 8*Math.sin(Math.PI*p)**2*(1-p) - 18*q - 3.5*breath;
      result.scale = 0.96 + 0.04*enter + 0.022 * breath;
    } else if (mode === 'poem') {
      const fadeIn = smooth(local / Math.min(0.72, phase.duration * 0.32));
      const fadeOut = smooth((phase.duration - local) / Math.min(0.66, phase.duration * 0.30));
      result.opacity = fadeIn * fadeOut;
      result.offsetY = 20 * (1 - fadeIn) - 16 * (1 - fadeOut);
      result.scale = 0.965 + 0.035 * fadeIn + 0.015 * (1 - fadeOut);
    } else {
      const breath = clamp(rhythm) * envelope;
      result.offsetX = 18*(1-enter) - 16*(1-leave);
      result.offsetY = 16*(1-enter) - 14*(1-leave) - 2.5*breath;
      result.scale = 0.96 + 0.04*enter + 0.022*breath;
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
