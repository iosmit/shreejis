// Store Products CSV URL - using proxy endpoint to keep URL hidden
const STORE_PRODUCTS_URL = '/api/products';

// Customers CSV URL - using proxy endpoint to keep URL hidden
const CUSTOMERS_RECEIPTS = '/api/customers-receipts';

// Cache keys
const PRODUCTS_CACHE_KEY = 'storeProductsCache';
const PRODUCTS_CACHE_TIMESTAMP_KEY = 'storeProductsCacheTimestamp';
const PENDING_ORDER_CACHE_KEY = 'pendingOrderCache';
const PENDING_ORDER_CACHE_TIMESTAMP_KEY = 'pendingOrderCacheTimestamp';
const RECEIPTS_CACHE_KEY = 'customerReceiptsCache';
const RECEIPTS_CACHE_TIMESTAMP_KEY = 'customerReceiptsCacheTimestamp';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

class OrderSystem {
    constructor() {
        this.products = [];
        this.cart = [];
        this.receipts = [];
        this.pendingOrder = null;
        this.customerName = authManager.customerName || '';
        this.specialPrices = {}; // Special prices for this customer
        this.cacheRefreshInterval = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.displayCustomerInfo();
        
        // Load products from cache first
        const hasProductsCache = this.loadProductsFromCache();
        const isProductsStale = hasProductsCache ? this.isCacheStale() : true;
        
        if (hasProductsCache && this.products.length > 0 && !isProductsStale) {
            this.handleSearch('');
        } else {
            await this.loadProductsWithRetry(false);
        }
        
        // Load customer receipts
        await this.loadCustomerReceipts();
        
        // Load pending order
        await this.loadPendingOrder();
        
        // Load special prices for this customer
        await this.loadSpecialPrices();
        
        // Set up periodic cache refresh
        this.setupPeriodicRefresh();
    }
    
    displayCustomerInfo() {
        const customerNameDisplay = document.getElementById('customerNameDisplay');
        const customerNameBtn = document.getElementById('customerNameBtn');
        if (customerNameDisplay) {
            customerNameDisplay.textContent = this.customerName || 'Customer';
        }
        if (customerNameBtn) {
            customerNameBtn.textContent = this.customerName || 'Customer Name';
        }
    }
    
    // Check if receipts cache is stale
    isReceiptsCacheStale() {
        try {
            const cacheTimestamp = localStorage.getItem(RECEIPTS_CACHE_TIMESTAMP_KEY);
            if (!cacheTimestamp) {
                return true;
            }
            const cacheTime = parseInt(cacheTimestamp, 10);
            const timeSinceCache = Date.now() - cacheTime;
            const isStale = timeSinceCache >= CACHE_DURATION_MS;
            return isStale;
        } catch (error) {
            console.error('[Receipts] Error checking cache staleness:', error);
            return true;
        }
    }
    
    // Load receipts from cache
    loadReceiptsFromCache() {
        try {
            const cachedData = localStorage.getItem(RECEIPTS_CACHE_KEY);
            if (!cachedData) {
                return false;
            }
            
            const parsed = JSON.parse(cachedData);
            // Check if cache is for current customer
            if (parsed.customerName && parsed.customerName.toUpperCase() === this.customerName.toUpperCase()) {
                this.receipts = parsed.receipts || [];
                return true;
            }
            return false;
        } catch (error) {
            console.error('[Receipts] Error loading from cache:', error);
            return false;
        }
    }
    
    // Save receipts to cache
    saveReceiptsToCache() {
        try {
            const cacheData = {
                customerName: this.customerName,
                receipts: this.receipts
            };
            localStorage.setItem(RECEIPTS_CACHE_KEY, JSON.stringify(cacheData));
            localStorage.setItem(RECEIPTS_CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (error) {
            console.error('[Receipts] Error saving to cache:', error);
        }
    }
    
    async loadCustomerReceipts(silent = false) {
        // Always try to load from cache first
        const hasCache = this.loadReceiptsFromCache();
        
        if (hasCache) {
            // Cache exists - check if it's stale
            const isStale = this.isReceiptsCacheStale();
            
            if (!isStale) {
                // Cache is fresh (less than 5 minutes old) - use it, don't fetch
                this.displayReceipts();
                this.calculateTotalUnpaid();
                return; // Use cached data, don't fetch
            }
        }
        
        // Only fetch if cache is missing or stale
        await this.loadCustomerReceiptsFromServer(silent);
    }
    
    async loadCustomerReceiptsFromServer(silent = false) {
        try {
            const response = await fetch(`${CUSTOMERS_RECEIPTS}?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch receipts: ${response.status}`);
            }

            const csvText = await response.text();
            
            Papa.parse(csvText, {
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    if (!results.data || results.data.length === 0) {
                        this.receipts = [];
                        this.saveReceiptsToCache();
                        this.displayReceipts();
                        this.calculateTotalUnpaid();
                        return;
                    }
                    
                    const headers = results.data[0] || [];
                    const customerColumnIndex = headers.findIndex(h => 
                        h && String(h).trim().toUpperCase() === 'CUSTOMER'
                    );
                    
                    if (customerColumnIndex === -1) {
                        this.receipts = [];
                        this.saveReceiptsToCache();
                        this.displayReceipts();
                        this.calculateTotalUnpaid();
                        return;
                    }
                    
                    // Find the customer row
                    let customerRowData = null;
                    for (let i = 1; i < results.data.length; i++) {
                        const row = results.data[i];
                        const rowCustomerName = row[customerColumnIndex];
                        if (rowCustomerName && String(rowCustomerName).trim().toUpperCase() === this.customerName.toUpperCase()) {
                            customerRowData = row;
                            break;
                        }
                    }
                    
                    if (!customerRowData) {
                        this.receipts = [];
                        this.saveReceiptsToCache();
                        this.displayReceipts();
                        this.calculateTotalUnpaid();
                        return;
                    }
                    
                    // Extract receipts
                    const receipts = [];
                    for (let i = 0; i < headers.length; i++) {
                        const header = headers[i];
                        const headerUpper = header ? String(header).trim().toUpperCase() : '';
                        
                        if (headerUpper.startsWith('RECEIPT')) {
                            const receiptValue = customerRowData[i];
                            if (receiptValue && String(receiptValue).trim() !== '') {
                                try {
                                    let receiptJson = String(receiptValue).trim();
                                    if (receiptJson.startsWith('"') && receiptJson.endsWith('"')) {
                                        receiptJson = receiptJson.slice(1, -1);
                                    }
                                    receiptJson = receiptJson.replace(/""/g, '"');
                                    const receipt = JSON.parse(receiptJson);
                                    receipts.push(receipt);
                                } catch (e) {
                                    console.error('Error parsing receipt JSON:', e);
                                }
                            }
                        }
                    }
                    
                    this.receipts = receipts;
                    // Save to cache
                    this.saveReceiptsToCache();
                    this.displayReceipts();
                    this.calculateTotalUnpaid();
                },
                error: (error) => {
                    console.error('[Receipts] Error parsing CSV:', error);
                    this.receipts = [];
                    this.saveReceiptsToCache();
                    this.displayReceipts();
                    this.calculateTotalUnpaid();
                }
            });
        } catch (error) {
            console.error('[Receipts] Error loading from server:', error);
            this.receipts = [];
            this.saveReceiptsToCache();
            this.displayReceipts();
            this.calculateTotalUnpaid();
        }
    }
    
