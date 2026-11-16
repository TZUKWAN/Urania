/** Parse an SVG path string into absolute segments: ['M',x,y], ['C',...], ['Q',...], ['L',...], ['Z']. */
export function parseSegments(d) {
	const source = String(d || '');
	if (source.length > 1024 * 1024) throw new Error('SVG path input limit exceeded');
	const token = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
	const tokens = [];
	for (let pos = 0; pos < source.length;) {
		if (/[\s,]/.test(source[pos])) { pos++; continue; }
		token.lastIndex = pos;
		const match = token.exec(source);
		if (!match) throw new Error('Invalid SVG path token at ' + pos);
		tokens.push(match[0]);
		if (tokens.length > 700000) throw new Error('SVG path token budget exceeded');
		pos = token.lastIndex;
	}
	const segs = [];
	const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
	const isCommand = (s) => /^[A-Za-z]$/.test(s || '');
	let i = 0, command = null, previous = null;
	let x = 0, y = 0, startX = 0, startY = 0, cubic = null, quadratic = null;
	const append = (segment) => {
		if (segs.length >= 100000) throw new Error('SVG path segment budget exceeded');
		if (!segment.slice(1).every(Number.isFinite)) throw new Error('Invalid SVG path coordinate');
		segs.push(segment);
	};
	while (i < tokens.length) {
		if (isCommand(tokens[i])) command = tokens[i++];
		if (!command) throw new Error('Invalid SVG path: coordinates require a command');
		const kind = command.toUpperCase(), relative = command !== kind;
		if (!segs.length && kind !== 'M') throw new Error('Invalid SVG path: must begin with moveto');
		if (kind === 'Z') {
			append(['Z']); x = startX; y = startY; previous = 'Z';
			cubic = quadratic = null; command = null;
			continue;
		}
		const n = arity[kind];
		if (!n || i + n > tokens.length || tokens.slice(i, i + n).some(isCommand)) throw new Error('Invalid SVG path operands for ' + kind);
		const a = tokens.slice(i, i + n).map(Number); i += n;
		if (!a.every(Number.isFinite)) throw new Error('Invalid SVG path coordinate');
		const ax = (value) => relative ? x + value : value;
		const ay = (value) => relative ? y + value : value;
		let nextCubic = null, nextQuadratic = null;
		if (kind === 'M' || kind === 'L') {
			x = ax(a[0]); y = ay(a[1]); append([kind, x, y]);
			if (kind === 'M') { startX = x; startY = y; command = relative ? 'l' : 'L'; }
		} else if (kind === 'H') { x = ax(a[0]); append(['L', x, y]); }
		else if (kind === 'V') { y = ay(a[0]); append(['L', x, y]); }
		else if (kind === 'C' || kind === 'S') {
			const first = kind === 'C' ? [ax(a[0]), ay(a[1])] : ((previous === 'C' || previous === 'S') && cubic ? [2*x-cubic[0], 2*y-cubic[1]] : [x,y]);
			const offset = kind === 'C' ? 2 : 0;
			const second = [ax(a[offset]), ay(a[offset+1])];
			const end = [ax(a[offset+2]), ay(a[offset+3])];
			append(['C', ...first, ...second, ...end]); nextCubic = second; [x,y] = end;
		} else if (kind === 'Q' || kind === 'T') {
			const control = kind === 'Q' ? [ax(a[0]), ay(a[1])] : ((previous === 'Q' || previous === 'T') && quadratic ? [2*x-quadratic[0],2*y-quadratic[1]] : [x,y]);
			const end = kind === 'Q' ? [ax(a[2]),ay(a[3])] : [ax(a[0]),ay(a[1])];
			append(['C', x+2/3*(control[0]-x), y+2/3*(control[1]-y), end[0]+2/3*(control[0]-end[0]), end[1]+2/3*(control[1]-end[1]), ...end]);
			nextQuadratic = control; [x,y] = end;
		} else if (kind === 'A') {
			if (![0,1].includes(a[3]) || ![0,1].includes(a[4]) || a[0] < 0 || a[1] < 0) throw new Error('Invalid SVG path arc parameters');
			const end = [ax(a[5]),ay(a[6])];
			if (x !== end[0] || y !== end[1]) {
				if (!a[0] || !a[1]) append(['L',...end]);
				else for (const b of arcToBeziers(x,y,a[0],a[1],a[2],a[3],a[4],...end)) append(['C',...b]);
			}
			[x,y] = end;
		}
		previous = kind; cubic = nextCubic; quadratic = nextQuadratic;
	}
	return segs;
}

