// Store Products CSV URL - using proxy endpoint to keep URL hidden
// The proxy endpoint (/api/products) fetches from Google Sheets server-side
const STORE_PRODUCTS_URL = '/api/products';


// Cache keys
const PRODUCTS_CACHE_KEY = 'storeProductsCache';
const CUSTOMERS_CACHE_KEY = 'customersCache';
const PRODUCTS_CACHE_TIMESTAMP_KEY = 'storeProductsCacheTimestamp';
const CUSTOMERS_CACHE_TIMESTAMP_KEY = 'customersCacheTimestamp';
const LAST_VIEW_KEY = 'storeProductsLastView';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

class POSSystem {
    constructor() {
        this.products = [];
        this.cart = [];
        this.customers = [];
        this.cacheRefreshInterval = null;
        this.cacheRefreshTimeout = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        
        // Load both products and customers from cache first, then fetch fresh data
        const hasProductsCache = this.loadProductsFromCache();
        const hasCustomersCache = this.loadCustomersFromCache();
        
        // Check if products cache is stale
        const isProductsStale = hasProductsCache ? this.isCacheStale() : true;
        
        if (hasProductsCache && this.products.length > 0 && !isProductsStale) {
            // Cache exists, has products, and is fresh (less than 5 minutes old) - use it immediately
            this.handleSearch('');
            this.updateLastViewTime();
        } else {
            // No cache exists, cache is empty, or cache is stale - fetch data
            if (isProductsStale && hasProductsCache) {
                console.log('Products cache is stale, fetching fresh data...');
            }
            await this.loadProductsWithRetry(false); // silent = false (show loading overlay)
            
            // Ensure cache was populated after initial load
            if (this.products.length === 0) {
                console.error('Failed to load products on initial page load, retrying...');
                await this.loadProductsWithRetry(false);
            }
            
            // Final verification that cache is populated
            if (this.products.length > 0) {
                const cachePopulated = this.verifyCacheSaved();
                if (cachePopulated) {
                    console.log(`✓ Cache successfully populated with ${this.products.length} products on page load`);
                } else {
                    console.warn('Cache verification failed after initial load, attempting to save again...');
                    this.saveProductsToCache(this.products);
                }
            }
        }
        
        // Load customers - will check cache staleness internally
        // Only fetch if cache is missing or stale (older than 5 minutes)
        if (!hasCustomersCache) {
            // No cache at all - fetch and cache
            await this.loadCustomers(true); // Load and cache customers (silent mode)
        } else {
            // Cache exists - check if it's stale
            const isStale = this.isCustomersCacheStale();
            if (isStale) {
                // Cache is stale - fetch fresh data in background
                await this.loadCustomers(true); // Silent background refresh
            }
            // If cache is fresh, customers are already loaded from loadCustomersFromCache() above
        }
        
        // Set up periodic cache refresh (every 5 minutes) - flush and replace
        // Cache is only updated when:
        // 1. Changes are made (receipts created, payments saved)
        // 2. Fresh data is fetched (when cache is missing or stale)
        // 3. Every 5 minutes (automatic flush and replace)
        this.setupPeriodicRefresh();
    }
    
    // Load products with retry logic
    async loadProductsWithRetry(silent = false, retryCount = 0, maxRetries = 3) {
        try {
            await this.loadProducts(silent);
            
            // Verify products were loaded successfully
            if (this.products.length === 0) {
                // Try to restore from cache first
                if (this.ensureProductsFromCache()) {
                    console.log('Products restored from cache after empty result');
                    return; // Success with cached products
                }
                
                // If no cache and retries left, retry
                if (retryCount < maxRetries) {
                    console.warn(`No products loaded, retrying... (${retryCount + 1}/${maxRetries})`);
                    // Wait 1 second before retry
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return this.loadProductsWithRetry(silent, retryCount + 1, maxRetries);
                }
            }
        } catch (error) {
            // Try to restore from cache on error
            if (this.ensureProductsFromCache()) {
                console.log('Products restored from cache after error in retry');
                return; // Success with cached products
            }
            
            // Retry on error if retries left
            if (retryCount < maxRetries) {
                console.warn(`Error loading products, retrying... (${retryCount + 1}/${maxRetries}):`, error);
                // Wait 1 second before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.loadProductsWithRetry(silent, retryCount + 1, maxRetries);
            } else {
                // Final fallback - try cache one more time
                if (this.ensureProductsFromCache()) {
                    console.log('Products restored from cache as final fallback');
                    return; // Success with cached products
                }
                throw error; // Re-throw if max retries reached and no cache
            }
        }
    }
    
    // Check if cache is stale (older than 5 minutes)
    isCacheStale() {
        try {
            const cacheTimestamp = localStorage.getItem(PRODUCTS_CACHE_TIMESTAMP_KEY);
            
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
            console.error('Error checking cache staleness:', error);
            return true; // On error, consider it stale
        }
    }
    
    // Schedule cache refresh when current cache becomes stale
    // NOTE: This is no longer used - cache is only refreshed:
    // 1. When changes are made (receipts created, payments saved)
    // 2. When fetching fresh data (cache missing or stale)
    // 3. Every 5 minutes (automatic flush and replace via setupPeriodicRefresh)
    scheduleCacheRefresh() {
        // Deprecated - cache refresh is handled by setupPeriodicRefresh
        // Keeping this function for backwards compatibility but it does nothing
    }
    
    // Set up periodic refresh every 5 minutes
    setupPeriodicRefresh() {
        // Clear any existing interval
        if (this.cacheRefreshInterval) {
            clearInterval(this.cacheRefreshInterval);
        }
        
        // Refresh cache every 5 minutes - flush old cache and replace with fresh data
        this.cacheRefreshInterval = setInterval(() => {
            console.log('Periodic cache refresh triggered - flushing and replacing cache');
            this.flushAndRefreshCache();
        }, CACHE_DURATION_MS);
    }
    
