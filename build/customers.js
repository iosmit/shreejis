// Customers CSV URL - using proxy endpoint to keep URL hidden
const CUSTOMERS_RECEIPTS = '/api/customers-receipts';

// Cache keys - must match script.js
const CUSTOMERS_CACHE_KEY = 'customersCache';
const CUSTOMERS_CACHE_KEY_PARSED = CUSTOMERS_CACHE_KEY + '_parsed'; // Same as script.js
const CUSTOMERS_CACHE_TIMESTAMP_KEY = 'customersCacheTimestamp';
const PRODUCTS_CACHE_KEY = 'storeProductsCache'; // For calculating profit margin
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

class CustomersManager {
    constructor() {
        this.customers = [];
        this.filteredCustomers = [];
        this.receipts = [];
        this.currentCustomer = null;
        this.currentReceipt = null;
        this.currentReceiptIndex = null;
        this.cacheRefreshInterval = null;
        this.pendingDelete = null; // Store pending deletion info
        this.products = []; // Store products for profit margin calculation
        this.pendingOrders = {}; // Map of customer name to order data
        this.pendingOrderCustomer = null; // Customer name for pending order approval
        this.init();
    }
    
    // Load products from cache for profit margin calculation
    loadProductsFromCache() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            if (!cachedData) {
                return false;
            }
            
            const parsedProducts = JSON.parse(cachedData);
            
            if (!Array.isArray(parsedProducts) || parsedProducts.length === 0) {
                return false;
            }
            
