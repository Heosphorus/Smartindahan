export type BarcodeType =
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'CODE_128'
  | 'QR_CODE'

export type InventoryEventType =
  | 'sale'
  | 'stock_in'
  | 'stock_out'
  | 'inventory_count'
  | 'adjustment'
  | 'refund'
  | 'product_registration'

export interface ProductBarcodeFields {
  barcode?: string
  barcodeType?: BarcodeType
  sku?: string
  qrCode?: string
  hasBarcode: boolean
}

export interface BarcodeScanRequest {
  storeId: string
  userId: string
  scanType: 'POS' | 'Stock-in' | 'Stock-out' | 'Inventory count' | 'Product registration'
  rawValue: string
  source: 'camera' | 'manual' | 'image-upload'
  action: 'sale' | 'stock_in' | 'stock_out' | 'inventory_count' | 'product_registration'
}

export interface BarcodeLookupResponse {
  found: boolean
  productId?: string
  productName?: string
  barcode?: string
  barcodeType?: BarcodeType
  currentStock?: number
  sellPrice?: number
  costPrice?: number
  message: string
}

export interface InventoryTransaction {
  id: string
  productId: string
  storeId: string
  userId: string
  type: InventoryEventType
  quantity: number
  previousStock: number
  newStock: number
  barcode?: string
  referenceId?: string
  timestamp: string
  note?: string
}

export interface StockInRequest {
  storeId: string
  userId: string
  supplierId: string
  items: Array<{
    productId: string
    quantity: number
    unitCost: number
    barcode?: string
  }>
  note?: string
}

export interface StockOutRequest {
  storeId: string
  userId: string
  productId: string
  quantity: number
  reason: 'Damaged' | 'Expired' | 'Spoiled' | 'Lost' | 'Personal use' | 'Other'
  barcode?: string
  note?: string
}

export interface InventoryCountRequest {
  storeId: string
  userId: string
  counts: Array<{
    productId: string
    scannedQuantity: number
    systemQuantity: number
    difference: number
    barcode?: string
  }>
  note?: string
}

export interface BarcodeInventoryApiContract {
  endpoints: {
    'POST /api/products/barcode/lookup': BarcodeScanRequest
    'POST /api/products/barcode/register': ProductBarcodeFields & { storeId: string; userId: string; name: string; category: string; brand?: string; costPrice: number; sellingPrice: number; initialStock: number; supplierId?: string }
    'POST /api/inventory/scan/stock-in': StockInRequest
    'POST /api/inventory/scan/stock-out': StockOutRequest
    'POST /api/inventory/scan/count': InventoryCountRequest
    'GET /api/inventory/transactions': { storeId: string; productId?: string; barcode?: string }
  }
}
