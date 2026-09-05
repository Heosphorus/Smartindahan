import { Router } from 'express'

import { authenticateToken } from '../middleware/authMiddleware.js'
import { bulkCreateProducts, createProduct, deleteProduct, getDashboardSummary, getProducts, updateProduct } from '../controllers/dashboardController.js'
import { checkout, inventoryCount, lookupProduct, stockIn, stockOut } from '../controllers/operationsController.js'

const router = Router()
router.use(authenticateToken)
router.get('/dashboard', getDashboardSummary)
router.get('/products', getProducts)
router.post('/products', createProduct)
router.post('/products/bulk', bulkCreateProducts)
router.patch('/products/:id', updateProduct)
router.delete('/products/:id', deleteProduct)
router.post('/products/barcode/lookup', lookupProduct)
router.post('/sales/checkout', checkout)
router.post('/inventory/stock-in', stockIn)
router.post('/inventory/stock-out', stockOut)
router.post('/inventory/count', inventoryCount)

export default router
