import { clsx } from 'clsx'

function SpreadValue({ value }) {
  if (value == null) return <span className="text-ink">—</span>
  const cls = value > 0 ? 'spread-positive' : value < 0 ? 'spread-negative' : 'spread-neutral'
  const sign = value > 0 ? '+' : ''
  return <span className={cls}>{sign}{value.toFixed(2)}</span>
}

function HLValue({ value, type }) {
  if (value == null) return <span className="text-ink/40">—</span>
  const sign = value > 0 ? '+' : ''
  const cls  = type === 'high' ? 'text-emerald' : 'text-crimson'
  return <span className={clsx('font-mono font-semibold', cls)}>{sign}{value.toFixed(2)}</span>
}

export default function SpreadTableRow({
  strike1, strike2, current, dayHigh, dayLow,
  isSelected, onViewChart,
}) {
  return (
    <tr className={clsx(
      'border-b border-edge/40 hover:bg-panelLight/40 transition-colors cursor-pointer',
      isSelected && 'bg-cyan/5 border-l-2 border-l-cyan'
    )}>
      <td className="table-cell font-bold text-bright">{strike1}</td>
      <td className="table-cell text-ink">{strike2}</td>
      <td className="table-cell">
        <SpreadValue value={current} />
      </td>
      <td className="table-cell text-ink/40">—</td>
      <td className="table-cell">
        <HLValue value={dayHigh} type="high" />
      </td>
      <td className="table-cell">
        <HLValue value={dayLow} type="low" />
      </td>
      <td className="table-cell">
        <button
          onClick={onViewChart}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
            isSelected
              ? 'bg-cyan text-void'
              : 'bg-panelLight border border-edge text-ink hover:text-bright hover:border-cyan/50'
          )}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          View Chart
        </button>
      </td>
    </tr>
  )
}