            this.products = parsedProducts;
            return true;
        } catch (error) {
            console.error('Error loading products from cache:', error);
            return false;
        }
    }
    
    // Calculate profit margin for a receipt on-the-fly
    calculateProfitMarginForReceipt(receipt) {
        if (!receipt.items || !Array.isArray(receipt.items)) {
            return 0;
        }
        
        // If products list is empty, try to reload it
        if (this.products.length === 0) {
            this.loadProductsFromCache();
        }
        
        let totalProfitMargin = 0;
        
        receipt.items.forEach(item => {
            // Get purchase cost from item (if stored) or from products list
            let purchaseCost = 0;
            
            if (item.purchaseCost !== undefined && item.purchaseCost !== null) {
                purchaseCost = parseFloat(item.purchaseCost) || 0;
            } else {
                // Look up purchase cost from products list
                const product = this.products.find(p => p.name === item.name);
                if (product && product.purchaseCost !== undefined) {
                    purchaseCost = parseFloat(product.purchaseCost) || 0;
                }
            }
            
            // Calculate profit margin for this item
            const itemRate = parseFloat(item.rate) || 0;
            const itemQuantity = parseFloat(item.quantity) || 0;
            const profitPerUnit = itemRate - purchaseCost;
            const profitMargin = profitPerUnit * itemQuantity;
            totalProfitMargin += profitMargin;
        });
        
        return totalProfitMargin;
    }

    async init() {
        this.setupEventListeners();
        
        // Load products from cache for profit margin calculation
        this.loadProductsFromCache();
        
        // Load pending orders
        await this.loadPendingOrders();
        
        // Always load from cache first to show latest data (including receipts created on index page)
        const hasCache = this.loadCustomersFromCache();
        
        if (!hasCache) {
            // No cache available - fetch and cache
            await this.loadCustomers(true); // Load and cache customers (silent mode)
        } else {
            // Cache exists - refresh customer list from cache to ensure it's up to date
            // This ensures new customers added on index page are visible
            this.refreshCustomerListFromCache();
            
            // Check if cache is stale - only fetch if older than 5 minutes
            const isStale = this.isCustomersCacheStale();
            if (isStale) {
                // Cache is stale - fetch fresh data in background (silent)
                this.loadCustomers(true).catch(err => {
                    console.error('Error refreshing stale customers cache:', err);
                });
            }
        }
        
        // Set up periodic cache refresh (every 5 minutes) - flush and replace
        // Cache is only updated when:
        // 1. Changes are made (payments saved)
        // 2. Fresh data is fetched (when cache is missing or stale)
        // 3. Every 5 minutes (automatic flush and replace)
        this.setupPeriodicRefresh();
    }
    
    // Load pending orders from Customer Orders sheet
    async loadPendingOrders() {
        try {
            const response = await fetch('/api/customer-orders');
            if (!response.ok) {
                console.warn('Failed to load customer orders');
                return;
            }
            
            const csvText = await response.text();
            this.pendingOrders = {};
            
            Papa.parse(csvText, {
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    if (!results.data || results.data.length < 2) {
                        return;
                    }
                    
                    // First row is headers, skip it
                    for (let i = 1; i < results.data.length; i++) {
                        const row = results.data[i];
                        if (row.length >= 3) {
                            // First column: customer name
                            // Second column: password
                            // Third column: order JSON
                            const customerName = String(row[0] || '').trim();
                            const orderJson = String(row[2] || '').trim();
                            
                            if (customerName && orderJson) {
                                try {
                                    let orderData = orderJson;
                                    if (orderData.startsWith('"') && orderData.endsWith('"')) {
                                        orderData = orderData.slice(1, -1);
                                    }
                                    orderData = orderData.replace(/""/g, '"');
                                    const order = JSON.parse(orderData);
                                    this.pendingOrders[customerName] = order;
                                } catch (e) {
                                    console.error('Error parsing order JSON for', customerName, ':', e);
                                }
                            }
                        }
                    }
                    
                    // Refresh display to show badges
                    this.displayCustomers();
                },
                error: (error) => {
                    console.error('Error parsing customer orders CSV:', error);
                }
            });
        } catch (error) {
            console.error('Error loading pending orders:', error);
        }
    }
    
    // Refresh customer list from cache to pick up new customers
    refreshCustomerListFromCache() {
        try {
            const cachedCsv = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            if (!cachedCsv) {
                return;
            }
            
            // Re-parse the CSV to get updated customer list
            Papa.parse(cachedCsv, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    const customerSet = new Set();
                    
                    results.data.forEach((row) => {
                        const customerName = row.CUSTOMER || row.customer || row.Customer || '';
                        const trimmedName = String(customerName).trim();
                        if (trimmedName && trimmedName !== '' && trimmedName.toUpperCase() !== 'CUSTOMER') {
                            customerSet.add(trimmedName);
                        }
                    });
                    
                    const newCustomers = Array.from(customerSet).map(customerName => ({
                        name: customerName
                    }));
                    
                    // Update if customer list changed
                    if (newCustomers.length !== this.customers.length || 
                        JSON.stringify(newCustomers) !== JSON.stringify(this.customers)) {
                        this.customers = newCustomers;
                        this.filteredCustomers = [...this.customers];
                        localStorage.setItem(CUSTOMERS_CACHE_KEY_PARSED, JSON.stringify(this.customers));
                        this.displayCustomers();
                        console.log('Refreshed customer list from cache:', this.customers.length, 'customers');
                    }
                },
                error: (error) => {
                    console.error('Error refreshing customer list from cache:', error);
                }
            });
        } catch (error) {
            console.error('Error refreshing customer list from cache:', error);
        }
    }
    
    // Set up periodic refresh every 5 minutes
    setupPeriodicRefresh() {
        // Clear any existing interval
        if (this.cacheRefreshInterval) {
            clearInterval(this.cacheRefreshInterval);
        }
        
        // Refresh cache every 5 minutes - flush old cache and replace with fresh data
        this.cacheRefreshInterval = setInterval(() => {
            console.log('Periodic customers cache refresh triggered - flushing and replacing cache');
            this.flushAndRefreshCache();
        }, CACHE_DURATION_MS);
    }
    
    // Flush old cache and replace with fresh data
    async flushAndRefreshCache() {
        try {
            // Clear old cache
            localStorage.removeItem(CUSTOMERS_CACHE_KEY);
            localStorage.removeItem(CUSTOMERS_CACHE_KEY_PARSED);
            localStorage.removeItem(CUSTOMERS_CACHE_TIMESTAMP_KEY);
            
            console.log('Customers cache flushed, fetching fresh data...');
            
            // Fetch fresh data and save to cache
            await this.loadCustomers(true);
            
            console.log('Customers cache refreshed with fresh data');
        } catch (error) {
            console.error('Error flushing and refreshing customers cache:', error);
        }
    }
    
    // Load customers from cache
    loadCustomersFromCache() {
        try {
            const cachedCustomers = localStorage.getItem(CUSTOMERS_CACHE_KEY_PARSED);
            const cachedCsv = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            
            if (cachedCustomers && cachedCsv) {
                const parsed = JSON.parse(cachedCustomers);
                
                // Ensure customers have the correct structure { name: string }
                this.customers = parsed
                    .filter(customer => customer && (customer.name || typeof customer === 'string'))
                    .map(customer => {
                        // Handle both { name: "..." } and string formats
                        if (typeof customer === 'string') {
                            return { name: customer };
                        }
                        if (customer.name) {
                            return { name: String(customer.name).trim() };
                        }
                        return null;
                    })
                    .filter(customer => customer && customer.name); // Remove nulls and empty names
                
                this.filteredCustomers = [...this.customers];
                console.log(`Loaded ${this.customers.length} customers from cache`);
                
                // Only display if we have valid customers
                if (this.customers.length > 0) {
                    this.displayCustomers();
                }
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading customers from cache:', error);
            return false;
        }
    }
    
    // Save customers to cache
    saveCustomersToCache(csvText, customers, silent = false) {
        try {
            localStorage.setItem(CUSTOMERS_CACHE_KEY, csvText);
            localStorage.setItem(CUSTOMERS_CACHE_KEY_PARSED, JSON.stringify(customers));
            localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
            if (!silent) {
                console.log(`Saved ${customers.length} customers to cache`);
            }
            return true;
        } catch (error) {
            console.error('Error saving customers to cache:', error);
            return false;
        }
    }
    
    // Update customers cache with payment information
    updateCustomersCacheWithPayment(customerName, receiptIndex, payments) {
        try {
            // Get cached CSV data
            const cachedCsv = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            if (!cachedCsv) {
                console.warn('No customers cache found to update');
                return;
            }
            
            // Parse the CSV
            Papa.parse(cachedCsv, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    // Find the customer row
                    let customerRow = null;
                    
                    for (let i = 0; i < results.data.length; i++) {
                        const row = results.data[i];
                        const rowCustomerName = row.CUSTOMER || row.customer || row.Customer || '';
                        if (rowCustomerName && rowCustomerName.trim().toUpperCase() === customerName.toUpperCase()) {
                            customerRow = row;
                            break;
                        }
                    }
                    
                    if (!customerRow) {
                        console.warn('Customer not found in cache for payment update');
                        return;
                    }
                    
                    // Find receipt columns
                    const receiptColumns = results.meta.fields.filter(f => f.toUpperCase().startsWith('RECEIPT'));
                    if (receiptColumns.length === 0) {
                        console.warn('No receipt columns found in cache');
                        return;
                    }
                    
                    // Get the receipt at the specified index (receiptIndex corresponds to column position)
                    // Receipt columns are: RECEIPT (index 0), RECEIPT2 (index 1), etc.
                    let receiptField = null;
                    if (receiptIndex === 0) {
                        receiptField = receiptColumns[0]; // First receipt column
                    } else {
                        // Find the receipt column at the specified index
                        const receiptFieldName = receiptIndex === 1 ? 'RECEIPT' : `RECEIPT${receiptIndex}`;
                        receiptField = receiptColumns.find(col => col.toUpperCase() === receiptFieldName.toUpperCase());
                        if (!receiptField && receiptColumns[receiptIndex]) {
                            receiptField = receiptColumns[receiptIndex];
                        }
                    }
                    
                    if (!receiptField || !customerRow[receiptField]) {
                        console.warn('Receipt not found in cache at specified index');
                        return;
                    }
                    
                    // Parse existing receipt JSON
                    let receiptData;
                    try {
                        const receiptJson = customerRow[receiptField];
                        // Handle double-encoded JSON
                        receiptData = typeof receiptJson === 'string' ? JSON.parse(receiptJson) : receiptJson;
                        if (typeof receiptData === 'string') {
                            receiptData = JSON.parse(receiptData);
                        }
                    } catch (e) {
                        console.error('Error parsing receipt JSON from cache:', e);
                        return;
                    }
                    
                    // Update payment information
                    receiptData.payments = {
                        cash: payments.cash || 0,
                        online: payments.online || 0
                    };
                    const totalPaid = receiptData.payments.cash + receiptData.payments.online;
                    receiptData.remainingBalance = receiptData.grandTotal - totalPaid;
                    
                    // Save back to cache
                    customerRow[receiptField] = JSON.stringify(receiptData);
                    
                    // Convert back to CSV and save
                    const updatedCsv = Papa.unparse(results.data, {
                        header: true,
                        columns: results.meta.fields
                    });
                    
                    // Update cache
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, updatedCsv);
                    localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                    
                    console.log('Updated customers cache with payment information');
                },
                error: (error) => {
                    console.error('Error updating customers cache with payment:', error);
                }
            });
        } catch (error) {
            console.error('Error updating customers cache with payment:', error);
        }
    }

    setupEventListeners() {
        const backToCustomersBtn = document.getElementById('backToCustomersBtn');
        const closePaymentModal = document.getElementById('closePaymentModal');
        const cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
        const paymentForm = document.getElementById('paymentForm');
        const customerSearch = document.getElementById('customerSearch');
        
        // Delete confirmation modal
        const closeDeleteConfirmModal = document.getElementById('closeDeleteConfirmModal');
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        
        if (closeDeleteConfirmModal) {
            closeDeleteConfirmModal.addEventListener('click', () => {
                this.closeDeleteConfirmModal();
            });
        }
        
        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => {
                this.closeDeleteConfirmModal();
            });
        }
        
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', () => {
                this.confirmDeleteReceipt();
            });
        }

        backToCustomersBtn.addEventListener('click', () => {
            this.showCustomersView();
        });

        closePaymentModal.addEventListener('click', () => {
            this.closePaymentModal();
        });

        cancelPaymentBtn.addEventListener('click', () => {
            this.closePaymentModal();
        });

        paymentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.savePayment();
        });

        // Customer search functionality
        if (customerSearch) {
            customerSearch.addEventListener('input', (e) => {
                this.handleCustomerSearch(e.target.value);
            });
        }

        // Close modal when clicking outside
        const paymentModal = document.getElementById('paymentModal');
        paymentModal.addEventListener('click', (e) => {
            if (e.target === paymentModal) {
                this.closePaymentModal();
            }
        });
        
        // Receipt view modal event listeners
        const closeReceiptView = document.getElementById('closeReceiptView');
        const printReceiptView = document.getElementById('printReceiptView');
        const shareReceiptView = document.getElementById('shareReceiptView');
        const receiptViewModal = document.getElementById('receiptViewModal');
        
        if (closeReceiptView) {
            closeReceiptView.addEventListener('click', () => {
                this.closeReceiptView();
            });
        }
        
        if (printReceiptView) {
            printReceiptView.addEventListener('click', () => {
                window.print();
            });
        }
        
        if (shareReceiptView) {
            shareReceiptView.addEventListener('click', () => {
                this.shareReceiptView();
            });
        }
        
        // Close receipt modal when clicking outside
        if (receiptViewModal) {
            receiptViewModal.addEventListener('click', (e) => {
                if (e.target === receiptViewModal) {
                    this.closeReceiptView();
                }
            });
        }
    }

    showLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.add('active');
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.remove('active');
    }

    // Check if customers cache is stale
    isCustomersCacheStale() {
        try {
            const cacheTimestamp = localStorage.getItem(CUSTOMERS_CACHE_TIMESTAMP_KEY);
            
            // If no cache timestamp, it's stale
            if (!cacheTimestamp) {
                return true;
            }
            
            const cacheTime = parseInt(cacheTimestamp, 10);
            const now = Date.now();
            const timeSinceCache = now - cacheTime;
            
            // Cache is stale if older than 5 minutes
            return timeSinceCache >= CACHE_DURATION_MS;
        } catch (error) {
            console.error('Error checking customers cache staleness:', error);
            return true; // On error, consider it stale
        }
    }
    
    async loadCustomers(silent = false) {
        // Always try to load from cache first
        const hasCache = this.loadCustomersFromCache();
        
        // Ensure products are loaded for profit margin calculation
        if (this.products.length === 0) {
            this.loadProductsFromCache();
        }
        
        if (hasCache && this.customers.length > 0) {
            // Cache exists and has data
            // Only fetch if cache is stale (older than 5 minutes)
            const isStale = this.isCustomersCacheStale();
            
            if (!isStale) {
                // Cache is fresh (less than 5 minutes old) - use it, don't fetch
                if (!silent) {
                    const cacheAge = Math.round((Date.now() - parseInt(localStorage.getItem(CUSTOMERS_CACHE_TIMESTAMP_KEY), 10)) / 1000);
                    console.log(`Using fresh customers cache (${cacheAge}s old)`);
                    this.displayCustomers();
                }
                return; // Use cached data, don't fetch
            } else {
                // Cache is stale - will fetch below
                if (!silent) {
                    console.log('Customers cache is stale, fetching fresh data...');
                }
            }
        }
        
        // Only fetch if cache is missing or stale
        if (!silent) {
            this.showLoading();
        }
        try {
            const response = await fetch(`${CUSTOMERS_RECEIPTS}?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch customers: ${response.status}`);
            }

            const csvText = await response.text();
            
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                quotes: true,
                escapeChar: '"',
                delimiter: ',',
                newline: '\n',
                complete: (results) => {
                    // Parse customers from CSV - extract unique customer names from CUSTOMER column
                    const customerSet = new Set();
                    
                    results.data.forEach((row, index) => {
                        // Try different possible column names (case-insensitive)
                        let customerName = '';
                        const rowKeys = Object.keys(row);
                        
                        // Find the customer column (could be CUSTOMER, customer, Customer, etc.)
                        for (const key of rowKeys) {
                            if (key.toUpperCase() === 'CUSTOMER') {
                                customerName = row[key];
                                break;
                            }
                        }
                        
                        // If still not found, try first column
                        if (!customerName && rowKeys.length > 0) {
                            customerName = row[rowKeys[0]];
                        }
                        
                        const trimmedName = String(customerName || '').trim();
                        
                        if (trimmedName && trimmedName !== '' && trimmedName.toUpperCase() !== 'CUSTOMER') {
                            customerSet.add(trimmedName);
                        }
                    });

                    this.customers = Array.from(customerSet).map(customerName => ({
                        name: customerName
                    }));
                    
                    // Initialize filtered customers with all customers
                    this.filteredCustomers = [...this.customers];
                    
                    // Save to cache (always update cache with fresh data)
                    // Use silent mode for background refreshes to reduce console noise
                    this.saveCustomersToCache(csvText, this.customers, silent);
                    
                    // Reload products after cache refresh to ensure we have latest purchase costs
                    this.loadProductsFromCache();

                    if (this.customers.length === 0) {
                        console.warn('No customers found in CSV');
                    }

                    this.displayCustomers();
                    if (!silent) {
                        this.hideLoading();
                    } else {
                        // Silent mode - don't log cache saves for background refreshes
                        // Cache is still updated, just without console noise
                    }
                },
                error: (error) => {
                    console.error('Error parsing customers CSV:', error);
                    if (!silent) {
                        this.hideLoading();
                        this.showError('Failed to load customers. Please try again.');
                    }
                }
            });
        } catch (error) {
            console.error('Error loading customers:', error);
            if (!silent) {
                this.hideLoading();
                this.showError('Failed to load customers. Please check your connection.');
            }
        }
    }

    async loadReceipts(customerName) {
        this.showLoading();
        try {
            // Ensure products are loaded for profit margin calculation
            if (this.products.length === 0) {
                this.loadProductsFromCache();
            }
            
            // Always try to load from cache first to get latest receipts (including those created on index page)
            // Receipts are always loaded from cache - they're updated via cache updates, not network fetches
            let csvText = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            
            if (!csvText) {
                // No cache available - only fetch if cache is completely missing
                // This should rarely happen as cache is created on page load
                console.warn('No customers cache found, fetching from server...');
                const response = await fetch(`${CUSTOMERS_RECEIPTS}?t=${Date.now()}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch receipts: ${response.status}`);
                }
                csvText = await response.text();
                // Save to cache
                if (csvText) {
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, csvText);
                    localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                }
                // Reload products after fetching fresh data
                this.loadProductsFromCache();
            } else {
                // Cache exists - use it (receipts are updated via cache updates, not network fetches)
                console.log('Loading receipts from cache (includes latest updates from index page)');
                // Ensure products are still loaded (in case cache was cleared)
                if (this.products.length === 0) {
                    this.loadProductsFromCache();
                }
            }
            
            // Parse CSV twice: once with headers to find the customer, once without to get raw data
            // This is necessary because PapaParse collapses duplicate column names
            Papa.parse(csvText, {
                header: false,
                skipEmptyLines: true,
                quotes: true,
                escapeChar: '"',
                delimiter: ',',
                newline: '\n',
                complete: (rawResults) => {
                    console.log('Parsing receipts for customer:', customerName);
                    
                    if (!rawResults.data || rawResults.data.length === 0) {
                        console.warn('No data in CSV');
                        this.receipts = [];
                        this.currentCustomer = customerName;
                        this.displayReceipts();
                        this.hideLoading();
                        return;
                    }
                    
                    // First row is headers
                    const headers = rawResults.data[0] || [];
                    
                    // Find CUSTOMER column index
                    const customerColumnIndex = headers.findIndex(h => 
                        h && String(h).trim().toUpperCase() === 'CUSTOMER'
                    );
                    
                    if (customerColumnIndex === -1) {
                        console.warn('CUSTOMER column not found in CSV');
                        this.receipts = [];
                        this.currentCustomer = customerName;
                        this.displayReceipts();
                        this.hideLoading();
                        return;
                    }
                    
                    // Find the customer row
                    let customerRowIndex = -1;
                    let customerRowData = null;
                    
                    for (let i = 1; i < rawResults.data.length; i++) {
                        const row = rawResults.data[i];
                        const rowCustomerName = row[customerColumnIndex];
                        if (rowCustomerName && String(rowCustomerName).trim() === customerName) {
                            customerRowIndex = i;
                            customerRowData = row;
                            break;
                        }
                    }
                    
                    if (!customerRowData) {
                        console.warn('Customer not found in CSV:', customerName);
                        this.receipts = [];
                        this.currentCustomer = customerName;
                        this.displayReceipts();
                        this.hideLoading();
                        return;
                    }
                    
                    // Extract all receipt columns by iterating through headers
                    const receipts = [];
                    let receiptColumnIndex = 0;
                    
                    for (let i = 0; i < headers.length; i++) {
                        const header = headers[i];
                        const headerUpper = header ? String(header).trim().toUpperCase() : '';
                        
                        // Skip CUSTOMER column
                        if (headerUpper === 'CUSTOMER') {
                            continue;
                        }
                        
                        // Check if this is a RECEIPT column
                        if (headerUpper.startsWith('RECEIPT')) {
                            const receiptValue = customerRowData[i];
                            
                            if (receiptValue && String(receiptValue).trim() !== '') {
                                try {
                                    // The receipt is stored as a JSON string, but it might be double-encoded
                                    let receiptJson = String(receiptValue).trim();
                                    
                                    // Remove surrounding quotes if present
                                    if (receiptJson.startsWith('"') && receiptJson.endsWith('"')) {
                                        receiptJson = receiptJson.slice(1, -1);
                                    }
                                    // Unescape JSON (handle double quotes)
                                    receiptJson = receiptJson.replace(/""/g, '"');
                                    
                                    const receipt = JSON.parse(receiptJson);
                                    // Store the original column index with the receipt
                                    receipt._originalIndex = receiptColumnIndex;
                                    
                                    // Ensure profitMargin is a number (handle string conversions from CSV)
                                    if (receipt.profitMargin !== undefined) {
                                        receipt.profitMargin = parseFloat(receipt.profitMargin) || 0;
                                    }
                                    
                                    receipts.push(receipt);
                                    receiptColumnIndex++;
                                } catch (e) {
                                    console.error('Error parsing receipt JSON:', e);
                                    console.error('Receipt value:', String(receiptValue).substring(0, 200));
                                    console.error('Column index:', i, 'Header:', header);
                                    // Still increment index to maintain order
                                    receiptColumnIndex++;
                                }
                            } else {
                                // Empty receipt column - still count it to maintain index
                                receiptColumnIndex++;
                            }
                        }
                    }

                    console.log(`Found ${receipts.length} receipts for ${customerName}`);
                    this.receipts = receipts;
                    this.currentCustomer = customerName;
                    this.displayReceipts();
                    this.hideLoading();
                },
                error: (error) => {
                    console.error('Error parsing receipts CSV:', error);
                    this.hideLoading();
                    this.showError('Failed to load receipts. Please try again.');
                }
            });
        } catch (error) {
            console.error('Error loading receipts:', error);
            this.hideLoading();
            this.showError('Failed to load receipts. Please try again.');
        }
    }

    handleCustomerSearch(searchTerm) {
        const term = searchTerm.trim().toLowerCase();
        
        if (term === '') {
            this.filteredCustomers = [...this.customers];
        } else {
            this.filteredCustomers = this.customers.filter(customer => {
                return customer.name.toLowerCase().includes(term);
            });
        }
        
        this.displayCustomers();
    }

    displayCustomers() {
        const customersList = document.getElementById('customersList');
        
        if (!this.customers || this.customers.length === 0) {
            customersList.innerHTML = `
                <div class="empty-state">
                    <h3>No customers found</h3>
                    <p>Customers will appear here once they have receipts.</p>
                </div>
            `;
            return;
        }
        
        if (!this.filteredCustomers || this.filteredCustomers.length === 0) {
            customersList.innerHTML = `
                <div class="empty-state">
                    <h3>No customers found</h3>
                    <p>Try a different search term.</p>
                </div>
            `;
            return;
        }

        customersList.innerHTML = this.filteredCustomers
            .filter(customer => customer && customer.name) // Filter out invalid customers
            .map(customer => {
                const customerName = String(customer.name || '').trim();
                if (!customerName) return '';
                const escapedCustomerName = this.escapeHtml(customerName).replace(/'/g, "\\'");
                const hasPendingOrder = this.pendingOrders[customerName] !== undefined;
                return `
                    <div class="customer-card">
                        <div class="customer-card-content" onclick="customersManager.selectCustomer('${escapedCustomerName}')">
                            <div class="customer-name">${this.escapeHtml(customerName)}</div>
                            <div class="customer-receipt-count">Click to view receipts</div>
                            ${hasPendingOrder ? `
                                <div class="pending-order-badge" onclick="event.stopPropagation(); customersManager.showOrderApproval('${escapedCustomerName}')">
                                    New Order
                                </div>
                            ` : ''}
                        </div>
                        <button class="delete-customer-btn" onclick="event.stopPropagation(); customersManager.deleteCustomer('${escapedCustomerName}')" title="Delete customer">
                            ×
                        </button>
                    </div>
                `;
            })
            .filter(html => html !== '') // Remove empty strings
            .join('');
    }
    
    // Show order approval modal
    showOrderApproval(customerName) {
        const order = this.pendingOrders[customerName];
        if (!order) {
            return;
        }
        
        this.pendingOrderCustomer = customerName;
        
        // Create or show approval modal
        let modal = document.getElementById('orderApprovalModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'orderApprovalModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Order Approval</h2>
                        <button class="close-btn" id="closeOrderApprovalModal">&times;</button>
                    </div>
                    <div id="orderApprovalContent" style="padding: 0;"></div>
                    <div class="modal-actions" style="padding: 24px; display: flex; gap: 12px;">
                        <button id="approveOrderBtn" class="btn btn-primary">Approve</button>
                        <button id="disapproveOrderBtn" class="btn btn-secondary">Disapprove</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Add event listeners
            document.getElementById('closeOrderApprovalModal').addEventListener('click', () => {
                this.closeOrderApprovalModal();
            });
            document.getElementById('approveOrderBtn').addEventListener('click', () => {
                this.approveOrder(true);
            });
            document.getElementById('disapproveOrderBtn').addEventListener('click', () => {
                this.approveOrder(false);
            });
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeOrderApprovalModal();
                }
            });
        }
        
        // Display order as receipt format
        const content = document.getElementById('orderApprovalContent');
        if (content) {
            // Format order as receipt (similar to index page)
            const isMobile = window.innerWidth <= 768;
            const nameWidth = isMobile ? 15 : 22;
            const rateWidth = isMobile ? 7 : 8;
            const totalWidth = isMobile ? 8 : 10;
            const separatorWidth = isMobile ? 35 : 50;
            
            const items = order.items || [];
            const validItems = items.filter((item) => {
                if (!item || !item.name || item.rate === undefined || item.quantity === undefined) {
                    return false;
                }
                return true;
            });
            
            const itemsText = validItems.map((item, index) => {
                const serialNumber = (index + 1).toString();
                const cleanName = item.name.trim().replace(/\s+/g, ' ');
                const serialPrefix = `${serialNumber}. `;
                const availableNameWidth = nameWidth - serialPrefix.length;
                const name = cleanName.length > availableNameWidth ? cleanName.substring(0, availableNameWidth - 3) + '...' : cleanName;
                const qty = item.quantity.toString();
                const rate = item.rate.toFixed(2);
                const total = (item.rate * item.quantity).toFixed(2);
                
                const namePart = name.padEnd(availableNameWidth);
                const qtyPart = qty.padStart(2);
                const ratePart = rate.padStart(rateWidth);
                const totalPart = total.padStart(totalWidth);
                
                return `${serialPrefix}${namePart} ${qtyPart} x ${ratePart} = ${totalPart}`;
            }).join('\n');
            
            const maxSerialNumber = validItems.length;
            const serialPrefixWidth = maxSerialNumber.toString().length + 2;
            const totalLabel = "Total".padEnd(nameWidth);
            const grandTotal = order.grandTotal || 0;
            const totalValueStr = `₹${grandTotal.toFixed(2)}`;
            const totalLineWidth = serialPrefixWidth + nameWidth + 1 + 2 + 1 + 1 + 1 + rateWidth + 1 + 1 + 1 + totalWidth;
            const totalValue = totalValueStr.padStart(totalLineWidth - nameWidth);
            
            const receiptLines = [
                order.storeName || "SHREEJI'S STORE",
                `Customer: ${customerName.toUpperCase()}`,
                '',
                `Date: ${order.date || 'N/A'}`,
                `Time: ${order.time || 'N/A'}`,
                '',
                '·'.repeat(separatorWidth),
                isMobile ? 'Item           Qty  Rate    Total' : 'Item                  Qty    Rate      Total',
                '·'.repeat(separatorWidth),
                itemsText,
                '·'.repeat(separatorWidth),
                `${totalLabel}${totalValue}`,
                '·'.repeat(separatorWidth),
                '',
                'Order Pending Approval'
            ];
            
            // Create receipt content element with monospace font (matching index page style)
            content.innerHTML = '';
            const receiptContent = document.createElement('div');
            receiptContent.className = 'receipt-content';
            receiptContent.style.cssText = 'padding: 32px 28px 32px 28px; font-family: "Courier New", Courier, monospace; font-size: 13px; line-height: 1.9; color: #000000; background: #ffffff; white-space: pre; text-align: left; width: 100%; margin: 0 auto; overflow-x: visible; letter-spacing: 0.1px; min-height: auto;';
            receiptContent.textContent = receiptLines.join('\n');
            content.appendChild(receiptContent);
        }
        
        modal.classList.add('active');
    }
    
    closeOrderApprovalModal() {
        const modal = document.getElementById('orderApprovalModal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.pendingOrderCustomer = null;
    }
    
    async approveOrder(approved) {
        if (!this.pendingOrderCustomer) {
            return;
        }
        
        this.showLoading();
        try {
            const response = await fetch('/api/approve-order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerName: this.pendingOrderCustomer,
                    approved: approved
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to ${approved ? 'approve' : 'disapprove'} order: ${response.status}`);
            }
            
            const result = await response.json();
            if (result.success) {
                // Remove from pending orders
                delete this.pendingOrders[this.pendingOrderCustomer];
                
                // Refresh display
                this.displayCustomers();
                
                // Reload customers cache if order was approved
                if (approved) {
                    // Clear cache to force refresh
                    localStorage.removeItem(CUSTOMERS_CACHE_KEY);
                    localStorage.removeItem(CUSTOMERS_CACHE_KEY_PARSED);
                    localStorage.removeItem(CUSTOMERS_CACHE_TIMESTAMP_KEY);
                    await this.loadCustomers(true);
                }
                
                this.closeOrderApprovalModal();
            } else {
                throw new Error(result.error || `Failed to ${approved ? 'approve' : 'disapprove'} order`);
            }
        } catch (error) {
            console.error('Error approving/disapproving order:', error);
            alert(`Failed to ${approved ? 'approve' : 'disapprove'} order. Please try again.`);
        } finally {
            this.hideLoading();
        }
    }

    async selectCustomer(customerName) {
        await this.loadReceipts(customerName);
        this.showReceiptsView();
    }
    
    // Delete a customer - show confirmation modal
    deleteCustomer(customerName) {
        // Store deletion info for confirmation
        this.pendingDelete = {
            type: 'customer',
            customerName: customerName
        };
        
        // Show confirmation modal
        this.showDeleteConfirmModal();
    }
    
    // Delete a receipt - show confirmation modal
    deleteReceipt(customerName, receiptIndex, displayIndex) {
        // Store deletion info for confirmation
        this.pendingDelete = {
            type: 'receipt',
            customerName: customerName,
            receiptIndex: receiptIndex,
            displayIndex: displayIndex
        };
        
        // Show confirmation modal
        this.showDeleteConfirmModal();
    }
    
    // Show delete confirmation modal
    showDeleteConfirmModal() {
        const modal = document.getElementById('deleteConfirmModal');
        const modalTitle = modal.querySelector('h2');
        const modalBody = modal.querySelector('.modal-body p');
        
        if (modal && this.pendingDelete) {
            if (this.pendingDelete.type === 'customer') {
                modalTitle.textContent = 'Delete Customer';
                modalBody.textContent = `Are you sure you want to delete customer "${this.pendingDelete.customerName}"? This will delete all their receipts. This action cannot be undone.`;
            } else {
                modalTitle.textContent = 'Delete Receipt';
                modalBody.textContent = 'Are you sure you want to delete this receipt? This action cannot be undone.';
            }
            modal.classList.add('active');
        }
    }
    
    // Close delete confirmation modal
    closeDeleteConfirmModal() {
        const modal = document.getElementById('deleteConfirmModal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.pendingDelete = null;
    }
    
    // Confirm and execute deletion (customer or receipt)
    async confirmDeleteReceipt() {
        if (!this.pendingDelete) {
            return;
        }
        
        if (this.pendingDelete.type === 'customer') {
            await this.confirmDeleteCustomer();
        } else {
            await this.confirmDeleteReceiptAction();
        }
    }
    
    // Confirm and execute customer deletion
    async confirmDeleteCustomer() {
        if (!this.pendingDelete || this.pendingDelete.type !== 'customer') {
            return;
        }
        
        const { customerName } = this.pendingDelete;
        this.closeDeleteConfirmModal();
        
        this.showLoading();
        try {
            const response = await fetch('/api/delete-customer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerName: customerName
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete customer: ${response.status}`);
            }
            
            const result = await response.json();
            if (result.success) {
                // Immediately remove customer from local arrays
                this.customers = this.customers.filter(customer => {
                    const name = customer.name || (typeof customer === 'string' ? customer : '');
                    return name && name.trim().toUpperCase() !== customerName.toUpperCase();
                });
                this.filteredCustomers = this.filteredCustomers.filter(customer => {
                    const name = customer.name || (typeof customer === 'string' ? customer : '');
                    return name && name.trim().toUpperCase() !== customerName.toUpperCase();
                });
                
                // Update local cache by removing the customer
                this.updateCustomersCacheAfterDeleteCustomer(customerName);
                
                // Refresh the display immediately
                this.displayCustomers();
                
                // If we're viewing this customer's receipts, go back to customers view
                if (this.currentCustomer === customerName) {
                    this.showCustomersView();
                }
                
                // Don't fetch from server - cache is already updated
                // The cache update happens asynchronously, but we've already updated local arrays
                // Fresh data will be fetched on next 5-minute interval if needed
            } else {
                throw new Error(result.error || 'Failed to delete customer');
            }
        } catch (error) {
            console.error('Error deleting customer:', error);
            alert('Failed to delete customer. Please try again.');
        } finally {
            this.hideLoading();
            this.pendingDelete = null;
        }
    }
    
    // Confirm and execute receipt deletion
    async confirmDeleteReceiptAction() {
        if (!this.pendingDelete || this.pendingDelete.type !== 'receipt') {
            return;
        }
        
        const { customerName, receiptIndex, displayIndex } = this.pendingDelete;
        this.closeDeleteConfirmModal();
        
        this.showLoading();
        try {
            // First, get the sorted receipts to find the correct receipt by display index
            const sortedReceipts = [...this.receipts].sort((a, b) => {
                const dateA = this.parseDate(a.date);
                const dateB = this.parseDate(b.date);
                if (dateA !== dateB) {
                    return dateB - dateA;
                }
                const timeA = this.parseTime(a.time || '');
                const timeB = this.parseTime(b.time || '');
                if (timeA !== timeB) {
                    return timeB - timeA;
                }
                const indexA = a._originalIndex !== undefined ? a._originalIndex : 999;
                const indexB = b._originalIndex !== undefined ? b._originalIndex : 999;
                return indexA - indexB;
            });
            
            // Log all receipts in sorted order for debugging
            console.log('Sorted receipts before deletion:', sortedReceipts.map((r, idx) => ({
                displayIndex: idx,
                date: r.date,
                time: r.time,
                originalIndex: r._originalIndex
            })));
            
            // Get the receipt at the display index (the one the user clicked)
            const receiptToDelete = sortedReceipts[displayIndex];
            if (!receiptToDelete) {
                throw new Error('Receipt not found at display index');
            }
            
            // Get the actual originalIndex from the receipt (for Google Sheets)
            const actualReceiptIndex = receiptToDelete._originalIndex !== undefined 
                ? receiptToDelete._originalIndex 
                : receiptIndex;
            
            console.log('Receipt to delete:', {
                displayIndex,
                date: receiptToDelete.date,
                time: receiptToDelete.time,
                originalIndex: actualReceiptIndex
            });
            
            const response = await fetch('/api/delete-receipt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerName: customerName,
                    receiptIndex: actualReceiptIndex
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete receipt: ${response.status}`);
            }
            
            const result = await response.json();
            if (result.success) {
                // Update local cache FIRST before modifying arrays
                // This ensures cache is updated before any reload happens
                // Update local cache by removing the receipt
                // Pass receipt data (date, time) to help identify the correct receipt in cache
                this.updateCustomersCacheAfterDelete(customerName, actualReceiptIndex, {
                    date: receiptToDelete.date,
                    time: receiptToDelete.time
                });
                
                // Immediately remove the receipt from local arrays
                // receiptToDelete is from sortedReceipts which is a spread of this.receipts
                // So it should be the same object reference - use direct object comparison
                console.log('Deleting receipt:', {
                    displayIndex,
                    actualReceiptIndex,
                    receiptDate: receiptToDelete.date,
                    receiptTime: receiptToDelete.time,
                    receiptOriginalIndex: receiptToDelete._originalIndex
                });
                
                // Remove the exact receipt object we found
                const beforeCount = this.receipts.length;
                this.receipts = this.receipts.filter(r => r !== receiptToDelete);
                let afterCount = this.receipts.length;
                
                console.log(`Removed receipt: ${beforeCount} -> ${afterCount} receipts`);
                
                // If object reference didn't work, try by _originalIndex as fallback
                if (beforeCount === afterCount) {
                    console.warn('Object reference match failed, using _originalIndex fallback');
                    this.receipts = this.receipts.filter(r => {
                        const rIndex = r._originalIndex !== undefined ? r._originalIndex : -1;
                        return rIndex !== actualReceiptIndex;
                    });
                    afterCount = this.receipts.length;
                    console.log(`After fallback: ${afterCount} receipts`);
                }
                
                // Log remaining receipts after deletion
                console.log('Remaining receipts after deletion:', this.receipts.map((r, idx) => ({
                    index: idx,
                    date: r.date,
                    time: r.time,
                    originalIndex: r._originalIndex
                })));
                
                // Refresh the display immediately with updated receipts array
                this.displayReceipts();
                
                // Don't reload from cache immediately - we've already updated the local array
                // The cache update happens asynchronously, so reloading would cause a race condition
                // The cache will be updated in the background, and will be used on next page load
            } else {
                throw new Error(result.error || 'Failed to delete receipt');
            }
        } catch (error) {
            console.error('Error deleting receipt:', error);
            alert('Failed to delete receipt. Please try again.');
        } finally {
            this.hideLoading();
            this.pendingDelete = null;
        }
    }
    
    // Update customers cache after deleting a customer
    updateCustomersCacheAfterDeleteCustomer(customerName) {
        try {
            // Get cached CSV data
            const cachedCsv = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            if (!cachedCsv) {
                console.warn('No customers cache found to update');
                return;
            }
            
            // Parse the CSV
            Papa.parse(cachedCsv, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    // Filter out the deleted customer
                    const filteredData = results.data.filter(row => {
                        const rowCustomerName = row.CUSTOMER || row.customer || row.Customer || '';
                        return rowCustomerName && rowCustomerName.trim().toUpperCase() !== customerName.toUpperCase();
                    });
                    
                    // Convert back to CSV
                    const newCsv = Papa.unparse(filteredData, {
                        header: true
                    });
                    
                    // Update cache
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, newCsv);
                    
                    // Update parsed cache
                    const updatedCustomers = filteredData
                        .map(row => {
                            const name = row.CUSTOMER || row.customer || row.Customer || '';
                            return name ? { name: name.trim() } : null;
                        })
                        .filter(c => c && c.name);
                    
                    localStorage.setItem(CUSTOMERS_CACHE_KEY_PARSED, JSON.stringify(updatedCustomers));
                    localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                    
                    console.log('Updated customers cache after deleting customer');
                },
                error: (error) => {
                    console.error('Error updating customers cache:', error);
                }
            });
        } catch (error) {
            console.error('Error updating customers cache after delete:', error);
        }
    }
    
    // Update customers cache after deleting a receipt
    // receiptToDeleteData should contain date and time to uniquely identify the receipt
    updateCustomersCacheAfterDelete(customerName, receiptIndex, receiptToDeleteData = null) {
        try {
            // Get cached CSV data
            const cachedCsv = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            if (!cachedCsv) {
                console.warn('No customers cache found to update');
                return;
            }
            
            // Parse the CSV
            Papa.parse(cachedCsv, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    // Find the customer row
                    let customerRow = null;
                    
                    for (let i = 0; i < results.data.length; i++) {
                        const row = results.data[i];
                        const rowCustomerName = row.CUSTOMER || row.customer || row.Customer || '';
                        if (rowCustomerName && rowCustomerName.trim().toUpperCase() === customerName.toUpperCase()) {
                            customerRow = row;
                            break;
                        }
                    }
                    
                    if (!customerRow) {
                        console.warn('Customer not found in cache for receipt deletion');
                        return;
                    }
                    
                    // Find receipt columns
                    const receiptColumns = results.meta.fields.filter(f => f.toUpperCase().startsWith('RECEIPT'));
                    if (receiptColumns.length === 0) {
                        console.warn('No receipt columns found in cache');
                        return;
                    }
                    
                    // Find the receipt to delete
                    // First try by index, but also try to match by date/time if provided
                    let receiptField = null;
                    let receiptFieldIndex = -1;
                    
                    // Sort receipt columns to match the order used when loading
                    const sortedReceiptColumns = receiptColumns.sort((a, b) => {
                        // Keep CUSTOMER first, then RECEIPT columns in order
                        if (a.toUpperCase() === 'CUSTOMER') return -1;
                        if (b.toUpperCase() === 'CUSTOMER') return 1;
                        return a.localeCompare(b);
                    });
                    
                    // Count non-empty receipts to find the one at receiptIndex
                    let receiptCount = 0;
                    for (const col of sortedReceiptColumns) {
                        const receiptValue = customerRow[col];
                        if (receiptValue && receiptValue.trim() !== '') {
                            // If we have receipt data to match, try to parse and match by date/time
                            if (receiptToDeleteData && receiptToDeleteData.date && receiptToDeleteData.time) {
                                try {
                                    let receiptJson = receiptValue.trim();
                                    if (receiptJson.startsWith('"') && receiptJson.endsWith('"')) {
                                        receiptJson = receiptJson.slice(1, -1);
                                    }
                                    receiptJson = receiptJson.replace(/""/g, '"');
                                    const receipt = JSON.parse(receiptJson);
                                    
                                    // Match by date and time
                                    if (receipt.date === receiptToDeleteData.date && receipt.time === receiptToDeleteData.time) {
                                        receiptField = col;
                                        receiptFieldIndex = results.meta.fields.indexOf(col);
                                        break;
                                    }
                                } catch (e) {
                                    // If parsing fails, continue
                                }
                            }
                            
                            // If we haven't found a match yet and this is the receipt at receiptIndex
                            if (!receiptField && receiptCount === receiptIndex) {
                                receiptField = col;
                                receiptFieldIndex = results.meta.fields.indexOf(col);
                            }
                            
                            receiptCount++;
                        }
                    }
                    
                    if (!receiptField || receiptFieldIndex === -1) {
                        console.warn('Receipt column not found at specified index or by date/time match');
                        return;
                    }
                    
                    console.log('Deleting receipt from cache:', {
                        receiptIndex,
                        receiptField,
                        date: receiptToDeleteData?.date,
                        time: receiptToDeleteData?.time
                    });
                    
                    // Clear the receipt cell
                    customerRow[receiptField] = '';
                    
                    // Shift remaining receipts to fill the gap (move receipts from right to left)
                    for (let i = receiptFieldIndex + 1; i < results.meta.fields.length; i++) {
                        const nextField = results.meta.fields[i];
                        if (nextField && nextField.toUpperCase().startsWith('RECEIPT')) {
                            if (customerRow[nextField] && customerRow[nextField].trim() !== '') {
                                customerRow[receiptField] = customerRow[nextField];
                                customerRow[nextField] = '';
                                receiptField = nextField;
                                receiptFieldIndex = i;
                            }
                        }
                    }
                    
                    // Convert back to CSV and save
                    const updatedCsv = Papa.unparse(results.data, {
                        header: true,
                        columns: results.meta.fields
                    });
                    
                    // Update cache
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, updatedCsv);
                    localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                    
                    console.log('Updated customers cache after receipt deletion');
                },
                error: (error) => {
                    console.error('Error updating customers cache after deletion:', error);
                }
            });
        } catch (error) {
            console.error('Error updating customers cache after receipt deletion:', error);
        }
    }

    displayReceipts() {
        const customerHeader = document.getElementById('customerHeader');
        const receiptsList = document.getElementById('receiptsList');

        // Calculate total unpaid amount across all receipts
        let totalUnpaid = 0;
        this.receipts.forEach(receipt => {
            if (receipt.remainingBalance !== undefined) {
                totalUnpaid += receipt.remainingBalance;
            } else {
                // Calculate remaining balance if not stored
                const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
                const remaining = receipt.grandTotal - totalPaid;
                if (remaining > 0) {
                    totalUnpaid += remaining;
                }
            }
        });

        // Display customer name with total unpaid
        customerHeader.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <span>Receipts for ${this.escapeHtml(this.currentCustomer)}</span>
                ${totalUnpaid > 0 ? `
                    <span style="font-size: 18px; font-weight: 700; color: #dc3545;">
                        Total Unpaid: ₹${this.formatCurrency(totalUnpaid)}
                    </span>
                ` : `
                    <span style="font-size: 18px; font-weight: 700; color: #28a745;">
                        All Paid
                    </span>
                `}
            </div>
        `;

        if (this.receipts.length === 0) {
            receiptsList.innerHTML = `
                <div class="empty-state">
                    <h3>No receipts found</h3>
                    <p>This customer has no receipts yet.</p>
                </div>
            `;
            return;
        }

        // Sort receipts by creation order (latest first) - regardless of payment status
        // All receipts (paid and unpaid) are shown in the same list, sorted by when they were created
        const sortedReceipts = [...this.receipts].sort((a, b) => {
            // Primary sort: by date (newest first)
            const dateA = this.parseDate(a.date);
            const dateB = this.parseDate(b.date);
            
            if (dateA !== dateB) {
                return dateB - dateA; // Negative means b is newer, so b comes first
            }
            
            // Secondary sort: by time (latest first) if same date
            const timeA = this.parseTime(a.time || '');
            const timeB = this.parseTime(b.time || '');
            
            if (timeA !== timeB) {
                return timeB - timeA; // Negative means b is later, so b comes first
            }
            
            // Tertiary sort: by original index (newest receipt added first)
            // Since new receipts are added to column 2 (index 0), lower index = newer
            // Use _originalIndex to maintain the order they were added
            const indexA = a._originalIndex !== undefined ? a._originalIndex : 999;
            const indexB = b._originalIndex !== undefined ? b._originalIndex : 999;
            return indexA - indexB; // Lower index (newer column) comes first
        });

        receiptsList.innerHTML = sortedReceipts.map((receipt, index) => {
            const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
            const remainingBalance = receipt.grandTotal - totalPaid;
            const paymentStatus = this.getPaymentStatus(receipt.grandTotal, totalPaid);
            
            // Use profitMargin from receipt if available (from CSV), otherwise calculate on-the-fly
            let profitMargin = receipt.profitMargin;
            if (profitMargin === undefined || profitMargin === null) {
                // Calculate profit margin on-the-fly for receipts that don't have it
                profitMargin = this.calculateProfitMarginForReceipt(receipt);
            } else {
                // Ensure it's a number (handle string conversions from CSV)
                profitMargin = parseFloat(profitMargin) || 0;
            }

            // Get the original receipt index for deletion
            const originalIndex = receipt._originalIndex !== undefined ? receipt._originalIndex : index;
            const escapedCustomerName = this.escapeHtml(this.currentCustomer).replace(/'/g, "\\'");
            
            return `
                <div class="receipt-card">
                    <div class="receipt-card-content" onclick="customersManager.selectReceipt(${index})">
                        <div class="receipt-header">
                            <div>
                                <div class="receipt-date">${this.escapeHtml(receipt.date || 'N/A')}</div>
                                <div class="receipt-time">${this.escapeHtml(receipt.time || '')}</div>
                            </div>
                            <div class="receipt-header-right">
                                <div class="receipt-total">₹${this.formatCurrency(receipt.grandTotal || 0)}</div>
                                <button class="delete-receipt-btn" onclick="event.stopPropagation(); customersManager.deleteReceipt('${escapedCustomerName}', ${originalIndex}, ${index})" title="Delete receipt">
                                    ×
                                </button>
                            </div>
                        </div>
                        <div class="receipt-payment-status payment-status-${paymentStatus}">
                            ${this.getPaymentStatusText(paymentStatus)}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 12px; flex-wrap: wrap;">
                            ${remainingBalance > 0 ? `
                                <div class="remaining-balance">Remaining: ₹${this.formatCurrency(remainingBalance)}</div>
                            ` : ''}
                            ${profitMargin > 0 ? `
                                <div style="font-size: 14px; color: #28a745; font-weight: 600;">
                                    Profit: ₹${this.formatCurrency(profitMargin)}
                                </div>
                            ` : profitMargin < 0 ? `
                                <div style="font-size: 14px; color: #dc3545; font-weight: 600;">
                                    Loss: ₹${this.formatCurrency(Math.abs(profitMargin))}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <button class="view-receipt-btn" onclick="event.stopPropagation(); customersManager.viewReceipt(${index})" title="View receipt">
                        View Receipt
                    </button>
                </div>
            `;
        }).join('');
    }

    selectReceipt(index) {
        // Get the receipt from the sorted display array (same sorting as displayReceipts)
        // Sort by creation order (latest first), regardless of payment status
        const sortedReceipts = [...this.receipts].sort((a, b) => {
            const dateA = this.parseDate(a.date);
            const dateB = this.parseDate(b.date);
            if (dateA !== dateB) {
                return dateB - dateA;
            }
            const timeA = this.parseTime(a.time || '');
            const timeB = this.parseTime(b.time || '');
            if (timeA !== timeB) {
                return timeB - timeA;
            }
            const indexA = a._originalIndex !== undefined ? a._originalIndex : 999;
            const indexB = b._originalIndex !== undefined ? b._originalIndex : 999;
            return indexA - indexB; // Lower index (newer) comes first
        });
        
        this.currentReceipt = sortedReceipts[index];
        // Use the original column index stored in the receipt
        this.currentReceiptIndex = this.currentReceipt._originalIndex !== undefined 
            ? this.currentReceipt._originalIndex 
            : this.receipts.indexOf(this.currentReceipt);
        this.showPaymentModal();
    }

    showPaymentModal() {
        const modal = document.getElementById('paymentModal');
        const receiptSummary = document.getElementById('receiptSummary');
        const cashPayment = document.getElementById('cashPayment');
        const onlinePayment = document.getElementById('onlinePayment');

        // Display receipt summary
        const receipt = this.currentReceipt;
        const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
        const remainingBalance = receipt.grandTotal - totalPaid;

        receiptSummary.innerHTML = `
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Date:</span>
                <span class="receipt-summary-value">${this.escapeHtml(receipt.date || 'N/A')}</span>
            </div>
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Time:</span>
                <span class="receipt-summary-value">${this.escapeHtml(receipt.time || 'N/A')}</span>
            </div>
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Grand Total:</span>
                <span class="receipt-summary-value">₹${this.formatCurrency(receipt.grandTotal || 0)}</span>
            </div>
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Items:</span>
                <span class="receipt-summary-value">${receipt.items?.length || 0}</span>
            </div>
            ${totalPaid > 0 ? `
                <div class="receipt-summary-item">
                    <span class="receipt-summary-label">Total Paid:</span>
                    <span class="receipt-summary-value">₹${this.formatCurrency(totalPaid)}</span>
                </div>
                <div class="receipt-summary-item">
                    <span class="receipt-summary-label">Remaining Balance:</span>
                    <span class="receipt-summary-value">₹${this.formatCurrency(remainingBalance)}</span>
                </div>
            ` : ''}
        `;

        // Set current payment values
        cashPayment.value = receipt.payments?.cash || 0;
        onlinePayment.value = receipt.payments?.online || 0;

        modal.classList.add('active');
    }

    closePaymentModal() {
        const modal = document.getElementById('paymentModal');
        modal.classList.remove('active');
    }

    async savePayment() {
        const cashPayment = parseFloat(document.getElementById('cashPayment').value) || 0;
        const onlinePayment = parseFloat(document.getElementById('onlinePayment').value) || 0;
        const totalPaid = cashPayment + onlinePayment;

        if (totalPaid > this.currentReceipt.grandTotal) {
            alert('Total payment cannot exceed the grand total.');
            return;
        }

        this.showLoading();
        try {
            const response = await fetch('/api/update-receipt-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerName: this.currentCustomer,
                    receiptIndex: this.currentReceiptIndex !== undefined ? this.currentReceiptIndex : this.receipts.indexOf(this.currentReceipt),
                    payments: {
                        cash: cashPayment,
                        online: onlinePayment
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to update payment: ${response.status}`);
            }

            const result = await response.json();
            if (result.success) {
                // Update local receipt data
                this.currentReceipt.payments = {
                    cash: cashPayment,
                    online: onlinePayment
                };
                this.currentReceipt.remainingBalance = this.currentReceipt.grandTotal - totalPaid;
                
                // Update the receipts array with the new payment data
                const receiptIndex = this.receipts.findIndex(r => r._originalIndex === this.currentReceiptIndex);
                if (receiptIndex !== -1) {
                    this.receipts[receiptIndex].payments = this.currentReceipt.payments;
                    this.receipts[receiptIndex].remainingBalance = this.currentReceipt.remainingBalance;
                }
                
                // Update local cache with payment information
                this.updateCustomersCacheWithPayment(
                    this.currentCustomer,
                    this.currentReceiptIndex,
                    {
                        cash: cashPayment,
                        online: onlinePayment
                    }
                );
                
                // Refresh the receipts display to show updated payment info
                this.displayReceipts();
                this.closePaymentModal();
            } else {
                throw new Error(result.error || 'Failed to save payment');
            }
        } catch (error) {
            console.error('Error saving payment:', error);
            alert('Failed to save payment. Please try again.');
        } finally {
            this.hideLoading();
        }
    }

    showCustomersView() {
        document.getElementById('customersView').style.display = 'block';
        document.getElementById('receiptsView').classList.remove('active');
        // Show search bar on customers view
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            searchContainer.style.display = 'block';
        }
        // Show page title container (Customers heading) on customers view
        const pageTitleContainer = document.querySelector('.page-title-container');
        if (pageTitleContainer) {
            pageTitleContainer.style.display = 'flex';
        }
        this.currentCustomer = null;
        this.currentReceipt = null;
        this.currentReceiptIndex = null;
        this.receipts = [];
    }
    
    viewReceipt(index) {
        // Get the receipt from the sorted display array (same sorting as displayReceipts)
        const sortedReceipts = [...this.receipts].sort((a, b) => {
            const dateA = this.parseDate(a.date);
            const dateB = this.parseDate(b.date);
            if (dateA !== dateB) {
                return dateB - dateA;
            }
            const timeA = this.parseTime(a.time || '');
            const timeB = this.parseTime(b.time || '');
            if (timeA !== timeB) {
                return timeB - timeA;
            }
            const indexA = a._originalIndex !== undefined ? a._originalIndex : 999;
            const indexB = b._originalIndex !== undefined ? b._originalIndex : 999;
            return indexA - indexB;
        });
        
        const receipt = sortedReceipts[index];
        if (!receipt) {
            console.error('Receipt not found at index:', index);
            return;
        }
        
        const receiptContent = document.getElementById('receiptViewContent');
        const modal = document.getElementById('receiptViewModal');
        
        if (!receiptContent || !modal) {
            console.error('Receipt modal elements not found');
            return;
        }
        
        // Format receipt similar to script.js
        const storeName = "SHREEJI'S STORE";
        const customerName = this.currentCustomer ? this.currentCustomer.toUpperCase() : '';
        const dateStr = receipt.date || 'N/A';
        const timeStr = receipt.time || 'N/A';
        
        // Detect mobile screen
        const isMobile = window.innerWidth <= 768;
        
        // Adjust column widths based on screen size
        const nameWidth = isMobile ? 15 : 22;
        const rateWidth = isMobile ? 7 : 8;
        const totalWidth = isMobile ? 8 : 10;
        const separatorWidth = isMobile ? 35 : 50;
        
        // Format items for receipt
        const items = receipt.items || [];
        const validItems = items.filter((item) => {
            if (!item || !item.name || item.rate === undefined || item.quantity === undefined) {
                return false;
            }
            return true;
        });
        
        const itemsText = validItems.map((item, index) => {
            // Serial number (1-based)
            const serialNumber = (index + 1).toString();
            
            // Trim and normalize the item name
            const cleanName = item.name.trim().replace(/\s+/g, ' ');
            // Adjust name width to account for serial number (e.g., "1. " = 3 chars)
            const serialPrefix = `${serialNumber}. `;
            const availableNameWidth = nameWidth - serialPrefix.length;
            const name = cleanName.length > availableNameWidth ? cleanName.substring(0, availableNameWidth - 3) + '...' : cleanName;
            const qty = item.quantity.toString();
            const rate = item.rate.toFixed(2);
            const total = (item.rate * item.quantity).toFixed(2);
            
            // Format: Serial Number. Name (left), then Qty x Rate = Total (right aligned)
            const namePart = name.padEnd(availableNameWidth);
            const qtyPart = qty.padStart(2);
            const ratePart = rate.padStart(rateWidth);
            const totalPart = total.padStart(totalWidth);
            
            return `${serialPrefix}${namePart} ${qtyPart} x ${ratePart} = ${totalPart}`;
        }).join('\n');
        
        // Format total with proper alignment
        // Calculate serial prefix width (e.g., "1. " = 3, "10. " = 4, "100. " = 5)
        const maxSerialNumber = validItems.length;
        const serialPrefixWidth = maxSerialNumber.toString().length + 2; // number + ". "
        const totalLabel = "Total".padEnd(nameWidth);
        const grandTotal = receipt.grandTotal || 0;
        const totalValueStr = `₹${grandTotal.toFixed(2)}`;
        // Calculate remaining space: serialPrefixWidth + nameWidth + 1 (space) + 2 (qty) + 1 (space) + 1 (x) + 1 (space) + rateWidth + 1 (space) + 1 (=) + 1 (space) + totalWidth
        const totalLineWidth = serialPrefixWidth + nameWidth + 1 + 2 + 1 + 1 + 1 + rateWidth + 1 + 1 + 1 + totalWidth;
        const totalValue = totalValueStr.padStart(totalLineWidth - nameWidth);
        
        // Build receipt content
        const receiptLines = [
            storeName,
            customerName ? `Customer: ${customerName}` : '',
            '',
            `Date: ${dateStr}`,
            `Time: ${timeStr}`,
            '',
            '·'.repeat(separatorWidth),
            isMobile ? 'Item           Qty  Rate    Total' : 'Item                  Qty    Rate      Total',
            '·'.repeat(separatorWidth),
            itemsText,
            '·'.repeat(separatorWidth),
            `${totalLabel}${totalValue}`,
            '·'.repeat(separatorWidth),
            '',
            'Thank you for your purchase!'
        ];
        
        receiptContent.textContent = receiptLines.join('\n');
        modal.style.display = 'flex';
    }
    
    closeReceiptView() {
        const modal = document.getElementById('receiptViewModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    async shareReceiptView() {
        const receiptContent = document.getElementById('receiptViewContent');
        const modal = document.getElementById('receiptViewModal');
        
        if (!receiptContent || !modal) {
            alert('Receipt not found');
            return;
        }
        
        // Ensure modal is visible for capture
        if (modal.style.display === 'none') {
            modal.style.display = 'flex';
        }
        
        try {
            // Show loading
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.classList.add('active');
                const loadingText = loadingOverlay.querySelector('p');
                if (loadingText) {
                    loadingText.textContent = 'Generating receipt image...';
                }
            }
            
            // Wait a bit for any rendering to complete
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Temporarily ensure receipt content is fully visible and not clipped
            const originalOverflow = receiptContent.style.overflow;
            const originalOverflowX = receiptContent.style.overflowX;
            const originalOverflowY = receiptContent.style.overflowY;
            const originalWidth = receiptContent.style.width;
            const originalMaxWidth = receiptContent.style.maxWidth;
            const originalBoxSizing = receiptContent.style.boxSizing;
            
            // Make receipt content fully visible for capture
            receiptContent.style.overflow = 'visible';
            receiptContent.style.overflowX = 'visible';
            receiptContent.style.overflowY = 'visible';
            receiptContent.style.width = 'auto';
            receiptContent.style.maxWidth = 'none';
            receiptContent.style.boxSizing = 'content-box';
            
            // Also ensure modal content doesn't clip
            const modalContent = modal.querySelector('.receipt-modal-content');
            let canvas;
            
            if (modalContent) {
                const originalModalOverflow = modalContent.style.overflow;
                const originalModalOverflowX = modalContent.style.overflowX;
                const originalModalWidth = modalContent.style.width;
                const originalModalMaxWidth = modalContent.style.maxWidth;
                
                modalContent.style.overflow = 'visible';
                modalContent.style.overflowX = 'visible';
                modalContent.style.width = 'auto';
                modalContent.style.maxWidth = 'none';
                
                // Wait for layout to update
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Get the actual dimensions after making it visible
                const receiptWidth = Math.max(
                    receiptContent.scrollWidth,
                    receiptContent.offsetWidth,
                    receiptContent.getBoundingClientRect().width
                );
                const receiptHeight = Math.max(
                    receiptContent.scrollHeight,
                    receiptContent.offsetHeight,
                    receiptContent.getBoundingClientRect().height
                );
                
                // Capture the receipt content as canvas
                canvas = await html2canvas(receiptContent, {
                    backgroundColor: '#ffffff',
                    scale: 2, // Higher quality
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: receiptWidth,
                    height: receiptHeight,
                    x: 0,
                    y: 0,
                    scrollX: 0,
                    scrollY: 0
                });
                
                // Restore modal content styles
                modalContent.style.overflow = originalModalOverflow;
                modalContent.style.overflowX = originalModalOverflowX;
                modalContent.style.width = originalModalWidth;
                modalContent.style.maxWidth = originalModalMaxWidth;
            } else {
                // Fallback if modal-content not found
                const receiptWidth = Math.max(
                    receiptContent.scrollWidth,
                    receiptContent.offsetWidth,
                    receiptContent.getBoundingClientRect().width
                );
                const receiptHeight = Math.max(
                    receiptContent.scrollHeight,
                    receiptContent.offsetHeight,
                    receiptContent.getBoundingClientRect().height
                );
                
                canvas = await html2canvas(receiptContent, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: receiptWidth,
                    height: receiptHeight,
                    x: 0,
                    y: 0,
                    scrollX: 0,
                    scrollY: 0
                });
            }
            
            // Restore receipt content styles
            receiptContent.style.overflow = originalOverflow;
            receiptContent.style.overflowX = originalOverflowX;
            receiptContent.style.overflowY = originalOverflowY;
            receiptContent.style.width = originalWidth;
            receiptContent.style.maxWidth = originalMaxWidth;
            receiptContent.style.boxSizing = originalBoxSizing;
            
            // Convert canvas to blob
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    throw new Error('Failed to create image blob');
                }
                
                const file = new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
                
                // Use Web Share API if available
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: 'Receipt',
                            text: 'Receipt from Shreeji\'s Store',
                            files: [file]
                        });
                    } catch (shareError) {
                        if (shareError.name !== 'AbortError') {
                            console.error('Error sharing:', shareError);
                            // Fallback to download
                            this.downloadReceiptImage(canvas);
                        }
                    }
                } else {
                    // Fallback to download
                    this.downloadReceiptImage(canvas);
                }
                
                // Hide loading
                if (loadingOverlay) {
                    loadingOverlay.classList.remove('active');
                }
            }, 'image/jpeg', 0.95);
            
        } catch (error) {
            console.error('Error sharing receipt:', error);
            alert('Failed to share receipt. Please try again.');
            
            // Hide loading
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.classList.remove('active');
            }
        }
    }
    
    downloadReceiptImage(canvas) {
        const link = document.createElement('a');
        link.download = 'receipt.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
    }

    showReceiptsView() {
        document.getElementById('customersView').style.display = 'none';
        document.getElementById('receiptsView').classList.add('active');
        // Hide search bar on receipts view
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            searchContainer.style.display = 'none';
        }
        // Hide page title container (Customers heading) on receipts view
        const pageTitleContainer = document.querySelector('.page-title-container');
        if (pageTitleContainer) {
            pageTitleContainer.style.display = 'none';
        }
    }

    getPaymentStatus(grandTotal, totalPaid) {
        if (totalPaid >= grandTotal) {
            return 'paid';
        } else if (totalPaid > 0) {
            return 'partial';
        } else {
            return 'unpaid';
        }
    }

    getPaymentStatusText(status) {
        switch (status) {
            case 'paid':
                return 'Paid';
            case 'partial':
                return 'Partial Payment';
            case 'unpaid':
                return 'Unpaid';
            default:
                return 'Unknown';
        }
    }

    parseDate(dateStr) {
        if (!dateStr) return 0;
        // Try to parse DD/MM/YYYY format
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
            const year = parseInt(parts[2], 10);
            const date = new Date(year, month, day);
            return date.getTime();
        }
        // Try to parse other formats
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    
    parseTime(timeStr) {
        if (!timeStr) return 0;
        // Try to parse HH:MM AM/PM format
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const period = timeMatch[3] ? timeMatch[3].toUpperCase() : '';
            
            if (period === 'PM' && hours !== 12) {
                hours += 12;
            } else if (period === 'AM' && hours === 12) {
                hours = 0;
            }
            
            return hours * 60 + minutes; // Return minutes since midnight for easy comparison
        }
        // Try to parse HH:MM format (24-hour)
        const parts = timeStr.split(':');
        if (parts.length >= 2) {
            const hours = parseInt(parts[0], 10);
            const minutes = parseInt(parts[1], 10);
            return hours * 60 + minutes;
        }
        return 0;
    }

    formatCurrency(amount) {
        return parseFloat(amount).toFixed(2);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showError(message) {
        const customersList = document.getElementById('customersList');
        customersList.innerHTML = `
            <div class="error-message">
                ${this.escapeHtml(message)}
            </div>
        `;
    }
}

// Initialize the customers manager
const customersManager = new CustomersManager();

