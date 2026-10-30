import { useEffect, useState } from 'react'

import { businessApi, type RestockInsights, type RestockStatus } from '../../services/businessApi'
import './RestockSuggestions.css'

const STATUS_LABEL: Record<RestockStatus, string> = { out: 'Out of stock', urgent: 'Order now', soon: 'Order soon', low: 'Below minimum' }
const COVER_OPTIONS = [7, 14, 30] as const
const peso = (value: number) => `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function RestockSuggestions() {
  const [coverDays, setCoverDays] = useState<number>(14)
  const [insights, setInsights] = useState<RestockInsights | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    businessApi.restockInsights(coverDays)
      .then((result) => { if (active) { setInsights(result); setError('') } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Restock suggestions could not be loaded.') })
    return () => { active = false }
  }, [coverDays, attempt])

  return (
    <section className="restock" aria-labelledby="restock-heading">
      <div className="restock-heading">
        <div>
          <h3 id="restock-heading">Restock suggestions</h3>
          <p>Worked out from your sales in the last 30 days. No outside service is used and nothing leaves your store data.</p>
        </div>
        <label className="restock-cover">
          Stock to cover
          <select value={coverDays} onChange={(event) => setCoverDays(Number(event.target.value))}>
            {COVER_OPTIONS.map((days) => <option key={days} value={days}>{days} days of sales</option>)}
          </select>
        </label>
      </div>

      {error && <p className="dashboard-error" role="alert">{error} <button type="button" className="btn-secondary" onClick={() => setAttempt((count) => count + 1)}>Try again</button></p>}
      {!insights && !error && <p className="loading-block" role="status"><span className="spinner" aria-hidden="true" />Calculating…</p>}

      {insights && (
        <>
          <p className="restock-summary" role="status">
            {insights.summary.needsRestock === 0
              ? 'Nothing needs restocking right now.'
              : `${insights.summary.needsRestock} product${insights.summary.needsRestock === 1 ? '' : 's'} need restocking (${insights.summary.out} out of stock). Suggested order cost: about ${peso(insights.summary.estimatedOrderCost)}.`}
          </p>

          {insights.suggestions.length > 0 && (
            <div className="restock-table-wrap">
              <table className="restock-table">
                <caption className="sr-only">Products to restock, most urgent first</caption>
                <thead>
                  <tr><th scope="col">Product</th><th scope="col">Status</th><th scope="col">In stock</th><th scope="col">Sold (30 days)</th><th scope="col">Days left</th><th scope="col">Suggested order</th><th scope="col">Est. cost</th></tr>
                </thead>
                <tbody>
                  {insights.suggestions.map((entry) => (
                    <tr key={entry.productId}>
                      <th scope="row">
                        {entry.name}
                        <small>{entry.reason}{entry.confidence === 'low' ? ' Little sales history, so treat this as a rough guide.' : ''}</small>
                      </th>
                      <td><span className={`restock-badge restock-${entry.status}`}>{STATUS_LABEL[entry.status]}</span></td>
                      <td>{entry.currentStock} {entry.unit}</td>
                      <td>{entry.soldLast30Days}</td>
                      <td>{entry.daysOfStockLeft ?? '—'}</td>
                      <td>{entry.suggestedOrderQuantity > 0 ? `${entry.suggestedOrderQuantity} ${entry.unit}` : '—'}</td>
                      <td>{entry.suggestedOrderQuantity > 0 ? peso(entry.estimatedCost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {insights.slowMovers.length > 0 && (
            <>
              <h4>Slow movers</h4>
              <p>In stock for over 30 days with no sales: about {peso(insights.summary.moneyTiedInSlowMovers)} of stock at cost.</p>
              <ul className="restock-slow">
                {insights.slowMovers.slice(0, 10).map((entry) => <li key={entry.productId}>{entry.name} — {entry.currentStock} {entry.unit} ({peso(entry.stockValue)})</li>)}
              </ul>
            </>
          )}
          <p className="restock-method">{insights.method}</p>
        </>
      )}
    </section>
  )
}
