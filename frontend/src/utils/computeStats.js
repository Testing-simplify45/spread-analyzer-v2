/**
 * Compute day stats from actual spread close values.
 * Always use this instead of backend stats for display.
 */
export function computeStatsFromData(data) {
  if (!data || data.length === 0) return null
  const spreads = data.map(d => d.spread).filter(v => v != null)
  if (spreads.length === 0) return null
  const open    = spreads[0]
  const high    = Math.max(...spreads)
  const low     = Math.min(...spreads)
  const current = spreads[spreads.length - 1]
  const highIdx = spreads.indexOf(high)
  const lowIdx  = spreads.indexOf(low)
  return {
    open:      Math.round(open    * 100) / 100,
    high:      Math.round(high    * 100) / 100,
    low:       Math.round(low     * 100) / 100,
    current:   Math.round(current * 100) / 100,
    high_time: data[highIdx]?.timestamp || null,
    low_time:  data[lowIdx]?.timestamp  || null,
  }
}
