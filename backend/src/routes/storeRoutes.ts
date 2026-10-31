import { Router } from 'express'

import { generalLimit } from '../middleware/rateLimitMiddleware.js'
import { authenticateToken, requireRole, requireStoreMembership } from '../middleware/authMiddleware.js'
import { requirePolicyAcceptance } from '../middleware/policyMiddleware.js'
import { bulkCreateProducts, createProduct, deleteCategory, deleteProduct, getDashboardSummary, getProducts, renameCategory, updateProduct } from '../controllers/dashboardController.js'
import { checkout, inventoryCount, lookupProduct, stockIn, stockOut } from '../controllers/operationsController.js'

const router = Router()
router.use(generalLimit('store', 3000), authenticateToken, requireRole('STORE_OWNER'), requireStoreMembership, requirePolicyAcceptance)
router.get('/dashboard', getDashboardSummary)
router.get('/products', getProducts)
router.post('/products', createProduct)
router.post('/products/bulk', bulkCreateProducts)
router.patch('/products/:id', updateProduct)
router.delete('/products/:id', deleteProduct)
router.post('/products/barcode/lookup', lookupProduct)
router.post('/categories/rename', renameCategory)
router.post('/categories/delete', deleteCategory)
router.post('/sales/checkout', checkout)
router.post('/inventory/stock-in', stockIn)
router.post('/inventory/stock-out', stockOut)
router.post('/inventory/count', inventoryCount)

export default router
