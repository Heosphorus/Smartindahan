export type PaymentMethod = 'Cash' | 'GCash' | 'Maya' | 'Bank Transfer' | 'Credit'

export type Currency = number

export interface Product {
  id: string
  name: string
  barcode?: string
  barcodeType?: string
  sku?: string
  qrCode?: string
  hasBarcode: boolean
  category: string
  brand?: string
  supplier?: string
  costPrice: number
  sellingPrice: number
  currentStock: number
  minStock: number
  unit: string
  image?: string
  status: 'active' | 'inactive'
  createdAt?: string
}

export interface CartItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  costPrice: number
}

export interface InventoryMovement {
  id: string
  productId: string
  productName: string
  type: 'stock_in' | 'stock_out' | 'sale' | 'adjustment' | 'refund'
  quantity: number
  previousStock: number
  newStock: number
  barcode?: string
  referenceId?: string
  timestamp: string
  userId?: string
  storeId?: string
  note?: string
}

export interface ScanHistoryEntry {
  id: string
  user: string
  store: string
  product?: string
  barcode: string
  scanType: 'POS' | 'Stock-in' | 'Stock-out' | 'Inventory count' | 'Product registration'
  quantity: number
  date: string
  time: string
}

export interface DashboardStats {
  todaySales: number
  transactions: number
  estimatedProfit: number
  outstandingUtang: number
  inventoryValue: number
  lowStockCount: number
  topSellingProducts: { name: string; sold: number }[]
}