    displayReceipts() {
        const receiptsList = document.getElementById('receiptsList');
        if (!receiptsList) return;
        
        if (this.receipts.length === 0) {
            receiptsList.innerHTML = '<div class="empty-receipts">No previous receipts</div>';
            return;
        }
        
        // Sort receipts by date (newest first)
        const sortedReceipts = [...this.receipts].sort((a, b) => {
            const dateA = this.parseDate(a.date);
            const dateB = this.parseDate(b.date);
            if (dateA !== dateB) {
                return dateB - dateA;
            }
            const timeA = this.parseTime(a.time || '');
            const timeB = this.parseTime(b.time || '');
            return timeB - timeA;
        });
        
        receiptsList.innerHTML = sortedReceipts.map((receipt, index) => {
            const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
            const remainingBalance = receipt.grandTotal - totalPaid;
            
            return `
                <div class="receipt-item">
                    <div class="receipt-item-info">
                        <div class="receipt-item-date">${this.escapeHtml(receipt.date || 'N/A')} ${this.escapeHtml(receipt.time || '')}</div>
                        <div class="receipt-item-amount">
                            ₹${this.formatCurrency(receipt.grandTotal || 0)}
                            ${remainingBalance > 0 ? ` <span class="unpaid-part">| Unpaid: ₹${this.formatCurrency(remainingBalance)}</span>` : ''}
                        </div>
                    </div>
                    <button class="view-receipt-btn-compact" onclick="orderSystem.viewReceipt(${index})" title="View receipt">
                        Receipt
                    </button>
                </div>
            `;
        }).join('');
    }
    
    calculateTotalUnpaid() {
        let totalUnpaid = 0;
        this.receipts.forEach(receipt => {
            const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
            const remainingBalance = receipt.grandTotal - totalPaid;
            if (remainingBalance > 0) {
                totalUnpaid += remainingBalance;
            }
        });
        
        const totalUnpaidEl = document.getElementById('totalUnpaid');
        if (totalUnpaidEl) {
            totalUnpaidEl.textContent = `Total Unpaid: ₹${this.formatCurrency(totalUnpaid)}`;
            totalUnpaidEl.classList.toggle('zero', totalUnpaid === 0);
        }
    }
    
    // Check if pending order cache is stale
    isPendingOrderCacheStale() {
        try {
            const cacheTimestamp = localStorage.getItem(PENDING_ORDER_CACHE_TIMESTAMP_KEY);
            if (!cacheTimestamp) return true;
            const cacheTime = parseInt(cacheTimestamp, 10);
            return (Date.now() - cacheTime) >= CACHE_DURATION_MS;
        } catch (error) {
            return true;
        }
    }
    
    // Load pending order from cache
    loadPendingOrderFromCache() {
        try {
            const cachedData = localStorage.getItem(PENDING_ORDER_CACHE_KEY);
            if (!cachedData) {
                return false;
            }
            
            const parsed = JSON.parse(cachedData);
            // Check if cache is for current customer
            if (parsed.customerName && parsed.customerName.toUpperCase() === this.customerName.toUpperCase()) {
                // Set pending order (can be null if no pending order exists)
                this.pendingOrder = parsed.order !== undefined ? parsed.order : null;
                return true;
            }
            // Cache exists but for different customer
            return false;
        } catch (error) {
            console.error('Error loading pending order from cache:', error);
            return false;
        }
    }
    
