import { Router } from 'express'

import { authenticateToken, requireRole, requireStoreMembership } from '../middleware/authMiddleware.js'
import { createCustomer, createExpense, createSupplier, deleteCustomer, deleteExpense, deleteSupplier, getSettings, listAlerts, listCustomers, listExpenses, listSales, listSuppliers, salesReport, updateCustomer, updateExpense, updateSettings, updateSupplier } from '../controllers/businessController.js'

const router = Router()
router.use(authenticateToken, requireRole('STORE_OWNER'), requireStoreMembership)
router.get('/sales', listSales)
router.get('/reports/sales', salesReport)
router.get('/customers', listCustomers)
router.post('/customers', createCustomer)
router.patch('/customers/:id', updateCustomer)
router.delete('/customers/:id', deleteCustomer)
router.get('/suppliers', listSuppliers)
router.post('/suppliers', createSupplier)
router.patch('/suppliers/:id', updateSupplier)
router.delete('/suppliers/:id', deleteSupplier)
router.get('/expenses', listExpenses)
router.post('/expenses', createExpense)
router.patch('/expenses/:id', updateExpense)
router.delete('/expenses/:id', deleteExpense)
router.get('/alerts', listAlerts)
router.get('/settings', getSettings)
router.patch('/settings', updateSettings)
export default router
