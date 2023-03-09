import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { deepEqual, deepMerge } from './utils'
import { useValueRef, useEnhancedMemo, useCachedData } from './hooks'
import { Cache } from './cache'
export { Cache } from './cache'

export type ApiVariables<T extends Partial<Record<'body' | 'query' | 'body', any>> = {}> = T

interface ApiConfig<APIs> {
  fetcher: <T>(api: APIs[keyof APIs], variables: ApiVariables) => Promise<T>
}

interface ApiContext<APIs> {
  cache: Cache
  config: ApiConfig<APIs>
}

type ApiProviderProps<T> = React.PropsWithChildren<{
  cache?: Cache
  config: ApiConfig<T>
}>

function createProvider<T>(ctx: React.Context<ApiContext<T>>) {
  return function Provider({
    config,
    children,
    cache = new Cache(),
  }: ApiProviderProps<T>) {

    return (
      <ctx.Provider value={{ config, cache }}>
        {children}
      </ctx.Provider>
    )
  }
}


function reducer<T>(_: T, action: T) {
  return action
}

export interface UseLazyApiOptions<TData, TError, TVariables> {
  variables?: TVariables
  onFetch?: () => Promise<any>
  onCompleted?: (params: { data: TData | null, error: TError | null }) => Promise<any>
}

function createUseLazyApi<
  T,
  TData extends Record<keyof T, any>,
  TError extends Record<keyof T, any>,
  TVariables extends Record<keyof T, any>
>(ctx: React.Context<ApiContext<T>>, apis: T) {
  return function useLazyApi<
    K extends keyof T,
    TApiData extends TData[K],
    TApiError extends TError[K],
    TApiVariables extends TVariables[K]
  >(key: K, defaultOpts: UseLazyApiOptions<TApiData, TApiError, TApiVariables> = {}) {
    const defaultOptsRef = useValueRef(defaultOpts)
    const {
      cache,
      config: { fetcher }
    } = useContext(ctx)
    const [variables, setVariables] = useReducer(reducer as typeof reducer<TApiVariables>, (defaultOpts.variables || {}) as TApiVariables)
    const variablesRef = useValueRef(variables)
    const cacheKey = useMemo(() => JSON.stringify([key, variables]), [key, variables])
    const result = useCachedData(cacheKey, cache)
    const prevResultRef = useRef({})

    const fetch = useCallback(async (opts: Pick<UseLazyApiOptions<TApiData, TApiError, TApiVariables>, 'variables'> = {}) => {
      const api = apis[key]
      const {
        onFetch,
        onCompleted,
        variables = {}
      } = deepMerge(defaultOptsRef.current, opts)

      if (onFetch) await onFetch()

      const cacheKey = JSON.stringify([key, variables])
      cache.set(cacheKey, {
        ...cache.get(cacheKey),
        loading: true
      })

      if (!deepEqual(variables, variablesRef.current)) {
        setVariables(variables as TApiVariables)
      }

      let data = null, error = null
      try {
        data = await fetcher!(api, variables) as TApiData
      } catch (err) {
        error = err as TApiError
      }

      if (onCompleted) await onCompleted({ data, error })

      prevResultRef.current = { data, error }

      cache.set(cacheKey, {
        loading: false,
        data,
        error
      })

      return { data, error }
    }, [key, cache, fetcher, setVariables])

    return [fetch, {
      ...result,
      ...(result.data === undefined && result.error === undefined && prevResultRef.current),
      refetch: fetch
    }] as const
  }
}

function createUseMutationApi<
  T,
  TData extends Record<keyof T, any>,
  TError extends Record<keyof T, any>,
  TVariables extends Record<keyof T, any>
>(ctx: React.Context<ApiContext<T>>, apis: T) {
  const useLazyApi = createUseLazyApi<T, TData, TError, TVariables>(ctx, apis)
  return function useMutationApi<
    K extends keyof T,
    TApiData extends TData[K],
    TApiError extends TError[K],
    TApiVariables extends TVariables[K]
  >(key: K, opts: UseLazyApiOptions<TApiData, TApiError, TApiVariables> = {}) {
    return useLazyApi<K, TApiData, TApiError, TApiVariables>(key, opts)
  }
}

export interface UseApiOptions<TData, TError, TVariables> extends UseLazyApiOptions<TData, TError, TVariables> {
  skip?: boolean
}

function createUseApi<
  T,
  TData extends Record<keyof T, any>,
  TError extends Record<keyof T, any>,
  TVariables extends Record<keyof T, any>
>(ctx: React.Context<ApiContext<T>>, apis: T) {
  const useLazyApi = createUseLazyApi<T, TData, TError, TVariables>(ctx, apis)
  return function useApi<
    K extends keyof T,
    TApiData extends TData[K],
    TApiError extends TError[K],
    TApiVariables extends TVariables[K]
  >(key: K, opts: UseApiOptions<TApiData, TApiError, TApiVariables> = {}) {
    const { skip = false, ...lazyOpts } = opts

    const calledRef = useRef(!skip)
    const loadingRef = useRef(!skip)

    const onFetch = useCallback(async () => {
      calledRef.current = true
      loadingRef.current = true
    }, [])
    const onCompleted = useCallback(async () => {
      loadingRef.current = false
    }, [])
    const [fetch, result] =  useLazyApi<K, TApiData, TApiError, TApiVariables>(key, {
      ...lazyOpts,
      onFetch,
      onCompleted
    })

    const latestVariables = useEnhancedMemo(opts.variables)

    useEffect(() => {
      if (skip) return
      fetch()
    }, [skip, fetch, latestVariables])

    return {
      ...result,
      loading: loadingRef.current,
      called: calledRef.current
    }
  }
}

const missingFetcher = async () => {
  throw new Error('Missing fetcher!')
}

export function createAPIs<
  T,
  TData extends Record<keyof T, any> = any,
  TError extends Record<keyof T, any> = any,
  TVariables extends Record<keyof T, any> = any
>(apis: T) {
  const ctx = createContext<ApiContext<T>>({
    cache: new Cache(),
    config: {
      fetcher: missingFetcher
    },
  })

  return {
    Provider: createProvider(ctx),
    useLazyApi: createUseLazyApi<T, TData, TError, TVariables>(ctx, apis),
    useMutationApi: createUseMutationApi<T, TData, TError, TVariables>(ctx, apis),
    useApi: createUseApi<T, TData, TError, TVariables>(ctx, apis)
  }
}