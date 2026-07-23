import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RatesPage } from "./RatesPage";
import { ChatPanel } from "./components/ChatPanel";

// App owns a QueryClient so it is self-contained (renderable directly in unit tests).
// retry:false on BOTH queries and mutations keeps failures fast and deterministic — and, for the
// redeem mutation, guarantees the UI never turns one Confirm click into two redeems (D14 Cond. 6).
export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RatesPage />
      <ChatPanel />
    </QueryClientProvider>
  );
}