    // Flush old cache and replace with fresh data
    async flushAndRefreshCache() {
        try {
            // Clear old cache timestamps to force fresh fetch
            localStorage.removeItem(PRODUCTS_CACHE_KEY);
            localStorage.removeItem(CUSTOMERS_CACHE_KEY);
            localStorage.removeItem(CUSTOMERS_CACHE_KEY + '_parsed');
            localStorage.removeItem(PRODUCTS_CACHE_TIMESTAMP_KEY);
            localStorage.removeItem(CUSTOMERS_CACHE_TIMESTAMP_KEY);
            
            console.log('Cache flushed, fetching fresh data...');
            
            // Fetch fresh data and save to cache
            await Promise.all([
                this.loadProductsWithRetry(true).catch(err => {
                    console.error('Error refreshing products cache:', err);
                }),
                this.loadCustomers(true).catch(err => {
                    console.error('Error refreshing customers cache:', err);
                })
            ]);
            
            console.log('Cache refreshed with fresh data');
        } catch (error) {
            console.error('Error flushing and refreshing cache:', error);
        }
    }
    
    // Update last view timestamp
    updateLastViewTime() {
        try {
            localStorage.setItem(LAST_VIEW_KEY, Date.now().toString());
        } catch (error) {
            console.error('Error updating last view time:', error);
        }
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
    
    // Load customers from CSV for autocomplete
    async loadCustomers(silent = false) {
        try {
            // Always try to load from cache first
            const cached = this.loadCustomersFromCache();
            if (cached && this.customers.length > 0) {
                // Cache exists and has data
                // Only fetch if cache is stale (older than 5 minutes) or if explicitly requested (silent=false on first load)
                const isStale = this.isCustomersCacheStale();
                
                if (!isStale) {
                    // Cache is fresh (less than 5 minutes old) - use it, don't fetch
                    if (!silent) {
                        console.log(`Using fresh customers cache (${Math.round((Date.now() - parseInt(localStorage.getItem(CUSTOMERS_CACHE_TIMESTAMP_KEY), 10)) / 1000)}s old)`);
                    }
                    return; // Use cached data, don't fetch
                } else {
                    // Cache is stale - will fetch below, but use cache for now
                    if (!silent) {
                        console.log('Customers cache is stale, fetching fresh data...');
                    }
                }
            }
            
            // Only fetch if cache is missing, stale, or this is a background refresh (silent=true)
            // Don't fetch if we have fresh cache (already returned above)
            const response = await fetch('/api/customers?t=' + Date.now());
            if (!response.ok) {
                console.warn('Failed to load customers for autocomplete');
                // Try to use cache if fetch fails
                if (!silent) {
                    this.loadCustomersFromCache();
                }
                return;
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
                    const customerSet = new Set();
                    
                    results.data.forEach(row => {
                        const customerName = row.CUSTOMER || row.customer || row.Customer || '';
                        const trimmedName = String(customerName).trim();
                        
                        if (trimmedName && trimmedName !== '' && trimmedName.toUpperCase() !== 'CUSTOMER') {
                            customerSet.add(trimmedName);
                        }
                    });

                    this.customers = Array.from(customerSet);
                    
                    // Only log and save if this is a fresh fetch (not just updating cache)
                    if (!silent) {
                        console.log(`Loaded ${this.customers.length} customers for autocomplete`);
                    }
                    
                    // Save to cache (always update cache with fresh data)
                    this.saveCustomersToCache(csvText, this.customers);
                },
                error: (error) => {
                    console.error('Error parsing customers CSV:', error);
                    // Try to use cache on error
                    if (!silent) {
                        this.loadCustomersFromCache();
                    }
                }
            });
        } catch (error) {
            console.error('Error loading customers:', error);
            // Try to use cache on error
            if (!silent) {
                this.loadCustomersFromCache();
            }
        }
    }
    
    // Load customers from cache
    loadCustomersFromCache() {
        try {
            const cachedCustomers = localStorage.getItem(CUSTOMERS_CACHE_KEY + '_parsed');
            
            if (cachedCustomers) {
                this.customers = JSON.parse(cachedCustomers);
                console.log(`Loaded ${this.customers.length} customers from cache`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading customers from cache:', error);
            return false;
        }
    }
    
    // Save customers to cache
    saveCustomersToCache(csvText, customers) {
        try {
            localStorage.setItem(CUSTOMERS_CACHE_KEY, csvText);
            localStorage.setItem(CUSTOMERS_CACHE_KEY + '_parsed', JSON.stringify(customers));
            localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`Saved ${customers.length} customers to cache`);
            return true;
        } catch (error) {
            console.error('Error saving customers to cache:', error);
            return false;
        }
    }
    
    // Update customers cache with new receipt
    updateCustomersCacheWithReceipt(receiptData) {
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
                    // Find the customer row or create new one
                    let customerRow = null;
                    let customerRowIndex = -1;
                    
                    for (let i = 0; i < results.data.length; i++) {
                        const row = results.data[i];
                        const customerName = row.CUSTOMER || row.customer || row.Customer || '';
                        if (customerName && customerName.trim().toUpperCase() === receiptData.customerName.toUpperCase()) {
                            customerRow = row;
                            customerRowIndex = i;
                            break;
                        }
                    }
                    
                    // If customer not found, create new row
                    if (!customerRow) {
                        customerRow = {};
                        const customerField = results.meta.fields[0] || 'CUSTOMER';
                        customerRow[customerField] = receiptData.customerName;
                        results.data.push(customerRow);
                        customerRowIndex = results.data.length - 1;
                    }
                    
                    // Create receipt JSON
                    const receiptJson = JSON.stringify({
                        storeName: receiptData.storeName,
                        customerName: receiptData.customerName,
                        date: receiptData.date,
                        time: receiptData.time,
                        items: receiptData.items,
                        grandTotal: receiptData.grandTotal,
                        profitMargin: receiptData.profitMargin || 0,
                        payments: {
                            cash: 0,
                            online: 0
                        },
                        remainingBalance: receiptData.grandTotal
                    });
                    
                    // Find the first RECEIPT column (should be column 2, index 1)
                    const receiptColumns = results.meta.fields.filter(f => f.toUpperCase().startsWith('RECEIPT'));
                    if (receiptColumns.length === 0) {
                        // No receipt columns, add RECEIPT column
                        const newField = 'RECEIPT';
                        results.meta.fields.push(newField);
                        customerRow[newField] = receiptJson;
                    } else {
                        // Insert at position 1 (second column, after CUSTOMER)
                        // Move existing receipt to next column if exists
                        const receiptField = receiptColumns[0];
                        if (customerRow[receiptField]) {
                            // Find next empty receipt column or create one
                            let nextIndex = 1;
                            let nextField = `RECEIPT${nextIndex > 1 ? nextIndex : ''}`;
                            while (customerRow[nextField] && nextIndex < 10) {
                                nextIndex++;
                                nextField = `RECEIPT${nextIndex > 1 ? nextIndex : ''}`;
                            }
                            if (!results.meta.fields.includes(nextField)) {
                                results.meta.fields.push(nextField);
                            }
                            customerRow[nextField] = customerRow[receiptField];
                        }
                        customerRow[receiptField] = receiptJson;
                    }
                    
                    // Convert back to CSV and save
                    const updatedCsv = Papa.unparse(results.data, {
                        header: true,
                        columns: results.meta.fields
                    });
                    
                    // Update cache
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, updatedCsv);
                    localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                    
                    // Update parsed customers list to include new customer if added
                    const customerSet = new Set();
                    results.data.forEach((row) => {
                        const customerName = row.CUSTOMER || row.customer || row.Customer || '';
                        const trimmedName = String(customerName).trim();
                        if (trimmedName && trimmedName !== '' && trimmedName.toUpperCase() !== 'CUSTOMER') {
                            customerSet.add(trimmedName);
                        }
                    });
                    
                    const updatedCustomers = Array.from(customerSet).map(customerName => ({
                        name: customerName
                    }));
                    
                    // Update local customers list
                    this.customers = updatedCustomers;
                    
                    // Update cache with both CSV and parsed customer list
                    localStorage.setItem(CUSTOMERS_CACHE_KEY + '_parsed', JSON.stringify(updatedCustomers));
                    
                    console.log('Updated customers cache with new receipt. Customer list:', updatedCustomers.length, 'customers');
                },
                error: (error) => {
                    console.error('Error updating customers cache:', error);
                }
            });
        } catch (error) {
            console.error('Error updating customers cache with receipt:', error);
        }
    }

    // Handle customer name search/autocomplete
    handleCustomerSearch(searchTerm) {
        const term = searchTerm.trim().toLowerCase();
        const resultsContainer = document.getElementById('customerNameResults');
        
        if (!resultsContainer) return;
        
        if (term === '' || this.customers.length === 0) {
            this.clearCustomerNameResults();
            return;
        }

        // Filter customers that match the search term
        // Handle both string and object formats
        const matches = this.customers.filter(customer => {
            const customerName = typeof customer === 'string' ? customer : (customer.name || '');
            return String(customerName).toLowerCase().includes(term);
        }).slice(0, 10); // Limit to 10 results

        if (matches.length === 0) {
            this.clearCustomerNameResults();
            return;
        }

        // Highlight matching text
        const resultsHTML = matches.map(customer => {
            // Handle both string and object formats
            const customerName = typeof customer === 'string' ? customer : (customer.name || '');
            const customerNameStr = String(customerName);
            const lowerName = customerNameStr.toLowerCase();
            const index = lowerName.indexOf(term);
            
            if (index === -1) {
                return `<div class="customer-name-result-item" onclick="pos.selectCustomerName('${customerNameStr.replace(/'/g, "\\'")}')">
                    <div class="customer-name-result-text">${this.escapeHtml(customerNameStr)}</div>
                </div>`;
            }
            
            const before = customerNameStr.substring(0, index);
            const match = customerNameStr.substring(index, index + term.length);
            const after = customerNameStr.substring(index + term.length);
            
            return `<div class="customer-name-result-item" onclick="pos.selectCustomerName('${customerNameStr.replace(/'/g, "\\'")}')">
                <div class="customer-name-result-text">${this.escapeHtml(before)}<mark>${this.escapeHtml(match)}</mark>${this.escapeHtml(after)}</div>
            </div>`;
        }).join('');

        resultsContainer.innerHTML = resultsHTML;
        resultsContainer.style.display = 'block';
    }

    // Select a customer name from autocomplete
    selectCustomerName(customerName) {
        const customerNameInput = document.getElementById('customerName');
        if (customerNameInput) {
            customerNameInput.value = customerName;
            this.clearCustomerNameResults();
            this.updateCheckoutButtonState();
        }
    }

    // Clear customer name results
    clearCustomerNameResults() {
        const resultsContainer = document.getElementById('customerNameResults');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
            resultsContainer.innerHTML = '';
        }
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Check if cache exists
    cacheExists() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            return cachedData !== null;
        } catch (error) {
            return false;
        }
    }
    
    // Load products from cache
    loadProductsFromCache() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            if (!cachedData) {
                return false;
            }
            
            const parsedProducts = JSON.parse(cachedData);
            
            // Validate cached products
            if (!Array.isArray(parsedProducts) || parsedProducts.length === 0) {
                console.warn('Cached products are invalid or empty');
                return false;
            }
            
            this.products = parsedProducts;
            
            // Update last view time when loading from cache
            this.updateLastViewTime();
            
            return true;
        } catch (error) {
            console.error('Error loading from cache:', error);
            return false;
        }
    }
    
    // Ensure products are loaded from cache if available
    ensureProductsFromCache() {
        // If products array is empty, try to load from cache
        if (this.products.length === 0) {
            const loaded = this.loadProductsFromCache();
            if (loaded && this.products.length > 0) {
                console.log('Products restored from cache');
                return true;
            }
        }
        return this.products.length > 0;
    }
    
    // Save products to cache
    saveProductsToCache(products) {
        try {
            // Only save if products array is valid and not empty
            if (!Array.isArray(products) || products.length === 0) {
                console.warn('Attempted to save empty or invalid products to cache, skipping');
                return false;
            }
            
            localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products));
            localStorage.setItem(PRODUCTS_CACHE_TIMESTAMP_KEY, Date.now().toString());
            this.updateLastViewTime();
            console.log(`Saved ${products.length} products to cache`);
            return true;
        } catch (error) {
            console.error('Error saving to cache:', error);
            return false;
        }
    }
    
    // Verify that cache was saved successfully
    verifyCacheSaved() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            if (!cachedData) {
                return false;
            }
            
            const parsed = JSON.parse(cachedData);
            return Array.isArray(parsed) && parsed.length > 0 && parsed.length === this.products.length;
        } catch (error) {
            console.error('Error verifying cache:', error);
            return false;
        }
    }

    setupEventListeners() {
        const searchInput = document.getElementById('productSearch');
            const checkoutBtn = document.getElementById('checkoutBtn');
            const clearCartBtn = document.getElementById('clearCartBtn');
            const closeReceipt = document.getElementById('closeReceipt');
            const printReceipt = document.getElementById('printReceipt');

            searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && this.searchResults.length > 0) {
                    e.preventDefault();
                    const searchResultsDiv = document.getElementById('searchResults');
                    const firstItem = searchResultsDiv.querySelector('.search-result-item');
                    if (firstItem) {
                        const index = parseInt(firstItem.dataset.index);
                        this.showQuantityInput(firstItem, this.searchResults[index]);
                    }
                }
            });

            checkoutBtn.addEventListener('click', () => this.showReceipt());
            clearCartBtn.addEventListener('click', () => this.clearCart());
            closeReceipt.addEventListener('click', () => this.closeReceipt());
            printReceipt.addEventListener('click', () => window.print());
            
            const shareReceipt = document.getElementById('shareReceipt');
            if (shareReceipt) {
                shareReceipt.addEventListener('click', () => this.shareReceipt());
            }
            
            // Manual product entry
            const addManualProductBtn = document.getElementById('addManualProductBtn');
            const closeManualProductModal = document.getElementById('closeManualProductModal');
            const cancelManualProductBtn = document.getElementById('cancelManualProductBtn');
            const manualProductForm = document.getElementById('manualProductForm');
            
            if (addManualProductBtn) {
                addManualProductBtn.addEventListener('click', () => this.showManualProductModal());
            }
            if (closeManualProductModal) {
                closeManualProductModal.addEventListener('click', () => this.closeManualProductModal());
            }
            if (cancelManualProductBtn) {
                cancelManualProductBtn.addEventListener('click', () => this.closeManualProductModal());
            }
            if (manualProductForm) {
                manualProductForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addManualProduct();
                });
            }
            
            // Close manual product modal when clicking outside
            const manualProductModal = document.getElementById('manualProductModal');
            if (manualProductModal) {
                manualProductModal.addEventListener('click', (e) => {
                    if (e.target === manualProductModal) {
                        this.closeManualProductModal();
                    }
                });
            }
            
            // Add event listener for customer name input
            const customerNameInput = document.getElementById('customerName');
            if (customerNameInput) {
                customerNameInput.addEventListener('input', (e) => {
                    this.handleCustomerSearch(e.target.value);
                    this.updateCheckoutButtonState();
                });
                customerNameInput.addEventListener('blur', () => {
                    // Hide results after a short delay to allow click events
                    setTimeout(() => this.clearCustomerNameResults(), 200);
                });
            }

        // Close modal when clicking outside
        document.getElementById('receiptModal').addEventListener('click', (e) => {
            if (e.target.id === 'receiptModal') {
                this.closeReceipt();
            }
        });
    }

    async loadProducts(silent = false) {
        // Check cache staleness first - only fetch if cache is missing or stale
        const isStale = this.isCacheStale();
        const hasCache = this.cacheExists();
        
        // If cache exists and is fresh (less than 5 minutes old), use it
        if (hasCache && !isStale) {
            const loaded = this.loadProductsFromCache();
            if (loaded && this.products.length > 0) {
                if (!silent) {
                    const cacheAge = Math.round((Date.now() - parseInt(localStorage.getItem(PRODUCTS_CACHE_TIMESTAMP_KEY), 10)) / 1000);
                    console.log(`Using fresh products cache (${cacheAge}s old)`);
                    this.handleSearch('');
                }
                return Promise.resolve(); // Use cached data, don't fetch
            }
        }
        
        // Cache is missing or stale - fetch fresh data
        if (hasCache && isStale && !silent) {
            console.log('Products cache is stale, fetching fresh data...');
        }
        
        const loadingOverlay = document.getElementById('loadingOverlay');
        
        // Only show loading overlay if not silent (first load or user-triggered)
        if (!silent) {
            loadingOverlay.style.display = 'flex';
        }

        return new Promise((resolve, reject) => {
            try {
                // Add cache-busting query parameter to prevent stale cache
                const cacheBuster = `?t=${Date.now()}&v=${Math.random().toString(36).substring(7)}`;
                const urlWithCacheBuster = STORE_PRODUCTS_URL + cacheBuster;
                
                // Use PapaParse to fetch and parse CSV (handles redirects automatically)
                Papa.parse(urlWithCacheBuster, {
                download: true,
                header: true,
                skipEmptyLines: true,
                transformHeader: (header) => {
                    // Normalize header names - trim whitespace and handle variations
                    return header.trim().toUpperCase();
                },
                complete: (results) => {
                    // Parse the CSV data into products
                    // Headers are normalized to "PRODUCT" and "RATE" by transformHeader
                    const newProducts = results.data
                        .filter(row => {
                            const product = row.PRODUCT || '';
                            const rate = row.RATE || '';
                            const productStr = String(product).trim();
                            const rateStr = String(rate).trim();
                            
                            // Skip header row
                            if (productStr.toUpperCase() === 'PRODUCT' || rateStr.toUpperCase() === 'RATE') {
                                return false;
                            }
                            
                            const rateNum = parseFloat(rateStr);
                            return productStr !== '' && !isNaN(rateNum) && rateNum > 0;
                        })
                        .map(row => ({
                            name: String(row.PRODUCT || '').trim(),
                            rate: parseFloat(row.RATE || 0),
                            purchaseCost: parseFloat(row['PURCHASE COST'] || row.PURCHASECOST || row['PURCHASE_COST'] || 0),
                            stock: parseFloat(row['STOCK INFO'] || row.STOCKINFO || row['STOCK_INFO'] || row.STOCK || row.QUANTITY || row.QTY || 0)
                        }));
                    
                    if (newProducts.length === 0) {
                        // If no products found, try to restore from cache
                        if (!this.ensureProductsFromCache()) {
                            // No cache available either - this is a real error
                            throw new Error('No products found in CSV. Expected columns: PRODUCT, RATE');
                        }
                        console.warn('No products found in fresh fetch, keeping cached products');
                        loadingOverlay.style.display = 'none';
                        resolve(); // Resolve with cached products
                        return;
                    }
                    
                    // Only update if we got valid products - always save to cache
                    this.products = newProducts;
                    this.saveProductsToCache(this.products);
                    
                    // Verify cache was saved successfully
                    const cacheVerified = this.verifyCacheSaved();
                    if (!cacheVerified) {
                        console.warn('Cache save verification failed, attempting to save again...');
                        this.saveProductsToCache(this.products);
                    }
                    
                    loadingOverlay.style.display = 'none';
                    
                    // Update UI (only if not silent, or if products changed)
                    if (!silent) {
                        this.handleSearch('');
                    } else {
                        // Silent refresh - update UI if products changed
                        const currentSearch = document.getElementById('productSearch').value;
                        this.handleSearch(currentSearch);
                    }
                    
                    this.scheduleCacheRefresh();
                    resolve(); // Resolve promise on success
                },
                error: (error) => {
                    console.error('Error loading products:', error);
                    loadingOverlay.style.display = 'none';
                    
                    // Always try to restore from cache on error
                    if (this.ensureProductsFromCache()) {
                        console.log('Restored products from cache after error');
                        if (!silent) {
                            this.handleSearch('');
                        }
                        resolve(); // Resolve with cached data
                        return;
                    }
                    
                    // Only show alert if not silent (first load) and no cache available
                    if (!silent) {
                        alert(`Failed to load products:\n\n${error.message || 'Unknown error occurred'}\n\nPlease check:\n1. The STORE_PRODUCTS URL in your .env file\n2. Browser console for more details\n3. That the Google Sheet is published as CSV`);
                    }
                    
                    reject(error); // Reject promise on error only if no cache available
                }
            });
            } catch (error) {
                console.error('Error loading products:', error);
                loadingOverlay.style.display = 'none';
                
                // Always try to restore from cache on error
                if (this.ensureProductsFromCache()) {
                    console.log('Restored products from cache after error');
                    if (!silent) {
                        this.handleSearch('');
                    }
                    resolve(); // Resolve with cached data
                    return;
                }
                
                // Only show alert if not silent (first load) and no cache available
                if (!silent) {
                    const errorMessage = error.message || 'Unknown error occurred';
                    alert(`Failed to load products:\n\n${errorMessage}\n\nPlease check:\n1. The STORE_PRODUCTS URL in your .env file\n2. Browser console for more details\n3. Network tab to see if the request succeeded`);
                }
                
                reject(error); // Reject promise on error only if no cache available
            }
        });
    }


    searchResults = [];

    handleSearch(query) {
        // Always ensure products are available from cache before searching
        if (!this.ensureProductsFromCache()) {
            console.warn('No products available for search, attempting to load...');
            // Try to load from cache one more time
            if (!this.loadProductsFromCache()) {
                console.error('No products available and cache is empty');
                return;
            }
        }
        
        const searchResultsDiv = document.getElementById('searchResults');
        
        if (!query.trim()) {
            // Hide search results when search is empty
            searchResultsDiv.style.display = 'none';
            searchResultsDiv.innerHTML = '';
            return;
        }

        const queryLower = query.toLowerCase();
        this.searchResults = this.products.filter(product => 
            product.name.toLowerCase().includes(queryLower)
        );

        if (this.searchResults.length === 0) {
            searchResultsDiv.style.display = 'none';
            return;
        }

        this.displaySearchResults(searchResultsDiv, query, true);
    }
    
    displaySearchResults(searchResultsDiv, query, highlight) {
        const maxResults = 50; // Limit display to 50 results
        const displayResults = this.searchResults.slice(0, maxResults);
        const hasMore = this.searchResults.length > maxResults;

        searchResultsDiv.innerHTML = displayResults.map((product, index) => {
            const stock = product.stock || 0;
            const stockText = stock > 0 ? `Stock: ${stock}` : 'Out of stock';
            const stockClass = stock > 0 ? 'product-stock' : 'product-stock out-of-stock';
            return `
            <div class="search-result-item" data-index="${index}">
                <span class="product-name">${highlight ? this.highlightMatch(product.name, query) : product.name}</span>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                    <span class="product-rate">₹${product.rate.toFixed(2)}</span>
                    <span class="${stockClass}">${stockText}</span>
                </div>
            </div>
        `;
        }).join('') + (hasMore ? `<div class="more-results">+ ${this.searchResults.length - maxResults} more products (refine your search)</div>` : '');

        searchResultsDiv.style.display = 'block';

        // Add click handlers
        searchResultsDiv.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking on quantity input or add button
                if (e.target.closest('.search-qty-controls')) {
                    return;
                }
                const index = parseInt(item.dataset.index);
                this.showQuantityInput(item, this.searchResults[index]);
            });
        });
    }
    
    showQuantityInput(itemElement, product) {
        // Remove any existing quantity controls from all search results
        const searchResultsDiv = document.getElementById('searchResults');
        if (searchResultsDiv) {
            searchResultsDiv.querySelectorAll('.search-qty-controls').forEach(controls => {
                controls.remove();
            });
        }
        
        // Check if quantity input already exists on this item
        if (itemElement.querySelector('.search-qty-controls')) {
            return;
        }
        
        // Create quantity controls
        const qtyControls = document.createElement('div');
        qtyControls.className = 'search-qty-controls';
        qtyControls.innerHTML = `
            <div class="search-qty-input-group">
                <button class="search-qty-btn" data-action="decrease">−</button>
                <input type="number" class="search-qty-input" value="1" min="1" step="1">
                <button class="search-qty-btn" data-action="increase">+</button>
            </div>
            <button class="search-add-btn">Add</button>
        `;
        
        // Insert after product rate
        const productRate = itemElement.querySelector('.product-rate');
        productRate.insertAdjacentElement('afterend', qtyControls);
        
        const qtyInput = qtyControls.querySelector('.search-qty-input');
        const decreaseBtn = qtyControls.querySelector('[data-action="decrease"]');
        const increaseBtn = qtyControls.querySelector('[data-action="increase"]');
        const addBtn = qtyControls.querySelector('.search-add-btn');
        
        // Focus on quantity input
        setTimeout(() => qtyInput.focus(), 50);
        qtyInput.select();
        
        // Decrease button
        decreaseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentValue = parseInt(qtyInput.value) || 1;
            if (currentValue > 1) {
                qtyInput.value = currentValue - 1;
            }
        });
        
        // Increase button
        increaseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentValue = parseInt(qtyInput.value) || 1;
            qtyInput.value = currentValue + 1;
        });
        
        // Add button
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const quantity = parseInt(qtyInput.value) || 1;
            if (quantity > 0) {
                this.addToCartWithQuantity(product, quantity);
                document.getElementById('productSearch').value = '';
                this.clearSearchResults();
            }
        });
        
        // Enter key on quantity input
        qtyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const quantity = parseInt(qtyInput.value) || 1;
                if (quantity > 0) {
                    this.addToCartWithQuantity(product, quantity);
                    document.getElementById('productSearch').value = '';
                    this.clearSearchResults();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                qtyControls.remove();
            }
        });
        
        // Prevent clicks on quantity controls from triggering item click
        qtyControls.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    addToCartWithQuantity(product, quantity) {
        const existingItem = this.cart.find(item => item.name === product.name);
        
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.cart.push({
                name: product.name,
                rate: product.rate,
                quantity: quantity,
                purchaseCost: product.purchaseCost || 0,
                stock: product.stock || 0
            });
        }

        this.updateCartDisplay();
    }

    highlightMatch(text, query) {
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    clearSearchResults() {
        const searchInput = document.getElementById('productSearch');
        const searchResultsDiv = document.getElementById('searchResults');
        
        // Hide the dropdown results
        searchResultsDiv.style.display = 'none';
        searchResultsDiv.innerHTML = '';
    }

    addToCart(product) {
        // Use addToCartWithQuantity with default quantity of 1
        this.addToCartWithQuantity(product, 1);
    }

    removeFromCart(index) {
        this.cart.splice(index, 1);
        this.updateCartDisplay();
    }

    updateQuantity(index, change) {
        const item = this.cart[index];
        item.quantity += change;
        
        if (item.quantity <= 0) {
            this.removeFromCart(index);
        } else {
            this.updateCartDisplay();
        }
    }
    
    updateRate(index, newRate) {
        const item = this.cart[index];
        const rate = parseFloat(newRate);
        
        if (!isNaN(rate) && rate > 0) {
            item.rate = rate;
            this.updateCartDisplay();
        } else {
            // Invalid rate, restore original
            this.updateCartDisplay();
        }
    }
    
    editRate(index) {
        const cartItem = document.querySelector(`.cart-item[data-index="${index}"]`);
        if (!cartItem) return;
        
        const rateSpan = cartItem.querySelector('.cart-item-rate');
        if (!rateSpan || rateSpan.tagName === 'INPUT') return; // Already editing or not found
        
        const currentRate = this.cart[index].rate;
        
        // Create input field
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'cart-item-rate-input';
        input.value = currentRate.toFixed(2);
        input.min = '0';
        input.step = '0.01';
        input.style.width = '100px';
        input.style.padding = '4px 8px';
        input.style.border = '2px solid #000000';
        input.style.borderRadius = '4px';
        input.style.fontSize = '14px';
        input.style.fontFamily = 'inherit';
        input.style.backgroundColor = '#ffffff';
        input.style.color = '#000000';
        
        // Replace span with input
        rateSpan.replaceWith(input);
        input.focus();
        input.select();
        
        // Save on Enter or blur
        const saveRate = () => {
            const newRate = parseFloat(input.value);
            if (!isNaN(newRate) && newRate > 0) {
                this.updateRate(index, newRate);
            } else {
                // Invalid rate, restore original display
                this.updateCartDisplay();
            }
        };
        
        input.addEventListener('blur', saveRate);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur(); // Trigger blur which will save
            } else if (e.key === 'Escape') {
                this.updateCartDisplay();
            }
        });
    }

    updateCartDisplay() {
        const cartItemsDiv = document.getElementById('cartItems');
        const clearCartBtn = document.getElementById('clearCartBtn');

        if (this.cart.length === 0) {
            cartItemsDiv.innerHTML = '<p class="empty-cart">No items in cart</p>';
            clearCartBtn.disabled = true;
        } else {
            cartItemsDiv.innerHTML = this.cart.map((item, index) => {
                // Get current stock from products array if available, otherwise use stored stock
                const product = this.products.find(p => p.name === item.name);
                const stock = product ? (product.stock || 0) : (item.stock || 0);
                const stockText = stock > 0 ? `Stock: ${stock}` : 'Out of stock';
                const stockClass = stock > 0 ? 'cart-item-stock' : 'cart-item-stock out-of-stock';
                return `
                <div class="cart-item" data-index="${index}">
                    <div class="cart-item-row">
                        <div class="cart-item-info">
                            <span class="cart-item-name">${item.name}</span>
                            <span class="cart-item-rate" onclick="pos.editRate(${index})" title="Click to edit rate">₹${item.rate.toFixed(2)} each</span>
                            <span class="${stockClass}">${stockText}</span>
                        </div>
                        <div class="cart-item-right">
                            <button class="remove-btn remove-btn-desktop" onclick="pos.removeFromCart(${index})" title="Remove">×</button>
                            <span class="cart-item-total">₹${(item.rate * item.quantity).toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="cart-item-controls">
                        <button class="remove-btn remove-btn-mobile" onclick="pos.removeFromCart(${index})" title="Remove">×</button>
                        <button class="qty-btn" onclick="pos.updateQuantity(${index}, -1)">−</button>
                        <span class="cart-item-qty">${item.quantity}</span>
                        <button class="qty-btn" onclick="pos.updateQuantity(${index}, 1)">+</button>
                    </div>
                </div>
            `;
            }).join('');
            clearCartBtn.disabled = false;
        }

        this.updateTotal();
        this.updateCheckoutButtonState();
    }
    
    updateCheckoutButtonState() {
        const checkoutBtn = document.getElementById('checkoutBtn');
        const customerNameInput = document.getElementById('customerName');
        
        const hasItems = this.cart.length > 0;
        const hasCustomerName = customerNameInput && customerNameInput.value.trim().length > 0;
        
        // Checkout button is enabled only if cart has items AND customer name is provided
        checkoutBtn.disabled = !(hasItems && hasCustomerName);
    }

    updateTotal() {
        const grandTotal = this.cart.reduce((sum, item) => sum + (item.rate * item.quantity), 0);
        document.getElementById('grandTotal').textContent = `₹${grandTotal.toFixed(2)}`;
    }

    clearCart() {
        this.cart = [];
        // Clear customer name input
        const customerNameInput = document.getElementById('customerName');
        if (customerNameInput) {
            customerNameInput.value = '';
        }
        this.updateCartDisplay();
    }

    showReceipt() {
        // Validate customer name before showing receipt
        const customerNameInput = document.getElementById('customerName');
        const customerNameTrimmed = customerNameInput ? customerNameInput.value.trim() : '';
        
        if (!customerNameTrimmed || customerNameTrimmed.length === 0) {
            alert('Please enter a customer name before checkout.');
            if (customerNameInput) {
                customerNameInput.focus();
            }
            return;
        }
        
        const receiptContent = document.getElementById('receiptContent');
        const modal = document.getElementById('receiptModal');
        
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const timeStr = now.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        // Ensure we're using the actual cart array - create a copy to avoid any issues
        const cartItems = [...this.cart];
        
        // Verify cart has items
        if (cartItems.length === 0) {
            console.error('Cart is empty when generating receipt');
            return;
        }
        
        console.log(`Generating receipt with ${cartItems.length} items:`, cartItems.map(item => item.name));
        
        // Calculate profit margin for each item and total
        let totalProfitMargin = 0;
        const receiptItems = cartItems.map(item => {
            // Get purchase cost from item (if manually added) or from products list
            const purchaseCost = item.purchaseCost !== undefined ? item.purchaseCost : 
                (this.products.find(p => p.name === item.name)?.purchaseCost || 0);
            const profitPerUnit = item.rate - purchaseCost;
            const profitMargin = profitPerUnit * item.quantity;
            totalProfitMargin += profitMargin;
            
            return {
                name: item.name,
                quantity: item.quantity,
                rate: item.rate,
                total: item.rate * item.quantity,
                purchaseCost: purchaseCost,
                profitMargin: profitMargin
            };
        });
        
        const grandTotal = cartItems.reduce((sum, item) => sum + (item.rate * item.quantity), 0);

        // Detect mobile screen
        const isMobile = window.innerWidth <= 768;
        
        // Adjust column widths based on screen size
        const nameWidth = isMobile ? 15 : 22;
        const rateWidth = isMobile ? 7 : 8;
        const totalWidth = isMobile ? 8 : 10;
        const separatorWidth = isMobile ? 35 : 50;

        // Format items for receipt - ensure ALL items are included
        const validItems = cartItems.filter((item, index) => {
            if (!item || !item.name || item.rate === undefined || item.quantity === undefined) {
                console.warn(`Invalid cart item at index ${index}:`, item);
                return false;
            }
            return true;
        });
        
        const itemsText = validItems.map((item, index) => {
            // Serial number (1-based)
            const serialNumber = (index + 1).toString();
            
            // Trim and normalize the item name to remove extra spaces
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

        // Store name left-aligned (same position as date/time)
        const storeName = "SHREEJI'S STORE";
        
        // Get customer name from input field and convert to uppercase (already validated above)
        const customerName = customerNameTrimmed.toUpperCase();

        // Format total with proper alignment (match item line width)
        // Total line format: "Total" (left) + spaces + "₹XX.XX" (right aligned)
        // Calculate serial prefix width (e.g., "1. " = 3, "10. " = 4, "100. " = 5)
        const maxSerialNumber = validItems.length;
        const serialPrefixWidth = maxSerialNumber.toString().length + 2; // number + ". "
        const totalLabel = "Total".padEnd(nameWidth);
        const totalValueStr = `₹${grandTotal.toFixed(2)}`;
        // Calculate remaining space: serialPrefixWidth + nameWidth + 1 (space) + 2 (qty) + 1 (space) + 1 (x) + 1 (space) + rateWidth + 1 (space) + 1 (=) + 1 (space) + totalWidth
        const totalLineWidth = serialPrefixWidth + nameWidth + 1 + 2 + 1 + 1 + 1 + rateWidth + 1 + 1 + 1 + totalWidth;
        const totalValue = totalValueStr.padStart(totalLineWidth - nameWidth);

        // Verify all items were included in receipt
        const receiptItemLines = itemsText.split('\n').filter(line => line.trim().length > 0);
        if (receiptItemLines.length !== cartItems.length) {
            console.error(`Mismatch: Cart has ${cartItems.length} items but receipt has ${receiptItemLines.length} lines`);
            console.log('Cart items:', cartItems.map(item => item.name));
            console.log('Receipt lines:', receiptItemLines);
        }
        
        // Verify total calculation
        const calculatedTotal = cartItems.reduce((sum, item) => sum + (item.rate * item.quantity), 0);
        if (Math.abs(calculatedTotal - grandTotal) > 0.01) {
            console.warn(`Total mismatch: Calculated ${calculatedTotal} but grandTotal is ${grandTotal}`);
        }

        // Build receipt content without extra whitespace from template literal indentation
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
        
        // Save receipt to Google Sheets
        this.saveReceiptToSheets({
            storeName: storeName,
            customerName: customerName,
            date: dateStr,
            time: timeStr,
            items: receiptItems,
            grandTotal: grandTotal,
            profitMargin: totalProfitMargin
        });
    }
    
    async saveReceiptToSheets(receiptData) {
        try {
            console.log('Attempting to save receipt to Google Sheets...', receiptData);
            
            // Create abort controller for timeout (mobile networks can be slow/unreliable)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                console.warn('Request timeout - aborting save receipt request');
                controller.abort();
            }, 30000); // 30 second timeout
            
            try {
                const response = await fetch('/api/save-receipt', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(receiptData),
                    signal: controller.signal,
                    // Ensure request doesn't get cached on mobile
                    cache: 'no-store'
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Failed to save receipt - Response not OK:', response.status, errorText);
                    throw new Error(`Failed to save receipt: ${response.status} ${response.statusText}`);
                }
                
                const result = await response.json();
                
                // Check if the response indicates success
                if (result.success !== false) {
                    console.log('Receipt saved to Google Sheets:', result);
                    // Update local cache with new receipt
                    this.updateCustomersCacheWithReceipt(receiptData);
                } else {
                    console.error('Google Sheets returned error:', result.error);
                    throw new Error(result.error || 'Failed to save receipt');
                }
            } catch (fetchError) {
                clearTimeout(timeoutId);
                
                // Check if it's an abort error (timeout)
                if (fetchError.name === 'AbortError') {
                    console.error('Request timed out - this may be a mobile network issue');
                }
                
                throw fetchError;
            }
        } catch (error) {
            console.error('Error saving receipt to Google Sheets:', error);
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // On mobile, network errors are more common - log but don't block user
            // The receipt is still displayed, so user can see it
            // Try to update cache anyway so data isn't lost
            try {
                this.updateCustomersCacheWithReceipt(receiptData);
                console.log('Receipt saved to local cache as fallback');
            } catch (cacheError) {
                console.error('Failed to save to cache as well:', cacheError);
            }
        }
    }

    closeReceipt() {
        document.getElementById('receiptModal').style.display = 'none';
    }
    
    // Share receipt as JPEG image
    async shareReceipt() {
        const receiptContent = document.getElementById('receiptContent');
        const modal = document.getElementById('receiptModal');
        
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
                loadingOverlay.style.display = 'flex';
                loadingOverlay.querySelector('p').textContent = 'Generating receipt image...';
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
            const modalContent = modal.querySelector('.modal-content');
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
                    height: receiptHeight
                });
            }
            
            // Restore receipt content styles
            receiptContent.style.overflow = originalOverflow;
            receiptContent.style.overflowX = originalOverflowX;
            receiptContent.style.overflowY = originalOverflowY;
            receiptContent.style.width = originalWidth;
            receiptContent.style.maxWidth = originalMaxWidth;
            receiptContent.style.boxSizing = originalBoxSizing;
            
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    alert('Failed to generate receipt image');
                    if (loadingOverlay) loadingOverlay.style.display = 'none';
                    return;
                }
                
                // Create file name with date and time
                const now = new Date();
                const dateStr = now.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                }).replace(/\//g, '-');
                const timeStr = now.toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).replace(/:/g, '-');
                const fileName = `Receipt-${dateStr}-${timeStr}.jpg`;
                
                // Create File object
                const file = new File([blob], fileName, { type: 'image/jpeg' });
                
                // Check if Web Share API is available
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: 'Receipt',
                            text: 'Receipt from Shreeji\'s Store',
                            files: [file]
                        });
                    } catch (shareError) {
                        // If share is cancelled or fails, fallback to download
                        if (shareError.name !== 'AbortError') {
                            this.downloadReceiptImage(blob, fileName);
                        }
                    }
                } else {
                    // Fallback to download if Web Share API is not available
                    this.downloadReceiptImage(blob, fileName);
                }
                
                // Hide loading
                if (loadingOverlay) {
                    loadingOverlay.style.display = 'none';
                    loadingOverlay.querySelector('p').textContent = 'Loading products...';
                }
            }, 'image/jpeg', 0.95); // 95% quality
            
        } catch (error) {
            console.error('Error sharing receipt:', error);
            alert('Failed to share receipt. Please try again.');
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
                loadingOverlay.querySelector('p').textContent = 'Loading products...';
            }
        }
    }
    
    // Download receipt as image (fallback)
    downloadReceiptImage(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    // Show manual product entry modal
    showManualProductModal() {
        const modal = document.getElementById('manualProductModal');
        if (modal) {
            modal.classList.add('active');
            // Focus on product name input
            const productNameInput = document.getElementById('manualProductName');
            if (productNameInput) {
                setTimeout(() => productNameInput.focus(), 100);
            }
        }
    }
    
    // Close manual product entry modal
    closeManualProductModal() {
        const modal = document.getElementById('manualProductModal');
        if (modal) {
            modal.classList.remove('active');
            // Reset form
            const form = document.getElementById('manualProductForm');
            if (form) {
                form.reset();
            }
        }
    }
    
    // Add manually entered product to cart
    addManualProduct() {
        const productName = document.getElementById('manualProductName').value.trim();
        const productRate = parseFloat(document.getElementById('manualProductRate').value);
        
        if (!productName) {
            alert('Please enter a product name');
            return;
        }
        
        if (isNaN(productRate) || productRate <= 0) {
            alert('Please enter a valid rate greater than 0');
            return;
        }
        
        // Check if product already exists in cart
        const existingItem = this.cart.find(item => item.name.toLowerCase() === productName.toLowerCase());
        
        if (existingItem) {
            // Update existing item - add 1 to quantity and update rate if different
            existingItem.quantity += 1;
            if (existingItem.rate !== productRate) {
                existingItem.rate = productRate;
            }
        } else {
            // Add new item with quantity 1
            // Try to find product in products list to get purchase cost
            const product = this.products.find(p => p.name.toLowerCase() === productName.toLowerCase());
            this.cart.push({
                name: productName,
                rate: productRate,
                quantity: 1,
                purchaseCost: product ? (product.purchaseCost || 0) : 0
            });
        }
        
        // Update cart display
        this.updateCartDisplay();
        
        // Close modal and reset form
        this.closeManualProductModal();
    }
}

// Initialize POS system when page loads
let pos;
window.addEventListener('DOMContentLoaded', () => {
    pos = new POSSystem();
});


