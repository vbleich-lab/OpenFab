// Tests for sketch trim/extend (node tools/test-trim.mjs)
import { trimAt, extendAt, remapConstraints } from '../js/trim.js';
const ok=(n,c,x='')=>{console.log((c?'OK   ':'FEHL ')+n+'  '+x); if(!c) process.exitCode=1;};
const r=a=>JSON.stringify(a,(k,v)=>typeof v==='number'?+v.toFixed(3):v);
// cross: horizontal line 0..10 at y=0, vertical line x=5 from -5..5
const ents=[{id:'h',type:'poly',pts:[[0,0],[10,0]]},{id:'v',type:'poly',pts:[[5,-5],[5,5]]}];
let t=trimAt(ents,[8,0.1],0.5); ok('Linie rechts kappen', t && t.remove[0]==='h' && t.add.length===1 && r(t.add[0].pts)==='[[0,0],[5,0]]', r(t?.add));
t=trimAt(ents,[2,0],0.5); ok('Linie links kappen', r(t.add[0].pts)==='[[5,0],[10,0]]', r(t.add));
// line through two verticals: middle part removed → two pieces
const e2=[{id:'h',type:'poly',pts:[[0,0],[10,0]]},{id:'a',type:'poly',pts:[[3,-1],[3,1]]},{id:'b',type:'poly',pts:[[7,-1],[7,1]]}];
t=trimAt(e2,[5,0],0.5); ok('Mittelstück entfernen', t.add.length===2 && r(t.add.map(x=>x.pts))==='[[[0,0],[3,0]],[[7,0],[10,0]]]', r(t.add.map(x=>x.pts)));
// no cut: whole line goes
t=trimAt([{id:'x',type:'poly',pts:[[0,0],[1,0]]}],[0.5,0],0.2); ok('Ohne Schnitt: ganz löschen', t.remove[0]==='x' && t.add.length===0);
// rectangle crossed by a line: rect side trimmed → open polyline
const e3=[{id:'R',type:'rect',x:0,y:0,w:10,h:6},{id:'L',type:'poly',pts:[[5,-2],[5,8]]}];
t=trimAt(e3,[7,0],0.4); ok('Rechteckseite stutzen', t.add.length===1 && t.add[0].pts.length===5 && !t.add[0].closed && JSON.stringify(t.add[0].pts.at(-1))==='[5,0]', r(t.add[0]?.pts));
// circle cut by a line: arc remains
const e4=[{id:'C',type:'circle',cx:0,cy:0,r:5},{id:'L',type:'poly',pts:[[-10,0],[10,0]]}];
t=trimAt(e4,[0,5],0.3); ok('Kreis → Bogen (untere Hälfte bleibt)', t.add.length===1 && t.add[0].curve==='arc' && t.add[0].pts[1][1]<-4.9, r(t.add[0]?.pts));
// arc trimmed by a line
const arc={id:'A',type:'poly',curve:'arc',pts:[[-5,0],[0,5],[5,0]]};
t=trimAt([arc,{id:'L',type:'poly',pts:[[0,-1],[0,9]]}],[3.5,3.6],0.3); ok('Bogen stutzen', t.add.length===1 && r(t.add[0].pts[2])==='[0,5]', r(t.add[0]?.pts));
// extend: line 0..3 towards vertical at x=5
let x=extendAt([{id:'h',type:'poly',pts:[[0,0],[3,0]]},{id:'v',type:'poly',pts:[[5,-5],[5,5]]}],[2.9,0],0.3); ok('Linie verlängern', x && r(x.pts)==='[[0,0],[5,0]]', r(x?.pts));
x=extendAt([{id:'h',type:'poly',pts:[[0,0],[3,0]]},{id:'C',type:'circle',cx:-6,cy:0,r:2}],[0.1,0],0.3); ok('Linie zum Kreis verlängern (Anfang)', x && r(x.pts)==='[[-4,0],[3,0]]', r(x?.pts));
x=extendAt([arc,{id:'L',type:'poly',pts:[[-10,-3],[10,-3]]}],[4.9,0.3],0.4); ok('Bogen verlängern', x && Math.abs(x.pts[2][1]+3)<1e-6, r(x?.pts));

// constraints move to the remaining pieces
{
  // polyline (0,0)-(10,0)-(10,10) cut by a line at y=5 → trim the upper part of the second segment
  const ents = [{ id: 'P', type: 'poly', pts: [[0, 0], [10, 0], [10, 10]] }, { id: 'X', type: 'poly', pts: [[5, 5], [15, 5]] }];
  const cons = [
    { id: 'c1', type: 'coincident', refs: ['P:p0', 'origin'] },        // start point stays → kept
    { id: 'c2', type: 'dim', kind: 'length', refs: ['P:l0'], value: 10 },  // untouched first edge → kept
    { id: 'c3', type: 'dim', kind: 'length', refs: ['P:l1'], value: 10 },  // trimmed edge → dropped
    { id: 'c4', type: 'coincident', refs: ['P:p2', 'Y:p0'] },          // removed end point → dropped
  ];
  const t = trimAt(ents, [10, 8], 0.4);
  const out = remapConstraints(cons, t, t.add.map((_, i) => 'N' + i));
  ok('Bemaßung/Abhängigkeit bleibt am Reststück', JSON.stringify(out.map(c => c.id + ':' + c.refs.join('~'))) === JSON.stringify(['c1:N0:p0~origin', 'c2:N0:l0']), JSON.stringify(out.map(c => c.id + ':' + c.refs.join('~'))));
}
{
  // rectangle: trim part of the bottom edge → corner constraints keep their corners, top-edge dimension stays
  const ents = [{ id: 'R', type: 'rect', x: 0, y: 0, w: 10, h: 6 }, { id: 'L', type: 'poly', pts: [[5, -2], [5, 8]] }];
  const cons = [{ id: 'w', type: 'dim', kind: 'length', refs: ['R:l2'], value: 10 }, { id: 'h', type: 'dim', kind: 'length', refs: ['R:l1'], value: 6 }, { id: 'o', type: 'coincident', refs: ['R:p0', 'origin'] }];
  const t = trimAt(ents, [7, 0], 0.4);
  const out = remapConstraints(cons, t, ['N']);
  const pts = t.add[0].pts;
  const at = ref => { const i = +ref.split(':p')[1]; return JSON.stringify(pts[i]); };
  ok('Rechteck: Maße und Ecke wandern mit', out.length === 3 && at(out[2].refs[0]) === '[0,0]', JSON.stringify(out.map(c => c.id + ':' + c.refs.join('~'))));
}
