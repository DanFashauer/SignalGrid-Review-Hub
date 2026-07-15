/**
 * Safe HTTP request utility with timeout protection
 * Prevents hanging connections and Denial-of-Service attacks
 */

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

interface FetchResult<T> {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
  text: () => Promise<string>;
  headers: Headers;
  error?: Error;
}

/**
 * Fetch with timeout protection
 * Default timeout is 10 seconds to prevent hanging connections
 * 
 * @param url - URL to fetch
 * @param options - Fetch options including timeoutMs (default 10000)
 * @returns Response or throws error on timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Network request timeout after ${timeoutMs}ms to ${new URL(url).hostname}`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch JSON with timeout and retry logic
 * 
 * @param url - URL to fetch
 * @param options - Fetch options with timeoutMs, retries, retryDelayMs
 * @returns Parsed JSON response
 */
export async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const { 
    retries = 1, 
    retryDelayMs = 500,
    ...fetchOptions 
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} from ${new URL(url).hostname}: ${response.statusText}`
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt or non-retriable errors
      if (attempt < retries - 1) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  throw lastError;
}

/**
 * Fetch with custom response validation
 * 
 * @param url - URL to fetch
 * @param validator - Function to validate response
 * @param options - Fetch options
 */
export async function fetchWithValidation<T>(
  url: string,
  validator: (response: Response) => Promise<T>,
  options: FetchOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${new URL(url).hostname}`
    );
  }

  return validator(response);
}

/**
 * Request timeout options for different scenarios
 */
export const TIMEOUT_PRESETS = {
  short: 5000,     // Quick health checks
  normal: 10000,   // Standard API calls
  long: 30000,     // Long-running operations like file uploads/downloads
  jwks: 5000,      // JWKS endpoint (should be fast)
} as const;
