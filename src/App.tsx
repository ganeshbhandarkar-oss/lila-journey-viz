import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { Layers, drawMarker } from './MapView'
import {
  Index, MapData, MapId, MAP_LABEL, MARKERS, MarkerGroup, HEAT_LABEL, HeatKind, EV, DEATH_CODES, KILL_CODES,
  loadIndex, loadMap, asset, fmtTime, shortId, BOT_COLOR, HUMAN_COLORS,
} from './data'

type Sort = 'players' | 'combat' | 'duration' | 'loot'
const MAPS: MapId[] = ['AmbroseValley', 'GrandRift', 'Lockdown']
const SPEEDS = [1, 5, 15, 40]

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1))
  return {
    map: (MAPS.includes(p.get('map') as MapId) ? p.get('map') : 'AmbroseValley') as MapId,
    match: p.get('match'),
    dates: p.get('dates')?.split(',').filter(Boolean) ?? [],
    heat: (p.get('heat') as HeatKind) || 'none',
    t: p.get('t') != null ? Number(p.get('t')) : Infinity,
  }
}

export default function App() {
  const init = useMemo(readHash, [])
  const [index, setIndex] = useState<Index | null>(null)
  const [mapId, setMapId] = useState<MapId>(init.map)
  const [data, setData] = useState<MapData | null>(null)
  const [dates, setDates] = useState<string[]>(init.dates)
  const [matchId, setMatchId] = useState<string | null>(init.match)
  const [showHumans, setShowHumans] = useState(true)
  const [showBots, setShowBots] = useState(true)
  const [sort, setSort] = useState<Sort>('players')
  const [search, setSearch] = useState('')
  const [layers, setLayers] = useState<Layers>(() => applyHeat({
    paths: true, heat: 'none', heatOpacity: 0.8,
    markers: { kills: true, deaths: true, storm: true, loot: true },
  }, init.heat))
  const [time, setTime] = useState(init.t)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(15)

  useEffect(() => { loadIndex().then(setIndex) }, [])
  useEffect(() => { setData(null); loadMap(mapId).then(setData) }, [mapId])

  // keep the URL shareable
  useEffect(() => {
    const p = new URLSearchParams({ map: mapId })
    if (matchId) p.set('match', matchId)
    if (dates.length) p.set('dates', dates.join(','))
    if (layers.heat !== 'none') p.set('heat', layers.heat)
    if (!playing && Number.isFinite(time)) p.set('t', String(Math.round(time)))
    history.replaceState(null, '', `#${p}`)
  }, [mapId, matchId, dates, layers.heat, playing, time])

  const matchesOnMap = useMemo(() => {
    if (!index) return []
    return index.matches.filter(m => m.map === mapId && (!dates.length || dates.includes(m.date)))
  }, [index, mapId, dates])

  const sortedMatches = useMemo(() => {
    const score = (m: Index['matches'][number]) => {
      const e = m.events
      switch (sort) {
        case 'players': return (m.humans + m.bots) * 100 + m.humans
        case 'combat': return (e.Kill ?? 0) + (e.BotKill ?? 0) + (e.Killed ?? 0) + (e.BotKilled ?? 0) + (e.KilledByStorm ?? 0)
        case 'duration': return m.duration
        case 'loot': return e.Loot ?? 0
      }
    }
    const q = search.trim().toLowerCase()
    return matchesOnMap.filter(m => !q || m.id.includes(q)).sort((a, b) => score(b) - score(a))
  }, [matchesOnMap, sort, search])

  const match = matchId ? index?.matches.find(m => m.id === matchId) ?? null : null
  // drop a selected match that doesn't belong to the current map / dates
  useEffect(() => {
    if (index && matchId && !matchesOnMap.some(m => m.id === matchId)) setMatchId(null)
  }, [index, matchesOnMap, matchId])

  const rows = useMemo(() => {
    if (!data) return new Int32Array()
    const allowed = new Set(matchesOnMap.map(m => data.matchIndex.get(m.id)!))
    const only = match ? data.matchIndex.get(match.id)! : -1
    const out: number[] = []
    for (let i = 0; i < data.m.length; i++) {
      const m = data.m[i]
      if (only >= 0 ? m !== only : !allowed.has(m)) continue
      const human = data.humans[data.u[i]] === 1
      if (human ? !showHumans : !showBots) continue
      out.push(i)
    }
    return Int32Array.from(out)
  }, [data, matchesOnMap, match, showHumans, showBots])

  const maxT = useMemo(() => {
    if (match) return match.duration
    return matchesOnMap.reduce((a, m) => Math.max(a, m.duration), 0)
  }, [match, matchesOnMap])
  const t = Math.min(time, maxT)

  // reset timeline when the selection changes
  const firstSel = useRef(true)
  useEffect(() => {
    if (firstSel.current) { firstSel.current = false; return }
    setPlaying(false); setTime(Infinity)
  }, [matchId, mapId])

  // playback loop
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (!playing) { last.current = null; return }
    let raf = 0
    const tick = (now: number) => {
      if (last.current != null) {
        const dt = (now - last.current) / 1000
        setTime(prev => {
          const next = Math.min(prev, maxT) + dt * speed
          if (next >= maxT) { setPlaying(false); return maxT }
          return next
        })
      }
      last.current = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, maxT])

  const togglePlay = () => {
    if (!playing && t >= maxT) setTime(0)
    setPlaying(p => !p)
  }

  // keyboard: space = play/pause
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); togglePlay() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const stats = useMemo(() => {
    const s = { humans: new Set<number>(), bots: new Set<number>(), pvp: 0, botKills: 0, byBot: 0, byPlayer: 0, storm: 0, loot: 0 }
    if (!data) return s
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k]
      if (data.t[i] > t) continue
      const u = data.u[i]
      ;(data.humans[u] ? s.humans : s.bots).add(u)
      const e = data.e[i]
      if (e === EV.Kill) s.pvp++
      else if (e === EV.BotKill) s.botKills++
      else if (e === EV.BotKilled) s.byBot++
      else if (e === EV.Killed) s.byPlayer++
      else if (e === EV.KilledByStorm) s.storm++
      else if (e === EV.Loot) s.loot++
    }
    return s
  }, [data, rows, t])

  // timeline ticks for single-match mode
  const ticks = useMemo(() => {
    if (!data || !match || !maxT) return []
    const out: { left: number; color: string; title: string }[] = []
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], e = data.e[i]
      if (KILL_CODES.has(e) || DEATH_CODES.has(e)) {
        const st = MARKERS[e]!
        out.push({ left: (data.t[i] / maxT) * 100, color: st.color, title: `${st.label} @ ${fmtTime(data.t[i])}` })
      }
    }
    return out
  }, [data, match, rows, maxT])

  const toggleDate = (d: string) => setDates(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d])
  const setMarker = (g: MarkerGroup, v: boolean) => setLayers(l => ({ ...l, markers: { ...l.markers, [g]: v } }))
  const copyLink = () => navigator.clipboard?.writeText(location.href)

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="dot" />LILA BLACK <span className="thin">Player Journey Explorer</span></div>
        <div className="maptabs">
          {MAPS.map(m => (
            <button key={m} className={m === mapId ? 'active' : ''} onClick={() => { setMapId(m); setMatchId(null) }}>
              {MAP_LABEL[m]}
              <span className="count">{index?.matches.filter(x => x.map === m).length ?? ''}</span>
            </button>
          ))}
        </div>
        <button className="ghost" onClick={copyLink} title="Copy a link to this exact view">🔗 Copy link</button>
      </header>

      <aside className="left">
        <section>
          <h3>Dates</h3>
          <div className="chips">
            <button className={!dates.length ? 'chip on' : 'chip'} onClick={() => setDates([])}>All</button>
            {index?.dates.map(d => (
              <button key={d} className={dates.includes(d) ? 'chip on' : 'chip'} onClick={() => toggleDate(d)}>
                {d}{d === 'Feb 14' ? '*' : ''}
              </button>
            ))}
          </div>
          <div className="hint">* Feb 14 is a partial day</div>
        </section>
        <section>
          <h3>Who</h3>
          <label className="toggle"><input type="checkbox" checked={showHumans} onChange={e => setShowHumans(e.target.checked)} />
            <span className="sw" style={{ background: HUMAN_COLORS[0] }} />Humans</label>
          <label className="toggle"><input type="checkbox" checked={showBots} onChange={e => setShowBots(e.target.checked)} />
            <span className="sw dashed" style={{ borderColor: BOT_COLOR }} />Bots</label>
        </section>
        <section className="matches">
          <h3>Matches <span className="muted">({matchesOnMap.length})</span></h3>
          <div className="matchtools">
            <input placeholder="Search match id…" value={search} onChange={e => setSearch(e.target.value)} />
            <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
              <option value="players">Most players</option>
              <option value="combat">Most combat</option>
              <option value="loot">Most loot</option>
              <option value="duration">Longest</option>
            </select>
          </div>
          <div className="list">
            <button className={!matchId ? 'match on' : 'match'} onClick={() => setMatchId(null)}>
              <div className="mtitle">All matches · aggregate</div>
              <div className="mmeta">{matchesOnMap.length} matches overlaid — use heatmaps</div>
            </button>
            {sortedMatches.map(m => {
              const e = m.events
              const combat = (e.Kill ?? 0) + (e.BotKill ?? 0)
              const deaths = (e.Killed ?? 0) + (e.BotKilled ?? 0) + (e.KilledByStorm ?? 0)
              return (
                <button key={m.id} className={m.id === matchId ? 'match on' : 'match'} onClick={() => setMatchId(m.id)}>
                  <div className="mtitle"><code>{shortId(m.id)}</code><span className="muted">{m.date} · {fmtTime(m.duration)}</span></div>
                  <div className="mmeta">
                    <span title="humans" style={{ color: HUMAN_COLORS[0] }}>👤 {m.humans}</span>
                    <span title="bots with recorded journeys" style={{ color: BOT_COLOR }}>🤖 {m.bots}</span>
                    <span title="kills" style={{ color: '#ffb020' }}>✕ {combat}</span>
                    <span title="deaths" style={{ color: '#f472b6' }}>☠ {deaths}</span>
                    <span title="loot" style={{ color: '#4ade80' }}>◆ {e.Loot ?? 0}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </aside>

      <main>
        {data && index ? (
          <MapView
            data={data}
            image={asset(index.maps[mapId].image)}
            rows={rows}
            time={t}
            layers={layers}
            singleMatch={!!match}
            onPickMatch={id => setMatchId(id)}
          />
        ) : <div className="loading big">Loading {MAP_LABEL[mapId]} telemetry…</div>}

        <div className="timeline">
          <button className="play" onClick={togglePlay} title="Play / pause (space)">{playing ? '❚❚' : '▶'}</button>
          <div className="tl-time">{fmtTime(t)} <span className="muted">/ {fmtTime(maxT)}</span></div>
          <div className="tl-track">
            <input type="range" min={0} max={maxT || 1} step={1} value={t}
              onChange={e => { setPlaying(false); setTime(Number(e.target.value)) }} />
            <div className="ticks">
              {ticks.map((k, i) => <span key={i} style={{ left: `${k.left}%`, background: k.color }} title={k.title} />)}
            </div>
          </div>
          <div className="speeds">
            {SPEEDS.map(s => <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
          <div className="tl-label muted">{match ? 'Match clock' : 'Time since match start (all matches)'}</div>
        </div>
      </main>

      <aside className="right">
        <section>
          <h3>{match ? <>Match <code>{shortId(match.id)}</code></> : 'Selection'}</h3>
          <div className="statgrid">
            <Stat label="Humans" value={stats.humans.size} color={HUMAN_COLORS[0]} />
            <Stat label="Bots" value={stats.bots.size} color={BOT_COLOR} />
            <Stat label="Bot kills" value={stats.botKills} color="#ffb020" />
            <Stat label="PvP kills" value={stats.pvp} color="#ff3b5c" />
            <Stat label="Killed by bot" value={stats.byBot} color="#f472b6" />
            <Stat label="Killed by player" value={stats.byPlayer} color="#ff3b5c" />
            <Stat label="Storm deaths" value={stats.storm} color="#a78bfa" />
            <Stat label="Loot pickups" value={stats.loot} color="#4ade80" />
          </div>
          {match && <div className="hint">{match.date} · {fmtTime(match.duration)} long · full id <code className="wrap">{match.id}</code></div>}
        </section>

        <section>
          <h3>Heatmap</h3>
          <div className="seg">
            {(Object.keys(HEAT_LABEL) as HeatKind[]).map(k => (
              <button key={k} className={layers.heat === k ? 'on' : ''} onClick={() => setLayers(l => applyHeat(l, k))}>{HEAT_LABEL[k]}</button>
            ))}
          </div>
          {layers.heat !== 'none' && (
            <>
              <div className="gradient" />
              <div className="gradlabels"><span>low</span><span>high</span></div>
              <label className="slider">Opacity
                <input type="range" min={0.2} max={1} step={0.05} value={layers.heatOpacity}
                  onChange={e => setLayers(l => ({ ...l, heatOpacity: Number(e.target.value) }))} />
              </label>
            </>
          )}
        </section>

        <section>
          <h3>Layers</h3>
          <label className="toggle"><input type="checkbox" checked={layers.paths} onChange={e => setLayers(l => ({ ...l, paths: e.target.checked }))} />
            <span className="sw line" style={{ background: HUMAN_COLORS[0] }} />Movement paths</label>
          {(['kills', 'deaths', 'storm', 'loot'] as MarkerGroup[]).map(g => (
            <label key={g} className="toggle">
              <input type="checkbox" checked={layers.markers[g]} onChange={e => setMarker(g, e.target.checked)} />
              <span className="toggle-name">{{ kills: 'Kills', deaths: 'Deaths', storm: 'Storm deaths', loot: 'Loot' }[g]}</span>
            </label>
          ))}
        </section>

        <section>
          <h3>Legend</h3>
          <div className="legend">
            <div><span className="sw line" style={{ background: HUMAN_COLORS[0] }} />Human path (one colour per player)</div>
            <div><span className="sw line dashed" style={{ borderColor: BOT_COLOR }} />Bot path (dashed)</div>
            {Object.values(MARKERS).map(st => st && (
              <div key={st.label}><LegendIcon shape={st.shape} color={st.color} />{st.label}</div>
            ))}
          </div>
          <div className="hint">Scroll to zoom · drag to pan · double-click to reset. {match ? 'Space plays the match.' : 'Click any marker to open its match.'}</div>
        </section>
      </aside>
    </div>
  )
}

// Picking a heatmap hides the busy layers so the density reads clearly;
// turning it off brings them back. Users can still re-enable layers manually.
function applyHeat(l: Layers, heat: HeatKind): Layers {
  if (heat === 'none') return { ...l, heat, paths: true, markers: { kills: true, deaths: true, storm: true, loot: true } }
  if (l.heat === 'none') return { ...l, heat, paths: false, markers: { kills: false, deaths: false, storm: heat === 'storm', loot: false } }
  return { ...l, heat }
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="stat"><div className="sv" style={{ color }}>{value.toLocaleString()}</div><div className="sl">{label}</div></div>
}

function LegendIcon({ shape, color }: { shape: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!, dpr = window.devicePixelRatio || 1
    c.width = 18 * dpr; c.height = 18 * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    drawMarker(ctx, shape, 9, 9, shape === 'diamond' ? 5 : 6, color)
  }, [shape, color])
  return <canvas ref={ref} style={{ width: 18, height: 18 }} className="legicon" />
}
