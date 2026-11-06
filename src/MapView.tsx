import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BOT_COLOR, DEATH_CODES, HUMAN_COLORS, MARKERS, MarkerGroup, MapData, HeatKind, heatMatches, fmtTime, shortId, EVENTS } from './data'
import { buildHeat } from './heatmap'

export interface Layers { paths: boolean; markers: Record<MarkerGroup, boolean>; heat: HeatKind; heatOpacity: number }

interface Props {
  data: MapData
  image: string
  rows: Int32Array          // rows passing match/date/actor filters (time not applied)
  time: number              // only rows with t <= time are drawn
  layers: Layers
  singleMatch: boolean
  onPickMatch: (id: string) => void
}

interface Hit { sx: number; sy: number; row: number }
interface View { k: number; tx: number; ty: number }

export default function MapView({ data, image, rows, time, layers, singleMatch, onPickMatch }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 800, h: 800 })
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; row: number } | null>(null)
  const hits = useRef<Hit[]>([])
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  // load minimap
  useEffect(() => {
    const im = new Image()
    im.onload = () => setImg(im)
    im.src = image
    setImg(null)
  }, [image])

  // size tracking
  useEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // bounding box of the current selection (single match → zoom to the action)
  const bbox = useMemo(() => {
    if (!singleMatch || !rows.length) return null
    let x0 = 1024, y0 = 1024, x1 = 0, y1 = 0
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k]
      x0 = Math.min(x0, data.x[i]); x1 = Math.max(x1, data.x[i])
      y0 = Math.min(y0, data.y[i]); y1 = Math.max(y1, data.y[i])
    }
    const pad = 60, min = 260
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const span = Math.max(min, x1 - x0 + pad * 2, y1 - y0 + pad * 2)
    return { cx, cy, span }
  }, [singleMatch, rows, data])

  const fitAll = useCallback((): View => {
    const k = Math.min(size.w, size.h) / 1024 * 0.96
    return { k, tx: (size.w - 1024 * k) / 2, ty: (size.h - 1024 * k) / 2 }
  }, [size])
  const fit = useCallback((): View => {
    if (!bbox) return fitAll()
    const k = Math.min(size.w, size.h) / bbox.span
    return { k, tx: size.w / 2 - bbox.cx * k, ty: size.h / 2 - bbox.cy * k }
  }, [size, bbox, fitAll])
  useEffect(() => { setView(fit()) }, [fit, data.map])

  // rows visible at current time
  const visible = useMemo(() => {
    const out: number[] = []
    for (let k = 0; k < rows.length; k++) if (data.t[rows[k]] <= time) out.push(rows[k])
    return out
  }, [rows, time, data])

  const heat = useMemo(() => {
    if (layers.heat === 'none') return null
    const idx = visible.filter(i => heatMatches(layers.heat, data.e[i]))
    const radius = layers.heat === 'traffic' ? 2 : 3
    return buildHeat(data.x, data.y, idx, radius)
  }, [visible, layers.heat, data])

  // colour per user within the current selection
  const userColor = useMemo(() => {
    const map = new Map<number, string>()
    let h = 0
    for (let k = 0; k < rows.length; k++) {
      const u = data.u[rows[k]]
      if (!map.has(u)) map.set(u, data.humans[u] ? HUMAN_COLORS[h++ % HUMAN_COLORS.length] : BOT_COLOR)
    }
    return map
  }, [rows, data])

  // ---- draw ----
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !view) return
    const dpr = window.devicePixelRatio || 1
    cv.width = size.w * dpr; cv.height = size.h * dpr
    cv.style.width = `${size.w}px`; cv.style.height = `${size.h}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#07090d'
    ctx.fillRect(0, 0, size.w, size.h)
    const { k, tx, ty } = view
    const SX = (x: number) => tx + x * k
    const SY = (y: number) => ty + y * k

    if (img) {
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, tx, ty, 1024 * k, 1024 * k)
    }
    if (heat) {
      ctx.save()
      ctx.globalAlpha = layers.heatOpacity
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(heat.canvas, tx, ty, 1024 * k, 1024 * k)
      ctx.restore()
      // dim the base a touch so the heat reads better? (keep map legible: no)
    }

    // paths: rows are sorted by match, user, t so each journey is a contiguous run
    if (layers.paths) {
      const many = !singleMatch
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      let i = 0
      while (i < visible.length) {
        const r0 = visible[i]
        const m = data.m[r0], u = data.u[r0]
        const human = data.humans[u] === 1
        ctx.beginPath()
        ctx.moveTo(SX(data.x[r0]), SY(data.y[r0]))
        let j = i + 1
        while (j < visible.length && data.m[visible[j]] === m && data.u[visible[j]] === u) {
          ctx.lineTo(SX(data.x[visible[j]]), SY(data.y[visible[j]]))
          j++
        }
        ctx.strokeStyle = many ? (human ? 'rgba(34,211,238,0.22)' : 'rgba(251,146,60,0.22)') : userColor.get(u)!
        ctx.lineWidth = many ? 0.9 : human ? 2.2 : 1.4
        ctx.setLineDash(human ? [] : [4, 3])
        ctx.globalAlpha = many ? 1 : human ? 0.95 : 0.7
        ctx.stroke()
        ctx.setLineDash([]); ctx.globalAlpha = 1

        // player head + death state during single-match playback
        if (singleMatch) {
          const last = visible[j - 1]
          let dead = false
          for (let q = i; q < j; q++) if (DEATH_CODES.has(data.e[visible[q]])) dead = true
          if (!dead) {
            ctx.beginPath()
            ctx.arc(SX(data.x[last]), SY(data.y[last]), human ? 5 : 3.5, 0, Math.PI * 2)
            ctx.fillStyle = userColor.get(u)!
            ctx.fill()
            ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'
            ctx.stroke()
          }
        }
        i = j
      }
    }

    // markers
    const newHits: Hit[] = []
    const sz = singleMatch ? 7 : 3.6
    // draw loot first (most numerous) so combat sits on top
    const order = [...visible].sort((a, b) => (data.e[a] === 7 ? 0 : 1) - (data.e[b] === 7 ? 0 : 1))
    for (const r of order) {
      const st = MARKERS[data.e[r]]
      if (!st || !layers.markers[st.group]) continue
      const x = SX(data.x[r]), y = SY(data.y[r])
      if (x < -10 || y < -10 || x > size.w + 10 || y > size.h + 10) continue
      drawMarker(ctx, st.shape, x, y, st.group === 'loot' ? sz * 0.7 : sz, st.color)
      newHits.push({ sx: x, sy: y, row: r })
    }
    hits.current = newHits
  }, [view, size, img, heat, visible, layers, data, singleMatch, userColor])

  // ---- interaction ----
  const onWheel = (ev: React.WheelEvent) => {
    if (!view) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
    const f = Math.exp(-ev.deltaY * 0.0015)
    const k = Math.min(Math.max(view.k * f, fitAll().k * 0.8), fitAll().k * 14)
    const r = k / view.k
    setView({ k, tx: mx - (mx - view.tx) * r, ty: my - (my - view.ty) * r })
  }
  const zoomBy = (f: number) => {
    if (!view) return
    const mx = size.w / 2, my = size.h / 2
    const k = Math.min(Math.max(view.k * f, fitAll().k * 0.8), fitAll().k * 14)
    const r = k / view.k
    setView({ k, tx: mx - (mx - view.tx) * r, ty: my - (my - view.ty) * r })
  }
  const findHit = (mx: number, my: number) => {
    let best: Hit | null = null, bd = 81
    for (const h of hits.current) {
      const d = (h.sx - mx) ** 2 + (h.sy - my) ** 2
      if (d < bd) { bd = d; best = h }
    }
    return best
  }
  const onMouseDown = (ev: React.MouseEvent) => { drag.current = { x: ev.clientX, y: ev.clientY, moved: false } }
  const onMouseMove = (ev: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
    if (drag.current && view) {
      const dx = ev.clientX - drag.current.x, dy = ev.clientY - drag.current.y
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true
      drag.current.x = ev.clientX; drag.current.y = ev.clientY
      setView({ ...view, tx: view.tx + dx, ty: view.ty + dy })
      setHover(null)
      return
    }
    const h = findHit(mx, my)
    setHover(h ? { x: mx, y: my, row: h.row } : null)
  }
  const onMouseUp = (ev: React.MouseEvent) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved && !singleMatch) {
      const rect = canvasRef.current!.getBoundingClientRect()
      const h = findHit(ev.clientX - rect.left, ev.clientY - rect.top)
      if (h) onPickMatch(data.matches[data.m[h.row]])
    }
  }

  const tip = hover && (() => {
    const r = hover.row
    const u = data.u[r]
    const st = MARKERS[data.e[r]]
    return (
      <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
        <div className="tip-title" style={{ color: st?.color }}>{st?.label ?? EVENTS[data.e[r]]}</div>
        <div>{data.humans[u] ? 'Human' : 'Bot'} <code>{shortId(data.users[u])}</code></div>
        <div>at {fmtTime(data.t[r])} into match</div>
        <div className="muted">match <code>{shortId(data.matches[data.m[r]])}</code> · px {data.x[r].toFixed(0)},{data.y[r].toFixed(0)}</div>
        {!singleMatch && <div className="muted">click to open this match</div>}
      </div>
    )
  })()

  return (
    <div className="mapwrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { drag.current = null; setHover(null) }}
        onDoubleClick={() => setView(fit())}
        style={{ cursor: hover ? 'pointer' : drag.current ? 'grabbing' : 'grab' }}
      />
      {!img && <div className="loading">Loading minimap…</div>}
      <div className="zoom">
        <button onClick={() => zoomBy(1.4)} title="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.4)} title="Zoom out">−</button>
        <button onClick={() => setView(fit())} title="Reset view">⤢</button>
      </div>
      {heat && <div className="heatinfo">{heat.count.toLocaleString()} events in heatmap</div>}
      {tip}
    </div>
  )
}

export function drawMarker(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, s: number, color: string) {
  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.fillStyle = color
  switch (shape) {
    case 'x':
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke()
      ctx.strokeStyle = color; ctx.lineWidth = 2.2
      ctx.stroke()
      break
    case 'skull':
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill()
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke()
      ctx.fillStyle = '#000'
      ctx.beginPath(); ctx.arc(x - s * 0.35, y - s * 0.15, s * 0.22, 0, Math.PI * 2); ctx.arc(x + s * 0.35, y - s * 0.15, s * 0.22, 0, Math.PI * 2); ctx.fill()
      break
    case 'bolt':
      ctx.beginPath()
      ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x + s * 1.1, y + s * 0.9); ctx.lineTo(x - s * 1.1, y + s * 0.9); ctx.closePath()
      ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke()
      ctx.fillStyle = '#000'; ctx.font = `bold ${s * 1.3}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('!', x, y + s * 0.25)
      break
    case 'diamond':
      ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath()
      ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.stroke()
      break
    default:
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}