/** SVG arc → cubic bezier segments (endpoint parameterization). */
export function arcToBeziers(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
	if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
	const phi = (phiDeg * Math.PI) / 180;
	const cosP = Math.cos(phi), sinP = Math.sin(phi);
	const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
	const x1p = cosP * dx2 + sinP * dy2, y1p = -sinP * dx2 + cosP * dy2;
	rx = Math.abs(rx); ry = Math.abs(ry);
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
	const sign = largeArc !== sweep ? 1 : -1;
	const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
	const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	if (den === 0) return [[x1, y1, x2, y2, x2, y2]];
	const co = sign * Math.sqrt(Math.max(0, num / den));
	const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
	const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
	const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
	const angle = (ux, uy, vx, vy) => {
		const dot = ux * vx + uy * vy;
		const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
		let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
		if (ux * vy - uy * vx < 0) a = -a;
		return a;
	};
	const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
	if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
	if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
	const segments = Math.ceil(Math.abs(dTheta) / (Math.PI / 2)) || 1;
	const delta = dTheta / segments;
	const t = 4 / 3 * Math.tan(delta / 4);
	const out = [];
	let th = theta1;
	for (let k = 0; k < segments; k++) {
		const th2 = th + delta;
		const p1 = pointOn(th), p2 = pointOn(th2);
		const d1 = derivative(th), d2 = derivative(th2);
		out.push([p1[0] + t * d1[0], p1[1] + t * d1[1], p2[0] - t * d2[0], p2[1] - t * d2[1], p2[0], p2[1]]);
		th = th2;
	}
	function pointOn(t2) {
		return [cx + rx * Math.cos(t2) * cosP - ry * Math.sin(t2) * sinP, cy + rx * Math.cos(t2) * sinP + ry * Math.sin(t2) * cosP];
	}
	function derivative(t2) {
		return [-rx * Math.sin(t2) * cosP - ry * Math.cos(t2) * sinP, -rx * Math.sin(t2) * sinP + ry * Math.cos(t2) * cosP];
	}
	return out;
}


export function transformPathData(d,m){
  if(!Array.isArray(m)||m.length!==6||!m.every(Number.isFinite))throw new Error('Invalid affine matrix');
  return parseSegments(d).map(([kind,...values])=>{
    const result=[];for(let i=0;i<values.length;i+=2)result.push(m[0]*values[i]+m[2]*values[i+1]+m[4],m[1]*values[i]+m[3]*values[i+1]+m[5]);
    return kind+(result.length?' '+result.join(' '):'');
  }).join(' ');
}
// Bounds include Bezier extrema, rather than only endpoints/control points.
export function pathBounds(d){
  const xs=[],ys=[];let current=[0,0],start=current;
  const point=(x,y)=>{xs.push(x);ys.push(y);};
  const roots=(p0,p1,p2,p3)=>{
    const a=-p0+3*p1-3*p2+p3,b=2*(p0-2*p1+p2),c=p1-p0;
    if(Math.abs(a)<1e-12)return Math.abs(b)<1e-12?[]:[-c/b];
    const disc=b*b-4*a*c;if(disc<0)return [];return [(-b+Math.sqrt(disc))/(2*a),(-b-Math.sqrt(disc))/(2*a)];
  };
  for(const [kind,...v] of parseSegments(d)){
    if(kind==='M'||kind==='L'){point(...v);current=v;if(kind==='M')start=v;}
    else if(kind==='C'){
      const [x0,y0]=current;point(x0,y0);point(v[4],v[5]);
      const evaluate=(p0,p1,p2,p3,t)=>(1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3*p3;
      for(const t of [...roots(x0,v[0],v[2],v[4]),...roots(y0,v[1],v[3],v[5])])if(t>0&&t<1)point(evaluate(x0,v[0],v[2],v[4],t),evaluate(y0,v[1],v[3],v[5],t));
      current=[v[4],v[5]];
    }else if(kind==='Z')current=start;
  }
  if(!xs.length)return {x:0,y:0,w:1,h:1};
  const min=arr=>arr.reduce((a,b)=>Math.min(a,b),Infinity),max=arr=>arr.reduce((a,b)=>Math.max(a,b),-Infinity);
  return {x:min(xs),y:min(ys),w:Math.max(1e-6,max(xs)-min(xs)),h:Math.max(1e-6,max(ys)-min(ys))};
}
export function vectorMatrix(layer){
  const b=layer.geometryBox;if(!b)return [1,0,0,1,0,0];
  const sx=layer.w/(b.w||1),sy=layer.h/(b.h||1);return [sx,0,0,sy,layer.x-b.x*sx,layer.y-b.y*sy];
}
