// Store Products CSV URL - using proxy endpoint to keep URL hidden
// The proxy endpoint (/api/products) fetches from Google Sheets server-side
const STORE_PRODUCTS_URL = '/api/products';


// Cache keys
const PRODUCTS_CACHE_KEY = 'storeProductsCache';
const CACHE_TIMESTAMP_KEY = 'storeProductsCacheTimestamp';
const LAST_VIEW_KEY = 'storeProductsLastView';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

class POSSystem {
    constructor() {
        this.products = [];
        this.cart = [];
        this.cacheRefreshInterval = null;
        this.cacheRefreshTimeout = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        
        // Step 1: Always check cache first on page load for immediate display
        const hasCache = this.loadProductsFromCache();
        
        if (hasCache && this.products.length > 0) {
            // Cache exists and has products - use it immediately
            this.handleSearch('');
            this.updateLastViewTime();
            
            // Always try to fetch fresh data on page load to ensure cache is up-to-date
            // Do this in background (silent) so user can use cached data immediately
            this.loadProductsWithRetry(true).catch(error => {
                console.warn('Background cache refresh failed, using existing cache:', error);
                // Cache is already loaded, so we're good
            });
        } else {
            // No cache exists or cache is empty - fetch data first, then save to cache
            // This is critical - we must populate cache on initial load
            await this.loadProductsWithRetry(false); // silent = false (show loading overlay)
            
            // Ensure cache was populated after initial load
            if (this.products.length === 0) {
                console.error('Failed to load products on initial page load, retrying...');
                // Try one more time to ensure cache is filled
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
            } else {
                console.error('⚠️ Products array is still empty after initial load attempts');
            }
        }
        
        // Set up periodic cache refresh (every 5 minutes)
        this.setupPeriodicRefresh();
        
        // Also ensure cache is refreshed periodically on page load
        // If cache is fresh, schedule refresh for when it becomes stale
        if (hasCache && this.products.length > 0 && !this.isCacheStale()) {
            this.scheduleCacheRefresh();
        }
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
            const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
            
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
    scheduleCacheRefresh() {
        try {
            const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
            if (!cacheTimestamp) return;
            
            const cacheTime = parseInt(cacheTimestamp, 10);
            const now = Date.now();
            const timeSinceCache = now - cacheTime;
            const timeUntilStale = CACHE_DURATION_MS - timeSinceCache;
            
            if (timeUntilStale > 0) {
                // Clear any existing timeout
                if (this.cacheRefreshTimeout) {
                    clearTimeout(this.cacheRefreshTimeout);
                }
                
                // Schedule refresh for when cache becomes stale
                this.cacheRefreshTimeout = setTimeout(() => {
                    this.loadProductsWithRetry(true); // silent refresh with retry
                }, timeUntilStale);
            }
        } catch (error) {
            console.error('Error scheduling cache refresh:', error);
        }
    }
    
    // Set up periodic refresh every 5 minutes
    setupPeriodicRefresh() {
        // Clear any existing interval
        if (this.cacheRefreshInterval) {
            clearInterval(this.cacheRefreshInterval);
        }
        
        // Refresh cache every 5 minutes
        this.cacheRefreshInterval = setInterval(() => {
            this.loadProductsWithRetry(true); // silent refresh with retry
        }, CACHE_DURATION_MS);
    }
    
    // Update last view timestamp
    updateLastViewTime() {
        try {
            localStorage.setItem(LAST_VIEW_KEY, Date.now().toString());
        } catch (error) {
            console.error('Error updating last view time:', error);
        }
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
            localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
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
                    this.addToCart(this.searchResults[0]);
                    searchInput.value = '';
                    this.clearSearchResults();
                }
            });

            checkoutBtn.addEventListener('click', () => this.showReceipt());
            clearCartBtn.addEventListener('click', () => this.clearCart());
            closeReceipt.addEventListener('click', () => this.closeReceipt());
            printReceipt.addEventListener('click', () => window.print());

        // Close modal when clicking outside
        document.getElementById('receiptModal').addEventListener('click', (e) => {
            if (e.target.id === 'receiptModal') {
                this.closeReceipt();
            }
        });
    }

    async loadProducts(silent = false) {
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
                            rate: parseFloat(row.RATE || 0)
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

        searchResultsDiv.innerHTML = displayResults.map((product, index) => `
            <div class="search-result-item" data-index="${index}">
                <span class="product-name">${highlight ? this.highlightMatch(product.name, query) : product.name}</span>
                <span class="product-rate">₹${product.rate.toFixed(2)}</span>
            </div>
        `).join('') + (hasMore ? `<div class="more-results">+ ${this.searchResults.length - maxResults} more products (refine your search)</div>` : '');

        searchResultsDiv.style.display = 'block';

        // Add click handlers
        searchResultsDiv.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.addToCart(this.searchResults[index]);
                document.getElementById('productSearch').value = '';
                this.clearSearchResults();
            });
        });
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
        const existingItem = this.cart.find(item => item.name === product.name);
        
        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            this.cart.push({
                name: product.name,
                rate: product.rate,
                quantity: 1
            });
        }

        this.updateCartDisplay();
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

    updateCartDisplay() {
        const cartItemsDiv = document.getElementById('cartItems');
        const checkoutBtn = document.getElementById('checkoutBtn');
        const clearCartBtn = document.getElementById('clearCartBtn');

        if (this.cart.length === 0) {
            cartItemsDiv.innerHTML = '<p class="empty-cart">No items in cart</p>';
            checkoutBtn.disabled = true;
            clearCartBtn.disabled = true;
        } else {
            cartItemsDiv.innerHTML = this.cart.map((item, index) => `
                <div class="cart-item">
                    <div class="cart-item-row">
                        <div class="cart-item-info">
                            <span class="cart-item-name">${item.name}</span>
                            <span class="cart-item-rate">₹${item.rate.toFixed(2)} each</span>
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
            `).join('');
            checkoutBtn.disabled = false;
            clearCartBtn.disabled = false;
        }

        this.updateTotal();
    }

    updateTotal() {
        const grandTotal = this.cart.reduce((sum, item) => sum + (item.rate * item.quantity), 0);
        document.getElementById('grandTotal').textContent = `₹${grandTotal.toFixed(2)}`;
    }

    clearCart() {
        this.cart = [];
        this.updateCartDisplay();
    }

    showReceipt() {
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
        
        const grandTotal = cartItems.reduce((sum, item) => sum + (item.rate * item.quantity), 0);

        // Detect mobile screen
        const isMobile = window.innerWidth <= 768;
        
        // Adjust column widths based on screen size
        const nameWidth = isMobile ? 15 : 22;
        const rateWidth = isMobile ? 7 : 8;
        const totalWidth = isMobile ? 8 : 10;
        const separatorWidth = isMobile ? 35 : 50;

        // Format items for receipt - ensure ALL items are included
        const itemsText = cartItems.map((item, index) => {
            // Ensure item has required properties
            if (!item || !item.name || item.rate === undefined || item.quantity === undefined) {
                console.warn(`Invalid cart item at index ${index}:`, item);
                return null;
            }
            
            // Trim and normalize the item name to remove extra spaces
            const cleanName = item.name.trim().replace(/\s+/g, ' ');
            const name = cleanName.length > nameWidth ? cleanName.substring(0, nameWidth - 3) + '...' : cleanName;
            const qty = item.quantity.toString();
            const rate = item.rate.toFixed(2);
            const total = (item.rate * item.quantity).toFixed(2);
            
            // Format: Name (left), then Qty x Rate = Total (right aligned)
            const namePart = name.padEnd(nameWidth);
            const qtyPart = qty.padStart(2);
            const ratePart = rate.padStart(rateWidth);
            const totalPart = total.padStart(totalWidth);
            
            return `${namePart} ${qtyPart} x ${ratePart} = ${totalPart}`;
        }).filter(line => line !== null).join('\n'); // Filter out any null entries

        // Store name left-aligned (same position as date/time)
        const storeName = "SHREEJI'S STORE";

        // Format total with proper alignment (match item line width)
        // Total line format: "Total" (left) + spaces + "₹XX.XX" (right aligned)
        const totalLabel = "Total".padEnd(nameWidth);
        const totalValueStr = `₹${grandTotal.toFixed(2)}`;
        // Calculate remaining space: nameWidth + 1 (space) + 2 (qty) + 1 (space) + 1 (x) + 1 (space) + rateWidth + 1 (space) + 1 (=) + 1 (space) + totalWidth
        const totalLineWidth = nameWidth + 1 + 2 + 1 + 1 + 1 + rateWidth + 1 + 1 + 1 + totalWidth;
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

    closeReceipt() {
        document.getElementById('receiptModal').style.display = 'none';
    }
}

// Initialize POS system when page loads
let pos;
window.addEventListener('DOMContentLoaded', () => {
    pos = new POSSystem();
});

