import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

import { connectDatabase } from '../config/database.js'
import { validatePasswordStrength } from '../services/authService.js'
import { UserModel } from '../models/User.js'

async function createAdminUser(): Promise<void> {
  try {
    await connectDatabase()

    const adminPassword = process.env.ADMIN_PASSWORD
    if (!adminPassword) throw new Error('Set ADMIN_PASSWORD in the environment before creating an admin user.')
    const passwordCheck = validatePasswordStrength(adminPassword)
    if (!passwordCheck.isValid) throw new Error(passwordCheck.message)
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@sarismart.com'
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

    console.log(`Admin user created successfully with role ${adminUser.role}.`)
  } catch (error) {
    console.error('Unable to create admin user:', error instanceof Error ? error.name : 'UnknownError')
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

createAdminUser()
