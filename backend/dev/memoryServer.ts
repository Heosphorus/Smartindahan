// Local development server that needs no MongoDB installation or Atlas access.
// It starts an in-memory single-node replica set (so transactions work), seeds a clearly-labelled demo store,
// and serves the real Express app on PORT (default 5000). Everything disappears when the process stops.
//
//   npm run dev:memory --prefix backend
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

process.env.NODE_ENV = 'development'
process.env.MONGODB_URI = ''
process.env.EMAIL_MODE = 'development'

const { env } = await import('../src/config/env.js')
const { app } = await import('../src/server.js')
const { UserModel } = await import('../src/models/User.js')
const { ProductModel } = await import('../src/models/Product.js')
const { SaleModel } = await import('../src/models/Sale.js')
const { SupplierModel } = await import('../src/models/Supplier.js')
const { CustomerModel } = await import('../src/models/Customer.js')
const { ExpenseModel } = await import('../src/models/Expense.js')

const DEMO_EMAIL = 'demo@smartindahan.test'
const DEMO_PASSWORD = 'DemoPass123'

const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
await mongoose.connect(replicaSet.getUri('smartindahan_dev_memory'))
await Promise.all([UserModel.init(), ProductModel.init(), SaleModel.init(), SupplierModel.init()])

const owner = await UserModel.create({
  firstName: 'Demo', lastName: 'Owner', email: DEMO_EMAIL, mobileNumber: '09171234567',
  passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10), storeName: 'Demo Tindahan (sample data)', storeAddress: 'Sample Street, Quezon City',
  role: 'STORE_OWNER', isEmailVerified: true, isActive: true, privacyPolicyAccepted: true, termsAccepted: true,
})
const storeId = owner._id

const catalog: Array<[string, string, number, number, number, number]> = [
  ['Lucky Me Pancit Canton Original 60g', 'Noodles', 11, 14, 48, 12],
  ['Sardinas Ligo 155g', 'Canned Goods', 19, 25, 4, 6],
  ['Coca-Cola Sakto 192ml', 'Beverages', 9, 12, 30, 10],
  ['Bear Brand Adult Plus 33g Sachet', 'Milk', 10.5, 13, 0, 8],
  ['Safeguard Pure White Soap 130g', 'Personal Care', 38, 46, 15, 5],
  ['Marlboro Red (per stick)', 'Cigarettes', 6.5, 8, 100, 40],
  ['Datu Puti Soy Sauce 1L with a deliberately very long product name for layout testing', 'Condiments', 42, 52, 6, 4],
  ['Egg (medium, per piece)', 'Fresh', 7, 9, 3, 12],
  ['C2 Green Tea Apple 230ml', 'Beverages', 14, 18, 20, 6],
  ['Surf Powder Cherry Blossom 66g', 'Household', 8, 11, 25, 10],
  ['Lucky Me Instant Mami Beef 55g', 'Noodles', 10, 13, 18, 12],
  ['Nescafe 3-in-1 Original 20g', 'Coffee', 6.5, 8, 60, 20],
]
const products = await ProductModel.create(catalog.map(([name, category, costPrice, sellingPrice, currentStock, minStock]) => ({ storeId, name, category, costPrice, sellingPrice, currentStock, minStock, unit: 'piece' })))

await SupplierModel.create([
  { storeId, name: 'Metro Wholesale Center', contactNumber: '09181112222', address: 'Commonwealth Ave, Quezon City' },
  { storeId, name: 'Aling Nena Trading', contactNumber: '09283334444', address: 'Brgy. San Isidro' },
])
await CustomerModel.create([
  { storeId, name: 'Mang Tomas', mobileNumber: '09175556666', address: 'Blk 4 Lot 2', creditLimit: 500, outstandingBalance: 0 },
  { storeId, name: 'Aling Rosa', mobileNumber: '09177778888', address: 'Purok 3', creditLimit: 300, outstandingBalance: 0 },
])
await ExpenseModel.create([
  { storeId, category: 'Electricity', description: 'Meralco bill', amount: 850, expenseDate: new Date() },
  { storeId, category: 'Transport', description: 'Delivery tricycle', amount: 120, expenseDate: new Date(Date.now() - 2 * 86400000) },
])

// Ten days of sample sales so the charts have something to show.
const sampleSales = []
for (let day = 0; day < 10; day += 1) {
  for (let index = 0; index < 1 + (day % 3); index += 1) {
    const product = products[(day * 3 + index) % products.length]!
    const quantity = 1 + ((day + index) % 4)
    const lineTotal = quantity * product.sellingPrice
    sampleSales.push({
      storeId, cashierId: storeId, transactionCode: `TXN-DEMO-${day}-${index}`, paymentMethod: index % 2 ? 'GCash' as const : 'Cash' as const,
      items: [{ productId: product._id, productName: product.name, quantity, unitPrice: product.sellingPrice, costPrice: product.costPrice, lineTotal }],
      subtotal: lineTotal, total: lineTotal, estimatedProfit: quantity * (product.sellingPrice - product.costPrice),
      createdAt: new Date(Date.now() - day * 86400000 - index * 3600000),
    })
  }
}
await SaleModel.create(sampleSales)

const server = app.listen(env.port, () => {
  console.log(`Demo backend (in-memory database, sample data) on http://localhost:${env.port}`)
  console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
})

const stop = async (): Promise<void> => {
  server.close()
  await mongoose.disconnect()
  await replicaSet.stop()
  process.exit(0)
}
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
