import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';

const HEALTH_ENDPOINT = '/minutas-api/health';
const CONFIGURED_SERVICE_URL = String(import.meta.env.VITE_MINUTAS_SERVICE_URL || '').trim();
const EXTERNAL_SERVICE_URL = (() => {
  if (!CONFIGURED_SERVICE_URL) return null;

  try {
    const url = new URL(CONFIGURED_SERVICE_URL);
    if (
      url.protocol !== 'https:' || url.username || url.password ||
      url.origin === window.location.origin ||
      url.hostname.includes('villa-hermosa') ||
      url.hostname.includes('villahermosa')
    ) return null;

    return url.href;
  } catch {
    return null;
  }
})();
const IS_EXTERNAL_SERVICE = EXTERNAL_SERVICE_URL !== null;
const IS_LOCAL_SERVICE = false;
const IS_UNCONFIGURED = !IS_EXTERNAL_SERVICE && !IS_LOCAL_SERVICE;
const MINUTAS_SERVICE_URL = EXTERNAL_SERVICE_URL ?? '/minutas-service/';

type ServiceState = 'checking' | 'ready' | 'error' | 'unconfigured';

export default function MinutasWorkspace() {
  const [serviceState, setServiceState] = useState<ServiceState>(
    IS_UNCONFIGURED ? 'unconfigured' : 'checking',
  );
  const [frameLoading, setFrameLoading] = useState(true);

  const checkService = useCallback(async (signal?: AbortSignal) => {
    setServiceState('checking');

    try {
      const response = await fetch(HEALTH_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });

      if (!response.ok) throw new Error('Health check failed');
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new Error('Health check did not return JSON');
      }

      const payload = await response.json() as { ok?: unknown; service?: unknown };
      if (payload.ok !== true || payload.service !== 'San Bartolomeo Minutas') {
        throw new Error('Unexpected service');
      }

      setFrameLoading(true);
      setServiceState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setServiceState('error');
    }
  }, []);

  useEffect(() => {
    if (IS_UNCONFIGURED) return;

    if (IS_EXTERNAL_SERVICE) {
      setServiceState('ready');
      setFrameLoading(true);
      return;
    }

    const controller = new AbortController();
    void checkService(controller.signal);
    return () => controller.abort();
  }, [checkService]);

  if (serviceState === 'unconfigured') {
    return (
      <section className="grid min-h-[680px] place-items-center" aria-label="Sistema de Minutas">
        <div className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-lg">
          <CircleAlert className="mx-auto h-8 w-8 text-amber-700" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold text-[#33204f]">Minutas de San Bartolomeo aún no está configurado</h1>
          <p className="mt-2 text-sm leading-6 text-[#697386]">Se conectará únicamente cuando exista un servicio y una plantilla propios para esta empresa.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative h-[calc(100dvh-5.5rem)] min-h-[680px] overflow-hidden rounded-2xl border border-[#d9ddd9] bg-white shadow-sm"
      aria-label="Sistema de Minutas San Bartolomeo"
      aria-busy={serviceState === 'checking' || frameLoading}
    >
      {serviceState === 'checking' && (
        <div className="absolute inset-0 z-10 space-y-5 bg-[#f7f7f3] p-5 sm:p-7" role="status" aria-live="polite">
          <span className="sr-only">Cargando el sistema de Minutas</span>
          <div className="flex animate-pulse items-center gap-3 motion-reduce:animate-none">
            <div className="h-11 w-11 rounded-2xl bg-[#dfe7e4]" />
            <div className="space-y-2">
              <div className="h-4 w-44 rounded-full bg-[#dfe7e4]" />
              <div className="h-3 w-64 max-w-[70vw] rounded-full bg-[#e9ece9]" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="h-[580px] animate-pulse rounded-2xl bg-[#e9ece9] motion-reduce:animate-none" />
            <div className="space-y-4">
              <div className="h-36 animate-pulse rounded-2xl bg-[#dfe7e4] motion-reduce:animate-none" />
              <div className="h-72 animate-pulse rounded-2xl bg-[#e9ece9] motion-reduce:animate-none" />
            </div>
          </div>
        </div>
      )}

      {serviceState === 'error' && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#f7f7f3] p-5">
          <div className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-lg">
            <CircleAlert className="mx-auto h-8 w-8 text-rose-700" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-[#33204f]">No pudimos abrir Minutas</h1>
            <p className="mt-2 text-sm leading-6 text-[#697386]">El servicio local no está disponible. Tus datos permanecen sin cambios.</p>
            <button
              type="button"
              onClick={() => void checkService()}
              className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#54317f] px-5 text-sm font-semibold text-white transition hover:bg-[#3b225d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5c3585] focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        </div>
      )}

      {serviceState === 'ready' && (
        <>
          {frameLoading && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-white/90">
              <div className="text-center" role="status" aria-live="polite">
                <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-[#5c3585] motion-reduce:animate-none" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-[#33204f]">Preparando Minutas…</p>
              </div>
            </div>
          )}
          <iframe
            src={MINUTAS_SERVICE_URL}
            title="Sistema de generación de minutas San Bartolomeo"
            className="h-full w-full border-0 bg-white"
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setFrameLoading(false)}
          />
        </>
      )}
    </section>
  );
}
