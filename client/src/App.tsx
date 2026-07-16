import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RatesPage } from "./RatesPage";

// App owns a QueryClient so it is self-contained (renderable directly in unit tests).
// retry:false keeps failures fast and deterministic in tests and the UI.
export default function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RatesPage />
    </QueryClientProvider>
  );
}
