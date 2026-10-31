import { Router } from 'express'

import { generalLimit } from '../middleware/rateLimitMiddleware.js'
import { authenticateToken, requireRole, requireStoreMembership } from '../middleware/authMiddleware.js'
import { requirePolicyAcceptance } from '../middleware/policyMiddleware.js'
import { batchArchiveProducts, batchUpdateProducts, bulkCreateProducts, createProduct, deleteCategory, deleteProduct, getDashboardSummary, getProducts, renameCategory, restoreProduct, updateProduct } from '../controllers/dashboardController.js'
import { applyCount, createCount, discardCount, getCount, listCounts, listMovements, restock, saveCount } from '../controllers/inventoryController.js'
import { checkout, inventoryCount, lookupProduct, stockIn, stockOut } from '../controllers/operationsController.js'

const router = Router()
router.use(generalLimit('store', 3000), authenticateToken, requireRole('STORE_OWNER'), requireStoreMembership, requirePolicyAcceptance)
router.get('/dashboard', getDashboardSummary)
router.get('/products', getProducts)
router.post('/products', createProduct)
router.post('/products/bulk', bulkCreateProducts)
router.post('/products/batch-update', batchUpdateProducts)
router.post('/products/batch-archive', batchArchiveProducts)
router.patch('/products/:id', updateProduct)
router.delete('/products/:id', deleteProduct)
router.post('/products/:id/restore', restoreProduct)
router.post('/products/barcode/lookup', lookupProduct)
router.post('/categories/rename', renameCategory)
router.post('/categories/delete', deleteCategory)
router.post('/sales/checkout', checkout)
router.post('/inventory/stock-in', stockIn)
router.post('/inventory/stock-out', stockOut)
router.post('/inventory/count', inventoryCount)
router.post('/inventory/restock', restock)
router.get('/inventory/movements', listMovements)
router.get('/inventory/counts', listCounts)
router.post('/inventory/counts', createCount)
router.get('/inventory/counts/:id', getCount)
router.put('/inventory/counts/:id', saveCount)
router.post('/inventory/counts/:id/apply', applyCount)
router.post('/inventory/counts/:id/discard', discardCount)

export default router
