// Authentication manager for password protection
const AUTH_STORAGE_KEY = 'storeAuth';
const AUTH_API_ENDPOINT = '/api/verify-password';

class AuthManager {
    constructor() {
        this.authToken = null;
        this.authType = 'store'; // 'store' or 'customer'
        this.customerName = null; // Only set if authType is 'customer'
        this.loadAuth();
    }

    loadAuth() {
        try {
            const stored = localStorage.getItem(AUTH_STORAGE_KEY);
            if (stored) {
                const authData = JSON.parse(stored);
                // Check if auth is still valid (not expired)
                if (authData.expires && authData.expires > Date.now()) {
                    this.authToken = authData.token;
                    this.authType = authData.type || 'store';
                    this.customerName = authData.customerName || null;
                } else {
                    // Auth expired, clear it
                    this.clearAuth();
                }
            }
        } catch (error) {
            console.error('Error loading auth:', error);
            this.clearAuth();
        }
    }

    setAuthenticated(type = 'store', customerName = null) {
        // Generate a simple token (in production, this could be a JWT from server)
        const token = this.generateToken();
        const expires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
        
        const authData = {
            token: token,
            expires: expires,
            type: type, // 'store' or 'customer'
            customerName: customerName // Only set if type is 'customer'
        };
        
        try {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
            this.authToken = token;
            this.authType = type;
            this.customerName = customerName;
        } catch (error) {
            console.error('Error saving auth:', error);
        }
    }

    clearAuth() {
        try {
            localStorage.removeItem(AUTH_STORAGE_KEY);
            this.authToken = null;
            this.authType = 'store';
            this.customerName = null;
        } catch (error) {
            console.error('Error clearing auth:', error);
        }
    }

    isAuthenticated() {
        return this.authToken !== null;
    }

    async verifyPassword(password) {
        try {
            const response = await fetch(AUTH_API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password: password })
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return { success: false }; // Wrong password
                }
                throw new Error(`Failed to verify password: ${response.status}`);
            }

            const result = await response.json();
            return result; // Return full result with type and customerName
        } catch (error) {
            console.error('Error verifying password:', error);
            throw error;
        }
    }

    requireAuth() {
        if (!this.isAuthenticated()) {
            // Store the current page so we can redirect back after login
            const currentPage = window.location.pathname.split('/').pop() || 'index.html';
            if (currentPage !== 'login.html') {
                sessionStorage.setItem('redirectAfterLogin', currentPage);
            }
            window.location.href = 'login.html';
            return false;
        }
        return true;
    }

    generateToken() {
        // Generate a simple token (in production, server should generate JWT)
        return 'auth_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

// Create global auth manager instance
const authManager = new AuthManager();

