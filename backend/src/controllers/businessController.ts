import type { Response } from 'express'
import mongoose from 'mongoose'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { CustomerModel } from '../models/Customer.js'
import { ExpenseModel } from '../models/Expense.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { SupplierModel } from '../models/Supplier.js'
import { UserModel } from '../models/User.js'
import { recordAuditLog } from '../services/auditService.js'
import { parsePagination } from '../utils/pagination.js'
import { parseObjectId } from '../utils/objectId.js'
import { pickRequestFields } from '../utils/requestFields.js'

function storeId(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return parseObjectId(req.user?.storeId)
}

function unauthorized(res: Response): void { res.status(401).json({ message: 'Invalid session.' }) }

export async function listSales(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const pagination = parsePagination(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ message: 'Invalid page or limit.' }); return }
  const filter = { storeId: id }
  const [sales, total] = await Promise.all([
    SaleModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    SaleModel.countDocuments(filter),
  ])
  res.json({ sales, pagination: { page: pagination.page, limit: pagination.limit, total } })
}

export async function salesReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const [summary, daily, paymentMethods] = await Promise.all([
    SaleModel.aggregate([{ $match: { storeId: id } }, { $group: { _id: null, sales: { $sum: '$total' }, profit: { $sum: '$estimatedProfit' }, transactions: { $sum: 1 } } }]),
    SaleModel.aggregate([{ $match: { storeId: id, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: '$total' }, profit: { $sum: '$estimatedProfit' } } }, { $sort: { _id: 1 } }]),
    SaleModel.aggregate([{ $match: { storeId: id } }, { $group: { _id: '$paymentMethod', total: { $sum: '$total' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
  ])
  res.json({ summary: summary[0] ?? { sales: 0, profit: 0, transactions: 0 }, daily, paymentMethods })
}

export async function listCustomers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const pagination = parsePagination(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ message: 'Invalid page or limit.' }); return }
  const filter = { storeId: id, isDeleted: { $ne: true } }
  const [customers, total] = await Promise.all([
    CustomerModel.find(filter).sort({ name: 1, _id: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    CustomerModel.countDocuments(filter),
  ])
  res.json({ customers, pagination: { page: pagination.page, limit: pagination.limit, total } })
}

export async function createCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = pickRequestFields(['name', 'mobileNumber', 'address', 'creditLimit'], req.body)
  if (typeof payload.name !== 'string' || !payload.name.trim()) { res.status(400).json({ message: 'Customer name is required.' }); return }
  const customer = await CustomerModel.create({ ...payload, storeId: id, name: payload.name.trim() })
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'CUSTOMER_CREATED', resourceType: 'Customer', resourceId: customer._id })
  res.status(201).json({ customer })
}

export async function updateCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const customerId = parseObjectId(req.params.id)
  if (!customerId) { res.status(404).json({ message: 'Customer not found.' }); return }
  const updates = pickRequestFields(['name', 'mobileNumber', 'address', 'creditLimit'], req.body)
  if (!Object.keys(updates).length) { res.status(400).json({ message: 'No editable customer fields were provided.' }); return }
  const customer = await CustomerModel.findOneAndUpdate({ _id: customerId, storeId: id, isDeleted: { $ne: true } }, { $set: updates }, { new: true, runValidators: true }).lean()
  if (!customer) { res.status(404).json({ message: 'Customer not found.' }); return }
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'CUSTOMER_UPDATED', resourceType: 'Customer', resourceId: customer._id })
  res.json({ customer })
}

export async function deleteCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const customerId = parseObjectId(req.params.id)
  if (!customerId) { res.status(404).json({ message: 'Customer not found.' }); return }
  const customer = await CustomerModel.findOne({ _id: customerId, storeId: id, isDeleted: { $ne: true } })
  if (!customer) { res.status(404).json({ message: 'Customer not found.' }); return }
  if (customer.outstandingBalance > 0) { res.status(409).json({ message: 'A customer with an outstanding balance cannot be archived.' }); return }
  customer.isDeleted = true
  customer.deletedAt = new Date()
  customer.deletedBy = new mongoose.Types.ObjectId(req.user!.id)
  await customer.save()
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'CUSTOMER_ARCHIVED', resourceType: 'Customer', resourceId: customer._id })
  res.json({ message: 'Customer archived.' })
}

export async function listSuppliers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const pagination = parsePagination(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ message: 'Invalid page or limit.' }); return }
  const filter = { storeId: id, isDeleted: { $ne: true } }
  const [suppliers, total] = await Promise.all([
    SupplierModel.find(filter).sort({ name: 1, _id: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    SupplierModel.countDocuments(filter),
  ])
  res.json({ suppliers, pagination: { page: pagination.page, limit: pagination.limit, total } })
}

export async function createSupplier(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = pickRequestFields(['name', 'contactNumber', 'address'], req.body)
  if (typeof payload.name !== 'string' || !payload.name.trim()) { res.status(400).json({ message: 'Supplier name is required.' }); return }
  const supplier = await SupplierModel.create({ ...payload, storeId: id, name: payload.name.trim() })
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'SUPPLIER_CREATED', resourceType: 'Supplier', resourceId: supplier._id })
  res.status(201).json({ supplier })
}