    // Save pending order to cache
    savePendingOrderToCache() {
        try {
            const cacheData = {
                customerName: this.customerName,
                order: this.pendingOrder
            };
            localStorage.setItem(PENDING_ORDER_CACHE_KEY, JSON.stringify(cacheData));
            localStorage.setItem(PENDING_ORDER_CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (error) {
            console.error('Error saving pending order to cache:', error);
        }
    }
    
    async loadPendingOrder(silent = false) {
        // Always try to load from cache first
        const hasCache = this.loadPendingOrderFromCache();
        
        if (hasCache) {
            // Cache exists - check if it's stale
            const isStale = this.isPendingOrderCacheStale();
            
            if (!isStale) {
                // Cache is fresh (less than 5 minutes old) - use it, don't fetch
                this.displayPendingOrder();
                return; // Use cached data, don't fetch
            }
        }
        
        // Only fetch if cache is missing or stale
        await this.loadPendingOrderFromServer(silent);
    }
    
    // Load special prices for this customer
    async loadSpecialPrices() {
        // Special prices are loaded along with pending order in loadPendingOrderFromServer
        // This method is here for consistency and future use
        if (Object.keys(this.specialPrices).length === 0) {
            // If not loaded yet, trigger a load
            await this.loadPendingOrderFromServer(true);
        }
    }
    
    // Get effective price for a product (special price if available, otherwise regular price)
    getEffectivePrice(product) {
        const productName = product.name || '';
        if (this.specialPrices[productName] !== undefined) {
            return this.specialPrices[productName];
        }
        return product.rate || 0;
    }
    
    async loadPendingOrderFromServer(silent = false) {
        try {
            const response = await fetch(`/api/customer-orders?t=${Date.now()}`);
            if (!response.ok) {
                console.warn('Failed to load pending order');
                this.pendingOrder = null;
                this.savePendingOrderToCache();
                this.displayPendingOrder();
                return;
            }
            
            const csvText = await response.text();
            this.pendingOrder = null;
            
            Papa.parse(csvText, {
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    if (!results.data || results.data.length < 2) {
                        this.pendingOrder = null;
                        this.savePendingOrderToCache();
                        this.displayPendingOrder();
                        return;
                    }
                    
                    // First row is headers, skip it
                    for (let i = 1; i < results.data.length; i++) {
                        const row = results.data[i];
                        if (row.length >= 3) {
                            // First column: customer name
                            // Second column: password
                            // Third column: order JSON
                            // Fourth column: special prices JSON (optional)
                            const customerName = String(row[0] || '').trim();
                            const orderJson = String(row[2] || '').trim();
                            const specialPricesJson = String(row[3] || '').trim();
                            
                            if (customerName && customerName.toUpperCase() === this.customerName.toUpperCase()) {
                                // Load special prices
                                if (specialPricesJson) {
                                    try {
                                        let pricesData = specialPricesJson;
                                        if (pricesData.startsWith('"') && pricesData.endsWith('"')) {
                                            pricesData = pricesData.slice(1, -1);
                                        }
                                        pricesData = pricesData.replace(/""/g, '"');
                                        this.specialPrices = JSON.parse(pricesData);
                                    } catch (e) {
                                        console.error('Error parsing special prices JSON:', e);
                                        this.specialPrices = {};
                                    }
                                } else {
                                    this.specialPrices = {};
                                }
                                
                                // Load pending order
                                if (orderJson) {
                                    try {
                                        let orderData = orderJson;
                                        if (orderData.startsWith('"') && orderData.endsWith('"')) {
                                            orderData = orderData.slice(1, -1);
                                        }
                                        orderData = orderData.replace(/""/g, '"');
                                        const order = JSON.parse(orderData);
                                        this.pendingOrder = order;
                                    } catch (e) {
                                        console.error('Error parsing pending order JSON:', e);
                                        this.pendingOrder = null;
                                    }
                                } else {
                                    this.pendingOrder = null;
                                }
                                break;
                            }
                        }
                    }
                    
                    // Save to cache
                    this.savePendingOrderToCache();
                    this.displayPendingOrder();
                },
                error: (error) => {
                    console.error('Error parsing pending order CSV:', error);
                    this.pendingOrder = null;
                    this.savePendingOrderToCache();
                    this.displayPendingOrder();
                }
            });
        } catch (error) {
            console.error('Error loading pending order:', error);
            this.pendingOrder = null;
            this.savePendingOrderToCache();
            this.displayPendingOrder();
        }
    }
    
    displayPendingOrder() {
        const pendingOrderSection = document.getElementById('pendingOrderSection');
        const pendingOrderContent = document.getElementById('pendingOrderContent');
        
        if (!pendingOrderSection || !pendingOrderContent) return;
        
        if (!this.pendingOrder) {
            pendingOrderSection.style.display = 'none';
            return;
        }
        
        pendingOrderSection.style.display = 'block';
        
        const order = this.pendingOrder;
        const dateStr = order.date || 'N/A';
        const timeStr = order.time || 'N/A';
        const grandTotal = order.grandTotal || 0;
        
        pendingOrderContent.innerHTML = `
            <div class="pending-order-item">
                <div class="pending-order-info">
                    <div class="pending-order-header">
                        <div>
                            <div class="pending-order-date">${this.escapeHtml(dateStr)}</div>
                            <div class="pending-order-time">${this.escapeHtml(timeStr)}</div>
                        </div>
                        <div class="pending-order-amount">₹${this.formatCurrency(grandTotal)}</div>
                    </div>
                    <div class="pending-order-status">Pending Approval</div>
                </div>
                <button class="delete-pending-order-btn" onclick="orderSystem.showDeletePendingOrderModal()" title="Delete pending order">
                    ×
                </button>
                <button class="view-pending-order-btn" onclick="orderSystem.viewPendingOrder()" title="View pending order">
                    Check Order
                </button>
            </div>
        `;
    }
    
    showDeletePendingOrderModal() {
        const modal = document.getElementById('deletePendingOrderModal');
        if (modal) {
            modal.classList.add('active');
        }
    }
    
    closeDeletePendingOrderModal() {
        const modal = document.getElementById('deletePendingOrderModal');
        if (modal) {
            modal.classList.remove('active');
        }
    }
    
    viewPendingOrder() {
        if (!this.pendingOrder) {
            return;
        }
        
        const pendingOrderContent = document.getElementById('pendingOrderViewContent');
        const modal = document.getElementById('pendingOrderViewModal');
        
        if (!pendingOrderContent || !modal) {
            console.error('Pending order modal elements not found');
            return;
        }
        
        // Format pending order similar to receipt
        const storeName = this.pendingOrder.storeName || "SHREEJI'S STORE";
        const customerName = this.customerName ? this.customerName.toUpperCase() : '';
        const dateStr = this.pendingOrder.date || 'N/A';
        const timeStr = this.pendingOrder.time || 'N/A';
        
        // Detect mobile screen
        const isMobile = window.innerWidth <= 768;
        
        // Adjust column widths based on screen size
        const nameWidth = isMobile ? 15 : 22;
        const rateWidth = isMobile ? 7 : 8;
        const totalWidth = isMobile ? 8 : 10;
        const separatorWidth = isMobile ? 35 : 50;
        
        // Format items for receipt
        const items = this.pendingOrder.items || [];
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
        const grandTotal = this.pendingOrder.grandTotal || 0;
        const totalValueStr = `₹${grandTotal.toFixed(2)}`;
        // Calculate remaining space: serialPrefixWidth + nameWidth + 1 (space) + 2 (qty) + 1 (space) + 1 (x) + 1 (space) + rateWidth + 1 (space) + 1 (=) + 1 (space) + totalWidth
        const totalLineWidth = serialPrefixWidth + nameWidth + 1 + 2 + 1 + 1 + 1 + rateWidth + 1 + 1 + 1 + totalWidth;
        const totalValue = totalValueStr.padStart(totalLineWidth - nameWidth);
        
        // Build pending order content
        const orderLines = [
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
            'Order Pending Approval'
        ];
        
        pendingOrderContent.textContent = orderLines.join('\n');
        modal.style.display = 'flex';
    }
    
    closePendingOrderView() {
        const modal = document.getElementById('pendingOrderViewModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    async sharePendingOrderView() {
        const pendingOrderContent = document.getElementById('pendingOrderViewContent');
        const modal = document.getElementById('pendingOrderViewModal');
        
        if (!pendingOrderContent || !modal) {
            alert('Pending order not found');
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
                const loadingText = loadingOverlay.querySelector('p');
                if (loadingText) {
                    loadingText.textContent = 'Generating order image...';
                }
            }
            
            // Wait a bit for any rendering to complete
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Temporarily ensure pending order content is fully visible
            const originalOverflow = pendingOrderContent.style.overflow;
            const originalOverflowX = pendingOrderContent.style.overflowX;
            const originalOverflowY = pendingOrderContent.style.overflowY;
            const originalWidth = pendingOrderContent.style.width;
            const originalMaxWidth = pendingOrderContent.style.maxWidth;
            const originalBoxSizing = pendingOrderContent.style.boxSizing;
            
            pendingOrderContent.style.overflow = 'visible';
            pendingOrderContent.style.overflowX = 'visible';
            pendingOrderContent.style.overflowY = 'visible';
            pendingOrderContent.style.width = 'auto';
            pendingOrderContent.style.maxWidth = 'none';
            pendingOrderContent.style.boxSizing = 'content-box';
            
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
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const orderWidth = Math.max(
                    pendingOrderContent.scrollWidth,
                    pendingOrderContent.offsetWidth,
                    pendingOrderContent.getBoundingClientRect().width
                );
                const orderHeight = Math.max(
                    pendingOrderContent.scrollHeight,
                    pendingOrderContent.offsetHeight,
                    pendingOrderContent.getBoundingClientRect().height
                );
                
                canvas = await html2canvas(pendingOrderContent, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: orderWidth,
                    height: orderHeight,
                    x: 0,
                    y: 0,
                    scrollX: 0,
                    scrollY: 0
                });
                
                modalContent.style.overflow = originalModalOverflow;
                modalContent.style.overflowX = originalModalOverflowX;
                modalContent.style.width = originalModalWidth;
                modalContent.style.maxWidth = originalModalMaxWidth;
            } else {
                const orderWidth = Math.max(
                    pendingOrderContent.scrollWidth,
                    pendingOrderContent.offsetWidth,
                    pendingOrderContent.getBoundingClientRect().width
                );
                const orderHeight = Math.max(
                    pendingOrderContent.scrollHeight,
                    pendingOrderContent.offsetHeight,
                    pendingOrderContent.getBoundingClientRect().height
                );
                
                canvas = await html2canvas(pendingOrderContent, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: orderWidth,
                    height: orderHeight
                });
            }
            
