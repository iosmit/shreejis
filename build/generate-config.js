#!/usr/bin/env node

/**
 * Build script to inject environment variables directly into JavaScript files
 * 
 * Local: Reads from .env file
 * Cloudflare Pages: Reads from environment variables set in dashboard
 */

const fs = require('fs');
const path = require('path');

let envVars = {};

// First, check for environment variables (for Cloudflare Pages or CI/CD)
if (process.env.STORE_PRODUCTS) {
    console.log('Using environment variables (Cloudflare Pages/CI mode)');
    envVars.STORE_PRODUCTS = process.env.STORE_PRODUCTS;
} else {
    // Fall back to .env file (for local development)
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        console.log('Using .env file (local development)');
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            line = line.trim();
            // Skip empty lines and comments
            if (line && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    envVars[key.trim()] = valueParts.join('=').trim();
                }
            }
        });
    } else {
        console.warn('Warning: No environment variables or .env file found. STORE_PRODUCTS will be empty.');
    }
}

// Files to process
const filesToProcess = [
    { path: 'script.js', placeholders: ['{{STORE_PRODUCTS}}'] }
];

// Process each file
filesToProcess.forEach(file => {
    const filePath = path.join(__dirname, file.path);
    
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Replace all placeholders with actual values
        file.placeholders.forEach(placeholder => {
            if (placeholder.includes('STORE_PRODUCTS')) {
                content = content.replace(/{{STORE_PRODUCTS}}/g, envVars.STORE_PRODUCTS || '');
            }
        });
        
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✓ Updated ${file.path}`);
    } else {
        console.warn(`Warning: ${file.path} not found`);
    }
});

console.log('\n✓ Build complete');
console.log(`  - STORE_PRODUCTS: ${envVars.STORE_PRODUCTS ? '✓ Set' : '✗ Not set'}`);