export async function updateSupplier(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const supplierId = parseObjectId(req.params.id)
  if (!supplierId) { res.status(404).json({ message: 'Supplier not found.' }); return }
  const updates = pickRequestFields(['name', 'contactNumber', 'address'], req.body)
  if (!Object.keys(updates).length) { res.status(400).json({ message: 'No editable supplier fields were provided.' }); return }
  const supplier = await SupplierModel.findOneAndUpdate({ _id: supplierId, storeId: id, isDeleted: { $ne: true } }, { $set: updates }, { new: true, runValidators: true }).lean()
  if (!supplier) { res.status(404).json({ message: 'Supplier not found.' }); return }
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'SUPPLIER_UPDATED', resourceType: 'Supplier', resourceId: supplier._id })
  res.json({ supplier })
}

export async function deleteSupplier(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const supplierId = parseObjectId(req.params.id)
  if (!supplierId) { res.status(404).json({ message: 'Supplier not found.' }); return }
  const supplier = await SupplierModel.findOneAndUpdate({ _id: supplierId, storeId: id, isDeleted: { $ne: true } }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } }, { new: true, runValidators: true }).lean()
  if (!supplier) { res.status(404).json({ message: 'Supplier not found.' }); return }
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'SUPPLIER_ARCHIVED', resourceType: 'Supplier', resourceId: supplier._id })
  res.json({ message: 'Supplier archived.' })
}

export async function listExpenses(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const pagination = parsePagination(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ message: 'Invalid page or limit.' }); return }
  const filter = { storeId: id, isDeleted: { $ne: true } }
  const [expenses, total] = await Promise.all([
    ExpenseModel.find(filter).sort({ expenseDate: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    ExpenseModel.countDocuments(filter),
  ])
  res.json({ expenses, pagination: { page: pagination.page, limit: pagination.limit, total } })
}

export async function createExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = pickRequestFields(['category', 'description', 'amount', 'expenseDate'], req.body)
  if (typeof payload.category !== 'string' || !payload.category.trim() || typeof payload.description !== 'string' || !payload.description.trim() || typeof payload.amount !== 'number' || !Number.isFinite(payload.amount) || payload.amount <= 0) { res.status(400).json({ message: 'Category, description, and a positive amount are required.' }); return }
  const expense = await ExpenseModel.create({ ...payload, storeId: id, category: payload.category.trim(), description: payload.description.trim() })
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'EXPENSE_CREATED', resourceType: 'Expense', resourceId: expense._id, metadata: { amount: expense.amount } })
  res.status(201).json({ expense })
}

export async function updateExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const expenseId = parseObjectId(req.params.id)
  if (!expenseId) { res.status(404).json({ message: 'Expense not found.' }); return }
  const updates = pickRequestFields(['category', 'description', 'amount', 'expenseDate'], req.body)
  if (!Object.keys(updates).length) { res.status(400).json({ message: 'No editable expense fields were provided.' }); return }
  if ('amount' in updates && (typeof updates.amount !== 'number' || !Number.isFinite(updates.amount) || updates.amount <= 0)) { res.status(400).json({ message: 'Expense amount must be a positive number.' }); return }
  const expense = await ExpenseModel.findOneAndUpdate({ _id: expenseId, storeId: id, isDeleted: { $ne: true } }, { $set: updates }, { new: true, runValidators: true }).lean()
  if (!expense) { res.status(404).json({ message: 'Expense not found.' }); return }
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'EXPENSE_UPDATED', resourceType: 'Expense', resourceId: expense._id, metadata: { amount: expense.amount } })
  res.json({ expense })
}

export async function deleteExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const expenseId = parseObjectId(req.params.id)
  if (!expenseId) { res.status(404).json({ message: 'Expense not found.' }); return }
  const expense = await ExpenseModel.findOneAndUpdate({ _id: expenseId, storeId: id, isDeleted: { $ne: true } }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } }, { new: true, runValidators: true }).lean()
  if (!expense) { res.status(404).json({ message: 'Expense not found.' }); return }
  await recordAuditLog({ storeId: id, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'EXPENSE_ARCHIVED', resourceType: 'Expense', resourceId: expense._id, metadata: { amount: expense.amount } })
  res.json({ message: 'Expense archived.' })
}

export async function listAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const products = await ProductModel.find({ storeId: id, status: 'active', $expr: { $lte: ['$currentStock', '$minStock'] } }).sort({ currentStock: 1 }).limit(100).lean()
  res.json({ alerts: products.map((product) => ({ id: product._id, type: 'LOW_STOCK', severity: product.currentStock === 0 ? 'critical' : 'warning', title: `${product.name} is low on stock`, message: `${product.currentStock} ${product.unit} remaining. Minimum is ${product.minStock}.`, createdAt: product.updatedAt })) })
}

export async function getSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const user = await UserModel.findById(id).lean()
  if (!user) { res.status(404).json({ message: 'User not found.' }); return }
  res.json({ settings: { firstName: user.firstName, lastName: user.lastName, email: user.email, mobileNumber: user.mobileNumber, storeName: user.storeName, storeAddress: user.storeAddress } })
}

export async function updateSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = pickRequestFields(['firstName', 'lastName', 'mobileNumber', 'storeName', 'storeAddress'], req.body)
  if (!Object.keys(payload).length) { res.status(400).json({ message: 'No editable settings were provided.' }); return }
  const user = await UserModel.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true }).lean()
  if (!user) { res.status(404).json({ message: 'User not found.' }); return }
  res.json({ message: 'Settings saved.', settings: { firstName: user.firstName, lastName: user.lastName, email: user.email, mobileNumber: user.mobileNumber, storeName: user.storeName, storeAddress: user.storeAddress } })
}