            // Restore pending order content styles
            pendingOrderContent.style.overflow = originalOverflow;
            pendingOrderContent.style.overflowX = originalOverflowX;
            pendingOrderContent.style.overflowY = originalOverflowY;
            pendingOrderContent.style.width = originalWidth;
            pendingOrderContent.style.maxWidth = originalMaxWidth;
            pendingOrderContent.style.boxSizing = originalBoxSizing;
            
            // Convert canvas to blob
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    throw new Error('Failed to create image blob');
                }
                
                const file = new File([blob], 'pending-order.jpg', { type: 'image/jpeg' });
                
                // Use Web Share API if available
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: 'Pending Order',
                            text: 'Pending Order from Shreeji\'s Store',
                            files: [file]
                        });
                    } catch (shareError) {
                        if (shareError.name !== 'AbortError') {
                            console.error('Error sharing:', shareError);
                            // Fallback to download
                            this.downloadPendingOrderImage(canvas);
                        }
                    }
                } else {
                    // Fallback to download
                    this.downloadPendingOrderImage(canvas);
                }
                
                // Hide loading
                if (loadingOverlay) {
                    loadingOverlay.style.display = 'none';
                    const loadingText = loadingOverlay.querySelector('p');
                    if (loadingText) {
                        loadingText.textContent = 'Loading products...';
                    }
                }
            }, 'image/jpeg', 0.95);
            
        } catch (error) {
            console.error('Error sharing pending order:', error);
            alert('Failed to share pending order. Please try again.');
            
            // Hide loading
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
                const loadingText = loadingOverlay.querySelector('p');
                if (loadingText) {
                    loadingText.textContent = 'Loading products...';
                }
            }
        }
    }
    
    downloadPendingOrderImage(canvas) {
        const link = document.createElement('a');
        link.download = 'pending-order.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
    }
    
    async deletePendingOrder() {
        if (!this.pendingOrder) {
            return;
        }
        
        this.closeDeletePendingOrderModal();
        
        try {
            const response = await fetch('/api/approve-order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerName: this.customerName,
                    approved: false
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete pending order: ${response.status}`);
            }
            
            const result = await response.json();
            if (result.success) {
                this.pendingOrder = null;
                // Update cache immediately
                this.savePendingOrderToCache();
                this.displayPendingOrder();
            } else {
                throw new Error(result.error || 'Failed to delete pending order');
            }
        } catch (error) {
            console.error('Error deleting pending order:', error);
            alert('Failed to delete pending order. Please try again.');
        }
    }
    
    // Set up periodic refresh every 5 minutes
    setupPeriodicRefresh() {
        // Clear any existing interval
        if (this.cacheRefreshInterval) {
            clearInterval(this.cacheRefreshInterval);
        }
        
        // Refresh both caches every 5 minutes - flush old cache and replace with fresh data
        this.cacheRefreshInterval = setInterval(() => {
            console.log('Periodic cache refresh triggered - flushing and replacing cache');
            this.flushAndRefreshPendingOrderCache();
            this.flushAndRefreshReceiptsCache();
        }, CACHE_DURATION_MS);
    }
    
    // Flush old cache and replace with fresh data
    async flushAndRefreshPendingOrderCache() {
        try {
            // Clear old cache
            localStorage.removeItem(PENDING_ORDER_CACHE_KEY);
            localStorage.removeItem(PENDING_ORDER_CACHE_TIMESTAMP_KEY);
            
            console.log('Pending order cache flushed, fetching fresh data...');
            
            // Fetch fresh data and save to cache
            await this.loadPendingOrderFromServer(true);
            
            console.log('Pending order cache refreshed with fresh data');
        } catch (error) {
            console.error('Error flushing and refreshing pending order cache:', error);
        }
    }
    
    // Flush old receipts cache and replace with fresh data
    async flushAndRefreshReceiptsCache() {
        try {
            // Clear old cache
            localStorage.removeItem(RECEIPTS_CACHE_KEY);
            localStorage.removeItem(RECEIPTS_CACHE_TIMESTAMP_KEY);
            
            console.log('Receipts cache flushed, fetching fresh data...');
            
            // Fetch fresh data and save to cache
            await this.loadCustomerReceiptsFromServer(true);
            
            console.log('Receipts cache refreshed with fresh data');
        } catch (error) {
            console.error('Error flushing and refreshing receipts cache:', error);
        }
    }
    
    parseDate(dateStr) {
        if (!dateStr) return 0;
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            return new Date(year, month, day).getTime();
        }
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    
    parseTime(timeStr) {
        if (!timeStr) return 0;
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const period = timeMatch[3] ? timeMatch[3].toUpperCase() : '';
            if (period === 'PM' && hours !== 12) hours += 12;
            else if (period === 'AM' && hours === 12) hours = 0;
            return hours * 60 + minutes;
        }
        const parts = timeStr.split(':');
        if (parts.length >= 2) {
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
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
    
    // Load products methods (same as script.js)
    isCacheStale() {
        try {
            const cacheTimestamp = localStorage.getItem(PRODUCTS_CACHE_TIMESTAMP_KEY);
            if (!cacheTimestamp) return true;
            const cacheTime = parseInt(cacheTimestamp, 10);
            return (Date.now() - cacheTime) >= CACHE_DURATION_MS;
        } catch (error) {
            return true;
        }
    }
    
    loadProductsFromCache() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            if (!cachedData) return false;
            const parsedProducts = JSON.parse(cachedData);
            if (!Array.isArray(parsedProducts) || parsedProducts.length === 0) return false;
            this.products = parsedProducts;
            return true;
        } catch (error) {
            return false;
        }
    }
    
    async loadProductsWithRetry(silent = false, retryCount = 0, maxRetries = 3) {
        try {
            await this.loadProducts(silent);
            if (this.products.length === 0 && retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.loadProductsWithRetry(silent, retryCount + 1, maxRetries);
            }
        } catch (error) {
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.loadProductsWithRetry(silent, retryCount + 1, maxRetries);
            }
        }
    }
    
    async loadProducts(silent = false) {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (!silent && loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }

        return new Promise((resolve, reject) => {
            try {
                const cacheBuster = `?t=${Date.now()}&v=${Math.random().toString(36).substring(7)}`;
                Papa.parse(STORE_PRODUCTS_URL + cacheBuster, {
                    download: true,
                    header: true,
                    skipEmptyLines: true,
                    transformHeader: (header) => header.trim().toUpperCase(),
                    complete: (results) => {
                        const newProducts = results.data
                            .filter(row => {
                                const product = row.PRODUCT || '';
                                const rate = row.RATE || '';
                                const productStr = String(product).trim();
                                const rateStr = String(rate).trim();
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
                            if (this.loadProductsFromCache()) {
                                if (loadingOverlay) loadingOverlay.style.display = 'none';
                                resolve();
                                return;
                            }
                        }
                        
                        this.products = newProducts;
                        localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(this.products));
                        localStorage.setItem(PRODUCTS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                        
                        if (loadingOverlay) loadingOverlay.style.display = 'none';
                        if (!silent) {
                            this.handleSearch('');
                        }
                        resolve();
                    },
                    error: (error) => {
                        if (loadingOverlay) loadingOverlay.style.display = 'none';
                        if (this.loadProductsFromCache()) {
                            resolve();
                        } else {
                            reject(error);
                        }
                    }
                });
            } catch (error) {
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                if (this.loadProductsFromCache()) {
                    resolve();
                } else {
                    reject(error);
                }
            }
        });
    }
    
    setupEventListeners() {
        const searchInput = document.getElementById('productSearch');
        const placeOrderBtn = document.getElementById('placeOrderBtn');
        const clearCartBtn = document.getElementById('clearCartBtn');
        const closeOrderModal = document.getElementById('closeOrderModal');
        const closeOrderBtn = document.getElementById('closeOrderBtn');
        const customerNameBtn = document.getElementById('customerNameBtn');
        const printOrderBtn = document.getElementById('printOrder');
        const shareOrderBtn = document.getElementById('shareOrder');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }
        
        if (placeOrderBtn) {
            placeOrderBtn.addEventListener('click', () => this.placeOrder());
        }
        
        if (clearCartBtn) {
            clearCartBtn.addEventListener('click', () => this.clearCart());
        }
        
        if (closeOrderModal) {
            closeOrderModal.addEventListener('click', () => this.closeOrderModal());
        }
        
        if (closeOrderBtn) {
            closeOrderBtn.addEventListener('click', () => this.closeOrderModal());
        }
        
        if (customerNameBtn) {
            customerNameBtn.addEventListener('click', () => this.toggleCustomerInfoView());
        }
        
        if (printOrderBtn) {
            printOrderBtn.addEventListener('click', () => window.print());
        }
        
        if (shareOrderBtn) {
            shareOrderBtn.addEventListener('click', () => this.shareOrder());
        }
        
        const printReceiptViewBtn = document.getElementById('printReceiptView');
        const shareReceiptViewBtn = document.getElementById('shareReceiptView');
        const closeReceiptView = document.getElementById('closeReceiptView');
        
        if (printReceiptViewBtn) {
            printReceiptViewBtn.addEventListener('click', () => window.print());
        }
        
        if (shareReceiptViewBtn) {
            shareReceiptViewBtn.addEventListener('click', () => this.shareReceiptView());
        }
        
        if (closeReceiptView) {
            closeReceiptView.addEventListener('click', () => this.closeReceiptView());
        }
        
        // Delete pending order modal
        const closeDeletePendingOrderModal = document.getElementById('closeDeletePendingOrderModal');
        const cancelDeletePendingOrderBtn = document.getElementById('cancelDeletePendingOrderBtn');
        const confirmDeletePendingOrderBtn = document.getElementById('confirmDeletePendingOrderBtn');
        
        if (closeDeletePendingOrderModal) {
            closeDeletePendingOrderModal.addEventListener('click', () => this.closeDeletePendingOrderModal());
        }
        
        if (cancelDeletePendingOrderBtn) {
            cancelDeletePendingOrderBtn.addEventListener('click', () => this.closeDeletePendingOrderModal());
        }
        
        if (confirmDeletePendingOrderBtn) {
            confirmDeletePendingOrderBtn.addEventListener('click', () => this.deletePendingOrder());
        }
        
        const deletePendingOrderModal = document.getElementById('deletePendingOrderModal');
        if (deletePendingOrderModal) {
            deletePendingOrderModal.addEventListener('click', (e) => {
                if (e.target.id === 'deletePendingOrderModal') {
                    this.closeDeletePendingOrderModal();
                }
            });
        }
        
        const orderModal = document.getElementById('orderModal');
        if (orderModal) {
            orderModal.addEventListener('click', (e) => {
                if (e.target.id === 'orderModal') {
                    this.closeOrderModal();
                }
            });
        }
        
        const receiptViewModal = document.getElementById('receiptViewModal');
        if (receiptViewModal) {
            receiptViewModal.addEventListener('click', (e) => {
                if (e.target.id === 'receiptViewModal') {
                    this.closeReceiptView();
                }
            });
        }
        
        // Pending order view modal
        const printPendingOrderViewBtn = document.getElementById('printPendingOrderView');
        const sharePendingOrderViewBtn = document.getElementById('sharePendingOrderView');
        const closePendingOrderView = document.getElementById('closePendingOrderView');
        
        if (printPendingOrderViewBtn) {
            printPendingOrderViewBtn.addEventListener('click', () => window.print());
        }
        
        if (sharePendingOrderViewBtn) {
            sharePendingOrderViewBtn.addEventListener('click', () => this.sharePendingOrderView());
        }
        
        if (closePendingOrderView) {
            closePendingOrderView.addEventListener('click', () => this.closePendingOrderView());
        }
        
        const pendingOrderViewModal = document.getElementById('pendingOrderViewModal');
        if (pendingOrderViewModal) {
            pendingOrderViewModal.addEventListener('click', (e) => {
                if (e.target.id === 'pendingOrderViewModal') {
                    this.closePendingOrderView();
                }
            });
        }
    }
    
    toggleCustomerInfoView() {
        const customerInfoView = document.getElementById('customerInfoView');
        const cartView = document.getElementById('cartView');
        
        if (customerInfoView && cartView) {
            const isInfoViewActive = customerInfoView.classList.contains('active');
            
            if (isInfoViewActive) {
                // Switch to cart view
                customerInfoView.classList.remove('active');
                cartView.classList.remove('hidden');
            } else {
                // Switch to customer info view
                customerInfoView.classList.add('active');
                cartView.classList.add('hidden');
                // Load pending order (uses cache if available and fresh, otherwise fetches)
                this.loadPendingOrder(true);
                // Reload receipts
                this.loadCustomerReceipts();
            }
        }
    }
    
    searchResults = [];
    
    handleSearch(query) {
        if (!this.products || this.products.length === 0) {
            return;
        }
        
        const searchResultsDiv = document.getElementById('searchResults');
        if (!searchResultsDiv) return;
        
        if (!query.trim()) {
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
        const maxResults = 50;
        const displayResults = this.searchResults.slice(0, maxResults);
        const hasMore = this.searchResults.length > maxResults;

        searchResultsDiv.innerHTML = displayResults.map((product, index) => {
            const stock = product.stock || 0;
            const stockText = stock > 0 ? `Stock: ${stock}` : 'Out of stock';
            const stockClass = stock > 0 ? 'product-stock' : 'product-stock out-of-stock';
            const effectivePrice = this.getEffectivePrice(product);
            const priceDisplay = `<span class="product-rate">₹${effectivePrice.toFixed(2)}</span>`;
            return `
            <div class="search-result-item" data-index="${index}">
                <span class="product-name">${highlight ? this.highlightMatch(product.name, query) : product.name}</span>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                    ${priceDisplay}
                    <span class="${stockClass}">${stockText}</span>
                </div>
            </div>
        `;
        }).join('') + (hasMore ? `<div class="more-results">+ ${this.searchResults.length - maxResults} more products (refine your search)</div>` : '');

        searchResultsDiv.style.display = 'block';

        searchResultsDiv.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.search-qty-controls')) {
                    return;
                }
                const index = parseInt(item.dataset.index);
                this.showQuantityInput(item, this.searchResults[index]);
            });
        });
    }
    
    highlightMatch(text, query) {
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }
    
    showQuantityInput(itemElement, product) {
        const searchResultsDiv = document.getElementById('searchResults');
        if (searchResultsDiv) {
            searchResultsDiv.querySelectorAll('.search-qty-controls').forEach(controls => {
                controls.remove();
            });
        }
        
        if (itemElement.querySelector('.search-qty-controls')) {
            return;
        }
        
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
        
        const productRate = itemElement.querySelector('.product-rate');
        productRate.insertAdjacentElement('afterend', qtyControls);
        
        const qtyInput = qtyControls.querySelector('.search-qty-input');
        const decreaseBtn = qtyControls.querySelector('[data-action="decrease"]');
        const increaseBtn = qtyControls.querySelector('[data-action="increase"]');
        const addBtn = qtyControls.querySelector('.search-add-btn');
        
        setTimeout(() => qtyInput.focus(), 50);
        qtyInput.select();
        
        decreaseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentValue = parseInt(qtyInput.value) || 1;
            if (currentValue > 1) {
                qtyInput.value = currentValue - 1;
            }
        });
        
        increaseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentValue = parseInt(qtyInput.value) || 1;
            qtyInput.value = currentValue + 1;
        });
        
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const quantity = parseInt(qtyInput.value) || 1;
            if (quantity > 0) {
                this.addToCartWithQuantity(product, quantity);
                document.getElementById('productSearch').value = '';
                this.clearSearchResults();
            }
        });
        
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
        
        qtyControls.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    addToCartWithQuantity(product, quantity) {
        const effectivePrice = this.getEffectivePrice(product);
        const existingItem = this.cart.find(item => item.name === product.name);
        
        if (existingItem) {
            existingItem.quantity += quantity;
            // Update rate in case special price changed
            existingItem.rate = effectivePrice;
        } else {
            this.cart.push({
                name: product.name,
                rate: effectivePrice,
                quantity: quantity,
                purchaseCost: product.purchaseCost || 0,
                stock: product.stock || 0
            });
        }

        this.updateCartDisplay();
    }
    
    clearSearchResults() {
        const searchInput = document.getElementById('productSearch');
        const searchResultsDiv = document.getElementById('searchResults');
        if (searchResultsDiv) {
            searchResultsDiv.style.display = 'none';
            searchResultsDiv.innerHTML = '';
        }
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
        const clearCartBtn = document.getElementById('clearCartBtn');
        const placeOrderBtn = document.getElementById('placeOrderBtn');

        if (this.cart.length === 0) {
            if (cartItemsDiv) {
                cartItemsDiv.innerHTML = '<p class="empty-cart">No items in cart</p>';
            }
            if (clearCartBtn) clearCartBtn.disabled = true;
            if (placeOrderBtn) placeOrderBtn.disabled = true;
        } else {
            if (cartItemsDiv) {
                cartItemsDiv.innerHTML = this.cart.map((item, index) => {
                    const product = this.products.find(p => p.name === item.name);
                    const stock = product ? (product.stock || 0) : (item.stock || 0);
                    const stockText = stock > 0 ? `Stock: ${stock}` : 'Out of stock';
                    const stockClass = stock > 0 ? 'cart-item-stock' : 'cart-item-stock out-of-stock';
                    return `
                    <div class="cart-item" data-index="${index}">
                        <div class="cart-item-row">
                            <div class="cart-item-info">
                                <span class="cart-item-name">${item.name}</span>
                                <span class="cart-item-rate">₹${item.rate.toFixed(2)} each</span>
                                <span class="${stockClass}">${stockText}</span>
                            </div>
                            <div class="cart-item-right">
                                <button class="remove-btn remove-btn-desktop" onclick="orderSystem.removeFromCart(${index})" title="Remove">×</button>
                                <span class="cart-item-total">₹${(item.rate * item.quantity).toFixed(2)}</span>
                            </div>
                        </div>
                        <div class="cart-item-controls">
                            <button class="remove-btn remove-btn-mobile" onclick="orderSystem.removeFromCart(${index})" title="Remove">×</button>
                            <button class="qty-btn" onclick="orderSystem.updateQuantity(${index}, -1)">−</button>
                            <span class="cart-item-qty">${item.quantity}</span>
                            <button class="qty-btn" onclick="orderSystem.updateQuantity(${index}, 1)">+</button>
                        </div>
                    </div>
                `;
                }).join('');
            }
            if (clearCartBtn) clearCartBtn.disabled = false;
            if (placeOrderBtn) placeOrderBtn.disabled = false;
        }

        this.updateTotal();
    }
    
    updateTotal() {
        const grandTotal = this.cart.reduce((sum, item) => sum + (item.rate * item.quantity), 0);
        const grandTotalEl = document.getElementById('grandTotal');
        if (grandTotalEl) {
            grandTotalEl.textContent = `₹${grandTotal.toFixed(2)}`;
        }
    }
    
    clearCart() {
        this.cart = [];
        const searchInput = document.getElementById('productSearch');
        if (searchInput) {
            searchInput.value = '';
        }
        this.updateCartDisplay();
    }
    
    placeOrder() {
        if (this.cart.length === 0) {
            alert('Your cart is empty.');
            return;
        }
        
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
        
        const cartItems = [...this.cart];
        let totalProfitMargin = 0;
        const orderItems = cartItems.map(item => {
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
        
        const orderData = {
            storeName: "SHREEJI'S STORE",
            customerName: this.customerName,
            date: dateStr,
            time: timeStr,
            items: orderItems,
            grandTotal: grandTotal,
            profitMargin: totalProfitMargin
        };
        
        // Show order confirmation
        this.showOrderConfirmation(orderData);
        
        // Save order to Google Sheets
        this.saveOrderToSheets(orderData);
    }
    
    showOrderConfirmation(orderData) {
        const orderContent = document.getElementById('orderContent');
        const modal = document.getElementById('orderModal');
        
        if (!orderContent || !modal) return;
        
        const isMobile = window.innerWidth <= 768;
        const nameWidth = isMobile ? 15 : 22;
        const rateWidth = isMobile ? 7 : 8;
        const totalWidth = isMobile ? 8 : 10;
        const separatorWidth = isMobile ? 35 : 50;
        
        const itemsText = orderData.items.map((item, index) => {
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
        
        const maxSerialNumber = orderData.items.length;
        const serialPrefixWidth = maxSerialNumber.toString().length + 2;
        const totalLabel = "Total".padEnd(nameWidth);
        const totalValueStr = `₹${orderData.grandTotal.toFixed(2)}`;
        const totalLineWidth = serialPrefixWidth + nameWidth + 1 + 2 + 1 + 1 + 1 + rateWidth + 1 + 1 + 1 + totalWidth;
        const totalValue = totalValueStr.padStart(totalLineWidth - nameWidth);
        
        const orderLines = [
            orderData.storeName,
            `Customer: ${orderData.customerName.toUpperCase()}`,
            '',
            `Date: ${orderData.date}`,
            `Time: ${orderData.time}`,
            '',
            '·'.repeat(separatorWidth),
            isMobile ? 'Item           Qty  Rate    Total' : 'Item                  Qty    Rate      Total',
            '·'.repeat(separatorWidth),
            itemsText,
            '·'.repeat(separatorWidth),
            `${totalLabel}${totalValue}`,
            '·'.repeat(separatorWidth),
            '',
            'Thank you for your purchase!',
            'Order Placed by Customer'
        ];
        
        orderContent.textContent = orderLines.join('\n');
        modal.style.display = 'flex';
    }
    
    closeOrderModal() {
        const modal = document.getElementById('orderModal');
        if (modal) {
            modal.style.display = 'none';
        }
        // Clear cart after order is placed
        this.clearCart();
        // Reload receipts to show updated data
        this.loadCustomerReceipts();
        // Reload pending order
        this.loadPendingOrder();
    }
    
    async shareOrder() {
        const orderContent = document.getElementById('orderContent');
        const modal = document.getElementById('orderModal');
        
        if (!orderContent || !modal) {
            alert('Order not found');
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
                const loadingText = loadingOverlay.querySelector('p');
                if (loadingText) {
                    loadingText.textContent = 'Generating order image...';
                }
            }
            
            // Wait a bit for any rendering to complete
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Temporarily ensure order content is fully visible
            const originalOverflow = orderContent.style.overflow;
            const originalOverflowX = orderContent.style.overflowX;
            const originalOverflowY = orderContent.style.overflowY;
            const originalWidth = orderContent.style.width;
            const originalMaxWidth = orderContent.style.maxWidth;
            const originalBoxSizing = orderContent.style.boxSizing;
            
            orderContent.style.overflow = 'visible';
            orderContent.style.overflowX = 'visible';
            orderContent.style.overflowY = 'visible';
            orderContent.style.width = 'auto';
            orderContent.style.maxWidth = 'none';
            orderContent.style.boxSizing = 'content-box';
            
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
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const orderWidth = Math.max(
                    orderContent.scrollWidth,
                    orderContent.offsetWidth,
                    orderContent.getBoundingClientRect().width
                );
                const orderHeight = Math.max(
                    orderContent.scrollHeight,
                    orderContent.offsetHeight,
                    orderContent.getBoundingClientRect().height
                );
                
                canvas = await html2canvas(orderContent, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: orderWidth,
                    height: orderHeight,
                    x: 0,
                    y: 0,
                    scrollX: 0,
                    scrollY: 0
                });
                
                modalContent.style.overflow = originalModalOverflow;
                modalContent.style.overflowX = originalModalOverflowX;
                modalContent.style.width = originalModalWidth;
                modalContent.style.maxWidth = originalModalMaxWidth;
            } else {
                const orderWidth = Math.max(
                    orderContent.scrollWidth,
                    orderContent.offsetWidth,
                    orderContent.getBoundingClientRect().width
                );
                const orderHeight = Math.max(
                    orderContent.scrollHeight,
                    orderContent.offsetHeight,
                    orderContent.getBoundingClientRect().height
                );
                
                canvas = await html2canvas(orderContent, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    width: orderWidth,
                    height: orderHeight
                });
            }
            
            // Restore order content styles
            orderContent.style.overflow = originalOverflow;
            orderContent.style.overflowX = originalOverflowX;
            orderContent.style.overflowY = originalOverflowY;
            orderContent.style.width = originalWidth;
            orderContent.style.maxWidth = originalMaxWidth;
            orderContent.style.boxSizing = originalBoxSizing;
            
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    alert('Failed to generate order image');
                    if (loadingOverlay) loadingOverlay.style.display = 'none';
                    return;
                }
                
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
                const fileName = `Order-${dateStr}-${timeStr}.jpg`;
                
                const file = new File([blob], fileName, { type: 'image/jpeg' });
                
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: 'Order',
                            text: 'Order from Shreeji\'s Store',
                            files: [file]
                        });
                    } catch (shareError) {
                        if (shareError.name !== 'AbortError') {
                            this.downloadOrderImage(blob, fileName);
                        }
                    }
                } else {
                    this.downloadOrderImage(blob, fileName);
                }
                
                if (loadingOverlay) {
                    loadingOverlay.style.display = 'none';
                    const loadingText = loadingOverlay.querySelector('p');
                    if (loadingText) {
                        loadingText.textContent = 'Loading products...';
                    }
                }
            }, 'image/jpeg', 0.95);
            
        } catch (error) {
            console.error('Error sharing order:', error);
            alert('Failed to share order. Please try again.');
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
                const loadingText = loadingOverlay.querySelector('p');
                if (loadingText) {
                    loadingText.textContent = 'Loading products...';
                }
            }
        }
    }
    
    downloadOrderImage(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    async saveOrderToSheets(orderData) {
        try {
            const response = await fetch('/api/save-order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(orderData),
                cache: 'no-store'
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to save order: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            if (result.success !== false) {
                console.log('Order saved to Google Sheets:', result);
                
                // Update pending order cache immediately
                // Create pending order object from orderData
                this.pendingOrder = {
                    date: orderData.date,
                    time: orderData.time,
                    customerName: orderData.customerName,
                    items: orderData.items,
                    grandTotal: orderData.grandTotal,
                    profitMargin: orderData.profitMargin,
                    storeName: orderData.storeName,
                    payments: {
                        cash: 0,
                        online: 0
                    },
                    remainingBalance: orderData.grandTotal
                };
                
                // Save to cache immediately
                this.savePendingOrderToCache();
                this.displayPendingOrder();
            } else {
                console.error('Google Sheets returned error:', result.error);
            }
        } catch (error) {
            console.error('Error saving order to Google Sheets:', error);
        }
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
        const storeName = receipt.storeName || "SHREEJI'S STORE";
        const customerName = this.customerName ? this.customerName.toUpperCase() : '';
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
                loadingOverlay.style.display = 'flex';
                const loadingText = loadingOverlay.querySelector('p');
                if (loadingText) {
                    loadingText.textContent = 'Generating receipt image...';
                }
            }
            
            // Wait a bit for any rendering to complete
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Temporarily ensure receipt content is fully visible
            const originalOverflow = receiptContent.style.overflow;
            const originalOverflowX = receiptContent.style.overflowX;
            const originalOverflowY = receiptContent.style.overflowY;
            const originalWidth = receiptContent.style.width;
            const originalMaxWidth = receiptContent.style.maxWidth;
            const originalBoxSizing = receiptContent.style.boxSizing;
            
            receiptContent.style.overflow = 'visible';
            receiptContent.style.overflowX = 'visible';
            receiptContent.style.overflowY = 'visible';
            receiptContent.style.width = 'auto';
            receiptContent.style.maxWidth = 'none';
            receiptContent.style.boxSizing = 'content-box';
            
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
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
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
                
                modalContent.style.overflow = originalModalOverflow;
                modalContent.style.overflowX = originalModalOverflowX;
                modalContent.style.width = originalModalWidth;
                modalContent.style.maxWidth = originalModalMaxWidth;
            } else {
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
                    loadingOverlay.style.display = 'none';
                    const loadingText = loadingOverlay.querySelector('p');
                    if (loadingText) {
                        loadingText.textContent = 'Loading products...';
                    }
                }
            }, 'image/jpeg', 0.95);
            
        } catch (error) {
            console.error('Error sharing receipt:', error);
            alert('Failed to share receipt. Please try again.');
            
            // Hide loading
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
                const loadingText = loadingOverlay.querySelector('p');
                if (loadingText) {
                    loadingText.textContent = 'Loading products...';
                }
            }
        }
    }
    
    downloadReceiptImage(canvas) {
        const link = document.createElement('a');
        link.download = 'receipt.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
    }
}

// Initialize order system when page loads
let orderSystem;
window.addEventListener('DOMContentLoaded', () => {
    orderSystem = new OrderSystem();
});

