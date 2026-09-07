import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

import { env } from '../config/env.js'
import { UserModel } from '../models/User.js'

async function createAdminUser(): Promise<void> {
  try {
    // Connect to database
    await mongoose.connect(env.mongoUri)
    console.log('Connected to MongoDB')

    // Admin user details
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@sarismart.com'
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!'
    const firstName = process.env.ADMIN_FIRSTNAME || 'Admin'
    const lastName = process.env.ADMIN_LASTNAME || 'User'
    const mobileNumber = process.env.ADMIN_MOBILE || '09123456789'
    const storeName = process.env.ADMIN_STORE || 'Admin Store'
    const storeAddress = process.env.ADMIN_ADDRESS || 'Admin Address'

    // Check if admin already exists
    const existingAdmin = await UserModel.findOne({ email: adminEmail })
    
    if (existingAdmin) {
      console.log(`Admin user with email ${adminEmail} already exists. Updating role to ADMIN...`)
      existingAdmin.role = 'ADMIN'
      await existingAdmin.save()
      console.log('Admin role updated successfully')
      return
    }

    // Hash password
    const passwordHash = await bcrypt.hash(adminPassword, 10)

    // Create admin user
    const adminUser = await UserModel.create({
      firstName,
      lastName,
      email: adminEmail,
      mobileNumber,
      passwordHash,
      storeName,
      storeAddress,
      role: 'ADMIN',
      isEmailVerified: true,
      isActive: true,
    })

    console.log('Admin user created successfully:')
    console.log(`  Email: ${adminEmail}`)
    console.log(`  Password: ${adminPassword}`)
    console.log(`  Role: ${adminUser.role}`)
    console.log('\nPlease change the password after first login!')
  } catch (error) {
    console.error('Error creating admin user:', error)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

createAdminUser()
