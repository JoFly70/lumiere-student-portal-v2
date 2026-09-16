import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthToken } from "./api";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  
  // Add auth token if available
  const accessToken = getAuthToken();
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function buildQueryKeyUrl(queryKey: readonly unknown[]): string {
  const pathSegments: string[] = [];
  const searchParams = new URLSearchParams();

  for (const keyPart of queryKey) {
    if (typeof keyPart === "string" || (typeof keyPart === "number" && Number.isFinite(keyPart))) {
      pathSegments.push(String(keyPart));
      continue;
    }

    if (!isPlainObject(keyPart)) {
      continue;
    }

    for (const [key, value] of Object.entries(keyPart)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      ) {
        searchParams.append(key, String(value));
      }
    }
  }

  const path = pathSegments.join("/");
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = {};
    
    // Add auth token if available
    const accessToken = getAuthToken();
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
    
    const res = await fetch(buildQueryKeyUrl(queryKey), {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
