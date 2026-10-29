import type { UseQueryResult } from "@tanstack/react-query";

/** The slice of a TanStack query the tabs need (so tests and tabs do not depend on the whole result). */
export type Query<T> = Pick<UseQueryResult<T, Error>, "data" | "isLoading" | "isError" | "error" | "refetch">;
