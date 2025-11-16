// Local development server for POS system
// Serves static files from the build directory

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'build', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API endpoint to save receipt data to Google Sheets
app.post('/api/save-receipt', async (req, res) => {
    try {
        const receiptData = req.body;
        
        // Get the Google Sheets webhook URL from environment
        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            console.error('SHEETS_WEBHOOK_URL not configured in environment');
            return res.status(500).json({ error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        // Send receipt data to Google Sheets via webhook
        const response = await fetch(sheetsWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(receiptData)
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save receipt: ${response.status} ${response.statusText}`);
        }

        res.json({ success: true, message: 'Receipt saved successfully' });
    } catch (error) {
        console.error('Error saving receipt to Google Sheets:', error);
        res.status(500).json({ error: error.message || 'Failed to save receipt' });
    }
});

// Proxy endpoint to fetch CSV from Google Sheets (keeps URL hidden)
// MUST be defined BEFORE static files and catch-all route
app.get('/api/products', async (req, res) => {
    try {
        const storeProductsUrl = process.env.STORE_PRODUCTS;
        
        if (!storeProductsUrl) {
            console.error('STORE_PRODUCTS URL not configured in environment');
            return res.status(500).json({ error: 'STORE_PRODUCTS URL not configured' });
        }

        // Fetch CSV from Google Sheets (server-side, URL is hidden)
        const response = await fetch(storeProductsUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

        // Return CSV with proper headers
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
        res.send(csvText);
    } catch (error) {
        console.error('Error fetching products CSV:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch products' });
    }
});

// Proxy endpoint to fetch customers CSV from Google Sheets
app.get('/api/customers', async (req, res) => {
    try {
        const customersUrl = process.env.CUSTOMERS_URL;
        
        if (!customersUrl) {
            console.error('CUSTOMERS_URL not configured in environment');
            return res.status(500).json({ error: 'CUSTOMERS_URL not configured' });
        }

        console.log('Fetching customers CSV from:', customersUrl);
        
        // Fetch CSV from Google Sheets (server-side, URL is hidden)
        // Node.js fetch should automatically follow redirects with redirect: 'follow'
        const response = await fetch(customersUrl, {
            headers: {
                'Accept': 'text/csv',
                'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
            },
            redirect: 'follow'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch customers CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();
        console.log('CSV fetched successfully, length:', csvText.length);
        console.log('CSV first 100 chars:', csvText.substring(0, 100));

        // Verify it's actually CSV, not HTML
        if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
            console.error('Received HTML instead of CSV. The Google Sheets URL may not be published correctly.');
            console.error('Response content type:', response.headers.get('content-type'));
            return res.status(500).json({ 
                error: 'Received HTML instead of CSV. Please ensure the Google Sheet is published as CSV and the URL is correct.' 
            });
        }

        // Return CSV with proper headers
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.send(csvText);
    } catch (error) {
        console.error('Error fetching customers CSV:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch customers' });
    }
});

// Endpoint to fetch receipts for a customer from Google Sheets
app.get('/api/receipts', async (req, res) => {
    try {
        const customerName = req.query.customer;
        
        if (!customerName) {
            return res.status(400).json({ error: 'Customer name is required' });
        }

        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            return res.status(500).json({ error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        // Get the base URL for the GET endpoint
        const getReceiptsUrl = sheetsWebhookUrl.replace('/exec', '') + '?action=getReceipts&customer=' + encodeURIComponent(customerName);

        const response = await fetch(getReceiptsUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch receipts: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching receipts:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch receipts' });
    }
});

// Endpoint to update receipt payment information
app.post('/api/update-receipt-payment', async (req, res) => {
    try {
        const { customerName, receiptIndex, payments } = req.body;
        
        if (!customerName || receiptIndex === undefined || !payments) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            return res.status(500).json({ error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        // Send update request to Google Apps Script
        const response = await fetch(sheetsWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'updatePayment',
                customerName: customerName,
                receiptIndex: receiptIndex,
                payments: payments
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to update payment: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('Error updating receipt payment:', error);
        res.status(500).json({ error: error.message || 'Failed to update payment' });
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'build')));

// Serve index.html for all other routes (SPA routing)
// MUST be last to not interfere with API routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 POS Server running on http://localhost:${PORT}`);
    console.log(`📦 Serving files from: ${path.join(__dirname, 'build')}`);
    console.log(`\n💡 Open http://localhost:${PORT} in your browser to test the POS system`);
});

