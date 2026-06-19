(function (global) {
  const API_BASE = 'http://localhost:8080';

  function getStorage() {
    return {
      local: global.localStorage,
      session: global.sessionStorage
    };
  }

  function isUuid(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
  }

  function getStoredUserId(storage) {
    const candidates = [
      storage.local.getItem('userId'),
      storage.session.getItem('userId'),
      storage.local.getItem('uuid'),
      storage.session.getItem('uuid')
    ];

    for (const candidate of candidates) {
      if (candidate && isUuid(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function decodeJwtPayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payload = parts[1];
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
      return JSON.parse(atob(pad));
    } catch (error) {
      return null;
    }
  }

  function getIdentity() {
    const { local, session } = getStorage();
    const storedUserId = getStoredUserId({ local, session });
    if (storedUserId) {
      return { id: storedUserId, isAnonymous: false };
    }

    const token = local.getItem('bearerToken') || session.getItem('bearerToken');
    if (token) {
      const decoded = decodeJwtPayload(token);
      const tokenUserId = decoded && (decoded.sub || decoded.id || decoded.userId || decoded.uid || null);
      if (tokenUserId && isUuid(String(tokenUserId))) {
        local.setItem('userId', String(tokenUserId));
        session.setItem('userId', String(tokenUserId));
        return { id: String(tokenUserId), isAnonymous: false };
      }
    }

    let guestId = local.getItem('guestId') || session.getItem('guestId');
    if (!guestId && global.crypto && typeof global.crypto.randomUUID === 'function') {
      guestId = global.crypto.randomUUID();
    }
    if (!guestId) {
      guestId = 'guest-' + Date.now();
    }

    local.setItem('guestId', guestId);
    session.setItem('guestId', guestId);
    return { id: guestId, isAnonymous: true };
  }

  function getAuthHeaders(extraHeaders) {
    const headers = new global.Headers(extraHeaders || {});
    const token = global.localStorage.getItem('bearerToken') || global.sessionStorage.getItem('bearerToken');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  function getCartEndpoint(path, identifier, isAnonymous) {
    return `${API_BASE}${path}/${identifier}?isAnonymous=${isAnonymous}`;
  }

  function handleResponse(response) {
    if (!response.ok) {
      return response.text().then((text) => {
        const message = text || `HTTP ${response.status}`;
        throw new Error(message);
      });
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return response.text();
  }

  const api = {
    getCartItems() {
      const { id, isAnonymous } = getIdentity();
      return fetch(getCartEndpoint('/api/cartItems', id, isAnonymous), {
        method: 'GET',
        headers: getAuthHeaders()
      }).then(handleResponse);
    },

    addCartItem(product) {
      const { id, isAnonymous } = getIdentity();
      const payload = {
        productId: product.productId || product.id || product.productID || product.uuid,
        quantity: Number(product.quantity || 1),
        size: product.size || 'M'
      };

      if (!payload.productId) {
        return Promise.reject(new Error('Missing productId for cart request.'));
      }

      return fetch(getCartEndpoint('/api/addCartItem', id, isAnonymous), {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      }).then(handleResponse);
    },

    deleteCartItem(productId) {
      const { id, isAnonymous } = getIdentity();
      return fetch(`${API_BASE}/api/deleteCartItem/${id}/${productId}?isAnonymous=${isAnonymous}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      }).then(handleResponse);
    },

    setCartItemQuantity(product, desiredQuantity) {
      const productId = product.productId || product.id || product.productID || product.uuid;
      if (!productId) {
        return Promise.reject(new Error('Missing productId for quantity update.'));
      }

      if (Number(desiredQuantity) <= 0) {
        return this.deleteCartItem(productId);
      }

      return this.deleteCartItem(productId)
        .then(() => this.addCartItem({ ...product, quantity: Number(desiredQuantity) }));
    },

    mergeGuestCartToUser(userId) {
      const { local, session } = getStorage();
      const guestId = local.getItem('guestId') || session.getItem('guestId');
      if (!guestId || !userId || guestId === userId) {
        return Promise.resolve('No merge needed.');
      }

      return fetch(`${API_BASE}/api/cart/merge/${guestId}/${userId}`, {
        method: 'POST',
        headers: getAuthHeaders()
      }).then(handleResponse);
    }
  };

  global.KKCart = api;
})(window);
