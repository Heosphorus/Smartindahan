# SariSmart

SariSmart is a web-based management platform designed to help sari-sari store owners manage their daily store operations through a centralized system.

## Overview

SariSmart provides tools for managing:

* Inventory
* Products
* Sales
* Customers
* Utang / customer credit
* Suppliers
* Expenses
* Sales and profit analytics
* Inventory history
* User accounts and store access
* Barcode and QR-based product scanning

The system is designed with a mobile-first approach while remaining usable on desktop and tablet devices.

---

## Core Features

### Dashboard

Provides an overview of store performance, including:

* Today's sales
* Number of transactions
* Estimated profit
* Inventory value
* Low-stock products
* Top-selling products
* Outstanding customer credit
* Sales trends

### Point of Sale

The POS system allows users to:

* Search products
* Scan product barcodes
* Add products to a cart
* Adjust quantities
* Apply discounts
* Select payment methods
* Calculate change
* Record credit transactions
* Generate transaction records

### Inventory Management

Users can:

* Add products
* Edit products
* Archive products
* Track stock
* Set minimum stock levels
* Record stock-in and stock-out transactions
* Perform inventory adjustments
* View inventory history
* Identify low-stock products

### Customer Management

Users can manage:

* Customer profiles
* Customer credit
* Outstanding balances
* Credit history
* Payment history

### Supplier Management

Users can:

* Register suppliers
* Maintain supplier information
* Associate suppliers with products
* Track purchases and stock acquisition

### Sales and Analytics

SariSmart provides reporting for:

* Sales
* Revenue
* Cost of goods sold
* Estimated profit
* Expenses
* Inventory
* Product performance

---

## Technology Stack

### Frontend

* React
* Vite
* TypeScript
* Tailwind CSS
* shadcn/ui
* TanStack Query
* Zustand
* Axios
* Recharts

### Backend

* Node.js
* Express
* TypeScript
* Mongoose
* JWT
* bcryptjs
* dotenv

### Database

* MongoDB Atlas
* Mongoose

### Testing

* Playwright
* Vitest
* Supertest

---

## Project Structure

```text
sarismart/
├── frontend/
├── backend/
├── docs/
├── tests/
├── .gitignore
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```


## Database

SariSmart uses MongoDB through Mongoose.

The backend is responsible for communicating with MongoDB Atlas.

```text
Frontend
   ↓
Backend API
   ↓
Mongoose
   ↓
MongoDB Atlas
```


## Security

SariSmart uses backend-enforced authentication and authorization.

Important security principles include:

* Password hashing
* Email verification
* OTP protection
* Role-based authorization
* Store-level data isolation
* Input validation
* Rate limiting
* Audit logging
* Secure environment variables
* Safe database queries


## Development

Clone the repository:

```bash
git clone <repository-url>
cd sarismart
```

Install dependencies according to the frontend and backend package configuration.

Start the backend:

```bash
cd backend
npm install
npm run dev
```

Start the frontend in a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

---
