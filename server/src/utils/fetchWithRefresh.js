const API_BASE_URL = process.env.BACKEND_URL || (typeof window !== 'undefined' ? '' : 'http://localhost:5000');

export async function fetchWithRefresh(url, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: options.credentials || 'include',
  });

  // No automatic refresh-token retry. Caller should handle 401.
  if (!response.ok && response.status >= 500) {
    try {
      const errorText = await response.text();
      console.error(`Server error ${response.status} for ${options.method || 'GET'} ${url}:`, errorText);
    } catch (_e) {
      console.error(`Server error ${response.status} for ${options.method || 'GET'} ${url}`);
    }
  }

  return response;
}
