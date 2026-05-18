'use strict'
/**
 * One-time setup script: creates the PayPal Product and Billing Plan.
 * Run this ONCE with your sandbox credentials, paste the IDs into .env,
 * then run it again with live credentials when you go to production.
 *
 * Usage:
 *   node scripts/setup-paypal.js
 *
 * It will print PAYPAL_PRODUCT_ID and PAYPAL_PLAN_ID — copy them into .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const paypal = require('../lib/paypal')

async function main() {
  console.log(`\nSetting up PayPal in ${process.env.PAYPAL_MODE} mode...\n`)

  // 1. Create Product
  console.log('Creating product...')
  const product = await paypal.createProduct({
    name: 'Universal AI Sync',
    description: 'Chrome extension to sync conversations between AI platforms.',
  })
  console.log(`✓ Product created: ${product.id}`)

  // 2. Create Plan
  // Adjust PRICE and NAME here before running if needed
  const PRICE_USD = '9.99'
  const PLAN_NAME = 'Universal AI Sync Monthly'

  console.log(`\nCreating plan ($${PRICE_USD}/month)...`)
  const plan = await paypal.createPlan({
    productId: product.id,
    name: PLAN_NAME,
    priceUsd: PRICE_USD,
  })
  console.log(`✓ Plan created: ${plan.id}`)

  console.log('\n─────────────────────────────────────────────────')
  console.log('Add these to your .env file:')
  console.log('')
  console.log(`PAYPAL_PRODUCT_ID=${product.id}`)
  console.log(`PAYPAL_PLAN_ID=${plan.id}`)
  console.log('─────────────────────────────────────────────────\n')
}

main().catch((err) => {
  console.error('Error:', err.response?.data ?? err.message)
  process.exit(1)
})
