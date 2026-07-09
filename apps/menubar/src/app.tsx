import { createPortal } from "react-dom";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { reportRuntimeError } from "./utils/query-utils.js";
import { AppErrorBoundary } from "./ui/app-error-boundary.js";
import { AppLayout } from "./ui/app-layout.js";
import { ToastHost } from "./ui/toast/toast-host.js";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: reportRuntimeError,
  }),
  mutationCache: new MutationCache({
    onError: reportRuntimeError,
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <AppLayout />
      </AppErrorBoundary>
      {createPortal(<ToastHost />, document.body)}
    </QueryClientProvider>
  );
}
