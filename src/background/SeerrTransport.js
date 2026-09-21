// Focused worker methods; composed onto SeerrAPI by background.js.
(function (root) {
  const RatingsConfig = root.RatingsConfig;
  root.SeerrTransport = {
    async makeAPIRequest(method, endpoint, data = null) {
      if (method === 'GET') {
        // Request pages are identical across title lookups. Details can also be
        // reused by identity validation and the final status lookup.
        if (/^\/api\/v1\/(request(?:\?|$)|(?:movie|tv)\/\d+$)/.test(endpoint)) {
          return this.cachedSeerrRead(`api:${endpoint}`, () => this.sendAPIRequest(method, endpoint, data), 10000);
        }
        return this.sendAPIRequest(method, endpoint, data);
      }
      this.invalidateSeerrReads();
      try {
        return await this.sendAPIRequest(method, endpoint, data);
      } finally {
        // A lost write reply may still have changed the server. Reads started
        // during the write cannot remain cached after it settles either.
        this.invalidateSeerrReads();
      }
    },

    async sendAPIRequest(method, endpoint, data = null) {
      if (!this.baseUrl || !this.apiKey) {
        throw new Error('Server URL and API key must be configured');
      }

      const url = `${this.baseUrl.replace(/\/$/, '')}${endpoint}`;
      const options = {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey
        }
      };

      if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        options.body = JSON.stringify(data);
      }

      try {
        const response = await fetch(url, options);

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = await response.json();
            if (errorData.message) errorMessage = errorData.message;
          } catch (_) {}
          throw new Error(errorMessage);
        }

        return response.status === 204 ? null : await response.json();
      } catch (error) {
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
          throw new Error('Could not connect to Seerr server. Please check the URL and your network connection.');
        }
        throw error;
      }
    },
  };
})(globalThis);
