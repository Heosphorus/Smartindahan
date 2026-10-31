import test from 'node:test'
import assert from 'node:assert/strict'

import { isPlaceholderMongoUri } from '../src/config/mongoUri.js'

test('the template connection string from .env.example is recognised as a placeholder', () => {
  for (const uri of [
    'mongodb+srv://DATABASE_USER:DATABASE_PASSWORD@cluster0.mongodb.net/app',
    'mongodb+srv://user:pass@<cluster-host>/app',
    'mongodb://user:pass@example.com/app',
    'mongodb://user:pass@db.example.com:27017/app',
    'mongodb://user:pass@EXAMPLE.COM/app?retryWrites=true',
    'mongodb://user:pass@real.host:27017,example.com:27017/app',
  ]) assert.equal(isPlaceholderMongoUri(uri), true, uri)
})

test('a real host is never mistaken for the placeholder, even when it merely contains the text', () => {
  for (const uri of [
    'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/app',
    'mongodb://user:pass@localhost:27017/app',
    'mongodb://user:pass@example.com.evil.net/app',
    'mongodb://user:pass@notexample.com/app',
    'mongodb://user:example.com@db.internal/app',
    'mongodb://user:pass@db.internal/example.com',
    'mongodb://user:pass@db.internal/app?appName=example.com',
  ]) assert.equal(isPlaceholderMongoUri(uri), false, uri)
})
