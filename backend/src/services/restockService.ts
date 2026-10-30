import type { Types } from 'mongoose'

import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { roundMoney } from '../utils/validation.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const SALES_WINDOW_DAYS = 30
const MIN_OBSERVED_DAYS = 7
const URGENT_DAYS = 3
const SOON_DAYS = 7
export const DEFAULT_COVER_DAYS = 14
const MAX_ROWS = 100

export type RestockStatus = 'out' | 'urgent' | 'soon' | 'low'

export type ProductInput = { id: string; name: string; unit: string; currentStock: number; minStock: number; costPrice: number; createdAt: Date }
export type SalesInput = Map<string, number>

export type RestockSuggestion = {
  productId: string
  name: string
  unit: string
  status: RestockStatus
  currentStock: number
  minStock: number
  soldLast30Days: number
  averageDailySales: number
  daysOfStockLeft: number | null
  suggestedOrderQuantity: number
  estimatedCost: number
  confidence: 'ok' | 'low'
  reason: string
}

export type SlowMover = { productId: string; name: string; unit: string; currentStock: number; stockValue: number; daysInCatalog: number }

export type RestockInsights = {
  generatedAt: string
  windowDays: number
  coverDays: number
  summary: { needsRestock: number; out: number; urgent: number; estimatedOrderCost: number; slowMovers: number; moneyTiedInSlowMovers: number }
  suggestions: RestockSuggestion[]
  slowMovers: SlowMover[]
  method: string
}

const statusRank: Record<RestockStatus, number> = { out: 0, urgent: 1, soon: 2, low: 3 }

function round(value: number, places = 1): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Pure calculation (no database): average daily sales over the recent window, how many days the stock lasts at that
 * pace, and how much to order to cover `coverDays`. It is an estimate from past sales only: it knows nothing about
 * holidays, supplier lead times or price changes, and says so through `confidence` and `reason`.
 */
export function buildRestockInsights(products: ProductInput[], unitsSold: SalesInput, now: Date, coverDays = DEFAULT_COVER_DAYS): RestockInsights {
  const suggestions: RestockSuggestion[] = []
  const slowMovers: SlowMover[] = []

  for (const product of products) {
    const sold = unitsSold.get(product.id) ?? 0
    const daysInCatalog = Math.max(1, Math.floor((now.getTime() - product.createdAt.getTime()) / DAY_MS))
    // A product added recently has less history; never divide by fewer than a week or one sale would look like a trend.
    const observedDays = Math.min(SALES_WINDOW_DAYS, Math.max(daysInCatalog, MIN_OBSERVED_DAYS))
    const averageDaily = sold / observedDays
    const daysLeft = averageDaily > 0 ? product.currentStock / averageDaily : null

    let status: RestockStatus | null = null
    let reason = ''
    if (product.currentStock === 0 && (sold > 0 || product.minStock > 0)) {
      status = 'out'
      reason = sold > 0 ? `Out of stock and sells about ${round(averageDaily)} per day.` : 'Out of stock.'
    } else if (daysLeft !== null && daysLeft <= URGENT_DAYS) {
      status = 'urgent'
      reason = `About ${round(daysLeft)} day(s) of stock left at the recent pace.`
    } else if (daysLeft !== null && daysLeft <= SOON_DAYS) {
      status = 'soon'
      reason = `About ${round(daysLeft)} day(s) of stock left at the recent pace.`
    } else if (product.minStock > 0 && product.currentStock <= product.minStock) {
      status = 'low'
      reason = `At or below your minimum stock of ${product.minStock}.`
    }

    if (status) {
      const target = Math.max(Math.ceil(averageDaily * coverDays), product.minStock)
      const suggestedOrderQuantity = Math.max(0, target - product.currentStock)
      suggestions.push({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        status,
        currentStock: product.currentStock,
        minStock: product.minStock,
        soldLast30Days: sold,
        averageDailySales: round(averageDaily, 2),
        daysOfStockLeft: daysLeft === null ? null : round(daysLeft),
        suggestedOrderQuantity,
        estimatedCost: roundMoney(suggestedOrderQuantity * product.costPrice),
        confidence: daysInCatalog < 14 || sold < 5 ? 'low' : 'ok',
        reason,
      })
    } else if (sold === 0 && product.currentStock > 0 && daysInCatalog >= SALES_WINDOW_DAYS) {
      slowMovers.push({ productId: product.id, name: product.name, unit: product.unit, currentStock: product.currentStock, stockValue: roundMoney(product.currentStock * product.costPrice), daysInCatalog })
    }
  }

  suggestions.sort((a, b) => statusRank[a.status] - statusRank[b.status] || (a.daysOfStockLeft ?? Infinity) - (b.daysOfStockLeft ?? Infinity) || a.name.localeCompare(b.name))
  slowMovers.sort((a, b) => b.stockValue - a.stockValue)

  return {
    generatedAt: now.toISOString(),
    windowDays: SALES_WINDOW_DAYS,
    coverDays,
    summary: {
      needsRestock: suggestions.length,
      out: suggestions.filter((entry) => entry.status === 'out').length,
      urgent: suggestions.filter((entry) => entry.status === 'urgent').length,
      estimatedOrderCost: roundMoney(suggestions.reduce((total, entry) => total + entry.estimatedCost, 0)),
      slowMovers: slowMovers.length,
      moneyTiedInSlowMovers: roundMoney(slowMovers.reduce((total, entry) => total + entry.stockValue, 0)),
    },
    suggestions: suggestions.slice(0, MAX_ROWS),
    slowMovers: slowMovers.slice(0, MAX_ROWS),
    method: `Based on units sold in the last ${SALES_WINDOW_DAYS} days. Suggested quantities cover about ${coverDays} days of sales or your minimum stock, whichever is higher. This is an estimate from past sales only; check it against what you know about your suppliers and season.`,
  }
}

export async function restockInsightsForStore(storeId: Types.ObjectId, coverDays = DEFAULT_COVER_DAYS, now = new Date()): Promise<RestockInsights> {
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * DAY_MS)
  const [products, sold] = await Promise.all([
    ProductModel.find({ storeId, status: 'active' }).select('name unit currentStock minStock costPrice createdAt').lean(),
    SaleModel.aggregate<{ _id: Types.ObjectId; quantity: number }>([
      { $match: { storeId, createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', quantity: { $sum: '$items.quantity' } } },
    ]),
  ])
  const unitsSold: SalesInput = new Map(sold.map((row) => [row._id.toString(), row.quantity]))
  return buildRestockInsights(
    products.map((product) => ({ id: product._id.toString(), name: product.name, unit: product.unit, currentStock: product.currentStock, minStock: product.minStock, costPrice: product.costPrice, createdAt: (product as { createdAt?: Date }).createdAt ?? now })),
    unitsSold,
    now,
    coverDays,
  )
}
