import type { Response } from 'express'
import mongoose from 'mongoose'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { CustomerModel } from '../models/Customer.js'
import { ExpenseModel } from '../models/Expense.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { SupplierModel } from '../models/Supplier.js'

function storeId(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return req.user?.id && mongoose.isValidObjectId(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : null
}

function unauthorized(res: Response): void { res.status(401).json({ message: 'Invalid session.' }) }

export async function listSales(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const sales = await SaleModel.find({ storeId: id }).sort({ createdAt: -1 }).limit(100).lean()
  res.json({ sales })
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
  res.json({ customers: await CustomerModel.find({ storeId: id }).sort({ name: 1 }).lean() })
}

export async function createCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = req.body as { name?: string; mobileNumber?: string; address?: string; creditLimit?: number; outstandingBalance?: number; utangRequestedAt?: string; utangPaidAt?: string }
  if (!payload.name?.trim()) { res.status(400).json({ message: 'Customer name is required.' }); return }
  res.status(201).json({ customer: await CustomerModel.create({ storeId: id, ...payload, name: payload.name.trim() }) })
}

export async function updateCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const customer = await CustomerModel.findOneAndUpdate({ _id: req.params.id, storeId: id }, { $set: req.body }, { new: true, runValidators: true }).lean()
  if (!customer) { res.status(404).json({ message: 'Customer not found.' }); return }
  res.json({ customer })
}

export async function deleteCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const result = await CustomerModel.deleteOne({ _id: req.params.id, storeId: id })
  if (!result.deletedCount) { res.status(404).json({ message: 'Customer not found.' }); return }
  res.json({ message: 'Customer deleted.' })
}

export async function listSuppliers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  res.json({ suppliers: await SupplierModel.find({ storeId: id }).sort({ name: 1 }).lean() })
}

export async function createSupplier(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = req.body as { name?: string; contactNumber?: string; address?: string }
  if (!payload.name?.trim()) { res.status(400).json({ message: 'Supplier name is required.' }); return }
  res.status(201).json({ supplier: await SupplierModel.create({ storeId: id, ...payload, name: payload.name.trim() }) })
}

export async function updateSupplier(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const supplier = await SupplierModel.findOneAndUpdate({ _id: req.params.id, storeId: id }, { $set: req.body }, { new: true, runValidators: true }).lean()
  if (!supplier) { res.status(404).json({ message: 'Supplier not found.' }); return }
  res.json({ supplier })
}

export async function deleteSupplier(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const result = await SupplierModel.deleteOne({ _id: req.params.id, storeId: id })
  if (!result.deletedCount) { res.status(404).json({ message: 'Supplier not found.' }); return }
  res.json({ message: 'Supplier deleted.' })
}

export async function listExpenses(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  res.json({ expenses: await ExpenseModel.find({ storeId: id }).sort({ expenseDate: -1 }).limit(100).lean() })
}

export async function createExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = req.body as { category?: string; description?: string; amount?: number; expenseDate?: string }
  if (!payload.category?.trim() || !payload.description?.trim() || typeof payload.amount !== 'number' || payload.amount <= 0) { res.status(400).json({ message: 'Category, description, and a positive amount are required.' }); return }
  res.status(201).json({ expense: await ExpenseModel.create({ storeId: id, ...payload, category: payload.category.trim(), description: payload.description.trim() }) })
}

export async function updateExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const expense = await ExpenseModel.findOneAndUpdate({ _id: req.params.id, storeId: id }, { $set: req.body }, { new: true, runValidators: true }).lean()
  if (!expense) { res.status(404).json({ message: 'Expense not found.' }); return }
  res.json({ expense })
}

export async function deleteExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const result = await ExpenseModel.deleteOne({ _id: req.params.id, storeId: id })
  if (!result.deletedCount) { res.status(404).json({ message: 'Expense not found.' }); return }
  res.json({ message: 'Expense deleted.' })
}

export async function listAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const products = await ProductModel.find({ storeId: id, status: 'active', $expr: { $lte: ['$currentStock', '$minStock'] } }).sort({ currentStock: 1 }).lean()
  res.json({ alerts: products.map((product) => ({ id: product._id, type: 'LOW_STOCK', severity: product.currentStock === 0 ? 'critical' : 'warning', title: `${product.name} is low on stock`, message: `${product.currentStock} ${product.unit} remaining. Minimum is ${product.minStock}.`, createdAt: product.updatedAt })) })
}

export async function getSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const user = await (await import('../models/User.js')).UserModel.findById(id).lean()
  if (!user) { res.status(404).json({ message: 'User not found.' }); return }
  res.json({ settings: { firstName: user.firstName, lastName: user.lastName, email: user.email, mobileNumber: user.mobileNumber, storeName: user.storeName, storeAddress: user.storeAddress } })
}

export async function updateSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = storeId(req); if (!id) { unauthorized(res); return }
  const payload = req.body as { firstName?: string; lastName?: string; mobileNumber?: string; storeName?: string; storeAddress?: string }
  const user = await (await import('../models/User.js')).UserModel.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true }).lean()
  if (!user) { res.status(404).json({ message: 'User not found.' }); return }
  res.json({ message: 'Settings saved.', settings: { firstName: user.firstName, lastName: user.lastName, email: user.email, mobileNumber: user.mobileNumber, storeName: user.storeName, storeAddress: user.storeAddress } })
}
