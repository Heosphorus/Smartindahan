# Barcode & QR Inventory API Contract

## Purpose
This contract defines the server-side API for camera and QR-driven product identification, registration, and inventory-safe stock mutation flows.

## Important rule
Scanning identifies the product. It never changes inventory directly. Inventory updates only happen after a user confirms a sale, stock-in, stock-out, or inventory count adjustment.

## Product barcode fields
```ts
interface ProductBarcodeFields {
  barcode?: string
  barcodeType?: 'EAN_13' | 'EAN_8' | 'UPC_A' | 'UPC_E' | 'CODE_128' | 'QR_CODE'
  sku?: string
  qrCode?: string
  hasBarcode: boolean
}
```

## 1) Lookup by barcode or QR
### POST /api/products/barcode/lookup
Request body:
```json
{
  "storeId": "store_123",
  "userId": "user_456",
  "scanType": "POS",
  "rawValue": "4800012345678",
  "source": "camera",
  "action": "sale"
}
```

Response:
```json
{
  "found": true,
  "productId": "prod_1",
  "productName": "Coca-Cola 1.5L",
  "barcode": "4800012345678",
  "barcodeType": "EAN_13",
  "currentStock": 8,
  "sellPrice": 75,
  "costPrice": 60,
  "message": "Product matched"
}
```

## 2) Register new product from barcode scan
### POST /api/products/barcode/register
Request body:
```json
{
  "storeId": "store_123",
  "userId": "user_456",
  "name": "Homemade Banana Cue",
  "category": "Snacks",
  "brand": "Local",
  "costPrice": 18,
  "sellingPrice": 25,
  "initialStock": 15,
  "supplierId": "supplier_7",
  "barcode": "4800011112223",
  "barcodeType": "EAN_13",
  "sku": "SS-000123",
  "qrCode": "SS-000123",
  "hasBarcode": true
}
```

## 3) Stock-in via scanner
### POST /api/inventory/scan/stock-in
Request body:
```json
{
  "storeId": "store_123",
  "userId": "user_456",
  "supplierId": "supplier_1",
  "items": [
    {
      "productId": "prod_1",
      "quantity": 24,
      "unitCost": 60,
      "barcode": "4800012345678"
    },
    {
      "productId": "prod_2",
      "quantity": 30,
      "unitCost": 12,
      "barcode": "4800098765432"
    }
  ],
  "note": "Supplier delivery"
}
```

## 4) Stock-out via scanner
### POST /api/inventory/scan/stock-out
Request body:
```json
{
  "storeId": "store_123",
  "userId": "user_456",
  "productId": "prod_1",
  "quantity": 2,
  "reason": "Damaged",
  "barcode": "4800012345678",
  "note": "Damaged during transfer"
}
```

## 5) Inventory count session
### POST /api/inventory/scan/count
Request body:
```json
{
  "storeId": "store_123",
  "userId": "user_456",
  "counts": [
    {
      "productId": "prod_1",
      "scannedQuantity": 3,
      "systemQuantity": 4,
      "difference": -1,
      "barcode": "4800012345678"
    },
    {
      "productId": "prod_2",
      "scannedQuantity": 1,
      "systemQuantity": 1,
      "difference": 0,
      "barcode": "4800098765432"
    }
  ],
  "note": "Weekly inventory check"
}
```

## 6) Inventory transaction record
```ts
interface InventoryTransaction {
  id: string
  productId: string
  storeId: string
  userId: string
  type: 'sale' | 'stock_in' | 'stock_out' | 'inventory_count' | 'adjustment' | 'refund' | 'product_registration'
  quantity: number
  previousStock: number
  newStock: number
  barcode?: string
  referenceId?: string
  timestamp: string
  note?: string
}
```

## 7) Security and validation rules
- Barcode must be unique within a store.
- No scan can mutate inventory without confirming an action.
- A scan event must be recorded to the ScanHistory table, even when the barcode is unregistered.
- Inventory mutations must create an InventoryTransaction row with previous and new stock values.
- Users can only access products within authorized stores.

## 8) Recommended database indexes
- unique index on storeId + barcode
- index on storeId + productId + timestamp
- index on storeId + userId + timestamp
- index on storeId + barcode + scanType
