import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/** Run an async function on mount and when deps change, with loading/error state and manual reload. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: ApiError | Error; loading: boolean }>({ loading: true });
  const run = useCallback(
    (signal: AbortSignal, keepData: boolean) => {
      setState((s) => ({ data: keepData ? s.data : undefined, loading: !keepData }));
      fn(signal).then(
        (data) => {
          if (!signal.aborted) setState({ data, loading: false });
        },
        (error: unknown) => {
          if (signal.aborted || (error as Error)?.name === 'AbortError') return;
          setState((s) => ({ data: s.data, error: error as Error, loading: false }));
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    ctl.current?.abort();
    ctl.current = new AbortController();
    run(ctl.current.signal, false);
    return () => ctl.current?.abort();
  }, [run]);
  const reload = useCallback(() => {
    ctl.current?.abort();
    ctl.current = new AbortController();
    run(ctl.current.signal, true);
  }, [run]);
  return { ...state, reload };
}

/** Re-run `reload` every `ms` while the tab is visible. */
export function usePolling(reload: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const id = window.setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [reload, ms, enabled]);
}

/** Set the document title and meta description for the current route. */
export function usePageMeta(title: string, description: string, opts: { index?: boolean } = {}) {
  useEffect(() => {
    document.title = title;
    const set = (name: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.name = name;
        document.head.appendChild(el);
      }
      el.content = content;
    };
    set('description', description);
    set('robots', opts.index === false ? 'noindex, nofollow' : 'index, follow');
    const og = (prop: string, content: string) => {
      const el = document.head.querySelector<HTMLMetaElement>(`meta[property="${prop}"]`);
      if (el) el.content = content;
    };
    og('og:title', title);
    og('og:description', description);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (opts.index === false) {
      link?.remove();
    } else {
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = `${window.location.origin}${window.location.pathname}`;
    }
  }, [title, description, opts.index]);
}

/** Move focus to the page heading when the route changes, so keyboard and screen-reader users land at the top of the new page. */
export function useFocusHeading(dep: unknown) {
  useEffect(() => {
    const h = document.querySelector<HTMLElement>('main h1');
    if (h) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: false });
    }
  }, [dep]);
}

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
