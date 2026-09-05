export type BarcodeFormat =
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'CODE_128'
  | 'QR_CODE'

export interface ScannerResult {
  rawValue: string
  format: BarcodeFormat
  productId?: string
  productName?: string
  isRegistered: boolean
  status: 'ready' | 'success' | 'not-found' | 'error'
}

export interface ScanSessionState {
  lastScanned: string
  cooldownMs: number
  detectedFormats: BarcodeFormat[]
}

export type ScanAction = 'sale' | 'stock_in' | 'stock_out' | 'inventory_count' | 'product_registration'
