// The radar: a hand-drawn map of Solara Bay rendered once to an offscreen
// canvas, then rotated under the player each frame with blips on top.
export function createMinimap(city) {
  const SIZE = 900; // world metres covered by the static map
  const MAP_PX = 1024;
  const staticMap = document.createElement('canvas');
  staticMap.width = MAP_PX;
  staticMap.height = MAP_PX;
  const ctx = staticMap.getContext('2d');
  const scale = MAP_PX / SIZE;
  const toPx = (v) => (v + SIZE / 2) * scale;

  // water
  ctx.fillStyle = '#123a4d';
  ctx.fillRect(0, 0, MAP_PX, MAP_PX);
  // land
  const half = city.landHalf;
  ctx.fillStyle = '#3d4238';
  ctx.fillRect(toPx(-half), toPx(-half), half * 2 * scale, half * 2 * scale);
  // beach
  ctx.fillStyle = '#8c7d55';
  ctx.fillRect(toPx(city.beach.x0), toPx(-half), (city.beach.x1 - city.beach.x0) * scale, half * 2 * scale);
  // blocks
  for (const b of city.blocks) {
    ctx.fillStyle = b.district === 'park' ? '#2f5a34' : '#4a4a44';
    ctx.fillRect(toPx(b.minX), toPx(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
  }
  // roads
  ctx.strokeStyle = '#9aa0a6';
  ctx.lineCap = 'butt';
  for (const r of city.mapRoads) {
    ctx.lineWidth = Math.max(1.6, r.w * scale * 0.85);
    ctx.beginPath();
    ctx.moveTo(toPx(r.x0), toPx(r.z0));
    ctx.lineTo(toPx(r.x1), toPx(r.z1));
    ctx.stroke();
  }
  // district tint labels
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.textAlign = 'center';
  const labels = [
    ['SUNSET STRIP', city.beach.x1 - 40, -260],
    ['CENTRICO', 0, 0],
    ['LITTLE HABANA', 300, 140],
    ['PUERTO DOCKS', -20, -330],
    ['PARQUE ROJO', 60, 360],
  ];
  for (const [text, x, z] of labels) ctx.fillText(text, toPx(x), toPx(z));

  return function draw(canvas, player, blips, opts = {}) {
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = w / 2;
    const zoom = opts.zoom ?? 2.6; // pixels per metre on screen
    g.save();
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.closePath();
    g.clip();
    g.fillStyle = '#101418';
    g.fillRect(0, 0, w, h);
    g.translate(cx, cy);
    // turn the world so the direction Rico faces points up the radar
    g.rotate(player.heading + Math.PI);
    g.save();
    const k = zoom / scale; // static-map pixels to radar pixels
    g.scale(k, k);
    g.drawImage(staticMap, -player.pos.x * scale - MAP_PX / 2, -player.pos.z * scale - MAP_PX / 2);
    g.restore();

    // blips
    for (const b of blips) {
      const bx = (b.x - player.pos.x) * zoom;
      const bz = (b.z - player.pos.z) * zoom;
      if (Math.hypot(bx, bz) > radius - 6) continue;
      g.fillStyle = b.color;
      if (b.kind === 'mission') {
        g.beginPath();
        g.moveTo(bx, bz - 6);
        g.lineTo(bx + 5, bz + 4);
        g.lineTo(bx - 5, bz + 4);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 1;
        g.stroke();
      } else if (b.kind === 'police') {
        g.beginPath();
        g.arc(bx, bz, 3.4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#0a1c3a';
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.beginPath();
        g.arc(bx, bz, 2.6, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();

    // player arrow
    g.save();
    g.translate(cx, cy);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.6, 6);
    g.lineTo(0, 3.4);
    g.lineTo(-5.6, 6);
    g.closePath();
    g.fill();
    g.restore();

    // chrome
    g.strokeStyle = 'rgba(12,16,20,0.95)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, radius - 4, 0, Math.PI * 2);
    g.stroke();

    // north marker nudged to the rim
    const theta = player.heading + Math.PI;
    const nx = cx + Math.sin(theta) * (radius - 12);
    const ny = cy - Math.cos(theta) * (radius - 12);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny);
  };
}
