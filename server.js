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
        
        console.log('Received receipt data:', JSON.stringify(receiptData).substring(0, 200));
        
        // Get the Google Sheets webhook URL from environment
        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            console.error('SHEETS_WEBHOOK_URL not configured in environment');
            return res.status(500).json({ success: false, error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        console.log('Sending receipt to Google Sheets webhook...');
        
        // Send receipt data to Google Sheets via webhook
        // Add timeout and better error handling for mobile
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout
        
        try {
            const response = await fetch(sheetsWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
                },
                body: JSON.stringify(receiptData),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Google Sheets webhook returned error:', response.status, errorText);
                throw new Error(`Failed to save receipt: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            console.log('Receipt saved successfully to Google Sheets:', result);
            res.json({ success: true, message: 'Receipt saved successfully', ...result });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            if (fetchError.name === 'AbortError') {
                console.error('Request to Google Sheets timed out');
                throw new Error('Request timed out - please check your network connection');
            }
            
            throw fetchError;
        }
    } catch (error) {
        console.error('Error saving receipt to Google Sheets:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to save receipt' 
        });
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
app.get('/api/customers-receipts', async (req, res) => {
    try {
        const customersUrl = process.env.CUSTOMERS_RECEIPTS;
        
        if (!customersUrl) {
            console.error('CUSTOMERS_RECEIPTS not configured in environment');
            return res.status(500).json({ error: 'CUSTOMERS_RECEIPTS not configured' });
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

// Endpoint to delete a receipt
app.post('/api/delete-receipt', async (req, res) => {
    try {
        const { customerName, receiptIndex } = req.body;
        
        if (!customerName || receiptIndex === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            return res.status(500).json({ error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        // Send delete request to Google Apps Script
        const response = await fetch(sheetsWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'deleteReceipt',
                customerName: customerName,
                receiptIndex: receiptIndex
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to delete receipt: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('Error deleting receipt:', error);
        res.status(500).json({ error: error.message || 'Failed to delete receipt' });
    }
});

app.post('/api/delete-customer', async (req, res) => {
    try {
        const { customerName } = req.body;
        
        if (!customerName) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            return res.status(500).json({ error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        // Send delete request to Google Apps Script
        const response = await fetch(sheetsWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'deleteCustomer',
                customerName: customerName
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to delete customer: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('Error deleting customer:', error);
        res.status(500).json({ error: error.message || 'Failed to delete customer' });
    }
});

// Proxy endpoint to fetch customer orders CSV from Google Sheets
app.get('/api/customer-orders', async (req, res) => {
    try {
        const customerOrdersUrl = process.env.CUSTOMERS_ORDERS;
        
        if (!customerOrdersUrl) {
            console.error('CUSTOMERS_ORDERS not configured in environment');
            return res.status(500).json({ error: 'CUSTOMERS_ORDERS not configured' });
        }

        console.log('Fetching customer orders CSV from:', customerOrdersUrl);
        
        const response = await fetch(customerOrdersUrl, {
            headers: {
                'Accept': 'text/csv',
                'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
            },
            redirect: 'follow'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch customer orders CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();
        console.log('Customer orders CSV fetched successfully, length:', csvText.length);

        // Verify it's actually CSV, not HTML
        if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
            console.error('Received HTML instead of CSV. The Google Sheets URL may not be published correctly.');
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
        console.error('Error fetching customer orders CSV:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch customer orders' });
    }
});

// Endpoint to verify password (store password or customer order password)
app.post('/api/verify-password', async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({ success: false, error: 'Password is required' });
        }

        const storePassword = process.env.PASSWORD;
        
        if (!storePassword) {
            console.error('PASSWORD not configured in environment');
            return res.status(500).json({ success: false, error: 'Password verification not configured' });
        }

        // Check if it's the store password
        if (password === storePassword) {
            return res.json({ success: true, type: 'store' });
        }

        // Check if it's a customer order password
        const customerOrdersUrl = process.env.CUSTOMERS_ORDERS;
        if (customerOrdersUrl) {
            try {
                const response = await fetch(customerOrdersUrl, {
                    headers: {
                        'Accept': 'text/csv',
                        'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
                    },
                    redirect: 'follow'
                });
                
                if (response.ok) {
                    const csvText = await response.text();
                    
                    // Simple CSV parsing (assuming first row is header, comma-separated)
                    const lines = csvText.split('\n').filter(line => line.trim());
                    if (lines.length > 1) {
                        // Skip header row, check each data row
                        for (let i = 1; i < lines.length; i++) {
                            const line = lines[i];
                            // Parse CSV line (handle quoted values)
                            const columns = [];
                            let current = '';
                            let inQuotes = false;
                            
                            for (let j = 0; j < line.length; j++) {
                                const char = line[j];
                                if (char === '"') {
                                    inQuotes = !inQuotes;
                                } else if (char === ',' && !inQuotes) {
                                    columns.push(current.trim());
                                    current = '';
                                } else {
                                    current += char;
                                }
                            }
                            columns.push(current.trim()); // Add last column
                            
                            if (columns.length >= 2) {
                                const customerName = columns[0] || '';
                                const customerPassword = columns[1] || '';
                                
                                if (customerPassword && customerPassword.trim() === password.trim()) {
                                    return res.json({ 
                                        success: true, 
                                        type: 'customer',
                                        customerName: customerName.trim()
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error checking customer passwords:', error);
                // Continue to return incorrect password
            }
        }

        // Password not found
        res.status(401).json({ success: false, error: 'Incorrect password' });
    } catch (error) {
        console.error('Error verifying password:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to verify password' });
    }
});

// Endpoint to save order (different from receipt - goes to Customer Orders sheet)
app.post('/api/save-order', async (req, res) => {
    try {
        const orderData = req.body;
        
        console.log('Received order data:', JSON.stringify(orderData).substring(0, 200));
        
        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            console.error('SHEETS_WEBHOOK_URL not configured in environment');
            return res.status(500).json({ success: false, error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        console.log('Sending order to Google Sheets webhook...');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        
        try {
            const response = await fetch(sheetsWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
                },
                body: JSON.stringify({
                    action: 'saveOrder',
                    ...orderData
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Google Sheets webhook returned error:', response.status, errorText);
                throw new Error(`Failed to save order: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            console.log('Order saved successfully to Google Sheets:', result);
            res.json({ success: true, message: 'Order saved successfully', ...result });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            if (fetchError.name === 'AbortError') {
                console.error('Request to Google Sheets timed out');
                throw new Error('Request timed out - please check your network connection');
            }
            
            throw fetchError;
        }
    } catch (error) {
        console.error('Error saving order to Google Sheets:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to save order' 
        });
    }
});

// Endpoint to approve or disapprove an order
app.post('/api/approve-order', async (req, res) => {
    try {
        const { customerName, approved } = req.body;
        
        if (!customerName || approved === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            return res.status(500).json({ error: 'SHEETS_WEBHOOK_URL not configured' });
        }

        // Send approve/disapprove request to Google Apps Script
        const response = await fetch(sheetsWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'approveOrder',
                customerName: customerName,
                approved: approved
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to ${approved ? 'approve' : 'disapprove'} order: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('Error approving/disapproving order:', error);
        res.status(500).json({ error: error.message || 'Failed to process order' });
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

